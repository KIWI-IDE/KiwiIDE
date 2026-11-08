/**
 * What a remembered completion answer was made for.
 *
 * A cached answer is only an answer to the question it was asked. The items in
 * one carry ranges and import edits measured against the file as it stood at
 * the time, so reusing one somewhere else does not merely show the wrong names
 * — it inserts text at the wrong offsets and adds imports in the wrong place.
 */
export interface CompletionCacheEntry<T = unknown> {
  /** The file the answer was for. */
  uri: string;
  /** The line and column the caret was at. */
  line: number;
  column: number;
  /** What stood before the caret, which is what JDT filtered on. */
  prefix: string;
  /** How many lines the file had, so an edit above the caret is noticed. */
  lineCount: number;
  /** When it was remembered. */
  at: number;
  items: T;
}

/** Past this an answer is too old to stand in for one, however well it matches. */
export const COMPLETION_CACHE_MAX_AGE_MS = 30_000;

/**
 * Whether a remembered answer may be shown for the question being asked now.
 *
 * Deliberately strict. The cache exists for one case — the language server
 * failed or is not answering — and showing something slightly wrong there is
 * worse than showing nothing: a name that is not in scope, inserted with an
 * import for a file that has since moved, is a compile error the person did
 * not type.
 *
 * The caret may have moved along the same word, because that is what typing a
 * few more characters does and the answer still covers it. It may not have
 * moved to another line, another file, or a file whose length has changed
 * underneath the offsets the answer carries.
 */
export function isCacheEntryUsable(
  entry: CompletionCacheEntry | undefined,
  now: {
    uri: string;
    line: number;
    column: number;
    prefix: string;
    lineCount: number;
    at: number;
  },
): boolean {
  if (!entry) return false;
  if (entry.uri !== now.uri) return false;
  if (entry.line !== now.line) return false;
  // An edit anywhere above moves every line the answer's edits point at.
  if (entry.lineCount !== now.lineCount) return false;
  if (now.at - entry.at > COMPLETION_CACHE_MAX_AGE_MS) return false;
  // Still the same word, just further along it — or exactly where it was.
  if (now.column < entry.column) return false;
  return now.prefix.startsWith(entry.prefix);
}

/**
 * Strips what a cached item cannot promise any more.
 *
 * An import edit and a text range were measured against the file as it was.
 * The names are still worth showing; the edits are not, and applying them
 * would put an import on a line that now holds something else. The caller
 * gives the item a range for where the caret actually is.
 */
export function withoutStalePositions<T extends Record<string, unknown>>(
  item: T,
  range: unknown,
): T {
  const { additionalTextEdits: _imports, textEdit: _edit, ...rest } = item as Record<string, unknown>;
  return { ...rest, range, _fromCache: true } as unknown as T;
}

/**
 * Puts the language server's answer and what was read from the buffer together.
 *
 * The buffer's own members are shown first because they are shown first in
 * time — they need nobody's permission and are there before the server has
 * answered. Once the server answers, its version of a member replaces the
 * scanned one: it knows the signature, the type and the documentation, and two
 * entries for one method is worse than either alone.
 *
 * Matching is by name without the parameter list, so `add(int)` from the
 * server displaces `add` from the scan.
 */
export function mergeCompletions<T>(
  local: T[],
  jdt: T[],
  nameOf: (item: T) => string,
): T[] {
  if (!jdt.length) return local;
  const fromServer = new Set(jdt.map((item) => bareName(nameOf(item))));
  const survivors = local.filter((item) => !fromServer.has(bareName(nameOf(item))));
  return [...jdt, ...survivors];
}

/** A member's name without its parameters, which is how the two sides agree. */
export function bareName(label: string): string {
  return String(label || "").replace(/\(.*$/, "").trim();
}
