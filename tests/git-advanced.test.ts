import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const {
  GitService,
  parseDiff3Merge,
  parseHunkRange,
  resolveMergeChunk,
  validateRebasePlan,
} = require("../electron/services/git-service.cjs");
const {
  GitHubAuthService,
  parseGitHubRepository,
  redactSecrets,
} = require("../electron/services/github-auth-service.cjs");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-git-advanced-"));
afterAll(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

function git(root: string, args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function repository(prefix = "repository-") {
  const root = fs.mkdtempSync(path.join(fixtureRoot, prefix));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "kiwi@example.invalid"]);
  git(root, ["config", "user.name", "Kiwi Test"]);
  const guard = new PathGuard();
  guard.register(root);
  return { root, service: new GitService(guard) };
}

describe("advanced Git data parsing", () => {
  it("extracts editor line ranges from unified diff hunks", () => {
    expect(parseHunkRange("@@ -12,4 +20,7 @@ class Demo {")).toEqual({ oldStart: 12, oldLines: 4, newStart: 20, newLines: 7 });
    expect(parseHunkRange("@@ -1 +2 @@")).toEqual({ oldStart: 1, oldLines: 1, newStart: 2, newLines: 1 });
  });

  it("parses diff3 blocks and supports line-level conflict resolution", () => {
    const chunks = parseDiff3Merge([
      "before\n", "<<<<<<< KIWI_OURS\n", "ours one\n", "ours two\n",
      "||||||| KIWI_BASE\n", "base\n", "=======\n", "theirs\n", ">>>>>>> KIWI_THEIRS\n", "after\n",
    ].join(""));
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toMatchObject({ kind: "conflict", oursLines: ["ours one", "ours two"], baseLines: ["base"], theirsLines: ["theirs"] });
    expect(resolveMergeChunk(chunks[1], {
      choice: "lines",
      lines: [{ source: "ours", index: 1 }, { source: "theirs", index: 0 }],
    })).toBe("ours two\ntheirs\n");
  });

  it("rejects stale, duplicate and structurally invalid rebase plans", () => {
    const commits = [
      { hash: "a".repeat(40), subject: "one" },
      { hash: "b".repeat(40), subject: "two" },
    ];
    expect(() => validateRebasePlan(commits, [
      { hash: commits[0].hash, action: "squash" },
      { hash: commits[1].hash, action: "pick" },
    ])).toThrow(/vorherigen Commit/);
    expect(() => validateRebasePlan(commits, [
      { hash: commits[0].hash, action: "pick" },
      { hash: commits[0].hash, action: "pick" },
    ])).toThrow(/ungültigen oder doppelten/);
  });
});

describe("three-way merge service", () => {
  it("creates a stable model and stages a line-wise resolution", async () => {
    const { root, service } = repository("merge-");
    const file = path.join(root, "Main.java");
    fs.writeFileSync(file, "class Main { int value = 0; }\n");
    git(root, ["add", "Main.java"]);
    git(root, ["commit", "-m", "base"]);
    git(root, ["switch", "-c", "incoming"]);
    fs.writeFileSync(file, "class Main { int incoming = 2; }\n");
    git(root, ["commit", "-am", "incoming"]);
    git(root, ["switch", "main"]);
    fs.writeFileSync(file, "class Main { int local = 1; }\n");
    git(root, ["commit", "-am", "local"]);
    try { git(root, ["merge", "incoming"]); } catch { /* expected conflict */ }

    const model = await service.mergeModel(root, file);
    const conflict = model.chunks.find((chunk: any) => chunk.kind === "conflict");
    expect(conflict).toBeTruthy();
    await service.resolveMerge(root, file, model.snapshot, [{
      id: conflict.id,
      choice: "lines",
      lines: [{ source: "ours", index: 0 }, { source: "theirs", index: 0 }],
    }]);
    const status = await service.status(root);
    expect(status.files.find((entry: any) => entry.path === "Main.java")).toMatchObject({ conflict: false, staged: true });
    expect(fs.readFileSync(file, "utf8")).toContain("local");
    expect(fs.readFileSync(file, "utf8")).toContain("incoming");
  });

  it("does not apply a resolution after the index conflict changed", async () => {
    const { root, service } = repository("merge-stale-");
    const file = path.join(root, "Demo.txt");
    fs.writeFileSync(file, "base\n");
    git(root, ["add", "Demo.txt"]); git(root, ["commit", "-m", "base"]);
    git(root, ["switch", "-c", "right"]); fs.writeFileSync(file, "right\n"); git(root, ["commit", "-am", "right"]);
    git(root, ["switch", "main"]); fs.writeFileSync(file, "left\n"); git(root, ["commit", "-am", "left"]);
    try { git(root, ["merge", "right"]); } catch {}
    const model = await service.mergeModel(root, file);
    fs.writeFileSync(file, "manual edit after opening the merge editor\n");
    await expect(service.resolveMerge(root, file, model.snapshot, [])).rejects.toThrow(/seit dem Öffnen geändert/);
  });
});

