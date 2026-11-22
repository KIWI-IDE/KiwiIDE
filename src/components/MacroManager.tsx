import { useState } from "react";
import { Play, Trash2, X } from "lucide-react";
import type { EditorMacro, MacroStep } from "../editor/editor-macros";
import { normalizeShortcut, shortcutFromEvent } from "../keybindings";
import "./feature-tools.css";

export function MacroManager({ macros, draft, reservedShortcuts, onSave, onRemove, onPlay, onRecord, onClose }: {
  macros: EditorMacro[]; draft: MacroStep[] | null; reservedShortcuts: string[];
  onSave: (macro: EditorMacro) => Promise<void>; onRemove: (id: string) => Promise<void>;
  onPlay: (macro: EditorMacro, repetitions: number) => void; onRecord: () => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<EditorMacro | null>(draft ? { id: crypto.randomUUID(), name: "New macro", shortcut: "", steps: draft, updatedAt: Date.now() } : macros[0] || null);
  const [repetitions, setRepetitions] = useState(1);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!selected) return;
    const shortcut = normalizeShortcut(selected.shortcut);
    if (shortcut && reservedShortcuts.some(value => normalizeShortcut(value) === shortcut)) { setError("This shortcut is already assigned to an IDE command."); return; }
    setBusy(true); setError("");
    try { await onSave({ ...selected, shortcut }); }
    catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop feature-modal-backdrop" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <section className="feature-dialog macro-manager" role="dialog" aria-modal="true" aria-label="Editor macros">
      <header><div><h2>Editor macros</h2><p>Record editing steps and replay them at the current cursor.</p></div><button onClick={onClose} aria-label="Close"><X size={17} /></button></header>
      {error && <p className="feature-error" role="alert">{error}</p>}
      <div className="macro-layout">
        <nav aria-label="Saved macros">{macros.map(macro => <button className={selected?.id === macro.id ? "selected" : ""} key={macro.id} onClick={() => { setSelected(macro); setError(""); }}><strong>{macro.name}</strong><small>{macro.shortcut || `${macro.steps.length} steps`}</small></button>)}{!macros.length && <p>No saved macros yet.</p>}</nav>
        <div className="macro-details">{selected ? <>
          <label>Name<input maxLength={80} value={selected.name} onChange={event => setSelected({ ...selected, name: event.target.value })} /></label>
          <label>Shortcut<input className="keybinding-capture" value={selected.shortcut} placeholder="Press Ctrl or Alt + a key" readOnly onKeyDown={event => {
            if (event.key === "Tab" || event.key === "Escape") return;
            event.preventDefault(); event.stopPropagation();
            if (event.ctrlKey || event.metaKey || event.altKey) { const shortcut = shortcutFromEvent(event.nativeEvent); if (shortcut) setSelected({ ...selected, shortcut }); }
          }} /></label><button onClick={() => setSelected({ ...selected, shortcut: "" })}>Clear shortcut</button>
          <p>{selected.steps.length} recorded steps · editing stays in the active file · undo restores the previous text.</p>
          <label>Repetitions<input type="number" min={1} max={100} value={repetitions} onChange={event => setRepetitions(Number(event.target.value))} /></label>
          <div className="feature-actions"><button disabled={busy || !selected.name.trim()} onClick={() => void save()}>Save macro</button><button disabled={busy || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100} onClick={() => onPlay(selected, repetitions)}><Play size={14} />Play</button><button disabled={busy || !macros.some(macro => macro.id === selected.id)} onClick={async () => { setBusy(true); try { await onRemove(selected.id); setSelected(null); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}><Trash2 size={14} />Delete</button></div>
        </> : <p>Start a recording in an editable file to create a macro.</p>}</div>
      </div>
      <footer><button disabled={busy} onClick={onRecord}>Start recording</button><button onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}
