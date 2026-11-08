import { describe, expect, it } from "vitest";
import { preserveTypedWhitespace } from "../src/language/format-whitespace";

/**
 * What "Format beim Speichern" is allowed to change.
 *
 * The Eclipse formatter re-indents every line to its own idea of the right
 * depth, strips whatever follows the last character, and empties lines that
 * hold only spaces. Somebody who lines a block up by hand, or leaves an
 * indented blank line to type on next, watched that disappear on every save.
 *
 * The formatter keeps the part of its work that is about the code. The
 * whitespace around it belongs to whoever wrote the file.
 */
describe("keeping the whitespace a file was written with", () => {
  it("takes the formatter's spacing inside a line and the author's around it", () => {
    const original = "class A {\n\t\tint c=3;   \n}\n";
    const formatted = "class A {\n    int c = 3;\n}\n";

    // The tabs and the three trailing spaces are the author's; "int c = 3;"
    // is the formatter's.
    expect(preserveTypedWhitespace(original, formatted)).toBe("class A {\n\t\tint c = 3;   \n}\n");
  });

  it("keeps a blank line that holds indentation", () => {
    const original = "class A {\n\tvoid a() {\n\t\tint x = 1;\n\t\t\n\t\tint y = 2;\n\t}\n}\n";
    // Eclipse empties the whitespace-only line and re-indents with spaces.
    const formatted = "class A {\n    void a() {\n        int x = 1;\n\n        int y = 2;\n    }\n}\n";

    expect(preserveTypedWhitespace(original, formatted)).toBe(original);
  });

  it("keeps blank lines the formatter would have deleted", () => {
    const original = "class A {\n\tint a = 1;\n\n\n\n\tint b = 2;\n}\n";
    const formatted = "class A {\n\tint a = 1;\n\n\tint b = 2;\n}\n";

    expect(preserveTypedWhitespace(original, formatted)).toBe(original);
  });

  it("keeps tabs when the file was written with tabs", () => {
    const original = "class A {\n\t\tint value=1;\n}\n";
    const formatted = "class A {\n    int value = 1;\n}\n";

    const kept = preserveTypedWhitespace(original, formatted);
    expect(kept).toContain("\t\tint value = 1;");
    expect(kept).not.toContain("    int value");
  });

  it("lets the formatter add a line", () => {
    const original = "class A {\n\tint a = 1;\n}\n";
    // A formatter that inserts a blank line between members.
    const formatted = "class A {\n\tint a = 1;\n\n\tint b = 2;\n}\n";

    expect(preserveTypedWhitespace(original, formatted)).toBe(formatted);
  });

  it("lets the formatter remove a line that had something on it", () => {
    const original = "class A {\n\tint a = 1;\n\tint unused = 2;\n}\n";
    const formatted = "class A {\n\tint a = 1;\n}\n";

    expect(preserveTypedWhitespace(original, formatted)).toBe(formatted);
  });

  it("gives a rewritten line to the formatter, indentation and all", () => {
    const original = "class A {\n        int a = 1;\n}\n";
    // Nothing here matches the old line, so it is a change rather than a move.
    const formatted = "class A {\n    long total = compute(a, b);\n}\n";

    expect(preserveTypedWhitespace(original, formatted)).toBe(formatted);
  });

  it("keeps the line endings the file had", () => {
    const original = "class A {\r\n\t\tint c=3;\r\n}\r\n";
    const formatted = "class A {\n    int c = 3;\n}\n";

    const kept = preserveTypedWhitespace(original, formatted);
    expect(kept).toBe("class A {\r\n\t\tint c = 3;\r\n}\r\n");
    expect(kept.includes("\n\n")).toBe(false);
  });

  it("answers with the formatted text when there is nothing to keep", () => {
    expect(preserveTypedWhitespace("", "class A {}")).toBe("class A {}");
    expect(preserveTypedWhitespace("class A {}", "")).toBe("");
    expect(preserveTypedWhitespace("same", "same")).toBe("same");
  });

  it("survives a file whose lines all moved", () => {
    // Far past the window the walk looks in, so it may not realign — but it
    // must still answer with a whole file rather than a truncated one.
    const original = Array.from({ length: 400 }, (_, index) => `\tint a${index} = ${index};`).join("\n");
    const formatted = Array.from({ length: 400 }, (_, index) => `    int b${index} = ${index};`).join("\n");

    const kept = preserveTypedWhitespace(original, formatted);
    expect(kept.split("\n")).toHaveLength(400);
    expect(kept).toContain("int b399 = 399;");
  });

  it("stays fast on a large file", () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `\t\tint value${index}=${index};`);
    const original = lines.join("\n");
    const formatted = lines.map((line) => line.replace("=", " = ").replace(/^\t\t/, "    ")).join("\n");

    const started = Date.now();
    const kept = preserveTypedWhitespace(original, formatted);
    // The save path runs this; a quadratic walk here would be seconds.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(kept.startsWith("\t\tint value0 = 0;")).toBe(true);
  });
});
