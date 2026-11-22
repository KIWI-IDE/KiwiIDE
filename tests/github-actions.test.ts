import { describe, expect, it, vi } from "vitest";
const { GitHubActionsService } = require("../electron/services/github-actions-service.cjs");
const { GitHubAuthService } = require("../electron/services/github-auth-service.cjs");
const run = { id: 12, name: 'Build', display_title: 'Check Java', status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'abc123', run_number: 3, run_attempt: 1, workflow_id: 4, html_url: 'https://github.com/org/repo/actions/runs/12' };
function fixture() {
  const auth = { status: () => ({ signedIn: true }), requestJson: vi.fn(async () => ({})), requestText: vi.fn(async () => ({ text: 'log', truncated: false })) };
  const guard = { assertWorkspace: (root: string) => { if (root !== 'root') throw Error('outside workspace'); return root; } };
  const git = { githubRepository: vi.fn(async () => ({ owner: 'org', repo: 'repo', fullName: 'org/repo' })) };
  return { service: new GitHubActionsService(guard, git, auth), auth, git };
}
describe('GitHub Actions', () => {
  it('encodes branch filters, lists real fields and scopes all calls to the project remote', async () => {
    const { service, auth } = fixture();
    auth.requestJson.mockImplementation(async (url: string) => url.includes('/workflows?') ? { workflows: [{ id: 4, name: 'CI' }] } : { total_count: 1, workflow_runs: [run] });
    const result = await service.list('root', { branch: 'feature/a&status=success', workflowId: 4, status: 'failure' });
    expect(result.runs[0]).toMatchObject({ id: 12, title: 'Check Java', branch: 'main', conclusion: 'failure' });
    const url = auth.requestJson.mock.calls[0][0] as string;
    expect(url).toContain('/repos/org/repo/actions/workflows/4/runs?');
    expect(url).toContain('branch=feature%2Fa%26status%3Dsuccess');
    await expect(service.list('other')).rejects.toThrow('outside workspace');
    await expect(service.details('root', '../other')).rejects.toThrow('ID');
  });
  it('verifies job ownership before downloading logs', async () => {
    const { service, auth } = fixture(); auth.requestJson.mockResolvedValue({ run_id: 99 });
    await expect(service.logs('root', 12, 5)).rejects.toThrow('gehört'); expect(auth.requestText).not.toHaveBeenCalled();
    auth.requestJson.mockResolvedValue({ run_id: 12 }); auth.requestText.mockResolvedValue({ text: '\x1b[31merror\x1b[0m', truncated: false });
    expect((await service.logs('root', 12, 5)).text).toBe('error');
  });
  it('requires sign-in and a failed completed run before requesting a re-run', async () => {
    const { service, auth } = fixture();
    auth.status = () => ({ signedIn: false }); await expect(service.rerunFailed('root', 12)).rejects.toThrow('GitHub'); expect(auth.requestJson).not.toHaveBeenCalled();
    auth.status = () => ({ signedIn: true }); auth.requestJson.mockResolvedValue({ ...run, conclusion: 'success' });
    await expect(service.rerunFailed('root', 12)).rejects.toThrow('fehlgeschlagene'); expect(auth.requestJson).toHaveBeenCalledTimes(1);
    auth.requestJson.mockResolvedValue(run); await service.rerunFailed('root', 12);
    expect(auth.requestJson).toHaveBeenLastCalledWith('/repos/org/repo/actions/runs/12/rerun-failed-jobs', { method: 'POST' });
  });
});
describe('GitHub Actions log transport', () => {
  it('allows public reads without exposing a token and never forwards credentials to log storage', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }));
    const auth = new GitHubAuthService('/unused', {}, fetcher);
    await auth.requestJson('/repos/org/repo/actions/runs', { public: true });
    expect((fetcher.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined();
    auth.state.token = 'fixture-token';
    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://productionresults.blob.core.windows.net/logs/output?sig=fixture' } }));
    fetcher.mockResolvedValueOnce(new Response('build output'));
    const result = await auth.requestText('/repos/org/repo/actions/jobs/5/logs');
    expect(result.text).toBe('build output');
    expect((fetcher.mock.calls[1] as any)[1].headers.Authorization).toBe('Bearer fixture-token');
    expect((fetcher.mock.calls[2] as any)[1].headers).toBeUndefined();
    expect((fetcher.mock.calls[2] as any)[1].redirect).toBe('error');
  });
  it('rejects unexpected redirect hosts and caps large log responses', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    const auth = new GitHubAuthService('/unused', {}, fetcher);
    await expect(auth.requestText('/repos/org/repo/actions/jobs/5/logs', { public: true })).rejects.toThrow('Protokolladresse');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(2_100_000)));
    const result = await auth.requestText('/repos/org/repo/actions/jobs/5/logs', { public: true });
    expect(result.truncated).toBe(true); expect(result.text.length).toBe(2_000_000);
  });
});
