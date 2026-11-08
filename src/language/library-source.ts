/**
 * Classes that come out of a jar.
 *
 * Ctrl+Click on a name from a dependency went nowhere. Monaco asks whoever
 * registered an editor opener to open the file the definition is in, nobody
 * had, and its documented behaviour without one is to do nothing at all — so
 * every jump out of the current file was silently dropped, whether the target
 * was another class in the project or a class in a library.
 *
 * A library class has no file on disk. The language server addresses it with a
 * `jdt://` address and hands back its source — the attached one where there is
 * one, a decompiled one where there is not. Either way it cannot be edited,
 * and this is what is needed to name it, open it and say so.
 */

export interface LibraryClass {
  /** The name for the tab, e.g. "TerminalBuilder.class". */
  name: string;
  /** Where it came from, e.g. "jline-3.25.1.jar". Empty when unreadable. */
  origin: string;
  /** The package, e.g. "org.jline.terminal". Empty when unreadable. */
  packageName: string;
}

/** Whether an address names something that lives inside a library. */
export function isLibraryUri(uri: string): boolean {
  return /^(?:jdt|jar|chrome-extension):/i.test(String(uri || "").trim());
}

/**
 * Reads a jar address.
 *
 * JDT writes them as
 * `jdt://contents/jline-3.25.1.jar/org.jline.terminal/TerminalBuilder.class?=…`,
 * and the query is an opaque handle that says nothing to a reader. Anything
 * that cannot be read comes back empty rather than guessed at — a tab labelled
 * with a wrong class name is worse than one labelled with the address.
 */
export function describeLibraryUri(uri: string): LibraryClass | null {
  const text = String(uri || "").trim();
  if (!isLibraryUri(text)) return null;
  const withoutQuery = text.split("?")[0];
  const parts = withoutQuery.replace(/^[a-z-]+:\/\//i, "").split("/").filter(Boolean);
  // The scheme's own first segment names nothing about the class.
  if (parts[0] === "contents") parts.shift();
  // What is left reads from the back: <jar> / <package> / <Class.class>, with
  // the earlier segments simply absent on a shorter address.
  const name = decodeURIComponent(parts.pop() || "");
  if (!name) return { name: text, origin: "", packageName: "" };
  const packageName = decodeURIComponent(parts.pop() || "");
  const origin = decodeURIComponent(parts.pop() || "");
  return {
    name,
    // Only a jar has a suffix, and only a package looks like one; anything
    // else in those places is left out rather than shown as though it were.
    origin: /\.(?:jar|zip|jmod)$/i.test(origin) ? origin : "",
    packageName: /^[a-z_$][\w$]*(?:\.[\w$]+)*$/i.test(packageName) ? packageName : "",
  };
}

/** What the tab says under the name. */
export function libraryClassSubtitle(entry: LibraryClass | null): string {
  if (!entry) return "";
  return [entry.packageName, entry.origin].filter(Boolean).join(" · ");
}

/**
 * Whether a document opened from this address can be written to.
 *
 * Everything from a library is read-only: there is no file to save into, and a
 * decompiled body is not the source anybody wrote.
 */
export function isReadOnlyDocument(path: string): boolean {
  return isLibraryUri(path);
}

/** Where the caret should land in whatever is opened. */
export interface OpenPosition {
  line: number;
  column: number;
}

export type EditorOpenTarget =
  | { kind: "library"; uri: string; position?: OpenPosition }
  | { kind: "file"; path: string; position?: OpenPosition }
  | { kind: "none" };

/**
 * What Monaco is asking to be opened.
 *
 * Monaco hands over an address and, when the jump knows one, a selection or a
 * position — the two shapes differ, and reading only one of them puts the
 * reader at the top of the file instead of on the line they asked for.
 *
 * `fallbackPath` is Monaco's own reading of the address as a file path, used
 * only when the address is not one this can decode itself.
 */
export function editorOpenTarget(
  address: string,
  fallbackPath: string,
  selection?: { lineNumber?: number; column?: number; startLineNumber?: number; startColumn?: number } | null,
  toPath: (uri: string) => string = () => "",
): EditorOpenTarget {
  const uri = String(address || "").trim();
  if (!uri) return { kind: "none" };
  const line = Number(selection?.startLineNumber ?? selection?.lineNumber) || 0;
  const column = Number(selection?.startColumn ?? selection?.column) || 1;
  const position = line > 0 ? { line, column } : undefined;
  if (isLibraryUri(uri)) return { kind: "library", uri, position };
  const path = toPath(uri) || String(fallbackPath || "");
  return path ? { kind: "file", path, position } : { kind: "none" };
}
