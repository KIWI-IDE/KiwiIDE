/**
 * A fast reproduction of the access violation on workspace close.
 *
 * The E2E takes four minutes to tell whether the main process survives closing
 * a workspace, and it dies roughly one run in three — which is a terrible loop
 * to diagnose anything in. This does the part that crashes and nothing else:
 * start terminals, stop them the way `workspace:closeAll` does, wait for them
 * to be gone, repeat.
 *
 * It runs under Electron because node-pty is built for Electron's ABI:
 *
 *   npx electron scripts/pty-teardown-probe.cjs --rounds 40 --terminals 3
 *
 * Exit code 0 means every round survived. 3221225477 (0xC0000005) is the crash
 * being hunted; anything else is this script's own failure, which it reports.
 *
 * KIWI_PTY_CONPTY_DLL=0 spawns without the bundled ConPTY DLL, which is the
 * one setting worth comparing against — the DLL is there to avoid node-pty's
 * console-list helper, and whether it is also what is crashing is exactly the
 * question this script exists to answer.
 */
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const { PathGuard } = require("../electron/services/path-guard.cjs");
const { TerminalService } = require("../electron/services/terminal-service.cjs");
const { WorkspaceService } = require("../electron/services/workspace-service.cjs");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const ROUNDS = option("rounds", 25);
const TERMINALS = option("terminals", 3);
/** How long a terminal is allowed to live before it is torn down again. */
const SETTLE_MS = option("settle", 400);
/** Whether a recursive file watcher is opened and closed alongside them. */
const WATCH = !process.argv.includes("--no-watch");
/** Whether terminals are started at all, to tell the two subsystems apart. */
const TERMINALS_ON = !process.argv.includes("--no-terminals");
/** "watcher-first" is what the workbench did; "watcher-last" is the candidate. */
const ORDER = process.argv.includes("--watcher-last") ? "watcher-last" : "watcher-first";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The pty backend under test.
 *
 * Production spawns with the bundled ConPTY DLL. `--no-conpty-dll` uses
 * Windows' own ConPTY instead and `--winpty` skips ConPTY altogether, so the
 * three backends can be held against the same crash rather than argued about.
 */
function ptyFactory() {
  if (!process.argv.includes("--no-conpty-dll") && !process.argv.includes("--winpty")) return null;
  const pty = require("node-pty");
  const override = process.argv.includes("--winpty")
    ? { useConpty: false, useConptyDll: false }
    : { useConpty: true, useConptyDll: false };
  return { spawn: (file, args, options) => pty.spawn(file, args, { ...options, ...override }) };
}

/**
 * Filesystem noise inside the watched directory.
 *
 * A real project is never quiet at close: JDT writes its workspace data, the
 * build tool its caches. A recursive watcher closed while nothing is happening
 * is not the case that has been crashing.
 */
function startChurn(root) {
  const directory = path.join(root, "churn");
  fsSync.mkdirSync(directory, { recursive: true });
  let index = 0;
  const timer = setInterval(() => {
    index += 1;
    const file = path.join(directory, `file-${index % 40}.txt`);
    try {
      fsSync.writeFileSync(file, `${index} ${"x".repeat(512)}`);
      if (index % 7 === 0) fsSync.rmSync(file, { force: true });
    } catch { }
  }, 4);
  return () => clearInterval(timer);
}

async function main() {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "kiwi-pty-probe-"));
  const guard = new PathGuard();
  guard.register(root);

  let output = 0;
  const service = new TerminalService(guard, () => { output += 1; }, ptyFactory());
  if (process.argv.includes("--taskkill")) {
    // Ends the shell as an operating-system process and lets ConPTY see its
    // client exit, rather than closing the pseudoconsole from under it — which
    // is where kill() dies. The exit path is then the same one a shell that
    // typed "exit" takes, and that one does not crash.
    service.endProcess = (terminalProcess) => new Promise((resolve) => {
      let settled = false;
      let killTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        resolve(true);
      };
      try { terminalProcess.onExit?.(finish); } catch { finish(); return; }
      try { terminalProcess.write("exit\r"); } catch { }
      killTimer = setTimeout(() => {
        const pid = Number(terminalProcess.pid) || 0;
        if (pid > 0) {
          try {
            require("node:child_process").execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => { });
          } catch { }
        }
        setTimeout(finish, 1_500);
      }, 700);
    });
  }
  if (process.argv.includes("--no-kill")) {
    // Only asks, never insists: whether kill() is what crashes, or whether
    // ending a ConPTY at all is enough to do it.
    service.endProcess = (terminalProcess) => new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(true); } };
      try { terminalProcess.onExit?.(finish); } catch { finish(); return; }
      try { terminalProcess.write("exit\r"); } catch { }
      setTimeout(finish, 3_000);
    });
  }
  const workspace = WATCH ? new WorkspaceService(guard, () => { }) : null;
  const stopChurn = WATCH ? startChurn(root) : () => { };

  process.stdout.write(
    `Probe: ${ROUNDS} Runden, ${TERMINALS} Terminals ${TERMINALS_ON ? "an" : "aus"}, Watcher ${WATCH ? "an" : "aus"}, Reihenfolge ${ORDER},`
    + ` ConPTY-DLL ${process.env.KIWI_PTY_CONPTY_DLL === "0" ? "aus" : "an"}\n`,
  );

  for (let round = 1; round <= ROUNDS; round += 1) {
    if (workspace) workspace.watch(root);
    if (TERMINALS_ON) {
      for (let index = 1; index <= TERMINALS; index += 1) service.start(root, String(index));
    }
    // Long enough for PowerShell to have printed a prompt, which is when a
    // terminal in the workbench is actually alive.
    await wait(SETTLE_MS);
    // Which of the two native subsystems is taken apart first. "watcher-first"
    // is what the workbench did; "watcher-last" closes the recursive watcher
    // only once every pty is actually gone.
    let drained = true;
    if (ORDER === "watcher-last") {
      service.stop(root);
      drained = await service.drain(2_000);
      if (workspace) workspace.unwatch(root);
    } else {
      if (workspace) workspace.unwatch(root);
      service.stop(root);
      drained = await service.drain(2_000);
    }
    process.stdout.write(`Runde ${round}/${ROUNDS}: ${drained ? "sauber" : "abgelaufen"} (${output} Ausgaben)\n`);
  }

  stopChurn();
  process.stdout.write("Alle Runden überstanden.\n");
  // A shell that was asked to leave may still hold the directory as its cwd.
  try { fsSync.rmSync(root, { recursive: true, force: true }); } catch { }
  app.exit(0);
}

app.whenReady().then(main).catch((error) => {
  process.stderr.write(`Probe fehlgeschlagen: ${error?.stack || error}\n`);
  app.exit(2);
});
