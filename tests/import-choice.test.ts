import { describe, expect, it } from "vitest";
import {
  conflictingNames,
  qualifiedAlternatives,
  qualifiedNameOf,
  type ImportCandidate,
} from "../src/language/import-choice";

const candidate = (over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  name: "List",
  qualifiedName: "java.util.List",
  addsImport: true,
  ...over,
});

/**
 * `List` is java.util.List and it is also java.awt.List.
 *
 * A list offering both showed two identical rows, and which one you got
 * depended on which row you happened to be on — a choice that changes what
 * every other line in the file refers to, made by accident.
 */
describe("finding a name that means two types", () => {
  it("names the one that is ambiguous", () => {
    const conflicting = conflictingNames([
      candidate(),
      candidate({ qualifiedName: "java.awt.List" }),
      candidate({ name: "Map", qualifiedName: "java.util.Map" }),
    ]);
    expect([...conflicting]).toEqual(["List"]);
  });

  it("is not troubled by the same type proposed twice", () => {
    expect(conflictingNames([candidate(), candidate()]).size).toBe(0);
  });

  it("says nothing about a proposal whose type it cannot read", () => {
    expect(conflictingNames([
      candidate({ qualifiedName: "" }),
      candidate({ qualifiedName: "java.awt.List" }),
    ]).size).toBe(0);
    expect(conflictingNames([]).size).toBe(0);
  });
});

describe("reading the whole name out of a proposal", () => {
  it("joins a package to a simple name", () => {
    expect(qualifiedNameOf("List", "java.util")).toBe("java.util.List");
  });

  it("takes a whole name that is already whole", () => {
    expect(qualifiedNameOf("List", "java.util.List")).toBe("java.util.List");
  });

  it("strips a method's parentheses before joining", () => {
    expect(qualifiedNameOf("getProperty(String key)", "java.lang.System"))
      .toBe("java.lang.System.getProperty");
  });

  it("answers nothing rather than something wrong", () => {
    // JDT writes signatures in the same field, and a name built out of one
    // would insert text that does not compile.
    expect(qualifiedNameOf("List", "(String key) : String")).toBe("");
    expect(qualifiedNameOf("List", "List")).toBe("");
    expect(qualifiedNameOf("", "java.util")).toBe("");
    expect(qualifiedNameOf("List", "")).toBe("");
  });
});

/**
 * The choice, as a second row.
 */
describe("offering the fully qualified name beside the import", () => {
  const items = [
    { id: "util", name: "List", qualifiedName: "java.util.List", addsImport: true },
    { id: "awt", name: "List", qualifiedName: "java.awt.List", addsImport: true },
    { id: "map", name: "Map", qualifiedName: "java.util.Map", addsImport: true },
  ];
  const describe_ = (item: typeof items[number]): ImportCandidate => item;

  it("offers one for each ambiguous proposal and none for the rest", () => {
    const alternatives = qualifiedAlternatives(items, describe_);
    expect(alternatives.map((entry) => entry.qualifiedName))
      .toEqual(["java.util.List", "java.awt.List"]);
  });

  it("says nothing where no name is ambiguous", () => {
    expect(qualifiedAlternatives([items[0], items[2]], describe_)).toEqual([]);
  });

  it("leaves alone a type the file already imports", () => {
    // Already imported means already unambiguous; spelling it out is noise.
    const alternatives = qualifiedAlternatives([
      { ...items[0], addsImport: false },
      items[1],
    ], describe_);
    expect(alternatives.map((entry) => entry.qualifiedName)).toEqual(["java.awt.List"]);
  });

  it("keeps the proposal it stands beside, so the caller can copy it", () => {
    const [first] = qualifiedAlternatives(items, describe_);
    expect(first.original).toBe(items[0]);
  });
});
