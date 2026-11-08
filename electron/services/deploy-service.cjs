/**
 * Getting the built artefact onto the machine it is supposed to run on.
 *
 * The loop this exists for: build, copy the jar to the server, restart the
 * service, watch the log. It is the thing a server developer does twenty times
 * a day and the one part of it an IDE usually leaves to a batch file somebody
 * wrote once and nobody understands any more.
 *
 * `scp` and `ssh` are used as they are. Windows has shipped OpenSSH since
 * 2018, and using it means the person's own `~/.ssh/config`, their own keys
 * and their own agent all work exactly as they do in a terminal — Kiwi adds
 * nothing to learn and, more to the point, never sees a key or a password.
 *
 * Two flags are set deliberately and neither is negotiable:
 *
 * `BatchMode=yes` — a prompt from ssh would be invisible behind the workbench
 * and would simply hang. Failing immediately with "no key" is an answer; a
 * progress bar that never ends is not.
 *
 * Host key checking is left at the person's own setting. Turning it off would
 * make the first deployment smoother and every one after it unauthenticated,
 * which is the whole point of the check.
 */
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

/** How long any single step may take before it is given up on. */
const STEP_TIMEOUT_MS = 10 * 60_000;

/** What a target looks like once it has been checked over. */
function normaliseTarget(target = {}) {
  const port = Number(target.port);
  return {
    host: String(target.host || "").trim(),
    user: String(target.user || "").trim(),
    port: Number.isFinite(port) && port > 0 && port < 65_536 ? Math.trunc(port) : 22,
    /** Where the jar is built, relative to the project. `*` is allowed. */
    artifact: String(target.artifact || "").trim(),
    /** Where it goes, as an absolute path on the server. */
    remoteDirectory: String(target.remoteDirectory || "").trim(),
    /** What to run afterwards. Empty means copy and stop. */
    restartCommand: String(target.restartCommand || "").trim(),
  };
}

/**
 * What is wrong with this target, in a sentence somebody can act on.
 *
 * Checked before anything is started rather than after the build has run for
 * two minutes: a missing host is not something to find out about at the point
 * of upload.
 */
function describeProblem(target) {
  if (!target.host) return "Es ist kein Server eingetragen.";
  if (!target.artifact) return "Es ist keine Datei zum Hochladen eingetragen.";
  if (!target.remoteDirectory) return "Es ist kein Zielverzeichnis auf dem Server eingetragen.";
  // A remote path that is not absolute lands wherever the login happens to
  // start, which is rarely where the service reads from.
  if (!/^(\/|~)/.test(target.remoteDirectory)) {
    return "Das Zielverzeichnis muss ein absoluter Pfad sein, etwa /opt/honeymc.";
  }
  if (/[\r\n]/.test(target.restartCommand)) return "Der Neustart-Befehl darf nur eine Zeile sein.";
  return "";
}

/** `user@host`, or just the host when the login name is the local one. */
function destination(target) {
  return target.user ? `${target.user}@${target.host}` : target.host;
}

class DeployService {
  /**
   * @param {object} pathGuard
   * @param {object} [options]
   * @param {typeof spawn} [options.spawnImpl]
   */
  constructor(pathGuard, options = {}) {
    this.pathGuard = pathGuard;
    this.spawnImpl = options.spawnImpl || spawn;
    /** One deployment per project at a time; the second would race the first. */
    this.running = new Map();
  }

  file(root) {
    this.pathGuard.assertWorkspace(root);
    return path.join(root, ".kiwi", "deploy.json");
  }

  async load(root) {
    try {
      return normaliseTarget(JSON.parse(await fsp.readFile(this.file(root), "utf8")));
    } catch {
      return normaliseTarget({});
    }
  }

  async save(root, target) {
    const next = normaliseTarget(target);
    const file = this.file(root);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  /** Whether a deployment could start at all, and why not when it could not. */
  async check(root) {
    const target = await this.load(root);
    const problem = describeProblem(target);
    if (problem) return { ready: false, problem, target };
    const artifact = await this.resolveArtifact(root, target.artifact);
    if (!artifact) {
      return {
        ready: false,
        problem: `„${target.artifact}“ wurde nicht gefunden. Erst bauen, dann hochladen.`,
        target,
      };
    }
    return { ready: true, problem: "", target, artifact };
  }

  /**
   * The file to upload, from a path that may end in a wildcard.
   *
   * `build/libs/*-all.jar` is what a shadowJar build actually produces, and
   * the version in the middle changes with every release. Only the last
   * segment may be a pattern: anything cleverer is a way to walk out of the
   * project without noticing.
   */
  async resolveArtifact(root, pattern) {
    this.pathGuard.assertWorkspace(root);
    const relative = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
    if (relative.includes("..")) return "";
    const directory = path.join(root, path.dirname(relative));
    const name = path.basename(relative);

    if (!name.includes("*")) {
      const candidate = path.join(root, relative);
      this.pathGuard.assertAllowed(candidate, root);
      try {
        const stat = await fsp.stat(candidate);
        return stat.isFile() ? candidate : "";
      } catch {
        return "";
      }
    }

    const matcher = new RegExp(`^${name.split("*").map(escapeRegExp).join(".*")}$`);
    let entries = [];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return "";
    }
    const files = entries.filter((entry) => entry.isFile() && matcher.test(entry.name));
    if (!files.length) return "";
    // Newest wins: after a rebuild that is the one just produced, and with
    // several versions lying about it is the one meant.
    const stats = await Promise.all(files.map(async (entry) => {
      const full = path.join(directory, entry.name);
      return { full, at: (await fsp.stat(full)).mtimeMs };
    }));
    stats.sort((left, right) => right.at - left.at);
    this.pathGuard.assertAllowed(stats[0].full, root);
    return stats[0].full;
  }

