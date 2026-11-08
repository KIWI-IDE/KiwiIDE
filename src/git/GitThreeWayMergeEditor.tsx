import { useEffect, useMemo, useState } from "react";
import type { GitMergeConflictChunk, GitMergeResolution } from "../types";
import "./git-workflow.css";
import { t } from "../i18n";

type LineSelection = { source: "ours" | "base" | "theirs"; index: number };

export function GitThreeWayMergeEditor({ root, file, onResolved, onClose }: {
  root: string;
  file: string;
  onResolved?: () => void;
  onClose?: () => void;
}) {
  const [model, setModel] = useState<Awaited<ReturnType<NonNullable<typeof window.kiwi>["git"]["mergeModel"]>> | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, GitMergeResolution>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const conflicts = useMemo(() => model?.chunks.filter((chunk): chunk is GitMergeConflictChunk => chunk.kind === "conflict") || [], [model]);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setModel(await window.kiwi!.git.mergeModel(root, file));
      setResolutions({});
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, [root, file]);

  const choose = (id: string, choice: GitMergeResolution["choice"]) => {
    setResolutions((current) => ({ ...current, [id]: { id, choice } }));
  };
  const toggleLine = (id: string, selection: LineSelection) => {
    setResolutions((current) => {
      const previous = current[id];
      const lines = previous?.choice === "lines" ? [...(previous.lines || [])] : [];
      const existing = lines.findIndex((line) => line.source === selection.source && line.index === selection.index);
      if (existing >= 0) lines.splice(existing, 1);
      else lines.push(selection);
      return { ...current, [id]: { id, choice: "lines", lines } };
    });
  };
  const apply = async () => {
    if (!model) return;
    if (conflicts.some((conflict) => !resolutions[conflict.id])) {
      setError("Löse zuerst jeden Konflikt auf.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await window.kiwi!.git.resolveMerge(root, file, model.snapshot, Object.values(resolutions));
      onResolved?.();
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally {
      setBusy(false);
    }
  };

  return <section className="git-workflow-view git-merge-view" aria-label={t("Drei-Wege-Merge")}>
    <header className="git-workflow-header">
      <div><h2>{t("Drei-Wege-Merge")}</h2><p>{file}</p></div>
      {onClose && <button type="button" onClick={onClose} aria-label={t("Schließen")}>×</button>}
    </header>
    <div className="git-workflow-toolbar">
      <button type="button" onClick={() => void load()} disabled={busy}>{t("Neu laden")}</button>
      <button className="primary" type="button" onClick={() => void apply()} disabled={busy || !model}>{t("Auflösen und stagen")}</button>
      <span>{conflicts.filter((conflict) => resolutions[conflict.id]).length}/{conflicts.length} Konflikte gelöst</span>
    </div>
    {error && <div className="git-workflow-error" role="alert">{error}</div>}
    <div className="git-merge-grid-labels"><strong>{t("Deine Version")}</strong><strong>{t("Gemeinsame Basis")}</strong><strong>{t("Eingehende Version")}</strong></div>
    <div className="git-merge-conflicts" aria-busy={busy}>
      {conflicts.map((conflict, conflictIndex) => {
        const resolution = resolutions[conflict.id];
        return <article className="git-merge-conflict" key={conflict.id}>
          <header>
            <strong>Konflikt {conflictIndex + 1}</strong>
            <div className="git-merge-actions">
              <button className={resolution?.choice === "ours" ? "selected" : ""} onClick={() => choose(conflict.id, "ours")}>{t("Deine übernehmen")}</button>
              <button className={resolution?.choice === "base" ? "selected" : ""} onClick={() => choose(conflict.id, "base")}>{t("Basis übernehmen")}</button>
              <button className={resolution?.choice === "theirs" ? "selected" : ""} onClick={() => choose(conflict.id, "theirs")}>{t("Eingehende übernehmen")}</button>
              <button className={resolution?.choice === "both" ? "selected" : ""} onClick={() => choose(conflict.id, "both")}>{t("Beide übernehmen")}</button>
            </div>
          </header>
          <div className="git-merge-columns">
            <MergeLines source="ours" lines={conflict.oursLines} selected={resolution?.choice === "lines" ? resolution.lines || [] : []} onToggle={(line) => toggleLine(conflict.id, line)} />
            <MergeLines source="base" lines={conflict.baseLines} selected={resolution?.choice === "lines" ? resolution.lines || [] : []} onToggle={(line) => toggleLine(conflict.id, line)} />
            <MergeLines source="theirs" lines={conflict.theirsLines} selected={resolution?.choice === "lines" ? resolution.lines || [] : []} onToggle={(line) => toggleLine(conflict.id, line)} />
          </div>
          {resolution?.choice === "lines" && <small>{t("Die markierten Zeilen werden in der Reihenfolge ihrer Auswahl übernommen.")}</small>}
        </article>;
      })}
      {!busy && model && !conflicts.length && <div className="git-workflow-empty">{t("Git konnte die Datei automatisch zusammenführen.")}</div>}
    </div>
  </section>;
}

function MergeLines({ source, lines, selected, onToggle }: {
  source: LineSelection["source"];
  lines: string[];
  selected: LineSelection[];
  onToggle: (selection: LineSelection) => void;
}) {
  return <div className={`git-merge-code source-${source}`}>
    {lines.map((line, index) => {
      const active = selected.some((selection) => selection.source === source && selection.index === index);
      return <button type="button" className={active ? "selected" : ""} onClick={() => onToggle({ source, index })} key={`${index}:${line}`}>
        <span>{index + 1}</span><code>{line || " "}</code>
      </button>;
    })}
  </div>;
}
