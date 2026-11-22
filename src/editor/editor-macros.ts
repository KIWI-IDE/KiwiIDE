import type * as Monaco from "monaco-editor";

export type MacroPoint = { line: number; column: number; relative: boolean; edge?: "start" | "end" | "top" | "bottom" };
export type MacroSelection = { anchor: MacroPoint; head: MacroPoint };
export type MacroStep = { kind: "edit"; edits: Array<{ start: MacroPoint; end: MacroPoint; text: string }>; after?: MacroSelection } | { kind: "move"; selection: MacroSelection };
export type EditorMacro = { id: string; name: string; shortcut: string; steps: MacroStep[]; updatedAt: number };
type Position = { lineNumber: number; column: number };
const relative = (position: Position, origin: Position, edge?: MacroPoint["edge"]): MacroPoint => ({ line: position.lineNumber - origin.lineNumber, column: position.lineNumber === origin.lineNumber ? position.column - origin.column : position.column, relative: position.lineNumber === origin.lineNumber, ...(edge ? { edge } : {}) });
function positions(text: string) {
  const starts = [0]; for (let index = 0; index < text.length; index++) if (text[index] === "\n") starts.push(index + 1);
  const at = (position: Position) => {
    const start = starts[position.lineNumber - 1];
    const end = position.lineNumber < starts.length ? starts[position.lineNumber] - (text[starts[position.lineNumber] - 2] === "\r" ? 2 : 1) : text.length;
    if (start === undefined || position.column < 1 || start + position.column - 1 > end) throw new Error("Das Makro passt an dieser Stelle nicht in die Datei.");
    return start + position.column - 1;
  };
  const resolve = (point: MacroPoint, origin: Position): Position => {
    let lineNumber = origin.lineNumber + point.line;
    if (point.edge === "top") return { lineNumber: 1, column: 1 };
    if (point.edge === "bottom") return { lineNumber: starts.length, column: text.length - starts.at(-1)! + 1 };
    if (lineNumber < 1 || lineNumber > starts.length) throw new Error("Das Makro passt an dieser Stelle nicht in die Datei.");
    const lineEnd = lineNumber < starts.length ? starts[lineNumber] - (text[starts[lineNumber] - 2] === "\r" ? 2 : 1) : text.length;
    const column = point.edge === "start" ? 1 : point.edge === "end" ? lineEnd - starts[lineNumber - 1] + 1 : point.relative ? origin.column + point.column : point.column;
    const position = { lineNumber, column }; at(position); return position;
  };
  return { at, resolve };
}
/** Preflight the complete macro in memory. A failure never leaves half a macro
 * in the editor, and successful replay becomes one normal undo operation. */
export function simulateMacro(text: string, initial: { anchor: Position; head: Position }, steps: MacroStep[], repetitions = 1) {
  let selection = initial;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error("Wiederholungen müssen zwischen 1 und 100 liegen.");
  for (let repeat = 0; repeat < repetitions; repeat++) for (const step of steps) {
    const origin = selection.head; let map = positions(text);
    if (step.kind === "edit") {
      const edits = step.edits.map(edit => ({ start: map.at(map.resolve(edit.start, origin)), end: map.at(map.resolve(edit.end, origin)), text: edit.text })).sort((a, b) => b.start - a.start);
      let boundary = text.length + 1;
      for (const edit of edits) {
        if (edit.end < edit.start || edit.end > boundary) throw new Error("Überlappende Makro-Schritte sind nicht zulässig.");
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end); boundary = edit.start;
      }
      map = positions(text);
      if (step.after) selection = { anchor: map.resolve(step.after.anchor, origin), head: map.resolve(step.after.head, origin) };
    } else selection = { anchor: map.resolve(step.selection.anchor, origin), head: map.resolve(step.selection.head, origin) };
    if (text.length > 8_000_000) throw new Error("Die Makro-Ausgabe ist zu groß.");
  }
  return { text, selection };
}

