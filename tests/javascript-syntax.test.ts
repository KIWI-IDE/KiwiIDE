import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findJavaScriptSyntaxProblems } from "../src/language/javascript-syntax";
import { findCodeSyntaxProblems } from "../src/language/syntax-router";

describe("JavaScript & TypeScript syntax checks", () => {
  it("stays silent on valid TypeScript and JavaScript code", () => {
    const code = [
      "import { useState } from 'react';",
      "",
      "interface User {",
      "  id: number;",
      "  name: string;",
      "}",
      "",
      "// A single line comment",
      "/* A multi-line",
      "   comment */",
      "export function greet(user: User): string {",
      "  const message = `Hello, ${user.name}!`;",
      "  if (user.id === 1) {",
      "    return message;",
      "  } else if (user.id > 1) {",
      "    return message.toUpperCase();",
      "  }",
      "  return 'Anonymous';",
      "}",
    ].join("\n");

    const problems = findJavaScriptSyntaxProblems(code, "typescript");
    expect(problems).toEqual([]);
  });

  it("stays silent on valid React TSX code with self-closing and nested tags", () => {
    const code = [
      "import React from 'react';",
      "",
      "export const App: React.FC = () => {",
      "  return (",
      "    <div className=\"app-container\">",
      "      <h1>KiwiIDE</h1>",
      "      <img src=\"logo.png\" />",
      "      <input type=\"text\" placeholder=\"Search...\" />",
      "      <p>TypeScript and React support</p>",
      "    </div>",
      "  );",
      "};",
    ].join("\n");

    const problems = findJavaScriptSyntaxProblems(code, "typescriptreact");
    expect(problems).toEqual([]);
  });

  it("detects unclosed brackets", () => {
    const code = [
      "function sum(a: number, b: number {",
      "  return a + b;",
      "}",
    ].join("\n");

    const problems = findJavaScriptSyntaxProblems(code);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.kind === "unclosed-bracket" || p.kind === "mismatched-bracket")).toBe(true);
  });

  it("detects mismatched brackets", () => {
    const code = "const list = [1, 2, 3};";
    const problems = findJavaScriptSyntaxProblems(code);
    expect(problems.some((p) => p.kind === "mismatched-bracket")).toBe(true);
  });

  it("detects unterminated strings", () => {
    const code = "const greeting = 'Hello world;\nconst x = 10;";
    const problems = findJavaScriptSyntaxProblems(code);
    expect(problems.some((p) => p.kind === "unterminated-string")).toBe(true);
  });

  it("detects unterminated template strings at EOF", () => {
    const code = "const str = `unterminated ${name};";
    const problems = findJavaScriptSyntaxProblems(code);
    expect(problems.some((p) => p.kind === "unterminated-string")).toBe(true);
  });

  it("detects unclosed JSX tags", () => {
    const code = [
      "function Component() {",
      "  return <div><span>KiwiIDE</div>;",
      "}",
    ].join("\n");

    const problems = findJavaScriptSyntaxProblems(code, "typescriptreact");
    expect(problems.some((p) => p.kind === "mismatched-jsx-tag" || p.kind === "unclosed-jsx-tag")).toBe(true);
  });

  it("detects polyglot errors (Python def in JS/TS)", () => {
    const code = [
      "def runServer() {",
      "  console.log('started');",
      "}",
    ].join("\n");

    const problems = findJavaScriptSyntaxProblems(code);
    expect(problems.some((p) => p.kind === "polyglot-syntax" && p.message.includes("function"))).toBe(true);
  });

  it("detects invalid operator ====", () => {
    const code = "if (a ==== b) { console.log(true); }";
    const problems = findJavaScriptSyntaxProblems(code);
    expect(problems.some((p) => p.kind === "invalid-syntax" && p.message.includes("===="))).toBe(true);
  });

  it("routes through findCodeSyntaxProblems", () => {
    const code = "const x = [1, 2;";
    const tsProblems = findCodeSyntaxProblems("typescript", code);
    expect(tsProblems.length).toBeGreaterThan(0);

    const jsProblems = findCodeSyntaxProblems("javascript", code);
    expect(jsProblems.length).toBeGreaterThan(0);

    const tsxProblems = findCodeSyntaxProblems("tsx", code);
    expect(tsxProblems.length).toBeGreaterThan(0);
  });

  it("handles TypeScript generics, arrow props, fragments, and apostrophes in .tsx without false positives", () => {
    const tsxCode = [
      "import React, { useState, useRef } from 'react';",
      "",
      "interface CardProps {",
      "  title?: string;",
      "  items: Array<string>;",
      "}",
      "",
      "const identity = <T>(val: T): T => val;",
      "",
      "export const Card: React.FC<CardProps> = ({ title = 'Default', items }) => {",
      "  const [count, setCount] = useState<number>(0);",
      "  const boxRef = useRef<HTMLDivElement>(null);",
      "",
      "  return (",
      "    <>",
      "      <div ref={boxRef} className=\"card\" onClick={(e) => { if (count > 0) setCount(count - 1); }}>",
      "        <h2>{identity(title)}</h2>",
      "        <p>Don't worry, it's working (100%)!</p>",
      "        <ul>",
      "          {items.map((item, idx) => (",
      "            <li key={idx}>{item}</li>",
      "          ))}",
      "        </ul>",
      "      </div>",
      "    </>",
      "  );",
      "};",
    ].join("\n");

    expect(findCodeSyntaxProblems("typescript", tsxCode)).toEqual([]);
    expect(findCodeSyntaxProblems("tsx", tsxCode)).toEqual([]);
  });

  it("produces zero false positives across real .tsx components in src/components and src/App.tsx", () => {
    const dir = "src/components";
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => join(dir, f)),
      "src/components/panel/TailerPanel.tsx",
      "src/App.tsx",
    ];
    const unexpected: Array<{ file: string; problems: unknown }> = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const problems = findCodeSyntaxProblems("typescript", source);
      if (problems.length > 0) {
        unexpected.push({ file, problems });
      }
    }
    expect(unexpected).toEqual([]);
  });
});
