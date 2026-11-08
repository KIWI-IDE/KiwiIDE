import { describe, expect, it } from "vitest";
import {
  bracketColorIndex,
  genericBracketSpans,
  GENERIC_BRACKET_COLORS,
  looksLikeTypeName,
} from "../src/language/generic-brackets";

/** The pairs, as the characters they sit on, for readable expectations. */
const pairsOf = (source: string) =>
  genericBracketSpans(source).map((span) => `${span.depth}:${source.slice(span.start, span.end + 1)}`);

/**
 * `Map<String, List<Map<String, Set<Integer>>>>` is exactly where the
 * colouring earns its keep. `a < b` is exactly where it must not appear.
 */
describe("finding the angle brackets that are type arguments", () => {
  it("takes a simple type argument", () => {
    expect(pairsOf("List<String> namen;")).toEqual(["0:<String>"]);
  });

  it("counts depth from the outside in", () => {
    const spans = genericBracketSpans("Map<String, List<Integer>> welt;");
    expect(spans.map((span) => span.depth)).toEqual([0, 1]);
  });

  it("handles the deeply nested case it exists for", () => {
    const spans = genericBracketSpans("Map<String, List<Map<String, Set<Integer>>>> tief;");
    expect(spans.map((span) => span.depth)).toEqual([0, 1, 2, 3]);
  });

  it("leaves a comparison alone", () => {
    expect(genericBracketSpans("if (a < b && c > d) { }")).toEqual([]);
    expect(genericBracketSpans("return anzahl < maximum;")).toEqual([]);
  });

  it("leaves a shift alone", () => {
    expect(genericBracketSpans("int x = 1 << 3;")).toEqual([]);
    expect(genericBracketSpans("int x = value >> 2;")).toEqual([]);
  });

  it("leaves a lambda arrow alone", () => {
    expect(genericBracketSpans("list.forEach(x -> print(x));")).toEqual([]);
  });

  it("leaves a comparison operator with an equals alone", () => {
    expect(genericBracketSpans("if (a >= b) { }")).toEqual([]);
  });

  it("takes the diamond", () => {
    expect(pairsOf("List<String> a = new ArrayList<>();")).toEqual(["0:<String>", "0:<>"]);
  });

  it("takes a wildcard and a bound", () => {
    expect(pairsOf("List<? extends Number> zahlen;")).toEqual(["0:<? extends Number>"]);
    expect(pairsOf("Class<T extends Comparable & Serializable> c;"))
      .toEqual(["0:<T extends Comparable & Serializable>"]);
  });

  it("takes an array inside a type argument", () => {
    expect(pairsOf("List<String[]> zeilen;")).toEqual(["0:<String[]>"]);
  });

  it("ignores angle brackets inside a string", () => {
    expect(genericBracketSpans('String s = "List<String>";')).toEqual([]);
  });

  it("ignores angle brackets inside a comment", () => {
    expect(genericBracketSpans("// List<String> namen;")).toEqual([]);
    expect(genericBracketSpans("/* Map<A, B> */")).toEqual([]);
  });

  it("does not carry an unmatched opener into the rest of the file", () => {
    // Half a guess is worse than none.
    const spans = genericBracketSpans("if (a < b) { }\nList<String> gut;");
    expect(spans).toHaveLength(1);
    expect(spans[0].depth).toBe(0);
  });

  it("survives a file with nothing in it", () => {
    expect(genericBracketSpans("")).toEqual([]);
    expect(genericBracketSpans("class A {}")).toEqual([]);
  });

  it("stops after the cap rather than working through a generated file", () => {
    const many = "List<String> a;\n".repeat(50);
    expect(genericBracketSpans(many, 10)).toHaveLength(10);
  });
});

describe("telling a type name from a value", () => {
  it("takes an identifier", () => {
    expect(looksLikeTypeName("List")).toBe(true);
    expect(looksLikeTypeName("  Map")).toBe(true);
  });

  it("refuses a number and an empty run", () => {
    expect(looksLikeTypeName("42")).toBe(false);
    expect(looksLikeTypeName("")).toBe(false);
    expect(looksLikeTypeName("  ")).toBe(false);
  });

  it("refuses a keyword that only ever precedes a comparison", () => {
    expect(looksLikeTypeName("return")).toBe(false);
    expect(looksLikeTypeName("while")).toBe(false);
  });

  it("refuses a lower-case name, because that is how a local is written", () => {
    // A convention rather than a rule, and used anyway: `a < b` and
    // `List<String>` are otherwise the same shape. Missing a lower-case
    // generic costs a colour nobody had; colouring an inequality costs trust
    // in every colour on the screen.
    expect(looksLikeTypeName("if (a")).toBe(false);
    expect(looksLikeTypeName("anzahl")).toBe(false);
    expect(looksLikeTypeName("List")).toBe(true);
  });
});

describe("which colour a depth gets", () => {
  it("starts again after the last one", () => {
    expect(bracketColorIndex(0)).toBe(0);
    expect(bracketColorIndex(GENERIC_BRACKET_COLORS)).toBe(0);
    expect(bracketColorIndex(GENERIC_BRACKET_COLORS + 2)).toBe(2);
  });

  it("takes a nonsense depth as the first colour", () => {
    expect(bracketColorIndex(-3)).toBe(0);
    expect(bracketColorIndex(Number.NaN)).toBe(0);
  });
});