describe("visual interactive rebase backend", () => {
  it("loads, reorders and rewrites an interactive plan without an editor prompt", async () => {
    const { root, service } = repository("rebase-");
    fs.writeFileSync(path.join(root, "base.txt"), "base\n"); git(root, ["add", "."]); git(root, ["commit", "-m", "base"]);
    const upstream = git(root, ["rev-parse", "HEAD"]).trim();
    fs.writeFileSync(path.join(root, "one.txt"), "one\n"); git(root, ["add", "."]); git(root, ["commit", "-m", "one"]);
    fs.writeFileSync(path.join(root, "two.txt"), "two\n"); git(root, ["add", "."]); git(root, ["commit", "-m", "two"]);

    const plan = await service.rebasePlan(root, upstream);
    expect(plan.commits.map((entry: any) => entry.subject)).toEqual(["one", "two"]);
    const requested = [
      { ...plan.commits[1], action: "pick" },
      { ...plan.commits[0], action: "reword", message: "one renamed" },
    ];
    const result = await service.startInteractiveRebase(root, upstream, requested);
    expect(result.code).toBe(0);
    expect(result.state.active).toBe(false);
    expect(git(root, ["log", "--format=%s", "-2"]).trim().split(/\r?\n/)).toEqual(["one renamed", "two"]);
  }, 30_000);

  it("does not consume a later reword message while editing a squash message", async () => {
    const { root, service } = repository("rebase-squash-");
    fs.writeFileSync(path.join(root, "base.txt"), "base\n"); git(root, ["add", "."]); git(root, ["commit", "-m", "base"]);
    const upstream = git(root, ["rev-parse", "HEAD"]).trim();
    for (const name of ["one", "two", "three"]) {
      fs.writeFileSync(path.join(root, `${name}.txt`), `${name}\n`); git(root, ["add", "."]); git(root, ["commit", "-m", name]);
    }
    const plan = await service.rebasePlan(root, upstream);
    const requested = [
      { ...plan.commits[0], action: "pick" },
      { ...plan.commits[1], action: "squash" },
      { ...plan.commits[2], action: "reword", message: "three renamed" },
    ];
    const result = await service.startInteractiveRebase(root, upstream, requested);
    expect(result.code).toBe(0);
    expect(git(root, ["log", "--format=%s", "-2"]).trim().split(/\r?\n/)[0]).toBe("three renamed");
  }, 30_000);
});

describe("safe commit checks", () => {
  it("persists only fixed boolean choices in the private git directory", async () => {
    const { root, service } = repository("checks-");
    const settings = await service.updateCommitChecks(root, { build: true, tests: true, format: true, failOnSkipped: false, command: "evil" });
    expect(settings).toEqual({ build: true, tests: true, format: true, failOnSkipped: false });
    expect(fs.existsSync(path.join(root, ".kiwi", "git.json"))).toBe(false);
    const stored = JSON.parse(fs.readFileSync(path.join(root, ".git", "kiwi-commit-checks.json"), "utf8"));
    expect(stored.command).toBeUndefined();
    const result = await service.runCommitChecks(root);
    expect(result.ok).toBe(true);
    expect(result.results.every((entry: any) => entry.status === "skipped")).toBe(true);
  });

  it("blocks unsupported required checks before a commit is created", async () => {
    const { root, service } = repository("checks-block-");
    fs.writeFileSync(path.join(root, "Main.java"), "class Main {}\n");
    git(root, ["add", "Main.java"]);
    await service.updateCommitChecks(root, { build: true, failOnSkipped: true });
    await expect(service.commit(root, "must not exist")).rejects.toThrow(/Commit-Prüfungen/);
    expect(fs.existsSync(path.join(root, ".git", "refs", "heads", "main"))).toBe(false);
  });
});

