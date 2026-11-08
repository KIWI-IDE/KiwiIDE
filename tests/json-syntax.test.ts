import { describe, expect, it } from "vitest";
import { findJsonSyntaxProblems } from "../src/language/json-syntax";
import { findCodeSyntaxProblems } from "../src/language/syntax-router";

describe("JSON syntax check", () => {
  it("stays silent on valid JSON", () => {
    expect(findJsonSyntaxProblems('{"name": "kiwi", "version": 1}')).toEqual([]);
  });

  it("reports syntax error on malformed JSON", () => {
    const problems = findJsonSyntaxProblems('{\n  "name": "kiwi",,\n}');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].kind).toBe("invalid-json");
  });

  it("routes syntax checks by language", () => {
    expect(findCodeSyntaxProblems("python", "def test()\n    pass").length).toBeGreaterThan(0);
    expect(findCodeSyntaxProblems("java", "class Test {\n").length).toBeGreaterThan(0);
    expect(findCodeSyntaxProblems("json", "{ bad: true }").length).toBeGreaterThan(0);
  });
});
