import { useEffect, useRef, useState } from "react";
import { Search, Check } from "lucide-react";
import type { StructuralPreview, StructuralApplyResult } from "../types";
import "./feature-tools.css";

export function StructuralSearchView({ root, dirtyFiles, onApply, onOpen, onClose }: {
  root: string; dirtyFiles: () => string[]; onApply: (result: StructuralApplyResult) => void;
  onOpen: (file: string, line: number, column: number) => void; onClose: () => void;
}) {
  const [language, setLanguage] = useState("java");
  const [pattern, setPattern] = useState("System.out.println($value$)");
  const [replacement, setReplacement] = useState("logger.info($value$)");
  const [preview, setPreview] = useState<StructuralPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const generation = useRef(0), currentRoot = useRef(root); currentRoot.current = root;
  useEffect(() => { generation.current++; setPreview(null); setSelected(new Set()); setError(""); setNotice(""); setBusy(false); return () => { generation.current++; }; }, [root, language, pattern, replacement]);
  const search = async () => {
    const request = ++generation.current; setBusy(true); setError(""); setNotice(""); setPreview(null);
    try {
      const result = await window.kiwi!.workspace.structuralPreview(root, { language, pattern, replacement, dirtyFiles: dirtyFiles() });
      if (request !== generation.current || currentRoot.current !== root) return;
      setPreview(result); setSelected(new Set(result.matches.map(match => match.id)));
    } catch (error) { if (request === generation.current) setError(String(error)); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const apply = async () => {
    if (!preview || busy) return;
    const request = ++generation.current; setBusy(true); setError("");
    try {
      const result = await window.kiwi!.workspace.structuralApply(root, preview.planId, [...selected], dirtyFiles());
      if (request !== generation.current || currentRoot.current !== root) return;
      onApply(result); setPreview(null); setSelected(new Set()); setNotice(`Replaced ${result.replacements} matches in ${result.files.length} files. Available in project undo history.`);
    } catch (error) { if (request === generation.current) setError(String(error)); }
    finally { if (request === generation.current) setBusy(false); }
  };
  return <section className="feature-workbench structural-view" aria-label="Structural search">
    <header><div><h2>Structural search & replace</h2><p>Match code structure across whitespace and comments. Preview every change before applying.</p></div><button onClick={onClose} aria-label="Close">×</button></header>
    <form className="structural-form" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label>Language<select disabled={busy} value={language} onChange={event => setLanguage(event.target.value)}><option value="java">Java</option><option value="javascript">JavaScript / TypeScript</option><option value="kotlin">Kotlin / Gradle Kotlin</option><option value="python">Python</option><option value="c">C / C++ / C# / Go / Rust</option></select></label>
      <label>Search pattern<textarea disabled={busy} spellCheck={false} value={pattern} onChange={event => setPattern(event.target.value)} /></label>
      <label>Replacement<textarea disabled={busy} spellCheck={false} value={replacement} onChange={event => setReplacement(event.target.value)} /></label>
      <p><code>$value$</code> captures a balanced expression; <code>$$args$$</code> captures an argument list, including an empty list. Repeated names must match the same tokens. Matches use syntax tokens, without semantic type inference. Comments and literal contents are not searched as code.</p>
      <div className="feature-actions"><button type="submit" disabled={busy || !pattern.trim()}><Search size={14} />{busy ? "Working…" : "Find & preview"}</button>{preview && <button type="button" disabled={busy || !selected.size} onClick={() => void apply()}><Check size={14} />Apply {selected.size} selected changes</button>}</div>
    </form>
    {error && <p className="feature-error" role="alert">{error}</p>}{notice && <p className="feature-notice" role="status">{notice}</p>}
    {preview && <div className="structural-results">
      <div className="feature-toolbar"><strong>{preview.matches.length} matches · {preview.scanned} files searched</strong><button onClick={() => setSelected(new Set(preview.matches.map(match => match.id)))}>Select all</button><button onClick={() => setSelected(new Set())}>Select none</button></div>
      {preview.truncated && <p className="feature-notice">Search limits reached. Narrow the pattern and search again for remaining matches.</p>}
      {!!preview.skipped.length && <details><summary>{preview.skipped.length} files skipped</summary>{preview.skipped.map(item => <p key={item.file}>{item.file} — {item.reason === "unsaved" ? "unsaved changes; save and search again" : "file too large"}</p>)}</details>}
      {!preview.matches.length && <p>No matching code found.</p>}
      {preview.matches.map(match => <article className="structural-match" key={match.id}><header><input type="checkbox" aria-label={`Select ${match.relative}:${match.line}`} checked={selected.has(match.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(match.id); else next.delete(match.id); return next; })} /><button onClick={() => onOpen(match.file, match.line, match.column)}>{match.relative}:{match.line}:{match.column}</button></header><div className="structural-diff"><div><small>Before</small><pre>{match.before}</pre></div><div><small>After</small><pre>{match.after || "(delete)"}</pre></div></div></article>)}
    </div>}
  </section>;
}
