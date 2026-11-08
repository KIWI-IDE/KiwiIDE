import { describe, expect, it, vi } from "vitest";
import {
  javaArgumentDefault,
  improveArgumentDefaults,
  CompletionRequestGate,
  camelHumpScore,
  dedupeAndRankCompletions,
  expectedTypeFromSignature,
  parameterTypesFromSignature,
  javaTemplates,
  MAX_RANK_SHIFT,
} from "./completion-controller";

describe("Java completion controller", () => {
  it("supports prefix, camel-hump and broadened ranking", () => {
    expect(camelHumpScore("HashMap", "Hash")).toBeLessThan(camelHumpScore("LinkedHashMap", "Hash"));
    expect(camelHumpScore("HttpServerRequest", "HSR")).toBeLessThan(100);
    const ranked = dedupeAndRankCompletions([
      { label: "StringBuilder", detail: "java.lang", source: "jdt" },
      { label: "String", detail: "java.lang", source: "jdt" },
    ], "Str", "basic");
    expect(ranked[0].label).toBe("String");
  });

  it("deduplicates providers and prioritizes JDT metadata", () => {
    const ranked = dedupeAndRankCompletions([
      { label: "sout", insertText: "System.out.println(${1});${0}", detail: "System.out.println", source: "live" },
      { label: "sout", insertText: "System.out.println(${1});${0}", detail: "System.out.println", source: "jdt" },
    ], "so", "basic");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].source).toBe("jdt");
  });

  it("keeps real class members ahead of postfix templates after a dot", () => {
    const ranked = dedupeAndRankCompletions([
      { label: ".if", insertText: "if (${1:value}) {}", source: "postfix" },
      { label: "displayName()", detail: "String · dev.kiwi.Person", source: "jdt" },
      { label: "rename(String)", detail: "void · dev.kiwi.Person", source: "jdt" },
    ], "", "basic");
    expect(ranked.slice(0, 2).map((item) => item.source)).toEqual(["jdt", "jdt"]);
  });

  it("creates live and postfix templates and reads a parameter type", () => {
    expect(javaTemplates("        so").some((item) => item.key === "sout")).toBe(true);
    expect(javaTemplates("value.nu").map((item) => item.key)).toContain(".null");
    expect(expectedTypeFromSignature({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [{ parameters: [{ label: "String key" }, { label: "List<Person> values" }] }],
    })).toBe("List<Person>");
  });

  it("uses expected generic types and locally learned selections for ranking", () => {
    const ranked = dedupeAndRankCompletions([
      { label: "names", detail: "List<String>", source: "jdt" },
      { label: "people", detail: "List<Person>", source: "jdt" },
      { label: "recentPeople", detail: "List<Person>", source: "jdt", usageScore: 5 },
    ], "", "smart", "List<Person>");
    expect(ranked.map((item) => typeof item.label === "string" ? item.label : item.label.label).slice(0, 2))
      .toEqual(["recentPeople", "people"]);
  });

  /**
   * Several overloads, and the position being typed.
   *
   * Only the chosen overload used to be read, so at `format(` — where the
   * server offers `format(String, Object...)` and `format(Locale, String,
   * Object...)` — a Locale was ranked as though it did not belong there.
   */
  it("reads every applicable overload's parameter, not only the chosen one", () => {
    const help = {
      activeSignature: 0,
      activeParameter: 0,
      signatures: [
        { parameters: [{ label: "String format" }, { label: "Object... args" }] },
        { parameters: [{ label: "Locale locale" }, { label: "String format" }] },
      ],
    };
    expect(parameterTypesFromSignature(help)).toEqual(["String", "Locale"]);
    // The chosen overload stays first, because it is the server's own answer.
    expect(expectedTypeFromSignature(help)).toBe("String");
  });

  it("reads a parameter each signature counts differently", () => {
    // A signature may carry its own active parameter, and it wins over the
    // one on the request when it does.
    expect(parameterTypesFromSignature({
      activeSignature: 0,
      activeParameter: 0,
      signatures: [{ activeParameter: 1, parameters: [{ label: "String a" }, { label: "Duration b" }] }],
    })).toEqual(["Duration"]);
  });

  it("says nothing when the server offered no signature", () => {
    expect(parameterTypesFromSignature(null)).toEqual([]);
    expect(parameterTypesFromSignature({ signatures: [] })).toEqual([]);
    expect(expectedTypeFromSignature(undefined)).toBe("");
  });

  it("broadens a repeated Ctrl+Space and invalidates stale requests", () => {
    vi.useFakeTimers();
    const gate = new CompletionRequestGate();
    expect(gate.setIntent("basic")).toBe("basic");
    vi.advanceTimersByTime(500);
    expect(gate.setIntent("basic")).toBe("broaden");
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first.id)).toBe(false);
    expect(gate.isCurrent(second.id)).toBe(true);
    vi.useRealTimers();
  });
});

