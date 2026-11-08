const { execFile } = require("node:child_process");
const path = require("node:path");

const MAX_OUTPUT_LENGTH = 250_000;
const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 30;

/**
 * How long a shell is given to leave on its own before it is ended.
 *
 * Measured rather than guessed: PowerShell under ConPTY reports its exit about
 * 2.7 seconds after being asked, and node-pty adds that same latency however
 * the process ends. The previous value was 700 ms, which meant the polite ask
 * never once won the race — every terminal was killed, which is exactly the
 * path that crashes.
 */
const SHELL_EXIT_GRACE_MS = 3_500;

/** And how long the operating system is given to end one that would not go. */
const SHELL_KILL_GRACE_MS = 2_500;

/** Sessions are isolated by project and terminal tab. */
const sessionKey = (root, sessionId) => `${root}\u0000${sessionId || "1"}`;

function defaultShell() {
  return process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/sh";
}

function terminalEnvironment(environment = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") result[key] = value;
  }
  result.TERM = "xterm-256color";
  result.COLORTERM = "truecolor";
  return result;
}

/**
 * Ends a shell and everything it started, as processes.
 *
 * Deliberately not `terminalProcess.kill()` on Windows: that goes through
 * ConPTY and is where the process was dying. Ending the shell by its id leaves
 * ConPTY to notice its client is gone and unwind the way it always does.
 *
 * Off Windows there is no ConPTY and node-pty's own kill is the right one.
 */
function endProcessTree(terminalProcess) {
  const pid = Number(terminalProcess?.pid) || 0;
  if (process.platform !== "win32" || pid <= 0) {
    try { terminalProcess?.kill?.(); } catch { }
    return;
  }
  try {
    // /T for the tree, because whatever the shell was running owns the console
    // as much as the shell does.
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => { });
  } catch {
    // Nothing left to end.
  }
}

function normalizeSize(value, fallback, minimum, maximum) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/**
 * Updates the informational cwd from PowerShell's real prompt.
 *
 * The shell itself remains the authority: this parser only makes snapshots and
 * the detached-window subtitle follow `cd`. It deliberately ignores relative
 * and malformed values instead of ever changing the process cwd itself.
 */
