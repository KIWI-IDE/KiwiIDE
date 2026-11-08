import { describe, expect, it } from "vitest";
import {
  describeFixes,
  hasFixes,
  isBatchableFix,
  mergeFixEdits,
  rangesOverlap,
  textEditsOf,
  type FixCandidate,
} from "../src/language/fix-all";

const FILE = "file:///C:/projekt/Main.java";

const range = (line: number, from: number, to = from) => ({
  start: { line, character: from },
  end: { line, character: to },
});

const fix = (title: string, edits: Array<{ range: ReturnType<typeof range>; newText: string }>, uri = FILE): FixCandidate => ({
  title,
  kind: "quickfix",
  edit: { changes: { [uri]: edits } },
});

/**
 * Forty missing imports after a paste is forty trips to the lightbulb.
 *
 * The care is in the merging: every fix was computed against the file as it
 * stands, so two that touch the same characters cannot both be applied.
 */
describe("putting many fixes into one edit", () => {
  it("takes fixes that do not touch each other", () => {
    const merged = mergeFixEdits([
      fix("Import 'List' (java.util)", [{ range: range(2, 0), newText: "import java.util.List;\n" }]),
      fix("Import 'Map' (java.util)", [{ range: range(3, 0), newText: "import java.util.Map;\n" }]),
    ]);
    expect(merged.total).toBe(2);
    expect(merged.edit.changes[FILE]).toHaveLength(2);
    expect(merged.skipped).toEqual([]);
  });

  it("counts fixes of the same kind together", () => {
    const merged = mergeFixEdits([
      fix("Import ergänzen", [{ range: range(2, 0), newText: "a" }]),
      fix("Import ergänzen", [{ range: range(3, 0), newText: "b" }]),
      fix("Cast entfernen", [{ range: range(9, 4, 12), newText: "" }]),
    ]);
    // Most of a kind first, because that is the headline.
    expect(merged.applied).toEqual([
      { title: "Import ergänzen", count: 2 },
      { title: "Cast entfernen", count: 1 },
    ]);
  });

  it("leaves out the second of two fixes for the same characters", () => {
    // No ordering makes both apply: the second was written for a file the
    // first has already changed.
    const merged = mergeFixEdits([
      fix("Typ ändern", [{ range: range(4, 8, 20), newText: "List<String>" }]),
      fix("Variable umbenennen", [{ range: range(4, 12, 16), newText: "namen" }]),
    ]);
    expect(merged.total).toBe(1);
    expect(merged.applied[0].title).toBe("Typ ändern");
    expect(merged.skipped[0]).toMatchObject({ title: "Variable umbenennen" });
  });

  it("keeps two edits that only meet at a point", () => {
    // One ends exactly where the next begins; both can be written.
    const merged = mergeFixEdits([
      fix("A", [{ range: range(1, 0, 5), newText: "x" }]),
      fix("B", [{ range: range(1, 5, 9), newText: "y" }]),
    ]);
    expect(merged.total).toBe(2);
  });

  it("takes a fix that spans two files", () => {
    const other = "file:///C:/projekt/Other.java";
    const merged = mergeFixEdits([{
      title: "Sichtbarkeit ändern",
      kind: "quickfix",
      edit: { changes: { [FILE]: [{ range: range(1, 0), newText: "a" }], [other]: [{ range: range(2, 0), newText: "b" }] } },
    }]);
    expect(Object.keys(merged.edit.changes)).toHaveLength(2);
    expect(merged.total).toBe(1);
  });

  it("leaves out anything that is not plain text in a file", () => {
    // Creating, renaming or deleting a file does not belong in a batch nobody
    // asked to review file by file.
    const merged = mergeFixEdits([
      { title: "Klasse anlegen", kind: "quickfix", edit: { documentChanges: [{ kind: "create", uri: FILE }] } },
      { title: "Im Server ausführen", kind: "quickfix", command: { command: "java.x" } },
      { title: "Ohne Wirkung", kind: "quickfix", edit: { changes: {} } },
    ]);
    expect(merged.total).toBe(0);
    expect(merged.skipped.map((entry) => entry.title))
      .toEqual(["Klasse anlegen", "Im Server ausführen", "Ohne Wirkung"]);
  });

  it("survives nothing at all", () => {
    const merged = mergeFixEdits([]);
    expect(hasFixes(merged)).toBe(false);
    expect(describeFixes(merged)).toBe("Nichts zu beheben.");
  });
});

