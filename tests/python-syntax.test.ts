import { describe, expect, it } from "vitest";
import { findPythonSyntaxProblems } from "../src/language/python-syntax";

const clean = (source: string) => findPythonSyntaxProblems(source);

describe("instant Python syntax check", () => {
  it("stays silent on valid Python code", () => {
    const code = [
      "import os",
      "from typing import List, Optional",
      "",
      "# A comment with ( [ { and \"quotes\"",
      "def greet(name: str, times: int = 1) -> List[str]:",
      "    \"\"\"Docstring with 'single' and \"double\" quotes.\"\"\"",
      "    result = []",
      "    for i in range(times):",
      "        msg = f\"Hello, {name}! Index: {i}\"",
      "        result.append(msg)",
      "    return result",
      "",
      "class Person:",
      "    def __init__(self, name: str):",
      "        self.name = name",
      "",
      "    def say_hi(self):",
      "        if self.name == 'Alice':",
      "            print('Welcome Alice')",
      "        elif self.name == 'Bob':",
      "            print('Welcome Bob')",
      "        else:",
      "            print('Welcome guest')",
    ].join("\n");

    expect(clean(code)).toEqual([]);
  });

  it("accepts the multiline game UI calls and tuples from the reported example", () => {
    const code = `def build_ui():
    title_text = Text('BLOCKWELT', parent=camera.ui, x=-.85, y=.45, scale=1.35,
                     color=color.white)
    help_text = Text('WASD: Gehen | Maus: Blick',
                    parent=camera.ui, x=-.85, y=.405, scale=.7, color=color.white)
    slots: list[Entity] = []
    for i, block in enumerate(HOTBAR):
        x = (i - (len(HOTBAR) - 1) / 2) * .115
        frame = Entity(parent=camera.ui, model='quad', position=(x, -.425),
                       scale=(.105, .105), color=color.rgba(34, 39, 48, 235))
        Entity(parent=frame, model='quad', z=-.01, scale=(.74, .74),
               color=color.rgb(*BLOCK_TYPES[block][1]))
        Text(str(i + 1), parent=camera.ui, position=(x - .045, -.39),
             scale=.72, color=color.white)
        slots.append(frame)
    return slots
`;
    expect(clean(code)).toEqual([]);
    expect(clean(code.replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it("uses the starting indentation of joined statements and multiline headers", () => {
    expect(clean([
      "def greet(", "    name: str,", "    count: int = 1,", ") -> str:",
      "    if (", "        count > 0", "    ):", "        return (", "            name", "        )",
      "    return \\", "        name", "",
      "for value in (", "    1, 2, 3", "):", "    print(value)",
    ].join("\n"))).toEqual([]);
  });

  it("accepts inline suites, soft keyword names and arbitrary continuation alignment", () => {
    expect(clean([
      "match = 1", "case: int = 2", "def greet(): return 'hello'", "if match: print(case)",
      "def ui():", "    text = Text(", "\t  'hello',", " color='white',", "    )",
      "    return text", "value = ++case", "other = case++match",
    ].join("\n"))).toEqual([]);
  });

  it("ignores continuation-like text inside comments and multiline strings", () => {
    expect(clean([
      'def greet():', '    """A docstring', '      arbitrary indentation', '    """',
      '    text = "backslash \\ "', '    # comment \\ ', '    return text',
    ].join("\n"))).toEqual([]);
  });

  it("still checks missing blocks and genuine bad indentation after continuations", () => {
    expect(clean('if (\n    True\n):\nprint("missing indent")').some(p => p.kind === "expected-indent")).toBe(true);
    expect(clean('value = Text(\n    "hello"\n)\n    bad_indent = 1').some(p => p.kind === "unexpected-indent")).toBe(true);
    expect(clean('def greet(\n    name\n)\n    return name').some(p => p.kind === "missing-colon")).toBe(true);
  });

  it("detects missing colon after def, if, and class", () => {
    const code = [
      "def calculate(x, y)",
      "    return x + y",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "missing-colon")).toBe(true);
    expect(problems.find((p) => p.kind === "missing-colon")).toMatchObject({
      line: 1,
      message: expect.stringContaining("Doppelpunkt"),
    });
  });

  it("detects expected indent error", () => {
    const code = [
      "def greet():",
      "print('hello')",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "expected-indent")).toBe(true);
  });

  it("detects unexpected indent", () => {
    const code = [
      "x = 10",
      "    y = 20",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "unexpected-indent")).toBe(true);
  });

  it("detects unindent mismatch", () => {
    const code = [
      "if True:",
      "    if True:",
      "        x = 1",
      "  y = 2",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "unindent-mismatch")).toBe(true);
  });

  it("detects unterminated single-line string", () => {
    const code = [
      "message = \"not closed string",
      "x = 5",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "unterminated-string")).toBe(true);
    expect(problems.find((p) => p.kind === "unterminated-string")).toMatchObject({
      line: 1,
      column: 11,
    });
  });

  it("detects unterminated triple-quote string at EOF", () => {
    const code = [
      "'''multiline started",
      "and never closed",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "unterminated-string")).toBe(true);
  });

  it("detects unclosed brackets and mismatched brackets", () => {
    const code = "items = [1, 2, (3 + 4]\n";
    const problems = clean(code);
    expect(problems.some((p) => p.kind === "mismatched-bracket")).toBe(true);
  });

  it("detects polyglot 'else if' instead of 'elif'", () => {
    const code = [
      "if x == 1:",
      "    pass",
      "else if x == 2:",
      "    pass",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "polyglot-syntax")).toBe(true);
    expect(problems.find((p) => p.kind === "polyglot-syntax")?.message).toContain("elif");
  });

  it("detects polyglot '===', '&&', '||', '++'", () => {
    const code = [
      "if a === b && c || d:",
      "    x++",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.message.includes("==="))).toBe(true);
    expect(problems.some((p) => p.message.includes("and"))).toBe(true);
    expect(problems.some((p) => p.message.includes("or"))).toBe(true);
    expect(problems.some((p) => p.message.includes("++"))).toBe(true);
  });

  it("detects return outside of function", () => {
    const code = [
      "x = 10",
      "return x",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "scope-error" && p.message.includes("return"))).toBe(true);
  });

  it("detects break outside of loop", () => {
    const code = [
      "def foo():",
      "    break",
    ].join("\n");

    const problems = clean(code);
    expect(problems.some((p) => p.kind === "scope-error" && p.message.includes("break"))).toBe(true);
  });

  it("detects invalid assignment to literal", () => {
    const code = "123 = x\n";
    const problems = clean(code);
    expect(problems.some((p) => p.kind === "invalid-assignment")).toBe(true);
  });

  it("warns about lowercase true/false/null", () => {
    const code = "is_active = true\n";
    const problems = clean(code);
    expect(problems.some((p) => p.message.includes("True"))).toBe(true);
  });
});