export class EditorMacroRecorder {
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private listeners: Monaco.IDisposable[] = [];
  private model: Monaco.editor.ITextModel | null = null;
  private origin: Position = { lineNumber: 1, column: 1 };
  private pending: Extract<MacroStep, { kind: "edit" }> | null = null;
  private edge: MacroPoint["edge"] | undefined;
  private steps: MacroStep[] = [];
  recording = false;
  constructor(private changed: (recording: boolean, count: number, error?: string) => void) {}
  attach(editor: Monaco.editor.IStandaloneCodeEditor) {
    this.dispose(); this.editor = editor;
    this.listeners = [editor.onDidChangeModel(() => { if (this.recording) this.cancel("Die Aufnahme wurde beim Dateiwechsel beendet."); }),
      editor.onKeyDown(event => {
        this.edge = event.code === "End" ? event.ctrlKey || event.metaKey ? "bottom" : "end" : event.code === "Home" ? event.ctrlKey || event.metaKey ? "top" : undefined : undefined;
      }),
      editor.onDidChangeModelContent(event => {
        if (!this.recording || editor.getModel() !== this.model) return;
        if (event.isFlush || event.isUndoing || event.isRedoing) { this.cancel("Die Aufnahme wurde durch Neuladen oder Rückgängig beendet."); return; }
        const step: Extract<MacroStep, { kind: "edit" }> = { kind: "edit", edits: event.changes.map(change => ({ start: relative({ lineNumber: change.range.startLineNumber, column: change.range.startColumn }, this.origin), end: relative({ lineNumber: change.range.endLineNumber, column: change.range.endColumn }, this.origin), text: change.text })) };
        this.steps.push(step); this.pending = step; this.checkLimit();
      }),
      editor.onDidChangeCursorSelection(event => {
        if (!this.recording || editor.getModel() !== this.model) return;
        if (event.secondarySelections.length) { this.cancel("Makros unterstützen derzeit einen Cursor."); return; }
        const selection: MacroSelection = { anchor: relative({ lineNumber: event.selection.selectionStartLineNumber, column: event.selection.selectionStartColumn }, this.origin, event.selection.isEmpty() ? this.edge : undefined), head: relative(event.selection.getPosition(), this.origin, this.edge) };
        if (this.pending) { this.pending.after = selection; this.pending = null; }
        else this.steps.push({ kind: "move", selection });
        this.origin = event.selection.getPosition(); this.edge = undefined; this.checkLimit();
      }),
      editor.onDidDispose(() => { this.cancel(); this.editor = null; }),
    ];
  }
  private checkLimit() {
    if (this.steps.length > 500 || JSON.stringify(this.steps).length > 500_000) this.cancel("Die maximale Makro-Länge wurde erreicht.");
    else this.changed(this.recording, this.steps.length);
  }
  start() {
    const editor = this.editor; const model = editor?.getModel();
    if (!editor || !model || editor.getRawOptions().readOnly || editor.getSelections()?.length !== 1) throw new Error("Öffne eine bearbeitbare Datei mit einem Cursor.");
    this.steps = []; this.pending = null; this.model = model; this.origin = editor.getPosition()!; this.recording = true;
    this.changed(true, 0); editor.focus();
  }
  stop() { const steps = structuredClone(this.steps); this.recording = false; this.pending = null; this.steps = []; this.changed(false, 0); return steps; }
  cancel(error?: string) { const wasRecording = this.recording; this.recording = false; this.steps = []; this.pending = null; if (wasRecording) this.changed(false, 0, error); }
  play(macro: EditorMacro, repetitions = 1) {
    if (this.recording) throw new Error("Beende zuerst die Aufnahme.");
    const editor = this.editor, model = editor?.getModel(), selection = editor?.getSelection();
    if (!editor || !model || !selection || editor.getRawOptions().readOnly) throw new Error("Öffne zuerst eine bearbeitbare Datei.");
    const result = simulateMacro(model.getValue(), { anchor: { lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn }, head: selection.getPosition() }, macro.steps, repetitions);
    editor.pushUndoStop();
    editor.executeEdits("kiwi.macro", [{ range: model.getFullModelRange(), text: result.text }]);
    const { anchor, head } = result.selection;
    editor.setSelections([{ selectionStartLineNumber: anchor.lineNumber, selectionStartColumn: anchor.column, positionLineNumber: head.lineNumber, positionColumn: head.column }]);
    editor.pushUndoStop(); editor.focus();
  }
  dispose() { this.cancel(); this.listeners.forEach(listener => listener.dispose()); this.listeners = []; this.editor = null; }
}