describe("generated method arguments", () => {
  it("supplies a usable default per Java type", () => {
    expect(javaArgumentDefault("int")).toBe("0");
    expect(javaArgumentDefault("long")).toBe("0L");
    expect(javaArgumentDefault("double")).toBe("0.0");
    expect(javaArgumentDefault("boolean")).toBe("false");
    expect(javaArgumentDefault("java.lang.String")).toBe('""');
    expect(javaArgumentDefault("Integer")).toBe("0");
  });

  it("keeps JDT's null for types without a sensible default", () => {
    expect(javaArgumentDefault("Player")).toBeNull();
    expect(javaArgumentDefault("List<String>")).toBeNull();
    expect(javaArgumentDefault("String[]")).toBeNull();
  });

  it("rewrites null placeholders using the signature", () => {
    expect(improveArgumentDefaults(
      "setValues(${1:null}, ${2:null}, ${3:null})",
      "setValues(int count, String name, Player target) : void",
    )).toBe('setValues(${1:0}, ${2:""}, ${3:null})');
  });

  it("leaves guessed arguments and unparametrised calls untouched", () => {
    expect(improveArgumentDefaults("setCount(${1:total})", "setCount(int count) : void"))
      .toBe("setCount(${1:total})");
    expect(improveArgumentDefaults("run()", "run() : void")).toBe("run()");
  });
});

/**
 * Whose ranking decides the order.
 *
 * The language server has resolved the expression and knows the expected type,
 * the receiver, the visibility and the imports. Kiwi knows the typed prefix and
 * what has been chosen before. Its score used to be the whole sort key, with
 * the server's relevance kept only as a tie-break — a heuristic deciding the
 * order of an answer that had been worked out properly.
 */
describe("keeping the server's relevance underneath", () => {
  const server = (label: string, sortText: string) => ({ label, sortText, source: "jdt" as const });

  it("leaves the server's order alone when nothing distinguishes the entries", () => {
    const ranked = dedupeAndRankCompletions(
      [server("zuletzt", "00030"), server("zuerst", "00010"), server("mitte", "00020")],
      "",
      "basic",
    );
    expect(ranked.map((item) => item.label)).toEqual(["zuerst", "mitte", "zuletzt"]);
  });

  it("lifts a plain prefix match without burying what the server put first", () => {
    // The server's twentieth entry matches what is being typed; it should come
    // into view, and the server's first should still be near the top.
    const items = Array.from({ length: 25 }, (_, index) =>
      server(`egal${index}`, String(index * 10).padStart(5, "0")));
    items.push(server("player", "00200"));

    const ranked = dedupeAndRankCompletions(items, "play", "basic");
    const positionOfMatch = ranked.findIndex((item) => item.label === "player");
    const positionOfServerFirst = ranked.findIndex((item) => item.label === "egal0");
    expect(positionOfMatch).toBeLessThan(20);
    expect(positionOfServerFirst).toBeLessThanOrEqual(MAX_RANK_SHIFT + 1);
  });

  it("moves nothing further than it is allowed to", () => {
    const items = Array.from({ length: 40 }, (_, index) =>
      server(`eintrag${index}`, String(index).padStart(5, "0")));
    const ranked = dedupeAndRankCompletions(items, "eintrag39", "basic");
    // Even a perfect match cannot travel from the bottom to the top: the
    // server ranked the others above it for reasons this side cannot see.
    expect(ranked.findIndex((item) => item.label === "eintrag39")).toBeGreaterThanOrEqual(39 - MAX_RANK_SHIFT - 1);
  });

  it("decides for itself when the server ranked nothing", () => {
    const ranked = dedupeAndRankCompletions(
      [
        { label: "StringBuilder", detail: "java.lang", source: "jdt" },
        { label: "String", detail: "java.lang", source: "jdt" },
      ],
      "Str",
      "basic",
    );
    expect(ranked[0].label).toBe("String");
  });

  it("puts what the server never saw behind what it ranked", () => {
    const ranked = dedupeAndRankCompletions(
      [
        { label: ".if", source: "postfix" as const },
        server("displayName()", "00010"),
      ],
      "",
      "basic",
    );
    expect(ranked[0].label).toBe("displayName()");
  });
});