  /** One child process, its output streamed line by line. */
  run(command, args, onLine) {
    return new Promise((resolve) => {
      let child;
      try {
        child = this.spawnImpl(command, args, { windowsHide: true });
      } catch (error) {
        onLine(`${command} konnte nicht gestartet werden: ${error?.message || error}`, "error");
        resolve({ code: -1, failed: true });
        return;
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        onLine(`${command} hat zu lange gebraucht und wurde beendet.`, "error");
        try {
          child.kill();
        } catch {
          // Already gone, which is the outcome either way.
        }
      }, STEP_TIMEOUT_MS);

      const pump = (stream, kind) => {
        let rest = "";
        stream?.setEncoding?.("utf8");
        stream?.on("data", (chunk) => {
          rest += chunk;
          const lines = rest.split(/\r?\n/);
          rest = lines.pop() || "";
          for (const line of lines) if (line.trim()) onLine(line, kind);
        });
        stream?.on("end", () => { if (rest.trim()) onLine(rest, kind); });
      };
      pump(child.stdout, "out");
      // ssh writes everything conversational to stderr, including the lines
      // that say it worked, so this is not an error channel.
      pump(child.stderr, "out");

      child.on("error", (error) => {
        clearTimeout(timer);
        onLine(`${command} ist nicht verfügbar: ${error?.message || error}`, "error");
        resolve({ code: -1, failed: true });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        // A process ended by a signal has no exit code. Number(null) is zero,
        // but an interrupted upload must never be followed by a restart.
        resolve({ code: typeof code === "number" ? code : -1, failed: timedOut || Boolean(signal) || code !== 0 });
      });
    });
  }

  /**
   * Upload, then restart.
   *
   * Building is deliberately not part of this: the workbench already has a
   * build it reports properly, and a second one hidden inside a deployment
   * would report its failures in the wrong place. `check` says whether there
   * is anything to upload, and the caller builds first if there is not.
   */
  async deploy(root, onLine) {
    this.pathGuard.assertWorkspace(root);
    const key = path.resolve(root);
    if (this.running.get(key)) {
      return { ok: false, problem: "Für dieses Projekt läuft bereits eine Übertragung." };
    }

    // Claimed before the first await, not after it. `check` reads the disk,
    // and two deployments started in the same tick both got past a flag that
    // was only set once it came back -- two scp processes onto one server.
    this.running.set(key, true);
    try {
      const state = await this.check(root);
      if (!state.ready) {
        onLine(state.problem, "error");
        return { ok: false, problem: state.problem };
      }
      const { target, artifact } = state;
      const common = [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=15",
      ];

      onLine(`${path.basename(artifact)} → ${destination(target)}:${target.remoteDirectory}`, "step");
      const copy = await this.run("scp", [
        ...common,
        // scp spells the port with a capital P and ssh with a small one. The
        // two are not interchangeable and the error if they are swapped is
        // about an unknown option, not about a port.
        "-P", String(target.port),
        artifact,
        // A missing directory must fail, not become a file named after it.
        `${destination(target)}:${target.remoteDirectory.replace(/\/+$/, "")}/`,
      ], onLine);
      if (copy.failed) {
        const problem = "Das Hochladen ist fehlgeschlagen.";
        onLine(problem, "error");
        return { ok: false, problem };
      }

      if (!target.restartCommand) {
        onLine("Übertragen. Kein Neustart-Befehl eingetragen.", "done");
        return { ok: true, problem: "", restarted: false };
      }

      onLine(target.restartCommand, "step");
      const restart = await this.run("ssh", [
        ...common,
        "-p", String(target.port),
        destination(target),
        target.restartCommand,
      ], onLine);
      if (restart.failed) {
        // Worth saying apart: the new jar is already up there, so the state on
        // the server is "new file, old process" and somebody has to know that.
        const problem = "Die Datei ist übertragen, der Neustart ist fehlgeschlagen.";
        onLine(problem, "error");
        return { ok: false, problem, uploaded: true };
      }

      onLine("Übertragen und neu gestartet.", "done");
      return { ok: true, problem: "", restarted: true };
    } finally {
      this.running.delete(key);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { DeployService, normaliseTarget, describeProblem, destination };
