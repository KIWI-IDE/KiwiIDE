import { useEffect, useState } from "react";
import type { GitRebaseAction, GitRebaseEntry, GitRebasePlan, GitRebaseState } from "../types";
import "./git-workflow.css";
import { t } from "../i18n";

const actions: Array<{ value: GitRebaseAction; label: string }> = [
  { value: "pick", label: "Behalten" },
  { value: "reword", label: "Nachricht ändern" },
  { value: "edit", label: "Zum Bearbeiten anhalten" },
  { value: "squash", label: "Mit vorherigem verbinden" },
  { value: "fixup", label: "Verbinden, Nachricht verwerfen" },
  { value: "drop", label: "Entfernen" },
];

export function GitRebaseEditor({ root, initialUpstream = "main", onClose, onChanged }: {
  root: string;
  initialUpstream?: string;
  onClose?: () => void;
  onChanged?: () => void;
}) {
  const [upstream, setUpstream] = useState(initialUpstream);
  const [plan, setPlan] = useState<GitRebasePlan | null>(null);
  const [state, setState] = useState<GitRebaseState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshState = async () => setState(await window.kiwi!.git.rebaseState(root));
  const loadPlan = async () => {
    setBusy(true);
    setError("");
    try {
      const loaded = await window.kiwi!.git.rebasePlan(root, upstream);
      setPlan(loaded);
      await refreshState();
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void loadPlan(); }, [root]);

  const update = (index: number, patch: Partial<GitRebaseEntry>) => {
    setPlan((current) => current ? {
      ...current,
      commits: current.commits.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry),
    } : current);
  };
  const move = (index: number, direction: -1 | 1) => {
    setPlan((current) => {
      if (!current || index + direction < 0 || index + direction >= current.commits.length) return current;
      const commits = [...current.commits];
      [commits[index], commits[index + direction]] = [commits[index + direction], commits[index]];
      return { ...current, commits };
    });
  };
  const execute = async (kind: "start" | "continue" | "skip" | "abort") => {
    if (!plan && kind === "start") return;
    setBusy(true);
    setError("");
    try {
      const result = kind === "start"
        ? await window.kiwi!.git.rebaseInteractive(root, upstream, plan!.commits)
        : await window.kiwi!.git.rebase(root, kind);
      setState(result.state);
      onChanged?.();
      if (!result.state.active) await loadPlan();
      if (result.code !== 0 && !result.state.active) setError(result.output || "Rebase fehlgeschlagen.");
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally {
      setBusy(false);
    }
  };

  return <section className="git-workflow-view" aria-label={t("Interaktiver Rebase")}>
    <header className="git-workflow-header">
      <div><h2>{t("Interaktiver Rebase")}</h2><p>{t("Commits neu anordnen, verbinden, umbenennen oder entfernen.")}</p></div>
      {onClose && <button type="button" onClick={onClose} aria-label={t("Schließen")}>×</button>}
    </header>
    <div className="git-workflow-toolbar">
      <label>{t("Auf Branch")} <input value={upstream} onChange={(event) => setUpstream(event.target.value)} /></label>
      <button type="button" onClick={() => void loadPlan()} disabled={busy}>{t("Neu laden")}</button>
      {!state?.active && <button className="primary" type="button" onClick={() => void execute("start")} disabled={busy || !plan?.commits.length}>{t("Rebase starten")}</button>}
      {state?.active && <>
        <button className="primary" type="button" onClick={() => void execute("continue")} disabled={busy || Boolean(state.conflicts?.length)}>{t("Fortsetzen")}</button>
        <button type="button" onClick={() => void execute("skip")} disabled={busy}>{t("Commit überspringen")}</button>
        <button className="danger" type="button" onClick={() => void execute("abort")} disabled={busy}>{t("Abbrechen")}</button>
      </>}
    </div>
    {error && <div className="git-workflow-error" role="alert">{error}</div>}
    {state?.active && <div className="git-workflow-state">
      <strong>{t("Rebase läuft")}</strong>
      <span>{state.done.length} erledigt · {state.todo.length} ausstehend</span>
      {!!state.conflicts?.length && <span className="danger-text">Konflikte: {state.conflicts.join(", ")}</span>}
    </div>}
    <div className="git-rebase-list" aria-busy={busy}>
      {plan?.commits.map((entry, index) => <article className={`git-rebase-row action-${entry.action}`} key={entry.hash}>
        <div className="git-rebase-move">
          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("Nach oben")}>↑</button>
          <button type="button" onClick={() => move(index, 1)} disabled={index === plan.commits.length - 1} aria-label={t("Nach unten")}>↓</button>
        </div>
        <select value={entry.action} onChange={(event) => update(index, { action: event.target.value as GitRebaseAction })}>
          {actions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
        </select>
        <code>{entry.shortHash}</code>
        <div className="git-rebase-subject">
          <strong>{entry.subject}</strong><small>{entry.author} · {new Date(entry.date).toLocaleString("de-DE")}</small>
          {entry.action === "reword" && <input aria-label={t("Neue Commit-Nachricht")} value={entry.message} onChange={(event) => update(index, { message: event.target.value })} />}
        </div>
      </article>)}
      {!busy && plan && !plan.commits.length && <div className="git-workflow-empty">Keine Commits zwischen {upstream} und HEAD.</div>}
    </div>
  </section>;
}
