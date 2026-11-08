/**
 * Every file in the project, known before anyone asks.
 *
 * The file palette searched the Explorer's tree, and that tree loads one level
 * at a time — so a file in a folder nobody had expanded to simply was not
 * there. Measured on a five-level package: open the project, press the
 * shortcut, type the class name, get nothing. The obvious reading is that
 * search is broken, and the actual answer is to go and click five folders
 * open first, which is the thing the search existed to avoid.
 *
 * So the project is walked once and written down. The list is read back on the
 * next open, which is instant, and kept current from the file watcher rather
 * than by walking again.
 *
 * The stored list is a cache and is treated as one: anything unreadable, from
 * a different version, or belonging to another project is a full rebuild, not
 * an error. Nothing here is the truth — the disk is.
 */

export const INDEX_VERSION = 2;

export type IndexedSymbolKind = "class" | "method";

export interface IndexedSymbol {
  /** The bare name, which is what gets typed. */
  name: string;
  kind: IndexedSymbolKind;
  /** 1-based, so a jump lands on the declaration. */
  line: number;
  /** The type it belongs to, for a method; the package, for a type. */
  owner: string;
}

export interface IndexedFile {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** Last modification, so a change can be noticed without reading. */
  modified: number;
  /**
   * The types and methods the file declares.
   *
   * Read while the file is being walked past anyway. Without them the class
   * and symbol searches answer nothing until the language server has finished
   * indexing, which on a large project is the first minute of every session —
   * exactly when somebody is looking for where to start.
   */
  symbols?: IndexedSymbol[];
}

export interface ProjectIndex {
  version: number;
  /** The project this belongs to, so another one's file is never used. */
  root: string;
  builtAt: number;
  files: IndexedFile[];
}

export function emptyIndex(root: string): ProjectIndex {
  return { version: INDEX_VERSION, root, builtAt: 0, files: [] };
}

/** Paths are compared and stored one way, whatever the platform writes. */
export function normalizeIndexPath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/** The part of a path below the project root. */
export function relativeIndexPath(root: string, filePath: string): string {
  const base = normalizeIndexPath(root).replace(/\/+$/, "");
  const file = normalizeIndexPath(filePath);
  if (!base) return file;
  const prefix = `${base}/`;
  if (file.toLowerCase().startsWith(prefix.toLowerCase())) return file.slice(prefix.length);
  return file;
}

/**
 * Reads a stored index.
 *
 * Answers an empty index for anything it cannot use — unreadable, a different
 * version, another project. A cache that refuses to load is a rebuild; a cache
 * that loads the wrong project's files is a search that lies.
 */
export function readProjectIndex(text: string, root: string): ProjectIndex {
  try {
    const parsed = JSON.parse(String(text || ""));
    if (Number(parsed?.version) !== INDEX_VERSION) return emptyIndex(root);
    if (normalizeIndexPath(parsed?.root).toLowerCase() !== normalizeIndexPath(root).toLowerCase()) {
      return emptyIndex(root);
    }
    const files: IndexedFile[] = [];
    for (const entry of Array.isArray(parsed?.files) ? parsed.files : []) {
      const filePath = normalizeIndexPath(entry?.path);
      if (!filePath) continue;
      const symbols: IndexedSymbol[] = [];
      for (const symbol of Array.isArray(entry?.symbols) ? entry.symbols : []) {
        const name = String(symbol?.name || "").trim();
        if (!name) continue;
        symbols.push({
          name,
          kind: symbol?.kind === "method" ? "method" : "class",
          line: Number(symbol?.line) || 1,
          owner: String(symbol?.owner || ""),
        });
      }
      files.push({
        path: filePath,
        modified: Number(entry?.modified) || 0,
        ...(symbols.length ? { symbols } : {}),
      });
    }
    return { version: INDEX_VERSION, root, builtAt: Number(parsed?.builtAt) || 0, files };
  } catch {
    return emptyIndex(root);
  }
}

/**
 * Whether a path is something a build produced rather than something written.
 *
 * The tree-based search offered `target/classes/Foo.class` above `Foo.java`,
 * because a compiled class and its source share a name and the class sorts
 * first. Nobody has ever wanted to open a .class file from a file palette.
 */
export function isBuildArtifact(filePath: string): boolean {
  const normalized = normalizeIndexPath(filePath).toLowerCase();
  if (/\.(?:class|jar|war|so|dll|exe|bin)$/.test(normalized)) return true;
  // What an annotation processor wrote is source, wherever it landed. Those
  // classes are compiled against, appear in stack traces and are stepped
  // through — and were the one thing in the project nobody could search for.
  if (isGeneratedSourcePath(normalized)) return false;
  return /(?:^|\/)(?:target|build|out|bin|node_modules)\//.test(normalized);
}

/**
 * Java a build tool wrote, under a directory otherwise full of output.
 *
 * The same list the walkers use, kept here rather than imported because this
 * runs in the renderer and they run in the main process; a test holds the two
 * to each other.
 */
