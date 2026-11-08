import { useEffect, useRef, useState } from "react";
import type { GitHubSession, GitPullRequest } from "../types";
import "./git-workflow.css";
import { t } from "../i18n";

type PullDetails = Awaited<ReturnType<NonNullable<typeof window.kiwi>["git"]["pullRequest"]>>;

export function GitPullRequestView({ root, onClose }: { root: string; onClose?: () => void }) {
  const [session, setSession] = useState<GitHubSession | null>(null);
  const [pulls, setPulls] = useState<GitPullRequest[]>([]);
  const [selected, setSelected] = useState<PullDetails | null>(null);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const [repository, setRepository] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string; expiresIn: number; interval: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPull, setNewPull] = useState({ title: "", body: "", base: "main", draft: false });
  const tokenRef = useRef<HTMLInputElement>(null);

  const load = async (state = filter) => {
    setBusy(true);
    setError("");
    try {
      const account = await window.kiwi!.git.githubStatus();
      setSession(account);
      if (!account.signedIn) return;
      const result = await window.kiwi!.git.pullRequests(root, state);
      setPulls(result.pulls);
      setRepository(result.repository.fullName);
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, [root]);

  const signInToken = async () => {
    const token = tokenRef.current?.value || "";
    if (tokenRef.current) tokenRef.current.value = "";
    setBusy(true);
    setError("");
    try {
      setSession(await window.kiwi!.git.githubSignIn(token));
      await load();
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
      setBusy(false);
    }
  };
  const beginDevice = async () => {
    setBusy(true);
    setError("");
    try {
      const flow = await window.kiwi!.git.githubBeginDeviceFlow();
      setDevice(flow);
      await window.kiwi!.app.openUpdate(flow.verificationUri);
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally { setBusy(false); }
  };
  const pollDevice = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.kiwi!.git.githubPollDeviceFlow();
      if (result.status === "complete") {
        setSession(result.session);
        setDevice(null);
        await load();
      } else setError(`GitHub wartet noch auf die Bestätigung. In ${result.retryAfter} Sekunden erneut prüfen.`);
    } catch (problem) {
      setError(String((problem as Error)?.message || problem));
    } finally { setBusy(false); }
  };
  const openPull = async (pull: GitPullRequest) => {
    setBusy(true);
    try { setSelected(await window.kiwi!.git.pullRequest(root, pull.number)); }
    catch (problem) { setError(String((problem as Error)?.message || problem)); }
    finally { setBusy(false); }
  };
  const createPull = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await window.kiwi!.git.createPullRequest(root, newPull);
      setCreating(false);
      setNewPull({ title: "", body: "", base: "main", draft: false });
      await load("open");
      await openPull(created);
    } catch (problem) { setError(String((problem as Error)?.message || problem)); setBusy(false); }
  };

  return <section className="git-workflow-view git-pr-view" aria-label={t("Pull Requests")}>
    <header className="git-workflow-header">
      <div><h2>{t("Pull Requests")}</h2><p>{repository || "GitHub"}</p></div>
      {onClose && <button type="button" onClick={onClose} aria-label={t("Schließen")}>×</button>}
    </header>
    {error && <div className="git-workflow-error" role="alert">{error}</div>}
    {!session?.signedIn ? <div className="git-login-card">
      <h3>{t("Mit GitHub verbinden")}</h3>
      <p>Das Token bleibt im Electron-Hauptprozess und wird mit Windows DPAPI verschlüsselt. Kiwi schreibt es weder in Git noch in Logs.</p>
      {session?.deviceFlowAvailable && <button className="primary" type="button" onClick={() => void beginDevice()} disabled={busy}>{t("Im Browser anmelden")}</button>}
      {device && <div className="git-device-code"><span>{t("Code")}</span><strong>{device.userCode}</strong><button onClick={() => void pollDevice()} disabled={busy}>{t("Anmeldung prüfen")}</button></div>}
      <details><summary>{t("Mit Personal Access Token anmelden")}</summary>
        <label>{t("GitHub Token")}<input ref={tokenRef} type="password" autoComplete="off" spellCheck={false} placeholder={t("github_pat_… oder ghp_…")} /></label>
        <button type="button" onClick={() => void signInToken()} disabled={busy}>{t("Token sicher speichern")}</button>
      </details>
    </div> : <>
      <div className="git-workflow-toolbar">
        {session.avatarUrl && <img className="git-avatar" src={session.avatarUrl} alt="" />}
        <strong>{session.name || session.login}</strong><span>@{session.login} · {session.tokenType || "Token"}</span>
        <select value={filter} onChange={(event) => { const value = event.target.value as typeof filter; setFilter(value); void load(value); }}>
          <option value="open">{t("Offen")}</option><option value="closed">{t("Geschlossen")}</option><option value="all">{t("Alle")}</option>
        </select>
        <button className="primary" type="button" onClick={() => setCreating((value) => !value)}>{t("Neuer Pull Request")}</button>
        <button type="button" onClick={() => void load()} disabled={busy}>{t("Aktualisieren")}</button>
        <button type="button" onClick={async () => { setSession(await window.kiwi!.git.githubSignOut()); setPulls([]); }}>{t("Abmelden")}</button>
      </div>
      {creating && <form className="git-pr-create" onSubmit={(event) => { event.preventDefault(); void createPull(); }}>
        <label>{t("Titel")}<input required maxLength={256} value={newPull.title} onChange={(event) => setNewPull({ ...newPull, title: event.target.value })} /></label>
        <label>{t("Ziel-Branch")}<input required value={newPull.base} onChange={(event) => setNewPull({ ...newPull, base: event.target.value })} /></label>
        <label className="wide">{t("Beschreibung")}<textarea value={newPull.body} onChange={(event) => setNewPull({ ...newPull, body: event.target.value })} /></label>
        <label className="checkbox"><input type="checkbox" checked={newPull.draft} onChange={(event) => setNewPull({ ...newPull, draft: event.target.checked })} /> {t("Als Entwurf erstellen")}</label>
        <div><button type="button" onClick={() => setCreating(false)}>{t("Abbrechen")}</button><button className="primary" type="submit" disabled={busy}>{t("Erstellen")}</button></div>
      </form>}
      <div className="git-pr-layout">
        <div className="git-pr-list" aria-busy={busy}>
          {pulls.map((pull) => <button type="button" className={selected?.pull.number === pull.number ? "selected" : ""} onClick={() => void openPull(pull)} key={pull.number}>
            <span className={`git-pr-state state-${pull.state}`}>#{pull.number}</span><strong>{pull.title}</strong>
            <small>{pull.author} · {pull.head} → {pull.base}</small>
          </button>)}
          {!busy && !pulls.length && <div className="git-workflow-empty">{t("Keine Pull Requests gefunden.")}</div>}
        </div>
        <div className="git-pr-details">
          {selected ? <>
            <header><h3>#{selected.pull.number} {selected.pull.title}</h3><button onClick={() => void window.kiwi!.app.openUpdate(selected.pull.url)}>{t("Auf GitHub öffnen")}</button></header>
            <p>{selected.body || "Keine Beschreibung."}</p>
            <div className="git-pr-metrics"><span>+{selected.pull.additions}</span><span>−{selected.pull.deletions}</span><span>{selected.pull.changedFiles} Dateien</span><span>{selected.mergeableState}</span></div>
            <h4>{t("Geänderte Dateien")}</h4>
            {selected.files.map((file) => <details key={file.filename}><summary>{file.filename} <small>+{file.additions} −{file.deletions}</small></summary><pre>{file.patch || "Binärdatei oder Diff nicht verfügbar."}</pre></details>)}
            {!!selected.reviews.length && <><h4>{t("Reviews")}</h4>{selected.reviews.map((review) => <blockquote key={review.id}><strong>{review.author} · {review.state}</strong><p>{review.body}</p></blockquote>)}</>}
          </> : <div className="git-workflow-empty">{t("Wähle einen Pull Request aus.")}</div>}
        </div>
      </div>
    </>}
  </section>;
}
