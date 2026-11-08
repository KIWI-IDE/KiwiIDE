import { describe, expect, it } from "vitest";
import {
  COMPLETION_CACHE_MAX_AGE_MS,
  bareName,
  isCacheEntryUsable,
  mergeCompletions,
  withoutStalePositions,
} from "../src/language/completion-cache";

const entry = {
  uri: "file:///c%3A/projekt/Alpha.java",
  line: 12,
  column: 9,
  prefix: "        pla",
  lineCount: 40,
  at: 1_000,
  items: [],
};

const asking = (patch: Partial<typeof entry> = {}) => ({
  uri: entry.uri,
  line: entry.line,
  column: entry.column,
  prefix: entry.prefix,
  lineCount: entry.lineCount,
  at: entry.at + 100,
  ...patch,
});

/**
 * When a remembered answer may stand in for one that never came.
 *
 * The cache exists for one case — the language server failed — and being
 * slightly wrong there is worse than being empty: a name that is not in scope,
 * inserted with an import measured against a file that has since changed, is a
 * compile error the person did not type.
 */
describe("reusing a remembered completion", () => {
  it("answers the same question again", () => {
    expect(isCacheEntryUsable(entry, asking())).toBe(true);
  });

  it("still answers after a few more characters of the same word", () => {
    expect(isCacheEntryUsable(entry, asking({ column: 12, prefix: "        player" }))).toBe(true);
  });

  it("refuses another file, another line, or a caret that went back", () => {
    expect(isCacheEntryUsable(entry, asking({ uri: "file:///c%3A/projekt/Beta.java" }))).toBe(false);
    expect(isCacheEntryUsable(entry, asking({ line: 13 }))).toBe(false);
    expect(isCacheEntryUsable(entry, asking({ column: 7, prefix: "        p" }))).toBe(false);
  });

  it("refuses a different word at the same place", () => {
    expect(isCacheEntryUsable(entry, asking({ prefix: "        sco" }))).toBe(false);
  });

  it("refuses once the file has grown or shrunk", () => {
    // Every range and import edit the answer carries points at a line number,
    // and an edit anywhere above the caret has moved all of them.
    expect(isCacheEntryUsable(entry, asking({ lineCount: 41 }))).toBe(false);
    expect(isCacheEntryUsable(entry, asking({ lineCount: 39 }))).toBe(false);
  });

  it("refuses an answer that has gone stale", () => {
    expect(isCacheEntryUsable(entry, asking({ at: entry.at + COMPLETION_CACHE_MAX_AGE_MS + 1 }))).toBe(false);
    expect(isCacheEntryUsable(undefined, asking())).toBe(false);
  });

  it("drops the edits a cached item can no longer promise", () => {
    const cached = {
      label: "getName()",
      insertText: "getName()",
      additionalTextEdits: [{ range: { startLineNumber: 3 }, text: "import java.util.List;" }],
      textEdit: { range: { startLineNumber: 12 } },
    };
    const range = { startLineNumber: 20, startColumn: 5, endLineNumber: 20, endColumn: 8 };

    const reused = withoutStalePositions(cached, range) as Record<string, unknown>;
    expect(reused.label).toBe("getName()");
    // The import and the old range were measured against a file that has moved
    // on; the name is still worth showing, the offsets are not.
    expect(reused).not.toHaveProperty("additionalTextEdits");
    expect(reused).not.toHaveProperty("textEdit");
    expect(reused.range).toBe(range);
    expect(reused._fromCache).toBe(true);
  });
});

/**
 * The buffer's own members and the server's, in one list.
 *
 * The scan is shown first in time because it needs nobody's permission. When
 * the server answers, its version of a member replaces the scanned one — it
 * knows the signature and the type, and two entries for one method is worse
 * than either alone.
 */
describe("putting the two sources together", () => {
  const name = (item: { label: string }) => item.label;

  it("keeps the scan when the server has said nothing yet", () => {
    const local = [{ label: "spielerName" }, { label: "reset()" }];
    expect(mergeCompletions(local, [], name)).toEqual(local);
  });

  it("lets the server's version replace the scanned one", () => {
    const local = [{ label: "reset()" }, { label: "nurImPuffer" }];
    const jdt = [{ label: "reset(boolean hart)" }];

    const merged = mergeCompletions(local, jdt, name);
    expect(merged.map(name)).toEqual(["reset(boolean hart)", "nurImPuffer"]);
  });

  it("puts the server's answer first", () => {
    const merged = mergeCompletions([{ label: "lokal" }], [{ label: "vomServer" }], name);
    expect(merged.map(name)).toEqual(["vomServer", "lokal"]);
  });

  it("matches a member by its name without the parameters", () => {
    expect(bareName("add(int index, E element)")).toBe("add");
    expect(bareName("size()")).toBe("size");
    expect(bareName("feld")).toBe("feld");
    expect(bareName("")).toBe("");
  });
});
