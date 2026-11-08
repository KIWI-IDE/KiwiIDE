import { describe, expect, it } from "vitest";
import {
  binaryClassName,
  bytecodeMethods,
  bytecodeOffsetsForLine,
  bytecodeTitle,
  readBytecode,
} from "../src/language/bytecode-view";

const JAVAP = [
  "Compiled from \"SpielerVerwaltung.java\"",
  "public class de.beispiel.plugin.SpielerVerwaltung {",
  "  public de.beispiel.plugin.SpielerVerwaltung();",
  "    Code:",
  "       0: aload_0",
  "       1: invokespecial #1                  // Method java/lang/Object.\"<init>\":()V",
  "       4: return",
  "    LineNumberTable:",
  "      line 8: 0",
  "",
  "  public boolean istVoll(java.lang.String);",
  "    Code:",
  "       0: aload_0",
  "       1: invokevirtual #7                  // Method online:(Ljava/lang/String;)Ljava/util/List;",
  "       9: ireturn",
  "    LineNumberTable:",
  "      line 24: 0",
  "      line 25: 9",
  "}",
].join("\n");

/**
 * The question comes up rarely and matters entirely when it does: what a
 * lambda captures, which overload a call picked, what a record generates.
 */
describe("naming the class a file becomes", () => {
  it("puts the package in front of the file's own name", () => {
    expect(binaryClassName("C:/p/src/main/java/de/beispiel/Welt.java", "package de.beispiel;\nclass Welt {}"))
      .toBe("de.beispiel.Welt");
  });

  it("takes a class in the default package", () => {
    expect(binaryClassName("C:/p/src/Welt.java", "class Welt {}")).toBe("Welt");
  });

  it("reads a Windows path the same way", () => {
    expect(binaryClassName("C:\\p\\src\\de\\Welt.java", "package de;")).toBe("de.Welt");
  });

  it("answers nothing for something that is not a Java file", () => {
    // Reported rather than guessed past.
    expect(binaryClassName("C:/p/pom.xml", "")).toBe("");
    expect(binaryClassName("", "package de;")).toBe("");
  });

  it("names the tab after the class, not the file", () => {
    expect(bytecodeTitle("de.beispiel.Welt")).toBe("Welt.bytecode");
    expect(bytecodeTitle("")).toBe("bytecode");
  });
});

/**
 * The commonest failure by far is a class that has not been compiled yet, and
 * "class not found" is not what somebody who just pressed a button needs.
 */
describe("reading javap's answer", () => {
  it("hands back what it printed", () => {
    const result = readBytecode(JAVAP, "", "de.beispiel.plugin.SpielerVerwaltung");
    expect(result.problem).toBe("");
    expect(result.text).toContain("invokevirtual");
  });

  it("says to build the project when the class is not there yet", () => {
    const result = readBytecode("", "error: class not found: de.beispiel.Welt", "de.beispiel.Welt");
    expect(result.text).toBe("");
    expect(result.problem).toContain("noch nicht übersetzt");
  });

  it("passes on another failure rather than inventing a reason for it", () => {
    const result = readBytecode("", "error: invalid flag: -q", "de.beispiel.Welt");
    expect(result.problem).toContain("invalid flag");
  });

  it("says so when javap printed nothing at all", () => {
    expect(readBytecode("", "", "de.beispiel.Welt").problem).toContain("nichts ausgegeben");
  });
});

/**
 * -l prints a LineNumberTable, which is what makes it possible to put the
 * caret on a line and see the instructions it became.
 */
describe("finding where a source line ended up", () => {
  it("names the offsets for a line", () => {
    expect(bytecodeOffsetsForLine(JAVAP, 24)).toEqual([0]);
    expect(bytecodeOffsetsForLine(JAVAP, 8)).toEqual([0]);
  });

  it("answers nothing for a line that produced no code", () => {
    expect(bytecodeOffsetsForLine(JAVAP, 999)).toEqual([]);
    expect(bytecodeOffsetsForLine(JAVAP, 0)).toEqual([]);
  });

  it("answers nothing for a build that carries no line numbers", () => {
    expect(bytecodeOffsetsForLine("public class A {\n}", 3)).toEqual([]);
  });
});

describe("listing the methods", () => {
  it("reads the declarations, not the instructions", () => {
    const methods = bytecodeMethods(JAVAP);
    expect(methods).toContain("public boolean istVoll(java.lang.String)");
    expect(methods).toContain("public de.beispiel.plugin.SpielerVerwaltung()");
    expect(methods.some((method) => method.includes("invokevirtual"))).toBe(false);
  });

  it("says nothing about an empty listing", () => {
    expect(bytecodeMethods("")).toEqual([]);
  });
});
