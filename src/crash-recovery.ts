/**
 * What survives Kiwi not being closed.
 *
 * The session was already written twice: on a short debounce while working,
 * and again on `beforeunload`. Only the second one carried unsaved drafts, and
 * only the second one is skipped when a process dies — a crashed renderer, a
 * killed process, a machine losing power fire no unload event at all. So the
 * one case the drafts were kept for was the one case they were not kept in.
 *
 * Keeping them on the debounce instead is the whole fix, and the cost has to
 * be bounded: writing every keystroke of a large file into local storage would
 * turn typing into a disk-bound operation. So drafts are kept up to a size,
 * newest first, and what does not fit is dropped rather than truncated —
 * half a file restored is worse than an honest gap.
 *
 * The other half is knowing that it happened. A session that ended cleanly
 * leaves a mark; a session that finds no mark on the next start knows the last
 * one did not end, and can say so instead of quietly reopening.
 */

/** Per file. Larger drafts are still listed, without their content. */
export const MAX_DRAFT_BYTES = 512 * 1024;

/** Across all of them, so a dozen large files cannot fill the quota. */
export const MAX_DRAFT_TOTAL_BYTES = 2 * 1024 * 1024;

export interface SessionFile {
  path: string;
  content?: string;
  savedContent?: string;
}

export interface StoredFile {
  path: string;
  content?: string;
}

/** Whether a file has something in it that is not on disk. */
export function isDraft(file: SessionFile): boolean {
  return typeof file.content === "string"
    && typeof file.savedContent === "string"
    && file.content !== file.savedContent;
}

/**
 * The files to write, with the drafts that fit.
 *
 * Newest first, because what somebody was just typing is what they would miss.
 * A draft too large for the budget keeps its place in the list without its
 * content: the tab comes back, the text does not, and that is said rather than
 * silently half-done.
 */
export function draftsToStore(files: SessionFile[], options: {
  maxPerFile?: number;
  maxTotal?: number;
} = {}): { files: StoredFile[]; kept: number; dropped: string[] } {
  const maxPerFile = options.maxPerFile ?? MAX_DRAFT_BYTES;
  const maxTotal = options.maxTotal ?? MAX_DRAFT_TOTAL_BYTES;
  const stored: StoredFile[] = [];
  const dropped: string[] = [];
  let budget = maxTotal;
  let kept = 0;

  for (const file of files) {
    if (!isDraft(file)) {
      stored.push({ path: file.path });
      continue;
    }
    const size = (file.content || "").length;
    if (size > maxPerFile || size > budget) {
      stored.push({ path: file.path });
      dropped.push(file.path);
      continue;
    }
    budget -= size;
    kept += 1;
    stored.push({ path: file.path, content: file.content });
  }
  return { files: stored, kept, dropped };
}

/**
 * What to say about drafts that were too large to keep.
 *
 * Named, because "some drafts were not kept" leaves somebody guessing which
 * file to check.
 */
export function describeDroppedDrafts(dropped: string[]): string {
  if (!dropped.length) return "";
  const names = dropped.map((path) => path.split(/[\\/]/).at(-1) || path);
  return names.length === 1
    ? `${names[0]} war zu groß, um ungespeichert gesichert zu werden.`
    : `${names.length} Dateien waren zu groß, um ungespeichert gesichert zu werden: ${names.join(", ")}.`;
}

export interface SessionMark {
  /** Set while a session is running, cleared when it ends properly. */
  running: boolean;
  /** When the mark was last written, so a stale one can be recognised. */
  at: number;
  version?: string;
}

/**
 * Whether the previous session ended or was cut off.
 *
 * A mark still saying "running" means nothing cleared it, which means nothing
 * ran the shutdown — a crash, a kill, or a power cut. There is no way to tell
 * those apart from here, and no reason to: the answer is the same.
 *
 * A mark from far in the past is treated as clean. Somebody who last used Kiwi
 * a month ago and is now told their session was interrupted learns nothing;
 * the drafts, if any, are offered on their own merits.
 */
export function endedBadly(mark: SessionMark | null, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000): boolean {
  if (!mark?.running) return false;
  const age = now - (Number(mark.at) || 0);
  return age >= 0 && age <= maxAgeMs;
}

/** What the reader is told when the last session did not end. */
export function describeRecovery(restoredDrafts: number): string {
  if (restoredDrafts <= 0) {
    return "Kiwi wurde beim letzten Mal nicht ordentlich beendet. Die Sitzung ist wiederhergestellt.";
  }
  return restoredDrafts === 1
    ? "Kiwi wurde beim letzten Mal nicht ordentlich beendet. Eine ungespeicherte Datei ist wiederhergestellt."
    : `Kiwi wurde beim letzten Mal nicht ordentlich beendet. ${restoredDrafts} ungespeicherte Dateien sind wiederhergestellt.`;
}

/** How many of the stored files carry text that was never saved. */
export function countStoredDrafts(files: StoredFile[]): number {
  return (files || []).filter((file) => typeof file.content === "string").length;
}
