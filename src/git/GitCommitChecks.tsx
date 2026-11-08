import { useEffect, useState } from "react";
import type { GitCommitCheckResult, GitCommitCheckSettings } from "../types";
import "./git-workflow.css";
import { t } from "../i18n";

export function GitCommitChecks({ root, compact = false }: { root: string; compact?: boolean }) {
  const [settings, setSettings] = useState<GitCommitCheckSettings | null>(null);
  const [results, setResults] = useState<GitCommitCheckResult[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setBusy(true);
    void window.kiwi!.git.commitChecks(root).then(setSettings).catch((problem) => {
      setError(String((problem as Error)?.message || problem));
    }).finally(() => setBusy(false));
  }, [root]);

  const update = async (patch: Partial<GitCommitCheckSettings>) => {
    if (!settings) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    setError("");
    try { setSettings(await window.kiwi!.git.updateCommitChecks(root, patch)); }
    catch (problem) { setSettings(settings); setError(String((problem as Error)?.message || problem)); }
  };
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await window.kiwi!.git.runCommitChecks(root);
      setResults(response.results);
      if (!response.ok) setError("Mindestens eine Commit-Prüfung ist fehlgeschlagen.");
    } catch (problem) { setError(String((problem as Error)?.message || problem)); }
    finally { setBusy(false); }
  };

  return <section className={`git-commit-checks ${compact ? "compact" : ""}`} aria-busy={busy}>
    <header><div><h3>{t("Commit-Prüfungen")}</h3><p>{t("Werden automatisch ausgeführt, bevor Git einen Commit anlegt.")}</p></div><button type="button" onClick={() => void run()} disabled={busy || !settings}>{t("Jetzt prüfen")}</button></header>
    {error && <div className="git-workflow-error" role="alert">{error}</div>}
    {settings && <div className="git-check-options">
      <CheckToggle label="Build" description="Kompiliert das Maven-/Gradle-Projekt." checked={settings.build} onChange={(build) => void update({ build })} />
      <CheckToggle label="Tests" description="Führt alle Tests vor dem Commit aus." checked={settings.tests} onChange={(tests) => void update({ tests })} />
      <CheckToggle label="Formatierung" description="Spotless, fmt oder Checkstyle prüfen." checked={settings.format} onChange={(format) => void update({ format })} />
      <CheckToggle label="Übersprungene Prüfung blockiert" description="Verhindert Commits, wenn ein Werkzeug fehlt." checked={settings.failOnSkipped} onChange={(failOnSkipped) => void update({ failOnSkipped })} />
    </div>}
    {!!results.length && <div className="git-check-results">{results.map((result) => <details key={result.id} className={`status-${result.status}`}>
      <summary><span>{result.status === "passed" ? "✓" : result.status === "failed" ? "×" : "–"}</span><strong>{result.label}</strong><small>{Math.round(result.durationMs / 100) / 10}s</small></summary>
      <pre>{result.output || result.reason || "Keine Ausgabe."}</pre>
    </details>)}</div>}
  </section>;
}

function CheckToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
