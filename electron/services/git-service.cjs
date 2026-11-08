const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnCapture } = require("./process-utils.cjs");
const { parseGitHubRepository, redactSecrets } = require("./github-auth-service.cjs");

/** Git subcommands that talk to a remote and therefore need credentials. */
const networkCommands = new Set(["push", "pull", "fetch", "clone", "ls-remote"]);

/**
 * Subcommands that take the index lock to do their work.
 *
 * Two of these running at once make the second fail with "Unable to create
 * .git/index.lock", which reaches the user as a failed stage or unstage even
 * though nothing was wrong with what they asked for. Kiwi refreshes the Git
 * view from a file watcher, so the overlap needs no unusual clicking.
 */
const indexWriters = new Set([
  "add", "rm", "mv", "reset", "restore", "checkout", "switch", "apply", "stash",
  "commit", "merge", "rebase", "cherry-pick", "revert", "pull", "clean", "update-index",
]);

/**
 * The addresses a clone may be given.
 *
 * git understands transports that run a command instead of fetching:
 * "ext::sh -c …" is a documented one, and it executes on the machine doing the
 * clone. An address arrives here from a text field, so the transports are
 * named rather than filtered — anything not listed is refused.
 *
 * A leading dash is refused separately: git would read it as an option rather
 * than an address, whatever follows it.
 */
function assertCloneUrl(url) {
  const text = String(url || "").trim();
  if (!text) throw new Error("Bitte gib eine Repository-Adresse an.");
  if (text.startsWith("-")) throw new Error("Ungültige Repository-Adresse.");
  // file:// fetches a repository the same way the others do. The transports
  // that are refused are the ones that run a command — ext:: and the transport
  // helpers — not the ones that differ only in where they read from.
  const allowed = /^(?:https?:\/\/[^\s]+|ssh:\/\/[^\s]+|git:\/\/[^\s]+|file:\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+)$/;
  if (!allowed.test(text)) {
    throw new Error("Nur https-, ssh- oder git-Adressen können geklont werden.");
  }
  return text;
}

