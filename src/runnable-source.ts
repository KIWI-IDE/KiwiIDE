/**
 * Which open file a run, a debug or a disassembly is actually about.
 *
 * Tabs are not all source. A class read out of a JAR, a bytecode listing, a
 * diff — each is a real tab that can be focused, and each was silently taken
 * as the file to run: pressing Run while looking at a disassembly asked the
 * build to compile `SpielerVerwaltung.bytecode`. The failure arrives from the
 * compiler, several seconds later, phrased as a missing file.
 *
 * So the question "what is this about" gets an answer that skips what cannot
 * be the answer, and falls back to the nearest editable Java file — which is
 * almost always the one the reader opened the listing from.
 */

import type { OpenFile } from "./types";

/** Whether a tab is a Java file somebody could run, build or debug. */
export function isRunnableSource(file: OpenFile | null | undefined): boolean {
  if (!file || file.readOnly) return false;
  if (file.language !== "java") return false;
  // A path is what the build needs; a tab without one exists only in memory.
  return Boolean(file.path);
}

/**
 * The file an action should apply to.
 *
 * The active tab when it can be one. Otherwise the nearest runnable tab,
 * measured from the active tab outwards — a bytecode listing is opened right
 * beside the class it came from, so the neighbour is the right guess far more
 * often than "the first tab" would be.
 *
 * Answers null when nothing open qualifies, which the caller reports rather
 * than papering over: running the wrong file is worse than saying there is
 * none.
 */
export function runnableSourceFor(files: OpenFile[], activePath: string): OpenFile | null {
  const open = Array.isArray(files) ? files : [];
  const activeIndex = open.findIndex((file) => file.path === activePath);
  const active = activeIndex >= 0 ? open[activeIndex] : null;
  if (isRunnableSource(active)) return active;
  // No active tab at all: there is no "nearest", so the first one that
  // qualifies is the only honest answer.
  if (activeIndex < 0) return open.find(isRunnableSource) || null;

  const start = activeIndex;
  for (let distance = 1; distance <= open.length; distance += 1) {
    const before = open[start - distance];
    const after = open[start + distance];
    // Left first: a listing opens to the right of its source, so the source is
    // the tab before it.
    if (isRunnableSource(before)) return before;
    if (isRunnableSource(after)) return after;
  }
  return null;
}