describe("saying what happened", () => {
  it("names the kinds and how many of each", () => {
    const merged = mergeFixEdits([
      fix("Import ergänzen", [{ range: range(1, 0), newText: "a" }]),
      fix("Import ergänzen", [{ range: range(2, 0), newText: "b" }]),
      fix("Cast entfernen", [{ range: range(3, 0), newText: "c" }]),
    ]);
    expect(describeFixes(merged)).toContain("3 Probleme behoben");
    expect(describeFixes(merged)).toContain("2× Import ergänzen");
  });

  it("admits to what it left out", () => {
    // A batch that quietly drops a third of its work is worse than one that
    // says so.
    const merged = mergeFixEdits([
      fix("Import ergänzen", [{ range: range(1, 0), newText: "a" }]),
      { title: "Nicht batchbar", kind: "quickfix", command: { command: "x" } },
    ]);
    expect(describeFixes(merged)).toContain("1 Korrektur ausgelassen");
  });
});

describe("which actions may be batched", () => {
  it("takes a quick fix", () => {
    expect(isBatchableFix({ kind: "quickfix", edit: { changes: {} } })).toBe(true);
    expect(isBatchableFix({ kind: "source.fixAll.java", edit: { changes: {} } })).toBe(true);
  });

  it("leaves a refactoring alone", () => {
    // Extracting a method is a decision, not a correction.
    expect(isBatchableFix({ kind: "refactor.extract.method", edit: { changes: {} } })).toBe(false);
    expect(isBatchableFix({ kind: "source.organizeImports", edit: { changes: {} } })).toBe(false);
  });

  it("judges an action without a kind by whether it has an edit", () => {
    expect(isBatchableFix({ edit: { changes: {} } })).toBe(true);
    expect(isBatchableFix({})).toBe(false);
  });
});

describe("when two ranges collide", () => {
  it("knows an overlap from a touch", () => {
    expect(rangesOverlap(range(1, 0, 5), range(1, 3, 8))).toBe(true);
    expect(rangesOverlap(range(1, 0, 5), range(1, 5, 8))).toBe(false);
    expect(rangesOverlap(range(1, 0, 5), range(2, 0, 5))).toBe(false);
  });

  it("sees an overlap that spans lines", () => {
    expect(rangesOverlap(
      { start: { line: 1, character: 0 }, end: { line: 4, character: 0 } },
      { start: { line: 2, character: 3 }, end: { line: 2, character: 9 } },
    )).toBe(true);
  });
});

/**
 * The shape the language server actually sends.
 *
 * The protocol has two, and JDT uses documentChanges. Reading only `changes`
 * made every fix it sent look like a file operation and a batch of them look
 * like a file with nothing to fix — reported as exactly that, with every test
 * in this file passing. Driving the real IDE is what found it.
 */
describe("reading a workspace edit either way it is written", () => {
  it("takes text edits out of documentChanges", () => {
    const merged = mergeFixEdits([{
      title: "Import 'ArrayList' (java.util)",
      kind: "quickfix",
      edit: {
        documentChanges: [{
          textDocument: { uri: FILE, version: 3 },
          edits: [{ range: range(1, 0), newText: "import java.util.ArrayList;\n" }],
        }],
      },
    }]);
    expect(merged.total).toBe(1);
    expect(merged.edit.changes[FILE]).toHaveLength(1);
  });

  it("merges both shapes in one edit", () => {
    expect(textEditsOf({
      changes: { [FILE]: [{ range: range(1, 0), newText: "a" }] },
      documentChanges: [{ textDocument: { uri: FILE }, edits: [{ range: range(2, 0), newText: "b" }] }],
    })?.[FILE]).toHaveLength(2);
  });

  it("still refuses an edit that creates or renames a file", () => {
    expect(textEditsOf({ documentChanges: [{ kind: "create", uri: FILE }] })).toBeNull();
    expect(textEditsOf({ documentChanges: [{ kind: "rename", oldUri: FILE, newUri: FILE }] })).toBeNull();
  });

  it("answers an empty map for an edit that changes nothing", () => {
    expect(textEditsOf({})).toEqual({});
    expect(textEditsOf(null)).toEqual({});
  });
});
