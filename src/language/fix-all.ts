/**
 * Applying every quick fix at once.
 *
 * Forty missing imports after a paste is forty trips to the lightbulb. The
 * fixes themselves already exist — the language server offers one per problem
 * — and what is missing is a way to take them all in one go.
 *
 * The care is in the merging. Every fix was computed against the file as it
 * stands, so applying one moves every position after it and the next fix then
 * edits the wrong place. Two answers to that: apply them back to front, which
 * the edit preview already does, and refuse any pair that overlaps, because no
 * ordering saves those.
 *
 * Nothing here decides that a fix is safe. That is the preview's job — the
 * whole change is shown before a character of it is written.
 */

export interface FixPosition {
  line: number;
  character: number;
}

export interface FixRange {
  start: FixPosition;
  end: FixPosition;
}

export interface FixEdit {
  range: FixRange;
  newText: string;
}

export interface FixCandidate {
  title?: string;
  kind?: string;
  edit?: { changes?: Record<string, FixEdit[]>; documentChanges?: unknown[] } | null;
  /** A fix the server performs itself; it cannot be merged with the others. */
  command?: unknown;
}

export interface MergedFixes {
  /** One workspace edit holding everything that could be taken together. */
  edit: { changes: Record<string, FixEdit[]> };
  /** What went in, by title, so the result can be reported in words. */
  applied: Array<{ title: string; count: number }>;
  /** What was left out, and why, so nothing disappears silently. */
  skipped: Array<{ title: string; reason: string }>;
  /** How many problems are being fixed altogether. */
  total: number;
}

/** Whether two ranges touch the same characters. */
export function rangesOverlap(left: FixRange, right: FixRange): boolean {
  const before = (a: FixPosition, b: FixPosition) =>
    a.line < b.line || (a.line === b.line && a.character < b.character);
  // Sharing only an endpoint is not an overlap: one edit ends where the next
  // begins, and both can be applied.
  return before(left.start, right.end) && before(right.start, left.end);
}

/**
 * The text edits in a workspace edit, whichever way it was written.
 *
 * The protocol has two shapes and JDT uses the second: `changes` is a map from
 * file to edits, `documentChanges` a list that may hold text edits *and*
 * resource operations. Reading only the first shape made every fix JDT sent
 * look like a file operation, and a batch of them like a file with nothing to
 * fix — which is exactly what it reported, with every test passing.
 *
 * Answers null when the edit creates, renames or deletes anything, which the
 * caller leaves out of the batch.
 */
export function textEditsOf(edit: FixCandidate["edit"]): Record<string, FixEdit[]> | null {
  const documents: Record<string, FixEdit[]> = { ...(edit?.changes || {}) };
  for (const change of (edit?.documentChanges || []) as Array<Record<string, any>>) {
    if (change?.kind) return null;
    const uri = change?.textDocument?.uri;
    if (!uri || !Array.isArray(change?.edits)) continue;
    documents[uri] = [...(documents[uri] || []), ...change.edits];
  }
  return documents;
}

/**
 * Puts many fixes into one edit.
 *
 * The first fix for a place wins. A later one covering the same characters is
 * left out rather than layered on top, because the second was written for a
 * file the first has already changed.
 */
export function mergeFixEdits(candidates: FixCandidate[]): MergedFixes {
  const changes: Record<string, FixEdit[]> = {};
  const counts = new Map<string, number>();
  const skipped: Array<{ title: string; reason: string }> = [];
  let total = 0;

  for (const candidate of candidates || []) {
    const title = String(candidate?.title || "Korrektur").trim() || "Korrektur";
    const documents = textEditsOf(candidate?.edit);
    if (documents === null) {
      // Creating, renaming or deleting a file is not a quick fix that belongs
      // in a batch nobody asked to review file by file.
      skipped.push({ title, reason: "ändert Dateien, nicht nur Text" });
      continue;
    }
    if (!documents || !Object.keys(documents).length) {
      skipped.push({ title, reason: candidate?.command ? "läuft im Sprachserver" : "schlägt keine Änderung vor" });
      continue;
    }
    let conflicted = false;
    const staged: Array<[string, FixEdit]> = [];
    for (const [uri, edits] of Object.entries(documents)) {
      for (const edit of edits || []) {
        if (!edit?.range) continue;
        const existing = changes[uri] || [];
        if (existing.some((kept) => rangesOverlap(kept.range, edit.range))
          || staged.some(([stagedUri, kept]) => stagedUri === uri && rangesOverlap(kept.range, edit.range))) {
          conflicted = true;
          break;
        }
        staged.push([uri, edit]);
      }
      if (conflicted) break;
    }
    if (conflicted) {
      // Two fixes for the same characters cannot both be right, and no
      // ordering makes them both apply.
      skipped.push({ title, reason: "überschneidet sich mit einer anderen Korrektur" });
      continue;
    }
    for (const [uri, edit] of staged) {
      changes[uri] = [...(changes[uri] || []), edit];
    }
    counts.set(title, (counts.get(title) || 0) + 1);
    total += 1;
  }

  const applied = [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    // Most of a kind first: "12 × Import ergänzen" is the headline.
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));
  return { edit: { changes }, applied, skipped, total };
}

/** Whether a merge produced anything worth applying. */
export function hasFixes(merged: MergedFixes): boolean {
  return merged.total > 0 && Object.values(merged.edit.changes).some((edits) => edits.length > 0);
}

/**
 * The result in one line of German.
 *
 * Says what was done and, when something was left out, that something was —
 * a batch that quietly drops a third of its work is worse than one that says
 * so.
 */
export function describeFixes(merged: MergedFixes): string {
  if (!merged.total) return "Nichts zu beheben.";
  const parts = merged.applied.slice(0, 3).map((entry) => `${entry.count}× ${entry.title}`);
  const rest = merged.applied.length - parts.length;
  const head = `${merged.total} ${merged.total === 1 ? "Problem" : "Probleme"} behoben: ${parts.join(", ")}`;
  const more = rest > 0 ? ` und ${rest} weitere${rest === 1 ? "" : ""}` : "";
  const left = merged.skipped.length
    ? `. ${merged.skipped.length} ${merged.skipped.length === 1 ? "Korrektur" : "Korrekturen"} ausgelassen.`
    : ".";
  return `${head}${more}${left}`;
}

/** The kinds of code action a batch may take, as the protocol names them. */
export const FIXABLE_KINDS = ["quickfix", "source.fixAll"];

export function isBatchableFix(candidate: FixCandidate): boolean {
  const kind = String(candidate?.kind || "");
  if (!kind) return Boolean(candidate?.edit);
  return FIXABLE_KINDS.some((allowed) => kind === allowed || kind.startsWith(`${allowed}.`));
}