/** The folder a clone creates, checked the way any new folder in Kiwi is. */
function assertCloneFolderName(name) {
  const text = String(name || "").trim();
  if (!text || text === "." || text === "..") throw new Error("Ungültiger Ordnername.");
  if (/[\\\/:*?"<>|]/.test(text)) throw new Error("Der Ordnername enthält unerlaubte Zeichen.");
  return text;
}

/** What GitHub would call the folder: the last segment, without ".git". */
function repositoryFolderName(url) {
  const withoutQuery = String(url).split(/[?#]/)[0].replace(/\/+$/, "");
  const last = withoutQuery.split(/[\\\/:]/).pop() || "";
  const name = last.replace(/\.git$/i, "");
  if (!name) throw new Error("Aus dieser Adresse lässt sich kein Ordnername ableiten.");
  return name;
}

class GitService {
  constructor(pathGuard, auth = null, options = {}) {
    this.pathGuard = pathGuard;
    this.auth = auth;
    this.resolveBuildTool = options.resolveBuildTool || null;
    /** Tail of the pending index writes, one chain per repository. */
    this.indexQueue = new Map();
  }

  async remoteUrl(root) {
    const result = await spawnCapture("git", ["remote", "get-url", "origin"], {
      cwd: this.pathGuard.assertWorkspace(root),
      rejectOnError: false,
      env: gitEnvironment(),
    });
    return result.code === 0 ? result.stdout.trim() : "";
  }

  /**
   * Clones a repository into a folder that is not a workspace yet.
   *
   * Every other command here runs inside a registered workspace; a clone is
   * the one that creates one, so it takes the parent directory and the name to
   * make, and neither goes near `assertWorkspace`. The directory it creates is
   * handed back so the caller can open it.
   */
  async clone(url, parentDirectory, folderName = "") {
    const address = assertCloneUrl(url);
    const parent = path.resolve(String(parentDirectory || ""));
    const parentStat = await fs.stat(parent).catch(() => null);
    if (!parentStat?.isDirectory()) throw new Error("Der Zielordner wurde nicht gefunden.");
    const name = assertCloneFolderName(folderName || repositoryFolderName(address));
    const target = path.join(parent, name);
    if (await fs.stat(target).then(() => true).catch(() => false)) {
      throw new Error(`„${name}“ gibt es in diesem Ordner schon.`);
    }
    const credentials = this.auth ? this.auth.authArgs(address) : [];
    const result = await spawnCapture(
      "git",
      [...credentials, "clone", "--progress", "--", address, target],
      { cwd: parent, rejectOnError: false, env: gitEnvironment(), timeoutMs: 10 * 60_000 },
    ).catch((error) => { throw new Error(redactSecrets(error.message)); });
    if (result.code !== 0) {
      // A half-written directory is worse than none: it looks like a project
      // and is not one.
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(explainGitFailure(
        { ...result, stderr: redactSecrets(result.stderr), output: redactSecrets(result.output) },
        Boolean(this.auth?.status().signedIn),
      ));
    }
    return { path: target, name, output: redactSecrets(result.output) };
  }

  /**
   * Runs one git command, serialized against other index writers on this repo.
   *
   * Reads are deliberately not queued: they carry --no-optional-locks and so
   * never contend, and putting a status refresh behind a running fetch would
   * freeze the Git view for as long as the network takes.
   */
  async run(root, args, rejectOnError = true, options = {}) {
    const cwd = this.pathGuard.assertWorkspace(root);
    if (!indexWriters.has(args[0])) return this.execute(root, cwd, args, rejectOnError, options);

    const pending = (this.indexQueue.get(cwd) || Promise.resolve())
      .then(() => this.execute(root, cwd, args, rejectOnError, options));
    // The queue must survive a failed command, so the tail swallows the error;
    // the caller still gets the rejection from `pending` itself.
    this.indexQueue.set(cwd, pending.catch(() => undefined));
    return pending;
  }

  async execute(root, cwd, args, rejectOnError, options) {
    let fullArgs = args;
    if (this.auth && networkCommands.has(args[0])) {
      fullArgs = [...this.auth.authArgs(await this.remoteUrl(root)), ...args];
    }
    // Keeps a read such as status or diff from grabbing index.lock only to
    // refresh its stat cache, which is what collided with real writes.
    fullArgs = ["--no-optional-locks", ...fullArgs];
    const result = await spawnCapture("git", fullArgs, {
      cwd,
      rejectOnError: false,
      env: { ...gitEnvironment(), ...(options.env || {}) },
      input: options.input,
      timeoutMs: options.timeoutMs,
    }).catch((error) => { throw new Error(redactSecrets(error.message)); });
    const redacted = {
      ...result,
      stdout: redactSecrets(result.stdout),
      stderr: redactSecrets(result.stderr),
      output: redactSecrets(result.output),
    };
    if (rejectOnError && redacted.code !== 0) {
      throw new Error(explainGitFailure(redacted, Boolean(this.auth?.status().signedIn)));
    }
    return redacted;
  }

  safePaths(root, paths) {
    return (paths || []).map((candidate) => {
      const absolute = path.isAbsolute(candidate) ? candidate : path.join(root, candidate);
      this.pathGuard.assertAllowed(absolute, root);
      return path.relative(root, absolute);
    });
  }

  async status(root) {
    try {
      const result = await this.run(root, ["status", "--porcelain=v1", "--branch"], false);
      if (result.code !== 0) return { available: false, output: result.output, branch: "", files: [] };
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const branchLine = lines.find((line) => line.startsWith("##")) || "";
      const branchText = branchLine.replace(/^##\s*/, "");
      const branch = branchText.match(/^(?:No commits yet on|Initial commit on)\s+(.+)$/)?.[1]
        || branchText.split("...")[0].split(/\s/)[0]
        || "main";
      const files = lines.filter((line) => !line.startsWith("##")).map((line) => {
        const index = line[0];
        const workingTree = line[1];
        const filePath = line.slice(3).split(" -> ").at(-1);
        const conflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${index}${workingTree}`);
        return {
          path: filePath,
          absolutePath: path.join(root, filePath),
          index,
          workingTree,
          staged: index !== " " && index !== "?",
          conflict,
        };
      });
      return { available: true, output: result.stdout, branch, branchLine, files };
    } catch {
      return { available: false, output: "", branch: "", files: [] };
    }
  }

  async init(root) {
    await this.run(root, ["init"]);
    return this.status(root);
  }

  async diff(root, file, staged = false) {
    const args = ["diff"];
    if (staged) args.push("--cached");
    if (file) args.push("--", ...this.safePaths(root, [file]));
    return (await this.run(root, args)).stdout;
  }

  async hunks(root, file, staged = false) {
    this.pathGuard.assertWorkspace(root);
    if (file) this.safePaths(root, [file]);
    try {
      const patch = await this.diff(root, file, staged);
      return splitPatchHunks(patch).map((item, index) => ({
        index,
        header: item.hunk.split(/\r?\n/)[0] || `Änderung ${index + 1}`,
        preview: item.hunk.split(/\r?\n/).slice(1, 5).join("\n"),
        ...parseHunkRange(item.hunk),
        staged: Boolean(staged),
        changes: selectableChanges(item.hunk),
      }));
    } catch {
      return [];
    }
  }

  async applyHunk(root, file, index, reverse = false) {
    const patch = await this.diff(root, file, reverse);
    const selected = splitPatchHunks(patch)[Number(index)];
    if (!selected) throw new Error("Der ausgewählte Diff-Abschnitt ist nicht mehr aktuell.");
    const args = ["apply", "--cached"];
    if (reverse) args.push("--reverse");
    args.push("--unidiff-zero", "-");
    // Through run() rather than a direct spawn: this writes the index and has
    // to queue behind any other write, exactly like stage and unstage do.
    const result = await this.run(root, args, true, { input: `${selected.fileHeader}${selected.hunk}` });
    return { output: result.output, status: await this.status(root) };
  }

  async applyLines(root, file, index, changeIds) {
    const patch = await this.diff(root, file, false);
    const selected = splitPatchHunks(patch)[Number(index)];
    if (!selected) throw new Error("Der ausgewählte Diff-Abschnitt ist nicht mehr aktuell.");
    const groups = selectableChanges(selected.hunk);
    const allowed = new Set((changeIds || []).map(String));
    const selectedIndexes = new Set(groups.filter((group) => allowed.has(group.id)).flatMap((group) => group.indexes));
    if (!selectedIndexes.size) throw new Error("Wähle mindestens eine geänderte Zeile aus.");
    const partialHunk = partialPatchHunk(selected.hunk, selectedIndexes);
    const result = await this.run(root, ["apply", "--cached", "--recount", "-"], true, {
      input: `${selected.fileHeader}${partialHunk}`,
    });
    return { output: result.output, status: await this.status(root) };
  }

  async stage(root, paths) {
    const safe = this.safePaths(root, paths);
    await this.run(root, ["add", "--", ...(safe.length ? safe : ["."])]);
    return this.status(root);
  }

  async unstage(root, paths) {
    const safe = this.safePaths(root, paths);
    await this.run(root, ["restore", "--staged", "--", ...(safe.length ? safe : ["."])]);
    return this.status(root);
  }

  /**
   * Commits, optionally staging everything and amending first.
   *
   * Staging, writing the message, committing and pushing used to be four
   * separate actions for what is one thought; the options let the caller
   * collapse the ones it does not need to keep apart.
   */
  async commit(root, message, options = {}) {
    const { stageAll = false, amend = false } = options;
    const text = String(message || "").trim();
    // Amending without a new message keeps the one that is already there.
    if (!text && !amend) throw new Error("Bitte gib eine Commit-Nachricht ein.");
    let status = await this.status(root);
    if (status.files.some((file) => file.conflict)) {
      throw new Error("Vor dem Commit müssen alle Merge-Konflikte gelöst werden.");
    }
    if (stageAll) {
      const unstaged = status.files.filter((file) => !file.staged).map((file) => file.absolutePath);
      if (unstaged.length) {
        await this.stage(root, unstaged);
        status = await this.status(root);
      }
    }
    if (!amend && !status.files.some((file) => file.staged)) {
      throw new Error("Für den Commit sind keine Änderungen gestagt.");
    }
    const checks = await this.runCommitChecks(root);
    if (!checks.ok) {
      const failed = checks.results.filter((check) => check.status === "failed");
      const details = failed.map((check) => `${check.label}: ${check.output || "fehlgeschlagen"}`).join("\n\n");
      throw new Error(`Commit-Prüfungen fehlgeschlagen.\n\n${details}`);
    }
    const args = ["commit"];
    if (amend) args.push("--amend");
    if (text) args.push("-m", text);
    else args.push("--no-edit");
    const result = await this.run(root, args);
    return { output: result.output, status: await this.status(root), checks };
  }

  /**
   * Local branches, plus remote ones that have no local counterpart yet.
   *
   * Only local branches were listed before, and checkout refuses anything not
   * in this list — so right after a clone none of the existing branches could
   * be switched to at all. A remote entry is reported under the name it will
   * have locally, which is the name `git switch` creates it under.
   */
  async branches(root) {
    const [local, remote] = await Promise.all([
      this.run(root, ["branch", "--format=%(HEAD)%09%(refname:short)%09%(upstream:short)"], false),
      this.run(root, ["branch", "--remotes", "--format=%(refname:short)"], false),
    ]);
    if (local.code !== 0) return [];
    const branches = local.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [head, name, upstream] = line.split("\t");
      return { current: head === "*", name, upstream: upstream || "", remote: "" };
    });
    if (remote.code !== 0) return branches;

    const known = new Set(branches.map((branch) => branch.name));
    for (const reference of remote.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      // "origin/HEAD -> origin/main" is a symbolic ref, not a branch.
      if (reference.includes("->")) continue;
      const slash = reference.indexOf("/");
      if (slash < 0) continue;
      const name = reference.slice(slash + 1);
      if (!name || known.has(name)) continue;
      known.add(name);
      branches.push({ current: false, name, upstream: reference, remote: reference });
    }
    return branches;
  }

  async createBranch(root, name, checkout = true) {
    const branch = String(name || "").trim();
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
      throw new Error("Ungültiger Branch-Name.");
    }
    await this.run(root, checkout ? ["switch", "-c", branch] : ["branch", branch]);
    return this.branches(root);
  }

  async checkout(root, name) {
    const branches = await this.branches(root);
    if (!branches.some((branch) => branch.name === name)) throw new Error("Unbekannter Branch.");
    await this.run(root, ["switch", name]);
    return this.status(root);
  }

  async log(root, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const format = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%P%x1f%D%x1e";
    const result = await this.run(root, ["log", `-${safeLimit}`, `--pretty=format:${format}`], false);
    if (result.code !== 0) return [];
    return result.stdout.split("\x1e").filter(Boolean).map((entry) => {
      const [hash, shortHash, author, date, subject, parents, refs] = entry.trim().split("\x1f");
      return {
        hash,
        shortHash,
        author,
        date,
        subject,
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        refs: refs ? refs.split(", ").map((r) => r.trim()).filter(Boolean) : [],
      };
    });
  }

  async pull(root) {
    const result = await this.run(root, ["pull", "--no-rebase"]);
    return { output: result.output, status: await this.status(root) };
  }

  async push(root, setUpstream = false) {
    const status = await this.status(root);
    const args = ["push"];
    if (setUpstream && status.branch) args.push("-u", "origin", status.branch);
    const result = await this.run(root, args);
    return { output: result.output, status: await this.status(root) };
  }

  /** Refreshes the remote refs so branch lists and counts are current. */
  async fetch(root, prune = true) {
    const args = ["fetch", "--all", "--tags"];
    if (prune) args.push("--prune");
    const result = await this.run(root, args);
    return { output: result.output, status: await this.status(root) };
  }

  /** Merges a branch into the current one. */
  async merge(root, name, options = {}) {
    const reference = safeGitRef(name);
    const args = ["merge"];
    if (options.noFastForward) args.push("--no-ff");
    if (options.squash) args.push("--squash");
    args.push(reference);
    const result = await this.run(root, args, false);
    const status = await this.status(root);
    // A conflict is a state to work in, not a failure to report and undo: the
    // merge editor exists for exactly this. Anything else is a real error.
    const conflicted = status.files.some((file) => file.conflict);
    if (result.code !== 0 && !conflicted) throw new Error(result.output || "Der Merge ist fehlgeschlagen.");
    return { output: result.output, status, conflicted };
  }

  /** Abandons a merge that is in progress and restores the previous state. */
  async mergeAbort(root) {
    const result = await this.run(root, ["merge", "--abort"]);
    return { output: result.output, status: await this.status(root) };
  }

  /**
   * Throws away the working-tree changes of the given files.
   *
   * Unversioned files are deleted rather than restored — there is no earlier
   * content to go back to — so both are handled explicitly and never with a
   * blanket `git clean`, which would also remove files nobody asked about.
   */
  async discard(root, paths) {
    const relative = this.safePaths(this.pathGuard.assertWorkspace(root), paths);
    if (!relative.length) throw new Error("Es wurde keine Datei ausgewählt.");
    const status = await this.status(root);
    // status reports an unversioned file as "??", not with a flag.
    const untracked = new Set(status.files.filter((file) => file.index === "?").map((file) => file.path));
    const tracked = relative.filter((file) => !untracked.has(file));
    const removals = relative.filter((file) => untracked.has(file));
    if (tracked.length) await this.run(root, ["restore", "--staged", "--worktree", "--", ...tracked]);
    for (const file of removals) {
      await fs.rm(path.join(this.pathGuard.assertWorkspace(root), file), { force: true, recursive: true });
    }
    return { discarded: tracked.length, removed: removals.length, status: await this.status(root) };
  }

  async deleteBranch(root, name, force = false) {
    const reference = safeGitRef(name);
    const status = await this.status(root);
    if (status.branch === reference) throw new Error("Der aktuelle Branch kann nicht gelöscht werden.");
    // -d refuses to drop unmerged work; -D is only used when asked for it.
    const result = await this.run(root, ["branch", force ? "-D" : "-d", reference]);
    return { output: result.output, branches: await this.branches(root) };
  }

  async renameBranch(root, name, nextName) {
    const from = safeGitRef(name);
    const to = safeGitRef(nextName);
    const result = await this.run(root, ["branch", "-m", from, to]);
    return { output: result.output, branches: await this.branches(root), status: await this.status(root) };
  }

  /** Creates a commit that undoes another one, keeping the history intact. */
  async revertCommit(root, hash) {
    const reference = safeGitRef(hash);
    const result = await this.run(root, ["revert", "--no-edit", reference], false);
    const status = await this.status(root);
    const conflicted = status.files.some((file) => file.conflict);
    if (result.code !== 0 && !conflicted) throw new Error(result.output || "Der Revert ist fehlgeschlagen.");
    return { output: result.output, status, conflicted };
  }

  async cherryPick(root, hash) {
    const reference = safeGitRef(hash);
    const result = await this.run(root, ["cherry-pick", reference], false);
    const status = await this.status(root);
    const conflicted = status.files.some((file) => file.conflict);
    if (result.code !== 0 && !conflicted) throw new Error(result.output || "Cherry-Pick ist fehlgeschlagen.");
    return { output: result.output, status, conflicted };
  }

  /**
   * Moves the current branch to another commit.
   *
   * "hard" discards the working tree, so it is spelled out rather than being
   * the default, and the caller has to ask for it by name.
   */
  async resetTo(root, hash, mode = "mixed") {
    const reference = safeGitRef(hash);
    if (!["soft", "mixed", "hard"].includes(mode)) throw new Error("Unbekannter Reset-Modus.");
    const result = await this.run(root, ["reset", `--${mode}`, reference]);
    return { output: result.output, status: await this.status(root) };
  }

  async tags(root) {
    const result = await this.run(root, ["tag", "--list", "--sort=-creatordate", "--format=%(refname:short)%09%(objectname:short)%09%(contents:subject)"], false);
    if (result.code !== 0) return [];
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, hash, subject] = line.split("\t");
      return { name, hash: hash || "", subject: subject || "" };
    });
  }

  async createTag(root, name, options = {}) {
    const reference = safeGitRef(name);
    const args = ["tag"];
    if (options.message) args.push("-a", reference, "-m", String(options.message));
    else args.push(reference);
    if (options.commit) args.push(safeGitRef(options.commit));
    const result = await this.run(root, args);
    return { output: result.output, tags: await this.tags(root) };
  }

  async deleteTag(root, name) {
    const result = await this.run(root, ["tag", "-d", safeGitRef(name)]);
    return { output: result.output, tags: await this.tags(root) };
  }

  async compare(root, base, head = "HEAD") {
    const safeBase = safeGitRef(base);
    const safeHead = safeGitRef(head);
    const [counts, commits, stat, patch] = await Promise.all([
      this.run(root, ["rev-list", "--left-right", "--count", `${safeBase}...${safeHead}`], false),
      this.run(root, ["log", "--oneline", "--decorate", `${safeBase}..${safeHead}`], false),
      this.run(root, ["diff", "--stat", safeBase, safeHead], false),
      this.run(root, ["diff", "--no-ext-diff", "--unified=3", safeBase, safeHead], false),
    ]);
    if (counts.code !== 0) throw new Error(counts.output || "Branches konnten nicht verglichen werden.");
    const [leftOnly, rightOnly] = counts.stdout.trim().split(/\s+/).map(Number);
    return {
      base: safeBase,
      head: safeHead,
      leftOnly: leftOnly || 0,
      rightOnly: rightOnly || 0,
      commits: commits.stdout.split(/\r?\n/).filter(Boolean),
      stat: stat.stdout,
      patch: patch.stdout,
    };
  }

  async previewPull(root) {
    const upstreamResult = await this.run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], false);
    if (upstreamResult.code !== 0 || !upstreamResult.stdout.trim()) {
      throw new Error("Für den aktuellen Branch ist kein Upstream konfiguriert.");
    }
    const upstream = upstreamResult.stdout.trim();
    const comparison = await this.compare(root, "HEAD", upstream);
    return {
      ...comparison,
      upstream,
      outgoing: comparison.leftOnly,
      incoming: comparison.rightOnly,
      note: "Vergleich mit dem zuletzt lokal abgerufenen Stand. Vor Pull bei Bedarf Fetch ausführen.",
    };
  }

  async githubRepository(root) {
    const remote = await this.remoteUrl(root);
    const repository = parseGitHubRepository(remote);
    if (!repository) throw new Error("Die origin-Remote verweist nicht auf ein GitHub-Repository.");
    return { ...repository, remote };
  }

  async pullRequests(root, state = "open") {
    if (!this.auth?.status().signedIn) throw new Error("Melde dich zuerst bei GitHub an.");
    const repository = await this.githubRepository(root);
    const filter = ["open", "closed", "all"].includes(state) ? state : "open";
    const pulls = await this.auth.requestJson(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls?state=${filter}&per_page=100&sort=updated&direction=desc`,
    );
    return { repository, state: filter, pulls: (pulls || []).map(mapPullRequest) };
  }

  async pullRequest(root, number) {
    if (!this.auth?.status().signedIn) throw new Error("Melde dich zuerst bei GitHub an.");
    const repository = await this.githubRepository(root);
    const pullNumber = positiveInteger(number, "Pull-Request-Nummer");
    const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls/${pullNumber}`;
    const [pull, files, reviews] = await Promise.all([
      this.auth.requestJson(prefix),
      this.auth.requestJson(`${prefix}/files?per_page=100`),
      this.auth.requestJson(`${prefix}/reviews?per_page=100`),
    ]);
    return {
      repository,
      pull: mapPullRequest(pull),
      body: String(pull?.body || ""),
      mergeable: pull?.mergeable ?? null,
      mergeableState: String(pull?.mergeable_state || "unknown"),
      files: (files || []).map((file) => ({
        filename: String(file.filename || ""),
        status: String(file.status || "modified"),
        additions: Number(file.additions || 0),
        deletions: Number(file.deletions || 0),
        changes: Number(file.changes || 0),
        patch: String(file.patch || ""),
      })),
      reviews: (reviews || []).map((review) => ({
        id: Number(review.id || 0),
        state: String(review.state || ""),
        body: String(review.body || ""),
        submittedAt: String(review.submitted_at || ""),
        author: String(review.user?.login || ""),
      })),
    };
  }

  async createPullRequest(root, input) {
    if (!this.auth?.status().signedIn) throw new Error("Melde dich zuerst bei GitHub an.");
    const repository = await this.githubRepository(root);
    const title = String(input?.title || "").trim();
    if (!title || title.length > 256) throw new Error("Gib einen gültigen Pull-Request-Titel ein.");
    const status = await this.status(root);
    const head = safeGitRef(input?.head || status.branch || "HEAD");
    const base = safeGitRef(input?.base || "main");
    const pull = await this.auth.requestJson(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls`,
      {
        method: "POST",
        body: {
          title,
          head,
          base,
          body: String(input?.body || "").slice(0, 65_536),
          draft: Boolean(input?.draft),
        },
      },
    );
    return mapPullRequest(pull);
  }

  async stashes(root) {
    const format = "%gd%x1f%h%x1f%aI%x1f%s%x1e";
    const result = await this.run(root, ["stash", "list", `--format=${format}`], false);
    if (result.code !== 0) return [];
    return result.stdout.split("\x1e").filter(Boolean).map((entry) => {
      const [ref, hash, date, message] = entry.trim().split("\x1f");
      return { ref, hash, date, message };
    });
  }

  async stashSave(root, message = "", includeUntracked = true) {
    const args = ["stash", "push"];
    if (includeUntracked) args.push("--include-untracked");
    if (String(message || "").trim()) args.push("-m", String(message).trim());
    const result = await this.run(root, args);
    return { output: result.output, stashes: await this.stashes(root), status: await this.status(root) };
  }

  async stashApply(root, ref = "stash@{0}", pop = false) {
    if (!/^stash@\{\d+\}$/.test(String(ref))) throw new Error("Ungültige Stash-Referenz.");
    const result = await this.run(root, ["stash", pop ? "pop" : "apply", ref]);
    return { output: result.output, stashes: await this.stashes(root), status: await this.status(root) };
  }

  async stashDrop(root, ref) {
    if (!/^stash@\{\d+\}$/.test(String(ref))) throw new Error("Ungültige Stash-Referenz.");
    const result = await this.run(root, ["stash", "drop", ref]);
    return { output: result.output, stashes: await this.stashes(root), status: await this.status(root) };
  }

  async fileHistory(root, file, limit = 100) {
    const [safeFile] = this.safePaths(root, [file]);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const format = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";
    const result = await this.run(root, ["log", "--follow", `-${safeLimit}`, `--pretty=format:${format}`, "--", safeFile], false);
    if (result.code !== 0) return [];
    return result.stdout.split("\x1e").filter(Boolean).map((entry) => {
      const [hash, shortHash, author, date, subject] = entry.trim().split("\x1f");
      return { hash, shortHash, author, date, subject };
    });
  }

  async blame(root, file) {
    const [safeFile] = this.safePaths(root, [file]);
    const result = await this.run(root, ["blame", "--line-porcelain", "--", safeFile], false);
    if (result.code !== 0) return [];
    const lines = [];
    let current = null;
    for (const line of result.stdout.split(/\r?\n/)) {
      const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/);
      if (header) {
        current = { hash: header[1], line: Number(header[2]), author: "", date: "", text: "" };
        continue;
      }
      if (!current) continue;
      if (line.startsWith("author ")) current.author = line.slice(7);
      if (line.startsWith("author-time ")) current.date = new Date(Number(line.slice(12)) * 1000).toISOString();
      if (line.startsWith("\t")) {
        current.text = line.slice(1);
        lines.push(current);
        current = null;
      }
    }
    return lines;
  }

  /** Commit checks are stored inside .git and can therefore never execute
   * commands supplied by a cloned repository. Only Kiwi's fixed build-tool
   * invocations are selectable. */
  async commitChecks(root) {
    const defaults = { build: false, tests: false, format: false, failOnSkipped: true };
    const file = await this.gitPrivatePath(root, "kiwi-commit-checks.json");
    try {
      return normalizeCommitChecks({ ...defaults, ...JSON.parse(await fs.readFile(file, "utf8")) });
    } catch {
      return defaults;
    }
  }

  async updateCommitChecks(root, patch) {
    const current = await this.commitChecks(root);
    const next = normalizeCommitChecks({ ...current, ...(patch || {}) });
    const file = await this.gitPrivatePath(root, "kiwi-commit-checks.json");
    await writeJsonAtomic(file, next);
    return next;
  }

  async commitCheckPlan(root) {
    const cwd = this.pathGuard.assertWorkspace(root);
    const settings = await this.commitChecks(root);
    const pom = path.join(cwd, "pom.xml");
    const gradle = (await firstExisting([
      path.join(cwd, "build.gradle.kts"),
      path.join(cwd, "build.gradle"),
      path.join(cwd, "settings.gradle.kts"),
      path.join(cwd, "settings.gradle"),
    ]));
    let kind = "plain";
    let source = "";
    if (await exists(pom)) {
      kind = "maven";
      source = await fs.readFile(pom, "utf8").catch(() => "");
    } else if (gradle) {
      kind = "gradle";
      source = await fs.readFile(gradle, "utf8").catch(() => "");
    }
    const tool = kind === "maven"
      ? await this.buildTool(cwd, "Maven")
      : kind === "gradle" ? await this.buildTool(cwd, "Gradle") : "";
    const checks = [];
    if (settings.build) {
      checks.push(kind === "maven"
        ? checkPlan("build", "Build", tool, ["--batch-mode", "--no-transfer-progress", "-DskipTests", "compile"])
        : kind === "gradle"
          ? checkPlan("build", "Build", tool, ["classes", "--console=plain", "--no-daemon"])
          : skippedPlan("build", "Build", "Plain-Java-Projekte benötigen eine Run-Konfiguration für den Commit-Build."));
    }
    if (settings.tests) {
      checks.push(kind === "maven"
        ? checkPlan("tests", "Tests", tool, ["--batch-mode", "--no-transfer-progress", "test"])
        : kind === "gradle"
          ? checkPlan("tests", "Tests", tool, ["test", "--console=plain", "--no-daemon"])
          : skippedPlan("tests", "Tests", "Für dieses Plain-Java-Projekt ist kein Test-Runner konfiguriert."));
    }
    if (settings.format) {
      const formatter = formatCheck(kind, source, tool);
      checks.push(formatter || skippedPlan("format", "Formatierung", "Kein unterstütztes Formatierungs-Plugin gefunden (Spotless, fmt oder Checkstyle)."));
    }
    return { settings, kind, checks };
  }

  async runCommitChecks(root) {
    const plan = await this.commitCheckPlan(root);
    const results = [];
    for (const check of plan.checks) {
      const startedAt = Date.now();
      if (!check.command) {
        results.push({ ...check, status: plan.settings.failOnSkipped ? "failed" : "skipped", durationMs: 0, output: check.reason || "Übersprungen" });
        continue;
      }
      const result = await spawnCapture(check.command, check.args, {
        cwd: this.pathGuard.assertWorkspace(root),
        env: gitEnvironment(),
        rejectOnError: false,
        timeoutMs: 10 * 60 * 1000,
      }).catch((error) => ({ code: 1, stdout: "", stderr: error.message, output: error.message }));
      results.push({
        ...check,
        status: result.code === 0 ? "passed" : "failed",
        durationMs: Date.now() - startedAt,
        output: redactSecrets(result.output).slice(-20_000),
      });
    }
    return { ok: results.every((check) => check.status !== "failed"), results };
  }

  async buildTool(root, type) {
    if (this.resolveBuildTool) return this.resolveBuildTool(root, type);
    const wrapper = path.join(root, type === "Maven"
      ? process.platform === "win32" ? "mvnw.cmd" : "mvnw"
      : process.platform === "win32" ? "gradlew.bat" : "gradlew");
    if (await exists(wrapper)) return wrapper;
    return type === "Maven"
      ? process.platform === "win32" ? "mvn.cmd" : "mvn"
      : process.platform === "win32" ? "gradle.bat" : "gradle";
  }

  async gitPrivatePath(root, name) {
    const result = await this.run(root, ["rev-parse", "--absolute-git-dir"], false);
    if (result.code !== 0) throw new Error("Dieses Projekt ist kein Git-Repository.");
    const gitDirectory = path.resolve(result.stdout.trim());
    this.pathGuard.assertAllowed(gitDirectory, root);
    return path.join(gitDirectory, name);
  }

  async conflict(root, file) {
    const [safeFile] = this.safePaths(root, [file]);
    const readStage = async (stage) => {
      const result = await this.run(root, ["show", `:${stage}:${safeFile.replace(/\\/g, "/")}`], false);
      return result.code === 0 ? result.stdout : "";
    };
    const [base, ours, theirs] = await Promise.all([readStage(1), readStage(2), readStage(3)]);
    if (!ours && !theirs) throw new Error("Für diese Datei liegt kein Drei-Wege-Konflikt vor.");
    const absolutePath = path.join(root, safeFile);
    const working = await fs.readFile(absolutePath, "utf8").catch(() => "");
    return { path: absolutePath, base, ours, theirs, working };
  }

  async mergeModel(root, file) {
    const conflict = await this.conflict(root, file);
    const snapshot = conflictSnapshot(conflict);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-merge-"));
    try {
      const oursFile = path.join(temporary, "ours");
      const baseFile = path.join(temporary, "base");
      const theirsFile = path.join(temporary, "theirs");
      await Promise.all([
        fs.writeFile(oursFile, conflict.ours, "utf8"),
        fs.writeFile(baseFile, conflict.base, "utf8"),
        fs.writeFile(theirsFile, conflict.theirs, "utf8"),
      ]);
      const merged = await spawnCapture("git", [
        "merge-file", "--stdout", "--diff3",
        "-L", "KIWI_OURS", "-L", "KIWI_BASE", "-L", "KIWI_THEIRS",
        oursFile, baseFile, theirsFile,
      ], { rejectOnError: false });
      return { path: conflict.path, snapshot, chunks: parseDiff3Merge(merged.stdout) };
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  async resolveMerge(root, file, snapshot, resolutions) {
    const model = await this.mergeModel(root, file);
    if (model.snapshot !== snapshot) throw new Error("Der Merge-Konflikt hat sich seit dem Öffnen geändert. Lade ihn neu.");
    const byId = new Map((resolutions || []).map((resolution) => [String(resolution.id), resolution]));
    const output = [];
    for (const chunk of model.chunks) {
      if (chunk.kind !== "conflict") {
        output.push(chunk.content);
        continue;
      }
      const resolution = byId.get(chunk.id);
      if (!resolution) throw new Error(`Für Konflikt ${chunk.id} fehlt eine Auflösung.`);
      output.push(resolveMergeChunk(chunk, resolution));
    }
    return this.resolveConflict(root, file, output.join(""));
  }

  async resolveConflict(root, file, content) {
    const absolute = path.isAbsolute(file) ? file : path.join(root, file);
    this.pathGuard.assertAllowed(absolute, root);
    await fs.writeFile(absolute, String(content), "utf8");
    await this.stage(root, [absolute]);
    return this.status(root);
  }

  async rebasePlan(root, upstream) {
    const base = safeGitRef(upstream);
    const format = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";
    const result = await this.run(root, ["log", "--reverse", "--topo-order", `--format=${format}`, `${base}..HEAD`], false);
    if (result.code !== 0) throw new Error(result.output || "Der Rebase-Plan konnte nicht geladen werden.");
    const commits = result.stdout.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [hash, shortHash, author, date, subject] = entry.split("\x1f");
      return { action: "pick", hash, shortHash, author, date, subject, message: subject };
    });
    const head = (await this.run(root, ["rev-parse", "HEAD"])).stdout.trim();
    return { upstream: base, head, commits };
  }

  async rebaseState(root) {
    const gitDirectory = path.dirname(await this.gitPrivatePath(root, "state-placeholder"));
    const mergeDirectory = path.join(gitDirectory, "rebase-merge");
    const applyDirectory = path.join(gitDirectory, "rebase-apply");
    const directory = await exists(mergeDirectory) ? mergeDirectory : await exists(applyDirectory) ? applyDirectory : "";
    if (!directory) return { active: false, todo: [], done: [] };
    const read = (name) => fs.readFile(path.join(directory, name), "utf8").catch(() => "");
    const [todo, done, headName, onto, stoppedSha, message] = await Promise.all([
      read("git-rebase-todo"), read("done"), read("head-name"), read("onto"), read("stopped-sha"), read("message"),
    ]);
    return {
      active: true,
      headName: headName.trim(),
      onto: onto.trim(),
      stoppedSha: stoppedSha.trim(),
      message: message.trim(),
      todo: parseRebaseTodo(todo),
      done: parseRebaseTodo(done),
      conflicts: (await this.status(root)).files.filter((file) => file.conflict).map((file) => file.path),
    };
  }

  async startInteractiveRebase(root, upstream, requestedPlan) {
    const source = await this.rebasePlan(root, upstream);
    const plan = validateRebasePlan(source.commits, requestedPlan);
    if ((await this.rebaseState(root)).active) throw new Error("Es läuft bereits ein Rebase.");
    const sessionDirectory = await this.gitPrivatePath(root, "kiwi-rebase-session");
    await fs.rm(sessionDirectory, { recursive: true, force: true });
    await fs.mkdir(sessionDirectory, { recursive: true });
    const todoFile = path.join(sessionDirectory, "todo");
    const messagesFile = path.join(sessionDirectory, "messages.json");
    const editorFile = path.join(sessionDirectory, "editor.cjs");
    const todo = plan.map((entry) => `${entry.action} ${entry.hash} ${singleLine(entry.subject)}`).join("\n");
    await Promise.all([
      fs.writeFile(todoFile, `${todo}\n`, "utf8"),
      fs.writeFile(messagesFile, `${JSON.stringify(plan.filter((entry) => entry.action === "reword").map((entry) => ({ subject: entry.subject, message: entry.message })))}\n`, "utf8"),
      fs.writeFile(editorFile, rebaseEditorSource(), "utf8"),
    ]);
    const editor = [process.execPath, editorFile].map(shellCommandArgument).join(" ");
    const env = {
      ELECTRON_RUN_AS_NODE: "1",
      GIT_SEQUENCE_EDITOR: `${editor} sequence ${shellCommandArgument(todoFile)}`,
      GIT_EDITOR: `${editor} message ${shellCommandArgument(messagesFile)}`,
    };
    const result = await this.run(root, ["rebase", "--interactive", source.upstream], false, { env, timeoutMs: 10 * 60 * 1000 });
    const state = await this.rebaseState(root);
    if (!state.active) await fs.rm(sessionDirectory, { recursive: true, force: true });
    return { code: result.code, output: result.output, state, status: await this.status(root) };
  }

  async rebase(root, action, upstream = "") {
    const allowed = new Set(["start", "continue", "skip", "abort"]);
    if (!allowed.has(action)) throw new Error("Ungültige Rebase-Aktion.");
    let args;
    if (action === "start") {
      const value = String(upstream || "").trim();
      if (!/^[A-Za-z0-9._/@{}-]+$/.test(value) || value.startsWith("-")) throw new Error("Ungültiger Rebase-Upstream.");
      args = ["rebase", "--rebase-merges", value];
    } else {
      args = ["rebase", `--${action}`];
    }
    const sessionDirectory = await this.gitPrivatePath(root, "kiwi-rebase-session");
    const editorFile = path.join(sessionDirectory, "editor.cjs");
    const messagesFile = path.join(sessionDirectory, "messages.json");
    const sessionEnv = await exists(editorFile) ? {
      ELECTRON_RUN_AS_NODE: "1",
      GIT_EDITOR: `${[process.execPath, editorFile].map(shellCommandArgument).join(" ")} message ${shellCommandArgument(messagesFile)}`,
    } : {};
    const result = await this.run(root, args, false, { env: sessionEnv, timeoutMs: 10 * 60 * 1000 });
    const state = await this.rebaseState(root);
    if (!state.active || action === "abort") await fs.rm(sessionDirectory, { recursive: true, force: true });
    return { code: result.code, output: result.output, state, status: await this.status(root) };
  }
}

/**
 * Git must never open an interactive prompt: the IDE has no terminal attached,
 * so a credential question would hang the operation until the timeout instead
 * of failing with something the user can act on.
 */
function gitEnvironment() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
  };
}

/** Turns git's terse auth failures into something actionable. */
function explainGitFailure(result, signedIn) {
  const text = `${result.stderr || ""}\n${result.stdout || ""}`;
  if (/could not read Username|terminal prompts disabled|Authentication failed|403 Forbidden/i.test(text)) {
    return signedIn
      ? "GitHub hat den Zugriff abgelehnt. Das Token hat vermutlich keinen repo-Scope oder keinen Zugriff auf dieses Repository."
      : "Für dieses Repository ist eine Anmeldung nötig. Melde dich unter Source Control bei GitHub an.";
  }
  if (/Permission denied \(publickey\)/i.test(text)) {
    return "Der SSH-Schlüssel wurde abgelehnt. Hinterlege einen gültigen Schlüssel oder nutze die HTTPS-URL mit GitHub-Anmeldung.";
  }
  if (/Repository not found/i.test(text)) {
    return "Repository nicht gefunden. Bei privaten Repositories muss das Token Zugriff darauf haben.";
  }
  if (/no upstream|set-upstream/i.test(text)) {
    return "Der Branch hat noch keinen Upstream. Nutze „Push mit Upstream“, um ihn anzulegen.";
  }
  return (result.stderr || result.stdout || `git beendete sich mit Code ${result.code}.`).trim();
}

/**
 * Accepts a single revision, not a range and not a flag.
 *
 * `~` and `^` belong here: HEAD~1 and HEAD^ are ordinary revisions, and
 * rejecting them made every "one commit back" operation impossible. What is
 * actually guarded against is a value starting with "-", which git would read
 * as an option, and "..", which turns one revision into a range. Arguments are
 * passed to git as an array, so there is no shell to escape from.
 */
function safeGitRef(value) {
  const ref = String(value || "").trim();
  if (!ref || ref.startsWith("-") || ref.includes("..") || !/^[A-Za-z0-9._/@{}:^~+-]+$/.test(ref)) {
    throw new Error("Ungültige Git-Referenz.");
  }
  return ref;
}

function splitPatchHunks(patch) {
  const sections = String(patch || "").split(/(?=^@@\s)/m);
  if (sections.length < 2) return [];
  const fileHeader = sections.shift();
  return sections
    .filter((hunk) => hunk.startsWith("@@"))
    .map((hunk) => ({ fileHeader, hunk }));
}

function selectableChanges(hunk) {
  const body = String(hunk || "").split(/\r?\n/).slice(1);
  const result = [];
  let cursor = 0;
  while (cursor < body.length) {
    if (!/^[+-]/.test(body[cursor]) || /^(\+\+\+|---)/.test(body[cursor])) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    const removed = [];
    const added = [];
    while (cursor < body.length && /^[+-]/.test(body[cursor]) && !/^(\+\+\+|---)/.test(body[cursor])) {
      const entry = { index: cursor, text: body[cursor].slice(1) };
      if (body[cursor][0] === "-") removed.push(entry);
      else added.push(entry);
      cursor += 1;
    }
    const count = Math.max(removed.length, added.length);
    for (let offset = 0; offset < count; offset += 1) {
      const before = removed[offset];
      const after = added[offset];
      result.push({
        id: `${start}:${offset}`,
        kind: before && after ? "replace" : before ? "remove" : "add",
        before: before?.text || "",
        after: after?.text || "",
        indexes: [before?.index, after?.index].filter(Number.isInteger),
      });
    }
  }
  return result;
}

function partialPatchHunk(hunk, selectedIndexes) {
  const lines = String(hunk || "").split(/\r?\n/);
  const header = lines.shift() || "";
  const body = [];
  let previousSelected = false;
  lines.forEach((line, index) => {
    if (line.startsWith("+")) {
      previousSelected = selectedIndexes.has(index);
      if (previousSelected) body.push(line);
      return;
    }
    if (line.startsWith("-")) {
      previousSelected = selectedIndexes.has(index);
      body.push(previousSelected ? line : ` ${line.slice(1)}`);
      return;
    }
    if (line.startsWith("\\")) {
      if (previousSelected) body.push(line);
      return;
    }
    previousSelected = false;
    body.push(line);
  });
  return `${header}\n${body.join("\n")}`;
}

function parseHunkRange(hunk) {
  const match = String(hunk || "").match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  return match ? {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] || 1),
    newStart: Number(match[3]),
    newLines: Number(match[4] || 1),
  } : { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0 };
}

function parseDiff3Merge(text) {
  const lines = String(text || "").match(/.*(?:\r?\n|$)/g)?.filter(Boolean) || [];
  const chunks = [];
  let common = "";
  let conflict = null;
  let section = "common";
  const pushCommon = () => {
    if (!common) return;
    chunks.push({ kind: "resolved", content: common });
    common = "";
  };
  for (const line of lines) {
    if (section === "common" && /^<<<<<<< KIWI_OURS\s*$/.test(line.trimEnd())) {
      pushCommon();
      conflict = { ours: "", base: "", theirs: "" };
      section = "ours";
    } else if (section === "ours" && /^\|\|\|\|\|\|\| KIWI_BASE\s*$/.test(line.trimEnd())) {
      section = "base";
    } else if (section === "base" && /^=======\s*$/.test(line.trimEnd())) {
      section = "theirs";
    } else if (section === "theirs" && /^>>>>>>> KIWI_THEIRS\s*$/.test(line.trimEnd())) {
      const id = crypto.createHash("sha256")
        .update(`${chunks.length}\0${conflict.base}\0${conflict.ours}\0${conflict.theirs}`)
        .digest("hex").slice(0, 16);
      chunks.push({
        kind: "conflict",
        id,
        ...conflict,
        baseLines: displayLines(conflict.base),
        oursLines: displayLines(conflict.ours),
        theirsLines: displayLines(conflict.theirs),
      });
      conflict = null;
      section = "common";
    } else if (section === "common") common += line;
    else conflict[section] += line;
  }
  // Malformed markers are retained verbatim instead of silently dropping code.
  if (conflict) common += `<<<<<<< KIWI_OURS\n${conflict.ours}||||||| KIWI_BASE\n${conflict.base}=======\n${conflict.theirs}>>>>>>> KIWI_THEIRS\n`;
  pushCommon();
  return chunks;
}

function resolveMergeChunk(chunk, resolution) {
  const choice = String(resolution.choice || "");
  if (choice === "ours" || choice === "base" || choice === "theirs") return chunk[choice];
  if (choice === "both") return `${chunk.ours}${chunk.theirs}`;
  if (choice === "custom") {
    const content = String(resolution.content || "");
    if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("Die manuelle Konfliktauflösung ist zu groß.");
    return content;
  }
  if (choice === "lines") {
    const sources = {
      ours: splitLinesPreserve(chunk.ours),
      base: splitLinesPreserve(chunk.base),
      theirs: splitLinesPreserve(chunk.theirs),
    };
    return (resolution.lines || []).map((selection) => {
      const source = sources[selection.source];
      const index = Number(selection.index);
      if (!source || !Number.isInteger(index) || index < 0 || index >= source.length) {
        throw new Error("Eine ausgewählte Konfliktzeile ist nicht mehr gültig.");
      }
      return source[index];
    }).join("");
  }
  throw new Error(`Unbekannte Konfliktauflösung: ${choice || "leer"}.`);
}

function displayLines(content) {
  return String(content || "").split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line);
}