function cwdFromPowerShellOutput(output, current) {
  const plain = String(output || "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
  const matches = [...plain.matchAll(/(?:^|[\r\n])PS\s+([^>\r\n]+)>\s?/g)];
  const candidate = matches.at(-1)?.[1]?.trim();
  return candidate && path.isAbsolute(candidate) ? path.normalize(candidate) : current;
}

class TerminalService {
  /**
   * `ptyFactory` is injectable so unit tests can use a deterministic fake.
   * Production intentionally has no pipe-based fallback: silently losing
   * ConPTY would break Ctrl+C, ANSI, interactive programs and terminal resize.
   */
  constructor(pathGuard, send, ptyFactory = null, options = {}) {
    this.pathGuard = pathGuard;
    this.send = send;
    this.ptyFactory = ptyFactory || require("node-pty");
    /**
     * How a shell that will not leave is ended, and how long it is given.
     *
     * Injectable for the same reason the pty factory is: the real one runs
     * taskkill against a process id, which a unit test can neither do nor
     * observe, and the grace period is measured in seconds.
     */
    this.killProcessTree = options.killProcessTree || endProcessTree;
    this.exitGraceMs = Number.isFinite(options.exitGraceMs) ? options.exitGraceMs : SHELL_EXIT_GRACE_MS;
    this.killGraceMs = Number.isFinite(options.killGraceMs) ? options.killGraceMs : SHELL_KILL_GRACE_MS;
    this.sessions = new Map();
    /**
     * Terminals that have been killed but may not have finished dying.
     *
     * kill() returns immediately and ConPTY does its own teardown afterwards,
     * in native code. Closing a workspace used to start that and then
     * immediately tear the language server down as well, so two native
     * subsystems were being taken apart at the same time — and the process
     * occasionally died with an access violation somewhere in the middle.
     */
    this.dying = new Set();
  }

  /**
   * Waits for the terminals that were killed to actually be gone.
   *
   * Bounded: a pty that will not die must not hold up closing a workspace, and
   * whatever it is doing is no worse for being waited on a moment longer.
   */
  async drain(timeoutMs = 2_000) {
    if (!this.dying.size) return true;
    const pending = [...this.dying];
    const settled = await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    for (const promise of pending) this.dying.delete(promise);
    return settled;
  }

  /**
   * Resolve a root for read/cleanup operations without reopening access after
   * the workspace guard was cleared. Closing a workspace and React effect
   * cleanup can overlap; in that short window stop/list/resize must be
   * idempotent instead of turning a successful close into an IPC failure.
   */
  existingSessionRoot(root) {
    if (!root || typeof root !== "string") return null;
    if (this.pathGuard.isRegistered(root)) return this.pathGuard.assertWorkspace(root);
    const normalized = process.platform === "win32"
      ? path.resolve(root).toLocaleLowerCase()
      : path.resolve(root);
    return [...this.sessions.values()].find((session) => {
      const sessionRoot = process.platform === "win32"
        ? path.resolve(session.root).toLocaleLowerCase()
        : path.resolve(session.root);
      return sessionRoot === normalized;
    })?.root || null;
  }

  appendOutput(session, text) {
    const chunk = String(text || "");
    if (!chunk) return;
    session.output = `${session.output || ""}${chunk}`.slice(-MAX_OUTPUT_LENGTH);
    session.cwd = cwdFromPowerShellOutput(chunk, session.cwd);
    this.send("terminal:output", {
      projectRoot: session.root,
      sessionId: session.sessionId,
      cwd: session.cwd,
      stream: "pty",
      text: chunk,
    });
  }

  start(root, sessionId = "1", size = {}) {
    const cwd = this.pathGuard.assertWorkspace(root);
    const id = String(sessionId || "1");
    const key = sessionKey(cwd, id);
    const current = this.sessions.get(key);
    if (current?.running) {
      if (size?.columns || size?.rows) this.resize(cwd, size.columns, size.rows, id);
      return { started: true, shell: current.shell, cwd: current.cwd, sessionId: id };
    }
    const previousOutput = current?.output || "";
    const previousCwd = current?.cwd || cwd;

    const shell = defaultShell();
    // With a PTY the shell must run interactively. `-Command -` would turn
    // stdin back into a script pipe and defeat ConPTY even though node-pty was
    // present.
    const args = process.platform === "win32" ? ["-NoLogo", "-NoProfile"] : [];
    const columns = normalizeSize(size?.columns, DEFAULT_COLUMNS, 20, 500);
    const rows = normalizeSize(size?.rows, DEFAULT_ROWS, 5, 300);
    const terminalProcess = this.ptyFactory.spawn(shell, args, {
      name: "xterm-256color",
      cols: columns,
      rows,
      cwd: previousCwd,
      env: terminalEnvironment(),
      // Kiwi targets modern Windows x64. The bundled ConPTY DLL avoids
      // node-pty's console-list helper process, which is unreliable in
      // frameless/portable Electron processes that have no parent console.
      ...(process.platform === "win32" ? { useConpty: true, useConptyDll: true } : {}),
    });
    const session = {
      process: terminalProcess,
      root: cwd,
      cwd: previousCwd,
      shell,
      sessionId: id,
      output: previousOutput,
      running: true,
      columns,
      rows,
      dataDisposable: null,
      exitDisposable: null,
    };
    this.sessions.set(key, session);
    session.dataDisposable = terminalProcess.onData((data) => this.appendOutput(session, data));
    session.exitDisposable = terminalProcess.onExit(({ exitCode = 0 } = {}) => {
      session.running = false;
      session.dataDisposable?.dispose?.();
      session.exitDisposable?.dispose?.();
      session.dataDisposable = null;
      session.exitDisposable = null;
      session.process = null;
      // A natural `exit` keeps scrollback. Only explicitly closing the tab
      // removes it; starting this id again replaces the PTY and keeps output.
      this.send("terminal:exit", { projectRoot: cwd, sessionId: id, code: exitCode });
    });
    return { started: true, shell, cwd: previousCwd, sessionId: id };
  }

  /** Writes raw terminal data. Newlines and control characters stay intact. */
  input(root, data, sessionId = "1") {
    const cwd = this.pathGuard.assertWorkspace(root);
    const id = String(sessionId || "1");
    const key = sessionKey(cwd, id);
    if (!this.sessions.get(key)?.running) this.start(cwd, id);
    this.sessions.get(key).process.write(String(data ?? ""));
    return true;
  }

  /** Convenience path for the quick-command field and reusable tasks. */
  execute(root, command, sessionId = "1") {
    const line = String(command || "").replace(/[\r\n]+$/, "");
    if (!line) return false;
    return this.input(root, `${line}\r`, sessionId);
  }

  resize(root, columns, rows, sessionId = "1") {
    const cwd = this.existingSessionRoot(root);
    if (!cwd) return false;
    const id = String(sessionId || "1");
    const session = this.sessions.get(sessionKey(cwd, id));
    if (!session?.running) return false;
    const nextColumns = normalizeSize(columns, session.columns || DEFAULT_COLUMNS, 20, 500);
    const nextRows = normalizeSize(rows, session.rows || DEFAULT_ROWS, 5, 300);
    if (nextColumns === session.columns && nextRows === session.rows) return true;
    session.process.resize(nextColumns, nextRows);
    session.columns = nextColumns;
    session.rows = nextRows;
    return true;
  }

  snapshot(root, sessionId = "1") {
    const cwd = this.existingSessionRoot(root);
    const id = String(sessionId || "1");
    if (!cwd) {
      const closedRoot = typeof root === "string" && root ? path.resolve(root) : "";
      return {
        projectRoot: closedRoot,
        sessionId: id,
        cwd: closedRoot,
        shell: defaultShell(),
        running: false,
        output: "",
        columns: DEFAULT_COLUMNS,
        rows: DEFAULT_ROWS,
      };
    }
    const session = this.sessions.get(sessionKey(cwd, id));
    return {
      projectRoot: cwd,
      sessionId: id,
      cwd: session?.cwd || cwd,
      shell: session?.shell || defaultShell(),
      running: Boolean(session?.running),
      output: session?.output || "",
      columns: session?.columns || DEFAULT_COLUMNS,
      rows: session?.rows || DEFAULT_ROWS,
    };
  }

  list(root) {
    const cwd = this.existingSessionRoot(root);
    if (!cwd) return [];
    return [...this.sessions.values()]
      .filter((session) => session.root === cwd)
      .map((session) => session.sessionId)
      .sort((left, right) => Number(left) - Number(right));
  }

  stop(root, sessionId = "") {
    if (!root) {
      let stopped = false;
      for (const session of [...this.sessions.values()]) {
        stopped = this.stop(session.root, session.sessionId) || stopped;
      }
      return stopped;
    }
    const cwd = this.existingSessionRoot(root);
    if (!cwd) return false;
    if (!sessionId) {
      let stopped = false;
      for (const id of this.list(cwd)) stopped = this.stop(cwd, id) || stopped;
      return stopped;
    }
    const id = String(sessionId);
    const key = sessionKey(cwd, id);
    const session = this.sessions.get(key);
    if (!session) return false;
    this.sessions.delete(key);
    session.running = false;
    // Closing a terminal tab means ending its process tree, not merely asking
    // the shell to exit while a foreground child may still own the console.
    //
    // Both listeners go before the kill, and the process reference goes with
    // them. Only the data listener used to be dropped, so the exit that the
    // kill causes still ran its handler — against a session already taken out
    // of the map, reporting an exit for a terminal nobody could be watching
    // any more. Closing a workspace does this for every terminal at once,
    // just after the windows they belonged to were destroyed.
    session.dataDisposable?.dispose?.();
    session.exitDisposable?.dispose?.();
    session.dataDisposable = null;
    session.exitDisposable = null;
    const terminalProcess = session.process;
    session.process = null;
    // A process that has already exited must not be killed a second time:
    // node-pty hands that straight to ConPTY, which is native code and does
    // not answer with an exception.
    if (terminalProcess) {
      const gone = this.endProcess(terminalProcess);
      this.dying.add(gone);
      void gone.then(() => this.dying.delete(gone));
    }
    return true;
  }

  /**
   * Ends one pty, asking before insisting — and never through node-pty's kill.
   *
   * This is the access violation that killed the process while a workspace was
   * being closed, and it took three wrong answers to find. It is not the file
   * watcher, and it is not the bundled ConPTY DLL: a probe that starts and
   * stops terminals in a loop crashes every eight to twenty rounds with ConPTY
   * either way, survives sixty rounds on winpty, and survives with ConPTY as
   * long as `kill()` is never called. `pty.kill()` closes the pseudoconsole out
   * from under ConPTY, in native code on its own thread.
   *
   * So the shell is asked to leave, and a shell that will not leave is ended as
   * an operating-system process instead. ConPTY then sees its client exit the
   * same way it does when somebody types "exit", which is the path that does
   * not crash.
   *
   * See scripts/pty-teardown-probe.cjs, which reproduces all of this in half a
   * minute rather than in a four-minute end-to-end run that fails one time in
   * three.
   */
  endProcess(terminalProcess) {
    return new Promise((resolve) => {
      let settled = false;
      let killTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        resolve(true);
      };
      try {
        terminalProcess.onExit?.(finish);
      } catch {
        finish();
        return;
      }
      try {
        // The shell's own way out. PowerShell and bash both take it, and the
        // carriage return is what submits the line — "exit\n" is typed but
        // never entered, and the shell sits there.
        terminalProcess.write("exit\r");
      } catch {
        // A pipe that is already gone needs no asking.
      }
      killTimer = setTimeout(() => {
        this.killProcessTree(terminalProcess);
        // Ended rather than asked, so the wait for its exit is bounded too.
        setTimeout(finish, this.killGraceMs);
      }, this.exitGraceMs);
    });
  }

  health() {
    return {
      sessions: this.sessions.size,
      backend: "node-pty",
      processes: [...this.sessions.values()].map((session) => ({
        root: session.root,
        pid: session.process?.pid || 0,
        running: Boolean(session.running),
        columns: session.columns,
        rows: session.rows,
      })),
    };
  }
}

module.exports = {
  TerminalService,
  cwdFromPowerShellOutput,
  normalizeSize,
  terminalEnvironment,
};
