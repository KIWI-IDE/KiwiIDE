import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import type { GitHubActionsList, GitHubActionsDetails, GitHubJob } from "../types";
import "../components/feature-tools.css";
const statusText = (item: { status: string; conclusion: string }) => item.conclusion || item.status.replaceAll("_", " ");

export function GitHubActionsView({ root, onConnect, onClose }: { root: string; onConnect: () => void; onClose: () => void }) {
  const [list, setList] = useState<GitHubActionsList | null>(null);
  const [details, setDetails] = useState<GitHubActionsDetails | null>(null);
  const [filter, setFilter] = useState({ branch: "", status: "", workflowId: "", page: 1 });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [log, setLog] = useState<{ job: GitHubJob; text: string; truncated: boolean } | null>(null);
  const [logBusy, setLogBusy] = useState(false); const [confirmRun, setConfirmRun] = useState(false); const [rerunning, setRerunning] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0), detailRequest = useRef(0), logRequest = useRef(0);
  const selectedId = useRef<number | null>(null); const currentRoot = useRef(root); currentRoot.current = root;
  const load = useCallback(async (silent = false) => {
    const request = ++epoch.current;
    if (!silent) setBusy(true);
    try {
      const result = await window.kiwi!.git.actionsList(root, { ...filter, workflowId: filter.workflowId ? Number(filter.workflowId) : undefined });
      if (request !== epoch.current || currentRoot.current !== root) return;
      setList(result); setError("");
    } catch (error) { if (request === epoch.current && currentRoot.current === root) setError(String(error)); }
    finally { if (request === epoch.current) setBusy(false); }
  }, [root, filter]);
  const select = useCallback(async (id: number, silent = false) => {
    const request = ++detailRequest.current;
    if (!silent) { selectedId.current = id; logRequest.current++; setLog(null); setLogBusy(false); setDetails(null); setConfirmRun(false); setBusy(true); }
    try {
      const result = await window.kiwi!.git.actionsDetails(root, id);
      if (request === detailRequest.current && currentRoot.current === root && selectedId.current === id) setDetails(result);
    } catch (error) { if (request === detailRequest.current && currentRoot.current === root) setError(String(error)); }
    finally { if (request === detailRequest.current) setBusy(false); }
  }, [root]);
  useEffect(() => {
    selectedId.current = null; detailRequest.current++; logRequest.current++;
    setDetails(null); setLog(null); setConfirmRun(false); setNotice(""); setList(null); setLogBusy(false);
    const initial = window.setTimeout(() => void load(), 250);
    const timer = window.setInterval(() => { if (document.visibilityState !== "visible") return; void load(true); if (selectedId.current) void select(selectedId.current, true); }, 15_000);
    return () => { clearTimeout(initial); clearInterval(timer); epoch.current++; detailRequest.current++; logRequest.current++; };
  }, [load, select]);
  const showLog = async (job: GitHubJob) => {
    const runId = selectedId.current; if (!runId) return;
    const request = ++logRequest.current; setLogBusy(true); setError("");
    try {
      const result = await window.kiwi!.git.actionsLogs(root, runId, job.id);
      if (request === logRequest.current && currentRoot.current === root && selectedId.current === runId) setLog({ job, ...result });
    } catch (error) { if (request === logRequest.current && currentRoot.current === root) setError(String(error)); }
    finally { if (request === logRequest.current) setLogBusy(false); }
  };
  const rerun = async () => {
    if (!details) return;
    const runId = details.run.id; const requestedRoot = root;
    setRerunning(true); setError("");
    try {
      await window.kiwi!.git.actionsRerunFailed(root, runId);
      if (currentRoot.current !== requestedRoot) return;
      if (selectedId.current === runId) {
        setConfirmRun(false); setNotice("GitHub accepted the request. Failed jobs will be queued again.");
        void load(true); void select(runId, true);
      }
    } catch (error) { if (currentRoot.current === requestedRoot) setError(String(error)); }
    finally { if (currentRoot.current === requestedRoot) setRerunning(false); }
  };
  return <section className="feature-workbench actions-view" aria-label="GitHub Actions">
    <header><div><h2>GitHub Actions</h2><p>{list?.repository || "Workflow runs for this project's GitHub repository"}</p></div><button onClick={onClose} aria-label="Close">×</button></header>
    <form className="feature-toolbar" onSubmit={event => { event.preventDefault(); void load(); }}>
      <input aria-label="Branch" placeholder="Branch (all)" value={filter.branch} onChange={event => setFilter({ ...filter, branch: event.target.value, page: 1 })} />
      <select aria-label="Workflow" value={filter.workflowId} onChange={event => setFilter({ ...filter, workflowId: event.target.value, page: 1 })}><option value="">All workflows</option>{list?.workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select>
      <select aria-label="Run status" value={filter.status} onChange={event => setFilter({ ...filter, status: event.target.value, page: 1 })}><option value="">All statuses</option>{["queued", "in_progress", "failure", "success", "cancelled"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
      <button disabled={busy}><RefreshCw size={14} />Refresh</button><button type="button" onClick={onConnect}>GitHub account</button>
    </form>
    {error && <div className="feature-error" role="alert">{error}</div>}{notice && <p className="feature-notice" role="status">{notice}</p>}
    <div className="actions-layout">
      <nav aria-label="Workflow runs" aria-busy={busy}>{list?.runs.map(run => <button key={run.id} className={details?.run.id === run.id ? "selected" : ""} onClick={() => void select(run.id)}><span className={`action-status action-${run.conclusion || run.status}`}>{statusText(run)}</span><strong>{run.title}</strong><small>{run.name} #{run.number} · {run.branch} · {run.sha.slice(0, 7)}</small><small>{new Date(run.createdAt).toLocaleString()} · {run.actor}</small></button>)}{!busy && !list?.runs.length && <p>No workflow runs found. Public repositories can be viewed without signing in.</p>}<div className="feature-actions"><button disabled={busy || filter.page <= 1} onClick={() => setFilter({ ...filter, page: filter.page - 1 })}>Previous</button><span>Page {filter.page}</span><button disabled={busy || (list?.runs.length || 0) < 30} onClick={() => setFilter({ ...filter, page: filter.page + 1 })}>Next</button></div></nav>
      <div className="actions-details">{details ? <>
        <h3>{details.run.title}</h3><p>{details.run.branch} · {details.run.sha.slice(0, 12)} · attempt {details.run.attempt} · {statusText(details.run)}</p>
        <div className="feature-actions"><button onClick={() => void window.kiwi!.app.openUpdate(details.run.url)}><ExternalLink size={14} />Open on GitHub</button>{details.run.status === "completed" && ["failure", "timed_out"].includes(details.run.conclusion) && <button disabled={rerunning} onClick={() => setConfirmRun(true)}><RotateCcw size={14} />Re-run failed jobs</button>}</div>
        {confirmRun && <div className="feature-confirm" role="alertdialog" aria-label="Re-run failed jobs"><p>Re-run failed jobs for <strong>{details.run.name} #{details.run.number}</strong> on {details.run.branch} ({details.run.sha.slice(0, 7)})? This starts work on GitHub and may consume Actions minutes.</p><button disabled={rerunning} onClick={() => void rerun()}>Confirm re-run</button><button disabled={rerunning} onClick={() => setConfirmRun(false)}>Cancel</button></div>}
        {details.jobs.map(job => <article className="action-job" key={job.id}><header><strong>{job.name}</strong><span className={`action-status action-${job.conclusion || job.status}`}>{statusText(job)}</span><button disabled={logBusy} onClick={() => void showLog(job)}>View log</button></header><ol>{job.steps.map(step => <li key={step.number}><span className={`action-status action-${step.conclusion || step.status}`}>{statusText(step)}</span> {step.name}</li>)}</ol></article>)}
        {details.totalJobs > details.jobs.length && <p>Showing the first {details.jobs.length} jobs. Open the run on GitHub to see all {details.totalJobs} jobs.</p>}
        {logBusy && <p role="status">Loading job log…</p>}{log && <section className="action-log"><h4>{log.job.name}</h4>{log.truncated && <p>The log is limited to 2 MB. Open the run on GitHub for the full log.</p>}<pre tabIndex={0}>{log.text || "This job has no log output yet."}</pre></section>}
      </> : <p>Select a workflow run to inspect jobs, steps and logs. Active runs refresh every 15 seconds.</p>}</div>
    </div>
  </section>;
}