describe("GitHub account and pull requests", () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`secure:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^secure:/, ""),
  };

  it("supports OAuth device login and never returns or stores a clear token", async () => {
    const token = "gho_0123456789abcdefghijklmnop";
    const responses = [
      { ok: true, status: 200, json: async () => ({ device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }) },
      { ok: true, status: 200, json: async () => ({ access_token: token, token_type: "bearer" }) },
      { ok: true, status: 200, headers: { get: () => "repo" }, json: async () => ({ login: "kiwi", name: "Kiwi User", avatar_url: "https://avatars.example/1" }) },
    ];
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "device-auth-"));
    const auth = new GitHubAuthService(userData, safeStorage, async () => responses.shift(), { clientId: "client-id" });
    const flow = await auth.beginDeviceFlow();
    expect(flow).not.toHaveProperty("deviceCode");
    const result = await auth.pollDeviceFlow();
    expect(result).toMatchObject({ status: "complete", session: { signedIn: true, login: "kiwi" } });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(fs.readFileSync(path.join(userData, "github-auth.json"), "utf8")).not.toContain(token);
  });

  it("restricts authenticated requests to relative GitHub API paths", async () => {
    const token = "github_pat_0123456789abcdefghijklmnopqrstuvwxyz";
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "api-auth-"));
    const auth = new GitHubAuthService(userData, safeStorage, async (url: string) => ({
      ok: true, status: 200, headers: { get: () => "repo" }, json: async () => url.endsWith("/user") ? { login: "kiwi" } : [{ number: 1 }],
    }));
    await auth.signIn(token);
    await expect(auth.requestJson("https://evil.invalid/steal")).rejects.toThrow(/API-Pfad/);
    expect(await auth.requestJson("/user/repos")).toEqual([{ number: 1 }]);
  });

  it("maps common GitHub remotes and scrubs every supported token form", () => {
    expect(parseGitHubRepository("git@github.com:kiwi/ide.git")).toEqual({ owner: "kiwi", repo: "ide", fullName: "kiwi/ide" });
    expect(parseGitHubRepository("https://github.com/kiwi/ide.git")).toEqual({ owner: "kiwi", repo: "ide", fullName: "kiwi/ide" });
    expect(parseGitHubRepository("https://github.com.evil.invalid/kiwi/ide")).toBeNull();
    expect(redactSecrets("token=github_pat_0123456789abcdefghijklmnopqrstuvwxyz")).not.toContain("github_pat_");
  });

  it("loads pull requests through the main-process account without exposing credentials", async () => {
    const { root } = repository("pulls-");
    git(root, ["remote", "add", "origin", "https://github.com/kiwi/ide.git"]);
    const calls: string[] = [];
    const auth = {
      status: () => ({ signedIn: true }),
      requestJson: async (apiPath: string, options?: any) => {
        calls.push(`${options?.method || "GET"} ${apiPath}`);
        if (options?.method === "POST") return { number: 2, title: options.body.title, state: "open", head: { ref: options.body.head }, base: { ref: options.body.base }, user: { login: "kiwi" } };
        return [{ number: 1, title: "Improve IDE", state: "open", html_url: "https://github.com/kiwi/ide/pull/1", head: { ref: "feature" }, base: { ref: "main" }, user: { login: "kiwi" } }];
      },
      authArgs: () => [],
    };
    const guard = new PathGuard(); guard.register(root);
    const service = new GitService(guard, auth);
    const list = await service.pullRequests(root, "open");
    expect(list).toMatchObject({ repository: { fullName: "kiwi/ide" }, pulls: [{ number: 1, title: "Improve IDE" }] });
    const created = await service.createPullRequest(root, { title: "New PR", head: "feature", base: "main", draft: true });
    expect(created).toMatchObject({ number: 2, title: "New PR" });
    expect(calls.join("\n")).toContain("POST /repos/kiwi/ide/pulls");
  });
});

describe("linking a GitHub account", () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`secure:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^secure:/, ""),
  };

  it("picks up a client id entered in the settings without a restart", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "client-id-"));
    let configured = "";
    const auth = new GitHubAuthService(userData, safeStorage, async () => ({ ok: false, status: 500, json: async () => ({}) }), {
      clientId: () => configured,
    });
    // The client id used to be read once at construction, so entering it in the
    // settings left the browser sign-in disabled until the next start.
    expect(auth.status().deviceFlowAvailable).toBe(false);
    await expect(auth.beginDeviceFlow()).rejects.toThrow(/nicht konfiguriert/);

    configured = "Iv1.abcdef";
    expect(auth.status().deviceFlowAvailable).toBe(true);
  });

  it("prefers a client id from the environment over the setting", () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "client-env-"));
    const previous = process.env.KIWI_GITHUB_CLIENT_ID;
    process.env.KIWI_GITHUB_CLIENT_ID = "Iv1.fromEnvironment";
    try {
      const auth = new GitHubAuthService(userData, safeStorage, async () => ({}), { clientId: () => "Iv1.fromSettings" });
      // A deployment that bakes one in must not be overridden by a stale value
      // in someone's settings file.
      expect(auth.clientId).toBe("Iv1.fromEnvironment");
    } finally {
      if (previous === undefined) delete process.env.KIWI_GITHUB_CLIENT_ID;
      else process.env.KIWI_GITHUB_CLIENT_ID = previous;
    }
  });

  it("still accepts a plain string client id", () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "client-string-"));
    const auth = new GitHubAuthService(userData, safeStorage, async () => ({}), { clientId: "Iv1.plain" });
    expect(auth.clientId).toBe("Iv1.plain");
    expect(auth.status().deviceFlowAvailable).toBe(true);
  });
});
