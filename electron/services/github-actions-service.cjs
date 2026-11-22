const { redactSecrets } = require("./github-auth-service.cjs");
const id = value => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error("Ungültige GitHub-ID."); return number; };
const text = value => String(value || "");
const runView = run => ({ id: id(run.id), name: text(run.name), title: text(run.display_title || run.name), number: Number(run.run_number), attempt: Number(run.run_attempt || 1), status: text(run.status), conclusion: text(run.conclusion), branch: text(run.head_branch), sha: text(run.head_sha), event: text(run.event), actor: text(run.actor?.login), createdAt: text(run.created_at), updatedAt: text(run.updated_at), url: text(run.html_url), workflowId: Number(run.workflow_id) });
const jobView = job => ({ id: id(job.id), name: text(job.name), status: text(job.status), conclusion: text(job.conclusion), startedAt: text(job.started_at), completedAt: text(job.completed_at), steps: (job.steps || []).map(step => ({ number: Number(step.number), name: text(step.name), status: text(step.status), conclusion: text(step.conclusion) })) });

class GitHubActionsService {
  constructor(guard, git, auth) { Object.assign(this, { guard, git, auth }); }
  async repository(root) {
    root = this.guard.assertWorkspace(root);
    const repository = await this.git.githubRepository(root);
    return { repository, base: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions` };
  }
  async list(root, options = {}) {
    const { repository, base } = await this.repository(root);
    const page = Math.min(100, Math.max(1, Number(options.page) || 1));
    const query = new URLSearchParams({ per_page: "30", page: String(page) });
    if (options.branch) query.set("branch", text(options.branch).slice(0, 255));
    if (["queued", "in_progress", "completed", "failure", "success", "cancelled"].includes(options.status)) query.set("status", options.status);
    const endpoint = options.workflowId ? `${base}/workflows/${id(options.workflowId)}/runs` : `${base}/runs`;
    const [runs, workflows] = await Promise.all([
      this.auth.requestJson(`${endpoint}?${query}`, { public: true }),
      this.auth.requestJson(`${base}/workflows?per_page=100`, { public: true }),
    ]);
    return { repository: repository.fullName, page, total: Number(runs.total_count || 0), runs: (runs.workflow_runs || []).map(runView), workflows: (workflows.workflows || []).map(workflow => ({ id: id(workflow.id), name: text(workflow.name), path: text(workflow.path), state: text(workflow.state) })) };
  }
  async details(root, runId) {
    const { base } = await this.repository(root);
    const number = id(runId);
    const [run, jobs] = await Promise.all([
      this.auth.requestJson(`${base}/runs/${number}`, { public: true }),
      this.auth.requestJson(`${base}/runs/${number}/jobs?filter=latest&per_page=100`, { public: true }),
    ]);
    return { run: runView(run), jobs: (jobs.jobs || []).map(jobView), totalJobs: Number(jobs.total_count || 0) };
  }
  async logs(root, runId, jobId) {
    const { base } = await this.repository(root);
    const job = await this.auth.requestJson(`${base}/jobs/${id(jobId)}`, { public: true });
    if (Number(job.run_id) !== id(runId)) throw new Error("Dieser Job gehört nicht zum ausgewählten Workflow-Lauf.");
    const result = await this.auth.requestText(`${base}/jobs/${id(jobId)}/logs`, { public: true });
    return { ...result, text: redactSecrets(result.text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") };
  }
  async rerunFailed(root, runId) {
    if (!this.auth.status().signedIn) throw new Error("Melde dich bei GitHub an, um fehlgeschlagene Jobs neu zu starten.");
    const { base } = await this.repository(root);
    const run = await this.auth.requestJson(`${base}/runs/${id(runId)}`);
    if (run.status !== "completed" || !["failure", "timed_out"].includes(run.conclusion)) throw new Error("Nur abgeschlossene, fehlgeschlagene Workflow-Läufe können hier neu gestartet werden.");
    await this.auth.requestJson(`${base}/runs/${id(runId)}/rerun-failed-jobs`, { method: "POST" });
    return { requested: true, id: id(runId) };
  }
}
module.exports = { GitHubActionsService };
