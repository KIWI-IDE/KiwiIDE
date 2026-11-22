import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Proves that the UI appears before background Gradle warming completes. */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronBinary = require(path.join(projectRoot, "node_modules", "electron"));

/** How much longer than usual every wait may take on a busy machine. */
const patience = Math.max(1, Number(process.env.KIWI_E2E_PATIENCE) || 1);
const budget = (ms) => Math.round(ms * patience);

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-preload-"));
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-preload-ud-"));

try {
  await fs.mkdir(path.join(fixture, "src", "main", "java"), { recursive: true });
  await fs.writeFile(path.join(fixture, "settings.gradle.kts"), 'rootProject.name = "vorladen"\n');
  await fs.writeFile(path.join(fixture, "build.gradle.kts"), "plugins { java }\nrepositories { mavenCentral() }\n");
  await fs.writeFile(
    path.join(fixture, "src", "main", "java", "Haupt.java"),
    "public class Haupt { public static void main(String[] args) {} }\n",
  );

  // First launch: leave the project open, so the second has one to preload.
  await withKiwi({ preload: false, splashMinimumMs: 300 }, async ({ waitForTarget, connect, evaluate, until }) => {
    const welcome = await waitForTarget((target) => target.url.includes("window=welcome"), budget(40_000), "Willkommensfenster");
    const cdp = await connect(welcome.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await until(() => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), budget(30_000), "Preload-Brücke");
    await evaluate(cdp, `window.kiwi.workspace.add([${JSON.stringify(fixture)}])`, true);
    await evaluate(cdp, `window.kiwi.app.openEditor(${JSON.stringify(fixture)})`, true);
    cdp.close();
    const editor = await waitForTarget((target) => target.url.includes("window=editor"), budget(40_000), "Editorfenster");
    const ui = await connect(editor.webSocketDebuggerUrl);
    await ui.send("Runtime.enable");
    await until(() => evaluate(ui, "document.querySelectorAll('.workspace-project-tree').length === 1"), budget(60_000), "Projektbaum");
    ui.close();
    // The workspace state is written debounced; let that write happen.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  // Background work must not hold a usable editor behind the splash.
  const observed = await withKiwi({ preload: true, splashMinimumMs: 300 }, async ({ waitForTarget, connect, evaluate, until, startedAt, log, targets }) => {
    const splash = await waitForTarget(target => target.url.startsWith("data:text/html"), budget(25_000), "Splash");
    const probe = await connect(splash.webSocketDebuggerUrl);
    await probe.send("Runtime.enable");
    await until(async () => !(await targets()).some(target => target.id === splash.id), budget(15_000), "visible editor");
    const shownMs = Date.now() - startedAt;
    assert.ok(shownMs < budget(14_000), "The ready window was delayed by startup work: " + shownMs + " ms");
    const editor = await waitForTarget(target => target.url.includes("window=editor"), budget(40_000), "Editorfenster");
    const ui = await connect(editor.webSocketDebuggerUrl);
    await ui.send("Runtime.enable");
    await until(() => evaluate(ui, "document.readyState === 'complete' && Boolean(window.kiwi)"), budget(30_000), "Preload bridge");
    const result = await evaluate(ui, 'window.kiwi.project.tasks(' + JSON.stringify(fixture) + ').then(value => ({count:value.tasks.length, reason:value.reason || ""}))', true, budget(240_000));
    assert.ok(result.count > 0, "No build tasks available");
    await until(() => /\[Start\] Build-Tasks werden geladen:/.test(log()), budget(240_000), "background Gradle warming");
    const asked = Date.now();
    await evaluate(ui, 'window.kiwi.project.tasks(' + JSON.stringify(fixture) + ')', true, budget(30_000));
    assert.ok(Date.now() - asked < budget(3000), "The warmed task cache was not reused");
    probe.close(); ui.close();
    return {shownMs, tasks:result.count};
  });
  console.log('Startup passed: window shown after ' + observed.shownMs + ' ms; ' + observed.tasks + ' Gradle tasks warmed in the background.');

} finally {
  await fs.rm(fixture, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(userData, { recursive: true, force: true }).catch(() => undefined);
}

/*
 * Said out loud, because otherwise this never returns.
 *
 * Unlike the other gates, this one attaches to the splash — a window the
 * application destroys while the connection to it is open. The socket gets no
 * close frame, Node keeps the loop alive waiting for one, and a gate that
 * hangs holds the whole release build behind it. Everything has been asserted
 * and cleaned up by here; there is nothing left to wait for.
 */
process.exit(0);

/** Runs Kiwi once against the shared user data, and cleans it up afterwards. */
async function withKiwi({ preload, splashMinimumMs }, body) {
  const port = await findAvailablePort();
  const startedAt = Date.now();
  const child = spawn(electronBinary, [
    ".",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
  ], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      KIWI_LOAD_DIST: "1",
      KIWI_SPLASH_MINIMUM_MS: String(splashMinimumMs),
      KIWI_STARTUP_PRELOAD: preload ? "1" : "0",
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const sockets = [];
  try {
    return await body({
      startedAt,
      log: () => output,
      targets: () => listTargets(port),
      waitForTarget: (match, timeout, label) => waitForTarget(port, match, timeout, label),
      connect: async (url) => {
        const cdp = await createCdp(url);
        sockets.push(cdp);
        return cdp;
      },
      evaluate,
      until,
    });
  } catch (error) {
    error.message = `${error.message}\nHauptprozess:\n${output.slice(-2_000)}`;
    throw error;
  } finally {
    try {
      const pages = await listTargets(port);
      const target = pages.find(page => page.type === "page" && page.url.includes("window=editor")) || pages.find(page => page.type === "page" && page.url.includes("window=welcome"));
      if (target) {
        const control = await createCdp(target.webSocketDebuggerUrl);
        await evaluate(control, "setTimeout(() => window.kiwi.app.close(), 50); true");
        control.close();
      }
    } catch { /* A failed launch may already be closed. */ }
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill(); resolve(); }, 15_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    for (const cdp of sockets) cdp.close();
    // Long enough for the workspace state to be flushed and the port released.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

async function evaluate(cdp, expression, awaitPromise = false, timeout = 30_000) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeout);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Auswertung fehlgeschlagen");
  return result.result.value;
}

async function until(read, timeout, label) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await Promise.resolve().then(read).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`${label} nicht rechtzeitig verfügbar.`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function waitForTarget(port, match, timeout, label) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const targets = await listTargets(port).catch(() => []);
    const found = targets.find((target) => target.type === "page" && match(target));
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`${label} nicht rechtzeitig verfügbar.`);
    // The splash lives for a few hundred milliseconds when it is not held, so
    // this polls fast enough to catch one.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function listTargets(port) {
  return new Promise((resolve, reject) => {
    // Without a timeout a request to a debug port that is not listening yet
    // waits for ever, and every deadline above it never comes due.
    const request = http.get({ host: "127.0.0.1", port, path: "/json/list", timeout: 2_000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk.toString(); });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Der Debug-Port antwortet nicht.")));
    request.on("error", reject);
  });
}

function createCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, timeout = 30_000) {
        const id = nextId += 1;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((ok, fail) => {
          // A window destroyed mid-call answers nothing at all.
          const timer = setTimeout(() => {
            pending.delete(id);
            fail(new Error(`${method} blieb ohne Antwort (${timeout} ms).`));
          }, timeout);
          pending.set(id, {
            ok: (value) => { clearTimeout(timer); ok(value); },
            fail: (error) => { clearTimeout(timer); fail(error); },
          });
        });
      },
      close() {
        try {
          socket.close();
        } catch {
          // Already gone with its window.
        }
      },
    }));
    socket.addEventListener("error", reject);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message));
      else waiter.ok(message.result);
    });
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
