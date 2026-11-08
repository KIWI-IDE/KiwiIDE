import { describe, expect, it } from "vitest";
import {
  describeBreakpoint,
  memberAtCaret,
  memberBreakpoint,
  memberOnLine,
  sameBreakpoint,
} from "../src/debug-member-breakpoints";

const SOURCE = [
  "package de.beispiel.plugin;",                      // 1
  "",                                                  // 2
  "public class SpielerVerwaltung {",                  // 3
  "",                                                  // 4
  "    private int maximum = 100;",                    // 5
  "    static final String NAME = \"welt\";",          // 6
  "",                                                  // 7
  "    public boolean istVoll(String welt) {",         // 8
  "        int lokal = 0;",                            // 9
  "        if (lokal > maximum) {",                    // 10
  "            pruefe(welt);",                         // 11
  "        }",                                         // 12
  "        return false;",                             // 13
  "    }",                                             // 14
  "",                                                  // 15
  "    void pruefe(String welt) {}",                   // 16
  "}",                                                 // 17
].join("\n");

/**
 * A field breakpoint answers "who put that value there", which no line
 * breakpoint can — but only if it lands on the field somebody meant.
 */
describe("reading the declaration under the caret", () => {
  it("finds a field", () => {
    expect(memberAtCaret(SOURCE, 5)).toEqual({ kind: "field", name: "maximum" });
    expect(memberAtCaret(SOURCE, 6)).toEqual({ kind: "field", name: "NAME" });
  });

  it("finds a method", () => {
    expect(memberAtCaret(SOURCE, 8)).toEqual({ kind: "method", name: "istVoll" });
    expect(memberAtCaret(SOURCE, 16)).toEqual({ kind: "method", name: "pruefe" });
  });

  it("does not take a local variable for a field", () => {
    // The VM would refuse a watchpoint on one, and the failure would surface
    // as a debugger that silently never stops.
    expect(memberAtCaret(SOURCE, 9)).toBeNull();
  });

  it("does not take a call for a method declaration", () => {
    expect(memberAtCaret(SOURCE, 11)).toBeNull();
  });

  it("does not take a control structure for a method", () => {
    expect(memberAtCaret(SOURCE, 10)).toBeNull();
    expect(memberOnLine("        if (lokal > maximum) {")).toBeNull();
    expect(memberOnLine("        while (true) {")).toBeNull();
    expect(memberOnLine("        for (String welt : welten) {")).toBeNull();
    expect(memberOnLine("        } catch (IOException error) {")).toBeNull();
  });

  it("answers nothing on a blank line, a comment or an annotation", () => {
    expect(memberAtCaret(SOURCE, 4)).toBeNull();
    expect(memberOnLine("    // private int maximum = 100;")).toBeNull();
    expect(memberOnLine("     * @param welt die Welt")).toBeNull();
    expect(memberOnLine("    @Override")).toBeNull();
  });

  it("answers nothing outside the file", () => {
    expect(memberAtCaret(SOURCE, 0)).toBeNull();
    expect(memberAtCaret(SOURCE, 999)).toBeNull();
    expect(memberAtCaret("", 1)).toBeNull();
  });

  it("is not confused by a brace inside a string", () => {
    // The depth count is what separates a field from a local, and a brace in a
    // string would shift every line after it.
    const source = [
      "class A {",
      "    String muster = \"{\";",
      "    private int zaehler = 0;",
      "}",
    ].join("\n");
    expect(memberAtCaret(source, 3)).toEqual({ kind: "field", name: "zaehler" });
  });

  it("is not confused by a brace inside a comment", () => {
    const source = [
      "class A {",
      "    // } das war es",
      "    private int zaehler = 0;",
      "}",
    ].join("\n");
    expect(memberAtCaret(source, 3)).toEqual({ kind: "field", name: "zaehler" });
  });

  it("reads an abstract method, which has no body", () => {
    expect(memberOnLine("    void schreibe(String inhalt);")).toEqual({ kind: "method", name: "schreibe" });
  });

  it("reads a method that declares a checked exception", () => {
    expect(memberOnLine("    void lies(Path pfad) throws IOException {"))
      .toEqual({ kind: "method", name: "lies" });
  });

  it("reads a generic field", () => {
    expect(memberOnLine("    private List<Spieler> online = new ArrayList<>();"))
      .toEqual({ kind: "field", name: "online" });
  });

  it("does not take an assignment for a declaration", () => {
    expect(memberOnLine("        maximum = 5;")).toBeNull();
  });
});

describe("making the breakpoint", () => {
  it("watches writes to a field, not reads", () => {
    // A read breakpoint fires on every mention and stops a hundred times
    // before the write anybody was looking for.
    expect(memberBreakpoint("de.beispiel.A", { kind: "field", name: "maximum" }))
      .toMatchObject({ type: "field", fieldName: "maximum", onWrite: true, onRead: false });
  });

  it("stops on entering a method, not on leaving it", () => {
    expect(memberBreakpoint("de.beispiel.A", { kind: "method", name: "istVoll" }))
      .toMatchObject({ type: "method", methodName: "istVoll", onEntry: true, onExit: false });
  });

  it("answers nothing without a class", () => {
    expect(memberBreakpoint("", { kind: "field", name: "maximum" })).toBeNull();
    expect(memberBreakpoint("de.beispiel.A", { kind: "field", name: "" })).toBeNull();
  });
});

describe("how a breakpoint reads in the list", () => {
  it("names the member and what it stops on", () => {
    expect(describeBreakpoint({ type: "field", className: "de.beispiel.A", line: 0, fieldName: "maximum", onWrite: true }))
      .toBe("A.maximum (schreiben)");
    expect(describeBreakpoint({ type: "field", className: "de.beispiel.A", line: 0, fieldName: "maximum", onRead: true }))
      .toBe("A.maximum (lesen/schreiben)");
    expect(describeBreakpoint({ type: "method", className: "de.beispiel.A", line: 0, methodName: "lauf", onExit: true }))
      .toBe("A.lauf() (Eintritt/Austritt)");
  });

  it("leaves a line breakpoint reading the way it always did", () => {
    expect(describeBreakpoint({ className: "de.beispiel.A", line: 42 })).toBe("de.beispiel.A:42");
    expect(describeBreakpoint({ type: "exception", className: "java.lang.Throwable", line: 0 }))
      .toBe("java.lang.Throwable");
  });
});

/**
 * Every member breakpoint on a class carries line 0, so the identity the list
 * used before would make them all the same breakpoint.
 */
describe("telling two breakpoints apart", () => {
  const field = (name: string) => ({ type: "field" as const, className: "A", line: 0, fieldName: name });

  it("keeps two fields of one class apart", () => {
    expect(sameBreakpoint(field("a"), field("b"))).toBe(false);
    expect(sameBreakpoint(field("a"), field("a"))).toBe(true);
  });

  it("keeps a field and a method of the same name apart", () => {
    expect(sameBreakpoint(field("lauf"), { type: "method", className: "A", line: 0, methodName: "lauf" })).toBe(false);
  });

  it("still tells line breakpoints apart by file", () => {
    expect(sameBreakpoint({ className: "A", line: 5, path: "a/A.java" }, { className: "A", line: 5, path: "b/A.java" }))
      .toBe(false);
    expect(sameBreakpoint({ className: "A", line: 5 }, { className: "A", line: 6 })).toBe(false);
  });
});
