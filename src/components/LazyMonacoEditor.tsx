import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import type { EditorProps } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { t } from "../i18n";
import { editorStates, pathFromUri } from "../editor/editor-state-store";
import { isRestorable } from "../editor/editor-state";

const MonacoEditorComponent = lazy(async () => {
  // Configure the bundled Monaco copy before the React wrapper renders. This
  // module is reached only once an actual editor is needed, so the project hub
  // and early workbench startup no longer parse the ~4 MB Monaco bundle.
  await import("../monaco-setup");
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

/**
 * The first lines of the regions that are folded right now.
 *
 * Monaco has no public reader for this, so it is taken from the view model the
 * folding controller keeps. Every step is optional: a Monaco that no longer
 * exposes it costs the fold state and nothing else.
 */
function readFolds(editor: MonacoEditor.IStandaloneCodeEditor): number[] {
  try {
    const controller = editor.getContribution("editor.contrib.folding") as {
      getFoldingModel?: () => { regions?: { length: number; isCollapsed: (index: number) => boolean; getStartLineNumber: (index: number) => number } } | null;
    } | null;
    const regions = controller?.getFoldingModel?.()?.regions;
    if (!regions) return [];
    const lines: number[] = [];
    for (let index = 0; index < regions.length; index += 1) {
      if (regions.isCollapsed(index)) lines.push(regions.getStartLineNumber(index));
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * Folds those regions again.
 *
 * Through the fold command's own `selectionLines` argument, which takes the
 * lines directly. Moving the caret to each one and folding there would work
 * too and would throw away the selection this has just put back.
 */
function applyFolds(editor: MonacoEditor.IStandaloneCodeEditor, lines: number[]): void {
  if (!lines.length) return;
  try {
    editor.trigger("kiwi.editorState", "editor.fold", { selectionLines: lines });
  } catch {
    // A fold that cannot be put back is a fold somebody opens again.
  }
}

export function LazyMonacoEditor(props: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const { onMount, ...editorProps } = props;
  const optionsRef = useRef(props.options);
  optionsRef.current = props.options;

  /**
   * Puts the configured indentation on the model.
   *
   * Tab width and spaces-versus-tabs belong to the model, not to the editor,
   * and Monaco decides them per model by looking at the file it is given —
   * a guess that quietly overrides the setting. A Java file with a few
   * two-space lines therefore made Tab insert two spaces and Enter indent by
   * two, while the settings dialog went on saying four, and the behaviour
   * changed from one file to the next.
   */
  const applyIndentation = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    const model = editor.getModel();
    const options = optionsRef.current;
    if (!model || !options) return;
    const tabSize = Number(options.tabSize);
    model.updateOptions({
      ...(Number.isFinite(tabSize) && tabSize > 0 ? { tabSize } : {}),
      ...(typeof options.insertSpaces === "boolean" ? { insertSpaces: options.insertSpaces } : {}),
      // Also a model option, and also decided per model: a line left empty
      // had the indentation taken back out of it.
      trimAutoWhitespace: false,
    });
  }, []);

  // The settings can change while a file is open, and a model already made
  // keeps whatever it was made with until it is told otherwise.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) applyIndentation(editor);
  }, [applyIndentation, props.options?.tabSize, props.options?.insertSpaces]);

  const layout = useCallback(() => {
    const host = hostRef.current;
    const editor = editorRef.current;
    if (!host || !editor) return false;
    const bounds = host.getBoundingClientRect();
    // Monaco initially falls back to 5x5 when a tab is mounted during a
    // workbench grid transition. Never persist that temporary measurement.
    if (bounds.width < 16 || bounds.height < 16) return false;
    editor.layout({
      width: Math.floor(bounds.width),
      height: Math.floor(bounds.height),
    });
    return true;
  }, []);

  /**
   * Keeps measuring until the host has a real size.
   *
   * Two animation frames were not always enough: a tab mounted while the
   * workbench was still rearranging its tool windows could stay at Monaco's
   * 5x5 fallback for good, because a host that never changes size afterwards
   * emits no resize the observer could react to. Retrying for a moment costs
   * nothing and removes the dead editor entirely.
   */
  const layoutUntilMeasured = useCallback(() => {
    if (layout()) return;
    let attempts = 0;
    const attempt = () => {
      if (!editorRef.current || layout() || attempts >= 40) return;
      attempts += 1;
      window.setTimeout(attempt, 50);
    };
    requestAnimationFrame(attempt);
  }, [layout]);

  const handleMount = useCallback<NonNullable<EditorProps["onMount"]>>((editor, monaco) => {
    editorRef.current = editor;

    /*
     * The file whose place has already been put back.
     *
     * A model swapped into the editor reports the caret at 1,1 until the
     * restore below has run, and the cursor event for that arrives on its own
     * schedule — sometimes before the model event, sometimes after. Recording
     * it overwrites the very place the restore was about to return to, and the
     * caret then "goes right to the front" a moment after a tab is switched.
     */
    let placedFor = "";

    const remember = () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;
      const uri = model.uri.toString();
      if (uri !== placedFor) return;
      const selection = editor.getSelection();
      editorStates.write({
        path: pathFromUri(uri),
        cursorLine: position.lineNumber,
        cursorColumn: position.column,
        scrollTop: editor.getScrollTop(),
        scrollLeft: editor.getScrollLeft(),
        selection: selection && !selection.isEmpty() ? {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        } : undefined,
        folds: readFolds(editor),
        lastOpened: Date.now(),
      });
    };
    editor.onDidChangeCursorPosition(remember);
    editor.onDidChangeCursorSelection(remember);
    editor.onDidScrollChange(remember);

    const restore = () => {
      applyIndentation(editor);
      const model = editor.getModel();
      if (!model) return;
      const uri = model.uri.toString();
      // From here on this file's caret is its own again, and worth recording.
      placedFor = uri;
      const place = editorStates.read(pathFromUri(uri));
      // A file opening for the first time belongs at its beginning. Restoring
      // line 1 would only be work done to arrive where the editor already is,
      // and every one of those is a chance to arrive somewhere else instead.
      if (!isRestorable(place)) return;
      if (place.selection) {
        editor.setSelection({
          startLineNumber: place.selection.startLine,
          startColumn: place.selection.startColumn,
          endLineNumber: place.selection.endLine,
          endColumn: place.selection.endColumn,
        });
      } else {
        editor.setPosition({ lineNumber: place.cursorLine, column: place.cursorColumn });
      }
      // The scroll last and on its own. `revealPositionInCenter…` used to
      // follow it, and against an editor Monaco had not measured yet every
      // line counts as outside the viewport — so it scrolled again, past the
      // position that had just been set. That is the jump downwards.
      editor.setScrollTop(place.scrollTop);
      editor.setScrollLeft(place.scrollLeft);
      applyFolds(editor, place.folds || []);
    };
    editor.onDidChangeModel(restore);
    // A remounted editor already carries its model, so no change event is
    // coming for it.
    restore();

    onMount?.(editor, monaco);
    // The first frame can still contain the old Build/Debug panel geometry, so
    // the measurement is repeated until it lands on the settled layout.
    layoutUntilMeasured();
  }, [applyIndentation, layoutUntilMeasured, onMount]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const observer = new ResizeObserver(() => layout());
    observer.observe(host);
    const handleWindowLayout = () => layout();
    window.addEventListener("resize", handleWindowLayout);
    document.addEventListener("visibilitychange", handleWindowLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleWindowLayout);
      document.removeEventListener("visibilitychange", handleWindowLayout);
      editorRef.current = null;
    };
  }, [layout]);

  return (
    <div className="monaco-editor-host" ref={hostRef}>
      <Suspense fallback={<div className="editor-lazy-loading" role="status"><span />{t("Editor wird geladen …")}</div>}>
        <MonacoEditorComponent {...editorProps} width="100%" height="100%" onMount={handleMount} />
      </Suspense>
    </div>
  );
}
