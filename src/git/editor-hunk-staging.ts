import type * as Monaco from "monaco-editor";
import type { GitHunk } from "../types";

/** Adds clickable stage/unstage markers to Monaco's glyph margin. The returned
 * disposable owns only its decorations and listener; editor state is left
 * untouched. */
export function installGitHunkStaging(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  root: string,
  file: string,
  onChanged?: () => void,
  onError?: (message: string) => void,
): Monaco.IDisposable & { refresh: () => Promise<void> } {
  const decorations = editor.createDecorationsCollection();
  const byDecoration = new Map<string, GitHunk>();
  let disposed = false;
  let applying = false;
  /** How many markers the last refresh put on screen. */
  let shown = 0;

  const refresh = async () => {
    if (disposed) return;
    const [working, staged] = await Promise.all([
      window.kiwi!.git.hunks(root, file, false),
      window.kiwi!.git.hunks(root, file, true),
    ]);
    if (disposed) return;
    const model = editor.getModel();
    if (!model) return;
    const items = [...working, ...staged].map((hunk) => ({
      range: new monaco.Range(Math.max(1, Math.min(hunk.newStart || hunk.oldStart || 1, model.getLineCount())), 1, Math.max(1, Math.min(hunk.newStart || hunk.oldStart || 1, model.getLineCount())), 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: hunk.staged ? "kiwi-git-hunk-staged" : "kiwi-git-hunk-unstaged",
        glyphMarginHoverMessage: { value: hunk.staged ? "Git: Abschnitt aus dem Index entfernen" : "Git: Abschnitt stagen" },
        description: `kiwi-git-hunk:${hunk.staged ? "staged" : "working"}:${hunk.index}`,
      },
    }));
    const ids = decorations.set(items);
    shown = items.length;
    byDecoration.clear();
    ids.forEach((id, index) => byDecoration.set(id, [...working, ...staged][index]));
  };

  const click = editor.onMouseDown(async (event) => {
    if (applying || event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const element = event.target.element;
    const id = element?.getAttribute?.("data-mprt") || "";
    let hunk = byDecoration.get(id);
    // Monaco does not expose the decoration id on every platform. Fall back to
    // the clicked line and prefer an unstaged marker when both overlap.
    if (!hunk && event.target.position) {
      const candidates = [...byDecoration.values()].filter((entry) => (entry.newStart || entry.oldStart) === event.target.position!.lineNumber);
      hunk = candidates.find((entry) => !entry.staged) || candidates[0];
    }
    if (!hunk) return;
    event.event.preventDefault();
    event.event.stopPropagation();
    applying = true;
    try {
      await window.kiwi!.git.applyHunk(root, file, hunk.index, hunk.staged);
      await refresh();
      onChanged?.();
    } catch (problem) {
      onError?.(String((problem as Error)?.message || problem));
    } finally {
      applying = false;
    }
  });

  // A file can be opened before Git status has finished loading (or outside a
  // repository). Hunk decorations are optional UI, so an unavailable Git
  // backend must never surface as an unhandled renderer rejection.
  //
  // One attempt used to be the only attempt, and it was made the moment the
  // model arrived. A call that lost that race — Git still busy right after the
  // project opened — left the file without markers for good: reopening the file
  // that is already open changes no model, and a repository that has settled
  // sends no further status. So it is retried, briefly, until markers appear.
  void (async () => {
    for (const delay of [0, 250, 500, 1_000, 2_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (disposed) return;
      await refresh().catch(() => undefined);
      if (shown > 0) return;
    }
  })();
  return {
    refresh,
    dispose() {
      disposed = true;
      click.dispose();
      decorations.clear();
      byDecoration.clear();
    },
  };
}
