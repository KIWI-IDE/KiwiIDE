import { describe, expect, it } from "vitest";
const { findStructuralMatches, compilePattern } = require("../electron/services/structural-search.cjs");
describe("structural code patterns", () => {
  it("matches code tokens across comments and whitespace, preserving captured source", () => {
    const source = 'System /* receiver */ . out.println(\n  format("x,y", value + 1)\n);';
    const result = findStructuralMatches(source, 'System.out.println($value$)', 'logger.info($value$)');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ line: 1, column: 1, after: 'logger.info(format("x,y", value + 1))' });
  });
  it("ignores code-looking strings, comments, regex and template contents", () => {
    const source = '// log(fake)\nconst s="log(fake)"; const r=/log(fake)/; const t=`log(fake)`; log(real);';
    const result = findStructuralMatches(source, 'log($x$)', 'trace($x$)', 'javascript');
    expect(result.matches.map((match: any) => match.after)).toEqual(['trace(real)']);
  });
  it("supports empty and balanced variadic argument lists", () => {
    const result = findStructuralMatches('log(); log(foo(1, 2), {a: [3, 4]});', 'log($$args$$)', 'trace($$args$$)', 'javascript');
    expect(result.matches.map((match: any) => match.after)).toEqual(['trace()', 'trace(foo(1, 2), {a: [3, 4]})']);
    expect(findStructuralMatches('log(a,b)', 'log($one$)', 'x($one$)').matches).toHaveLength(0);
  });
  it("enforces repeated captures and exact identifier boundaries", () => {
    expect(findStructuralMatches('equals(a, a); equals(a, b); myequals(a,a);', 'equals($x$, $x$)', '$x$').matches.map((match: any) => match.after)).toEqual(['a']);
  });
  it("does not capture a return statement or declaration as a method receiver", () => {
    const result = findStructuralMatches('return service.send(x); const a = other.send(y);', '$receiver$.send($x$)', '$receiver$.trace($x$)', 'javascript');
    expect(result.matches.map((match: any) => match.before)).toEqual(['service.send(x)', 'other.send(y)']);
  });
  it("supports Python comments and multiple non-overlapping replacements", () => {
    expect(findStructuralMatches('# print(fake)\nprint( first )\nprint(second)', 'print($x$)', 'logging.info($x$)', 'python').matches.map((match: any) => match.after)).toEqual(['logging.info(first)', 'logging.info(second)']);
  });
  it("rejects ambiguous/unbalanced patterns and unknown replacement captures", () => {
    expect(() => compilePattern('$anything$', 'java')).toThrow();
    expect(() => compilePattern('log($x$', 'java')).toThrow();
    expect(() => findStructuralMatches('log(x)', 'log($x$)', '$missing$')).toThrow('missing');
    expect(findStructuralMatches('log(x)', 'log($constructor$)', '$constructor$').matches[0].after).toBe('x');
  });
});
