import { EditorStateStore, isRestorable, parseStates, type EditorFileState } from "./editor-state";

/**
 * The one place a file's caret, scroll, selection and folds are kept.
 *
 * A module-level instance on purpose. The editor is remounted whenever the
 * workbench rearranges around it, and anything held in a ref would be thrown
 * away with it — which is the same forgetting, one level up. Two of these
 * would be worse still: scroll remembered here, the session's cursor there,
 * and neither knowing about folds at all.
 */
export const editorStates = new EditorStateStore();

/** The file a Monaco model URI points at, in the spelling the store uses. */
export function pathFromUri(uri: string): string {
  const text = String(uri || "");
  if (!text.startsWith("file:")) return text;
  try {
    // decodeURI rather than a hand-rolled unescape: a path with a space or an
    // umlaut arrives percent-encoded and would otherwise never match.
    const withoutScheme = decodeURI(text.replace(/^file:\/{2,3}/, ""));
    return withoutScheme.replace(/^\/([A-Za-z]:)/, "$1");
  } catch {
    return text;
  }
}

/**
 * Reads a project's stored states and makes them the current ones.
 *
 * Every failure ends the same way — an empty store. A project that has never
 * been open, a file somebody deleted, a record from a Kiwi that wrote a
 * different shape: none of those is worth an error, and all of them mean the
 * same thing, which is that files open where they always did.
 */
export async function adoptProjectStates(root: string): Promise<void> {
  if (!root) {
    editorStates.adopt("", []);
    return;
  }
  const stored = await window.kiwi?.workspace.loadEditorStates(root).catch(() => []) ?? [];
  editorStates.adopt(root, parseStates(stored));
}

/**
 * Writes the current project's states down.
 *
 * Awaited by the caller, so "saved" means the bytes reached the disk rather
 * than a buffer somewhere — the same reason the session is written this way.
 */
export async function persistProjectStates(): Promise<void> {
  const root = editorStates.root;
  if (!root || !window.kiwi) return;
  // Only the ones that say something. A file left at line 1 with no selection
  // is a file that opens where it opens, and storing a few hundred of those
  // makes the file larger and the next start slower for no gain at all.
  const worth = editorStates.snapshot().filter((state) => isRestorable(state));
  await window.kiwi.workspace.saveEditorStates(root, worth).catch(() => undefined);
}

export type { EditorFileState };
