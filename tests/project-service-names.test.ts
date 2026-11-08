import { describe, expect, it } from "vitest";

const {
  JAVA_RESERVED,
  projectDefaults,
  safeJavaIdentifier,
  safePackage,
} = require("../electron/services/project-service.cjs");

describe("names that end up in generated Java", () => {
  it("keeps a name Java would accept", () => {
    expect(safeJavaIdentifier("Main", "app")).toBe("Main");
    expect(safeJavaIdentifier("_helper$2", "app")).toBe("_helper$2");
  });

  it("strips what an identifier may not contain", () => {
    expect(safeJavaIdentifier("mein projekt!", "app")).toBe("meinprojekt");
    expect(safeJavaIdentifier("äöü-name", "app")).toBe("name");
  });

  it("falls back when nothing usable is left", () => {
    // A name that cannot start an identifier is not repaired into something
    // arbitrary: the caller's fallback is what the project is named after.
    expect(safeJavaIdentifier("123", "app")).toBe("app");
    expect(safeJavaIdentifier("", "app")).toBe("app");
    expect(safeJavaIdentifier("!!!", "fallback")).toBe("fallback");
  });

  it("escapes a Java keyword instead of writing code that cannot compile", () => {
    // This went straight into `package …;` and into module-info.java. A user
    // who called their package "class" got a project that did not build, with
    // the reason sitting in a file they never wrote.
    expect(safeJavaIdentifier("class", "app")).toBe("class_");
    expect(safeJavaIdentifier("new", "app")).toBe("new_");
    expect(safeJavaIdentifier("goto", "app")).toBe("goto_");
  });

  it("escapes the literals and the underscore Java took back", () => {
    expect(safeJavaIdentifier("null", "app")).toBe("null_");
    expect(safeJavaIdentifier("true", "app")).toBe("true_");
    // Java 9 made a lone underscore a keyword of its own.
    expect(safeJavaIdentifier("_", "app")).toBe("__");
  });

  it("catches a keyword whatever case it was typed in", () => {
    // The package name is lower-cased afterwards, so "Class" would have
    // become "class" and slipped through a case-sensitive check.
    expect(safePackage("com.Class.util")).toBe("com.class_.util");
    expect(safePackage("com.INT.x")).toBe("com.int_.x");
  });

  it("has a keyword list that covers what the language reserves", () => {
    for (const word of ["class", "interface", "enum", "package", "import", "static", "void"]) {
      expect({ word, reserved: JAVA_RESERVED.has(word) }).toEqual({ word, reserved: true });
    }
    expect(JAVA_RESERVED.has("main")).toBe(false);
    expect(JAVA_RESERVED.has("app")).toBe(false);
  });
});

describe("the package a new project gets", () => {
  it("lower-cases every part, the way Java packages are written", () => {
    expect(safePackage("Com.Example.App")).toBe("com.example.app");
  });

  it("replaces a part that cannot be an identifier", () => {
    expect(safePackage("com.2fast.app")).toBe("com.app.app");
    expect(safePackage("com..app")).toBe("com.app.app");
  });

  it("stands in for a package nobody gave", () => {
    expect(safePackage("")).toBe("com.example");
    expect(safePackage(null)).toBe("com.example");
  });

  it("keeps a package that was already fine untouched", () => {
    expect(safePackage("org.beispiel.werkzeug")).toBe("org.beispiel.werkzeug");
  });
});

describe("what a project starts out with", () => {
  it("names a language level and an encoding rather than leaving them empty", () => {
    // These are written into build files, and an empty value there is a build
    // that fails on a machine other than the one it was made on.
    expect(projectDefaults.languageLevel).toBeTruthy();
    expect(projectDefaults.encoding).toBe("UTF-8");
  });

  it("leaves the JDK path to be chosen rather than guessing one", () => {
    expect(projectDefaults.jdkPath).toBe("");
  });
});
