import { describe, expect, it } from "vitest";
import { findJavaSyntaxProblems } from "./java-syntax";

const clean = (source: string) => findJavaSyntaxProblems(source);

describe("instant Java syntax check", () => {
  it("stays silent on valid code", () => {
    expect(clean([
      "package de.demo;",
      "",
      "/** Javadoc with a { brace and a \" quote. */",
      "public class Demo {",
      "    private static final String NOTE = \"a } and a ) in a string\";",
      "    private char slash = '\\\\';",
      "    private char quote = '\\'';",
      "    // A line comment with ( and [",
      "    void run(int[] values) {",
      "        if (values.length > 0) { System.out.println(NOTE); }",
      "    }",
      "}",
    ].join("\n"))).toEqual([]);
  });

  it("accepts a text block containing quotes and braces", () => {
    expect(clean([
      "public class Demo {",
      "    String sql = \"\"\"",
      "        SELECT { \" FROM t",
      "        \"\"\";",
      "}",
    ].join("\n"))).toEqual([]);
  });

  it("points at the brace that is never closed", () => {
    const problems = clean([
      "public class Demo {",
      "    void run() {",
      "        int value = 1;",
      "}",
    ].join("\n"));
    expect(problems).toEqual([
      { line: 1, column: 19, length: 1, kind: "unclosed-bracket", message: expect.stringContaining("geschweifte Klammer") },
    ]);
  });

  it("flags a closing bracket with nothing to close", () => {
    const problems = clean("void run() {}\n}\n");
    expect(problems).toEqual([
      { line: 2, column: 1, length: 1, kind: "unexpected-bracket", message: expect.stringContaining("nie geöffnet") },
    ]);
  });

  it("flags brackets that do not match", () => {
    const problems = clean("void run(int a] {}\n");
    expect(problems[0]).toMatchObject({ line: 1, column: 15, kind: "mismatched-bracket" });
  });

  it("finds an unterminated string on its own line", () => {
    const problems = clean([
      "public class Demo {",
      "    String broken = \"not closed;",
      "}",
    ].join("\n"));
    expect(problems).toEqual([
      // The span reaches to the line break the literal failed to close before,
      // so jumping to it highlights the whole broken literal.
      { line: 2, column: 21, length: 12, kind: "unterminated-string", message: expect.stringContaining("Zeichenkette") },
    ]);
  });

  it("finds an unterminated block comment", () => {
    const problems = clean([
      "public class Demo {",
      "    /* started but never finished",
      "    void run() {}",
    ].join("\n"));
    expect(problems.some((problem) => problem.kind === "unterminated-comment")).toBe(true);
    expect(problems.find((problem) => problem.kind === "unterminated-comment")).toMatchObject({ line: 2, column: 5, length: 2 });
  });

  it("does not trip over brackets inside comments and literals", () => {
    expect(clean([
      "public class Demo {",
      "    // }",
      "    /* ) ] */",
      "    String s = \"{ [ (\";",
      "    char c = '}';",
      "}",
    ].join("\n"))).toEqual([]);
  });

  it("reports several problems in source order", () => {
    const problems = clean([
      "void a() {}",
      "]",
      "String s = \"open;",
      "int b = (1;",
    ].join("\n"));
    expect(problems.map((problem) => [problem.line, problem.kind])).toEqual([
      [2, "unexpected-bracket"],
      [3, "unterminated-string"],
      [4, "unclosed-bracket"],
    ]);
  });

  it("gives every problem a span that can be selected", () => {
    const problems = clean([
      "void a() {",
      "  ]",
      "  String s = \"open;",
    ].join("\n"));
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.length, problem.kind).toBeGreaterThan(0);
    }
  });

  it("blames the wrong closer rather than the whole rest of the file", () => {
    // "]" closes the block that "{" opened, so the mismatch is the finding —
    // reporting the following lines as unbalanced too would bury it.
    const problems = clean("void a() {\n  ]\n");
    expect(problems.map((problem) => problem.kind)).toEqual(["mismatched-bracket"]);
    expect(problems[0]).toMatchObject({ line: 2, column: 3 });
  });
});