function splitLinesPreserve(content) {
  return String(content || "").match(/.*(?:\r?\n|$)/g)?.filter(Boolean) || [];
}

function conflictSnapshot(conflict) {
  return crypto.createHash("sha256")
    .update(`${conflict.path}\0${conflict.base}\0${conflict.ours}\0${conflict.theirs}\0${conflict.working || ""}`)
    .digest("hex");
}

function parseRebaseTodo(content) {
  return String(content || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const match = line.match(/^(pick|reword|edit|squash|fixup|drop)\s+([0-9a-f]+)(?:\s+(.*))?$/i);
    return match ? { action: match[1].toLowerCase(), hash: match[2], subject: match[3] || "" } : { action: "unknown", hash: "", subject: line };
  });
}

function validateRebasePlan(sourceCommits, requestedPlan) {
  if (!Array.isArray(requestedPlan) || requestedPlan.length !== sourceCommits.length || !requestedPlan.length) {
    throw new Error("Der Rebase-Plan passt nicht mehr zum aktuellen Branch.");
  }
  const sourceByHash = new Map(sourceCommits.map((commit) => [commit.hash, commit]));
  const seen = new Set();
  const allowed = new Set(["pick", "reword", "edit", "squash", "fixup", "drop"]);
  let hasPrevious = false;
  return requestedPlan.map((entry) => {
    const hash = String(entry?.hash || "");
    const source = sourceByHash.get(hash);
    const action = String(entry?.action || "pick").toLowerCase();
    if (!source || seen.has(hash) || !allowed.has(action)) throw new Error("Der Rebase-Plan enthält einen ungültigen oder doppelten Commit.");
    if ((action === "squash" || action === "fixup") && !hasPrevious) throw new Error("Squash/Fixup benötigt einen vorherigen Commit.");
    seen.add(hash);
    if (action !== "drop") hasPrevious = true;
    const message = action === "reword" ? String(entry.message || "").trim() : source.subject;
    if (action === "reword" && (!message || message.length > 10_000)) throw new Error("Für Reword wird eine gültige Commit-Nachricht benötigt.");
    return { ...source, action, message };
  });
}

