import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IN_SCOPE_KIND_NAMES,
  MEMBER_KIND_NAMES,
  MONACO_COMPLETION_KIND_NAMES,
  monacoCompletionKind,
  monacoCompletionKindName,
} from "../src/language/completion-kinds";
import { localityPenalty } from "../src/language/completion-controller";

/**
 * Monaco's own numbering, read from the copy that is installed.
 *
 * Written out here it would be a second place for the numbers to drift apart,
 * which is the whole reason the mapping is kept as names.
 */
function monacoKinds(): Record<string, number> {
  const source = readFileSync("node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts", "utf8");
  const block = source.match(/export enum CompletionItemKind \{([^}]*)\}/)?.[1] || "";
  const kinds: Record<string, number> = {};
  for (const line of block.split("\n")) {
    const entry = line.match(/^\s*([A-Za-z]+)\s*=\s*(\d+)/);
    if (entry) kinds[entry[1]] = Number(entry[2]);
  }
  return kinds;
}

/**
 * The icon beside a proposal.
 *
 * Monaco and the protocol both number completion kinds and do not number them
 * the same way. They were converted by subtracting one, which is right from
 * Interface onward and wrong for everything before it — so a local variable
 * was drawn with a class icon and an enum constant with a colour swatch.
 */
describe("mapping a protocol kind to Monaco's", () => {
  const kinds = monacoKinds();

  it("reads the enumeration Monaco actually ships", () => {
    // If this fails the test is broken, not the mapping.
    expect(kinds.Method).toBe(0);
    expect(Object.keys(kinds).length).toBeGreaterThan(20);
  });

  it("names a kind for every one the protocol defines", () => {
    for (let lspKind = 1; lspKind <= 25; lspKind += 1) {
      expect({ lspKind, named: Boolean(MONACO_COMPLETION_KIND_NAMES[lspKind]) })
        .toEqual({ lspKind, named: true });
    }
  });

  it("names only kinds Monaco has", () => {
    for (const [lspKind, name] of Object.entries(MONACO_COMPLETION_KIND_NAMES)) {
      expect({ lspKind, known: name in kinds }).toEqual({ lspKind, known: true });
    }
  });

  it("puts the kinds that used to be wrong where they belong", () => {
    // Protocol Variable is 6; subtracting one gave 5, which Monaco draws as a
    // class. These five were all wrong.
    expect(monacoCompletionKind(6, kinds)).toBe(kinds.Variable);
    expect(monacoCompletionKind(5, kinds)).toBe(kinds.Field);
    expect(monacoCompletionKind(2, kinds)).toBe(kinds.Method);
    expect(monacoCompletionKind(20, kinds)).toBe(kinds.EnumMember);
    expect(monacoCompletionKind(21, kinds)).toBe(kinds.Constant);
    expect(monacoCompletionKind(15, kinds)).toBe(kinds.Snippet);
  });

  it("keeps the ones the old arithmetic happened to get right", () => {
    expect(monacoCompletionKind(8, kinds)).toBe(kinds.Interface);
    expect(monacoCompletionKind(10, kinds)).toBe(kinds.Property);
    expect(monacoCompletionKind(25, kinds)).toBe(kinds.TypeParameter);
  });

  it("falls back to a kind rather than to nothing", () => {
    // A wrong icon is a smaller mistake than a proposal that does not appear.
    expect(monacoCompletionKindName(99)).toBe("Property");
    expect(monacoCompletionKindName(undefined)).toBe("Property");
    expect(monacoCompletionKind(99, kinds)).toBe(kinds.Property);
    expect(monacoCompletionKind(2, {})).toBe(9);
  });
});

/**
 * What reaching a name costs beyond typing it.
 *
 * Small on their own and never enough to outweigh the prefix or the type;
 * together they settle the ties those leave.
 */
describe("how near a proposal is", () => {
  const jdt = (over: Record<string, unknown>) => ({ label: "x", source: "jdt" as const, ...over });

  it("puts what is in scope ahead of a member, and a member ahead of the rest", () => {
    const local = localityPenalty(jdt({ _lsp: { kind: 6 } }));
    const member = localityPenalty(jdt({ _lsp: { kind: 5 } }));
    const type = localityPenalty(jdt({ _lsp: { kind: 7 } }));
    expect(local).toBeLessThan(member);
    expect(member).toBeLessThan(type);
  });

  it("charges for an import the proposal would add", () => {
    const withImport = localityPenalty(jdt({ _lsp: { kind: 7 }, additionalTextEdits: [{ newText: "import java.util.List;\n" }] }));
    const without = localityPenalty(jdt({ _lsp: { kind: 7 } }));
    expect(withImport).toBeGreaterThan(without);
  });

  it("leaves a proposal whose kind it cannot read exactly where it was", () => {
    // Not knowing must never push a correct answer down the list.
    expect(localityPenalty(jdt({}))).toBe(0);
    expect(localityPenalty(jdt({ _lsp: { kind: 0 } }))).toBe(0);
  });

  it("does not weigh templates, which are not names in a project at all", () => {
    expect(localityPenalty({ label: ".if", source: "postfix" })).toBe(0);
    expect(localityPenalty({ label: "sout", source: "live" })).toBe(0);
  });

  it("agrees with itself about which kinds are near", () => {
    expect(IN_SCOPE_KIND_NAMES).toContain("Variable");
    expect(MEMBER_KIND_NAMES).toContain("Field");
    expect(IN_SCOPE_KIND_NAMES.some((name) => MEMBER_KIND_NAMES.includes(name))).toBe(false);
  });
});
