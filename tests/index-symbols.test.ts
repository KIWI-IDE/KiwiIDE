import { describe, expect, it } from "vitest";

const { declaredSymbols } = require("../electron/services/index-service.cjs");

type Symbol = { name: string; kind: string; line: number; owner: string };

const SOURCE = [
  "package de.beispiel.plugin;",
  "",
  "import java.util.List;",
  "",
  "public class SpielerVerwaltung {",
  "",
  "    private int maximum = 100;",
  "",
  "    public List<Spieler> online(String welt) {",
  "        return List.of();",
  "    }",
  "",
  "    public boolean istVoll(String welt) {",
  "        if (online(welt).size() >= maximum) {",
  "            return true;",
  "        }",
  "        return false;",
  "    }",
  "}",
].join("\n");

const named = (symbols: Symbol[], name: string) => symbols.find((symbol) => symbol.name === name);

/**
 * A reader, not a compiler. It exists to answer during the minute before the
 * language server has finished starting, and it says what it cannot do.
 */
describe("reading what a Java file declares", () => {
  const symbols: Symbol[] = declaredSymbols(SOURCE);

  it("finds the type and where it is", () => {
    expect(named(symbols, "SpielerVerwaltung")).toMatchObject({ kind: "class", line: 5, owner: "de.beispiel.plugin" });
  });

  it("finds the methods and which type they belong to", () => {
    expect(named(symbols, "online")).toMatchObject({ kind: "method", line: 9, owner: "SpielerVerwaltung" });
    expect(named(symbols, "istVoll")).toMatchObject({ kind: "method", line: 13 });
  });

  it("does not read a constructor call as a method declaration", () => {
    // `new IllegalStateException("…");` has a method's exact shape, and read as
    // one it put every constructor call anybody ever wrote into the search.
    expect(named(symbols, "IllegalStateException")).toBeUndefined();
    const calls: Symbol[] = declaredSymbols([
      "class A {",
      "    void run() {",
      "        Welt welt = new Welt();",
      "        throw new IllegalStateException(\"x\");",
      "    }",
      "}",
    ].join("\n"));
    expect(calls.map((symbol) => symbol.name)).toEqual(["A", "run"]);
  });

  it("does not read a record header as a method", () => {
    // The type is already collected as one; counting it twice would put the
    // same name in the list under two kinds.
    const record: Symbol[] = declaredSymbols("public record Spieler(String name, int punkte) {}");
    expect(record.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(["class:Spieler"]);
  });

  it("does not mistake a control structure for a method", () => {
    // `if (…) {` has the same shape as a method header if the keyword is
    // ignored, and a search offering "if" would be a search nobody trusts.
    expect(named(symbols, "if")).toBeUndefined();
    expect(named(symbols, "return")).toBeUndefined();
  });

  it("reads an interface and a record too", () => {
    const other: Symbol[] = declaredSymbols([
      "package de.beispiel;",
      "public record Spieler(String name, int punkte) {}",
      "interface Speicher { void schreibe(String inhalt); }",
    ].join("\n"));
    expect(named(other, "Spieler")?.kind).toBe("class");
    expect(named(other, "Speicher")?.kind).toBe("class");
    // A method without a body is still a method.
    expect(named(other, "schreibe")?.kind).toBe("method");
  });
});

/**
 * A brace in a string does not close a class, and `// class Foo` declares
 * nothing.
 */
describe("what is hidden from it", () => {
  it("ignores a declaration inside a comment", () => {
    const symbols: Symbol[] = declaredSymbols([
      "class Echt {",
      "    // class Versteckt {}",
      "    /* void auchVersteckt() {} */",
      "    void echt() {}",
      "}",
    ].join("\n"));
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Echt", "echt"]);
  });

  it("ignores a declaration inside a string", () => {
    const symbols: Symbol[] = declaredSymbols('class Echt { String s = "class Versteckt {}"; }');
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Echt"]);
  });

  it("is not ended early by an escaped quote", () => {
    const symbols: Symbol[] = declaredSymbols('class Echt { String s = "er sagte \\"hallo\\""; void echt() {} }');
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Echt", "echt"]);
  });

  it("keeps the line numbers pointing at the declaration", () => {
    // Blanking rather than removing is what makes this true.
    const symbols: Symbol[] = declaredSymbols([
      "/* eine",
      "   mehrzeilige",
      "   Notiz */",
      "class Spaet {}",
    ].join("\n"));
    expect(named(symbols, "Spaet")?.line).toBe(4);
  });

  it("survives a file that declares nothing", () => {
    expect(declaredSymbols("")).toEqual([]);
    expect(declaredSymbols("package de.beispiel;")).toEqual([]);
  });
});