export function isGeneratedSourcePath(filePath: string): boolean {
  const normalized = normalizeIndexPath(filePath).toLowerCase();
  if (!normalized.endsWith(".java")) return false;
  return /(?:^|\/)(?:target\/generated-(?:test-)?sources|build\/generated\/sources?|build\/generated-src)\//.test(normalized);
}

export interface IndexChange {
  /** Paths that were added or changed, absolute or relative. */
  changed?: string[];
  /** Paths that are gone. */
  removed?: string[];
}

/**
 * Folds a watcher's report into the index.
 *
 * Only the named files are touched. Rebuilding the whole list because one file
 * was saved is what made the old tree refresh visible on a large project.
 */
export function applyIndexChange(
  index: ProjectIndex,
  change: IndexChange,
  now: number,
): ProjectIndex {
  const byPath = new Map(index.files.map((file) => [file.path.toLowerCase(), file]));
  for (const raw of change.removed || []) {
    byPath.delete(relativeIndexPath(index.root, raw).toLowerCase());
  }
  for (const raw of change.changed || []) {
    const filePath = relativeIndexPath(index.root, raw);
    if (!filePath) continue;
    // The walk skips what a build produced; the watcher does not, and it
    // reports every class file the compiler writes. Without this the index
    // filled up with target/classes the moment the language server built the
    // project, and a search for a class answered with its .class file first.
    if (isBuildArtifact(filePath)) continue;
    byPath.set(filePath.toLowerCase(), { path: filePath, modified: now });
  }
  return { ...index, files: [...byPath.values()] };
}

export interface IndexMatch {
  path: string;
  /** The file name on its own, which is what is usually typed. */
  name: string;
  score: number;
}

/**
 * The files a query names, best first.
 *
 * The name is matched before the path: somebody typing "SpielerVerwaltung"
 * means the class, not every file in a folder that happens to contain those
 * letters. A query with a slash in it is asking about the path and is matched
 * against the whole of it.
 */
export function searchIndex(index: ProjectIndex, query: string, limit = 60): IndexMatch[] {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const wantsPath = needle.includes("/");
  const matches: IndexMatch[] = [];
  for (const file of index.files) {
    const name = file.path.split("/").at(-1) || file.path;
    const haystack = wantsPath ? file.path.toLowerCase() : name.toLowerCase();
    const score = matchScore(haystack, needle);
    if (score < 0) continue;
    matches.push({ path: file.path, name, score });
  }
  return matches
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}

/** Lower is better; -1 does not match at all. */
function matchScore(haystack: string, needle: string): number {
  if (haystack === needle) return 0;
  const withoutExtension = haystack.replace(/\.[^.]+$/, "");
  if (withoutExtension === needle) return 1;
  if (haystack.startsWith(needle)) return 10 + (haystack.length - needle.length);
  const index = haystack.indexOf(needle);
  if (index >= 0) return 40 + index + (haystack.length - needle.length);
  return -1;
}

export interface SymbolMatch {
  name: string;
  kind: IndexedSymbolKind;
  owner: string;
  path: string;
  line: number;
  score: number;
}

/**
 * The types and methods a query names, best first.
 *
 * Answers from what was written down rather than from the language server, so
 * it answers before the server has started. Its answer is narrower — no
 * inherited members, nothing from a dependency, no generics — which is why the
 * caller prefers the server's whenever there is one and falls back to this.
 */
export function searchSymbols(
  index: ProjectIndex,
  query: string,
  options: { kinds?: IndexedSymbolKind[]; limit?: number } = {},
): SymbolMatch[] {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const kinds = options.kinds;
  const matches: SymbolMatch[] = [];
  for (const file of index.files) {
    for (const symbol of file.symbols || []) {
      if (kinds && !kinds.includes(symbol.kind)) continue;
      const score = matchScore(symbol.name.toLowerCase(), needle);
      if (score < 0) continue;
      matches.push({ ...symbol, path: file.path, score });
    }
  }
  return matches
    .sort((left, right) =>
      left.score - right.score
      // A type before a method of the same name: somebody typing a capitalised
      // word means the class far more often than a method that shares its name.
      || Number(left.kind === "method") - Number(right.kind === "method")
      || left.name.localeCompare(right.name))
    .slice(0, options.limit ?? 60);
}

/**
 * Whether the stored index is too old to be trusted on its own.
 *
 * Not a correctness test — the watcher keeps it current while Kiwi runs. This
 * is about the time Kiwi was not running, when files may have changed under
 * it: the list is still shown immediately, and a walk is started behind it.
 */
export function indexNeedsRefresh(index: ProjectIndex, now: number, maxAgeMs = 60 * 60 * 1000): boolean {
  if (!index.files.length) return true;
  return now - (index.builtAt || 0) > maxAgeMs;
}