function rebaseEditorSource() {
  return `"use strict";\nconst fs = require("node:fs");\nconst mode = process.argv[2];\nconst source = process.argv[3];\nconst target = process.argv[4];\nif (!target) process.exit(2);\nif (mode === "sequence") { fs.copyFileSync(source, target); process.exit(0); }\nif (mode === "message") {\n  let queue = [];\n  try { queue = JSON.parse(fs.readFileSync(source, "utf8")); } catch {}\n  const current = fs.readFileSync(target, "utf8");\n  const combined = /^# This is a combination of/m.test(current);\n  const subject = current.split(/\\r?\\n/).find((line) => line.trim() && !line.startsWith("#")) || "";\n  const index = combined ? -1 : queue.findIndex((entry) => String(entry.subject) === subject.trim());\n  if (index >= 0) { const next = String(queue[index].message); queue.splice(index, 1); fs.writeFileSync(target, next.endsWith("\\n") ? next : next + "\\n", "utf8"); fs.writeFileSync(source, JSON.stringify(queue), "utf8"); }\n  process.exit(0);\n}\nprocess.exit(2);\n`;
}

function shellCommandArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function singleLine(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function normalizeCommitChecks(value) {
  return {
    build: Boolean(value?.build),
    tests: Boolean(value?.tests),
    format: Boolean(value?.format),
    failOnSkipped: value?.failOnSkipped !== false,
  };
}

function checkPlan(id, label, command, args) {
  return { id, label, command: String(command || ""), args: args.map(String), reason: "" };
}

function skippedPlan(id, label, reason) {
  return { id, label, command: "", args: [], reason };
}

function formatCheck(kind, source, tool) {
  if (/spotless/i.test(source)) return kind === "maven"
    ? checkPlan("format", "Formatierung", tool, ["--batch-mode", "--no-transfer-progress", "spotless:check"])
    : checkPlan("format", "Formatierung", tool, ["spotlessCheck", "--console=plain", "--no-daemon"]);
  if (kind === "maven" && /fmt-maven-plugin/i.test(source)) return checkPlan("format", "Formatierung", tool, ["--batch-mode", "--no-transfer-progress", "fmt:check"]);
  if (/checkstyle/i.test(source)) return kind === "maven"
    ? checkPlan("format", "Formatierung", tool, ["--batch-mode", "--no-transfer-progress", "checkstyle:check"])
    : checkPlan("format", "Formatierung", tool, ["checkstyleMain", "--console=plain", "--no-daemon"]);
  return null;
}

async function firstExisting(paths) {
  for (const candidate of paths) if (await exists(candidate)) return candidate;
  return "";
}

async function exists(candidate) {
  try { await fs.access(candidate); return true; } catch { return false; }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} ist ungültig.`);
  return parsed;
}

function mapPullRequest(pull) {
  return {
    number: Number(pull?.number || 0),
    title: String(pull?.title || ""),
    state: String(pull?.state || "open"),
    draft: Boolean(pull?.draft),
    url: String(pull?.html_url || ""),
    author: String(pull?.user?.login || ""),
    avatarUrl: String(pull?.user?.avatar_url || ""),
    createdAt: String(pull?.created_at || ""),
    updatedAt: String(pull?.updated_at || ""),
    head: String(pull?.head?.ref || ""),
    base: String(pull?.base?.ref || ""),
    additions: Number(pull?.additions || 0),
    deletions: Number(pull?.deletions || 0),
    changedFiles: Number(pull?.changed_files || 0),
    comments: Number(pull?.comments || 0) + Number(pull?.review_comments || 0),
  };
}

module.exports = {
  assertCloneUrl,
  repositoryFolderName,
  GitService,
  conflictSnapshot,
  parseDiff3Merge,
  parseHunkRange,
  parseRebaseTodo,
  partialPatchHunk,
  resolveMergeChunk,
  safeGitRef,
  selectableChanges,
  splitPatchHunks,
  validateRebasePlan,
};
