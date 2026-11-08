import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Proves that the splash holds for its minimum and spends the time loading.
 *
 * The other gates run with the preload switched off: its steps spawn a
 * `java -version` per JDK candidate, a Gradle configuration phase and the
 * language server, and doing that while a smoke run drives the workbench made
 * those runs fail at random. This one exists so the preload is still covered
 * somewhere — on its own, where its processes compete with nothing.
 *
 * Two launches. The first opens the project so there is an active workspace to
 * find; the second is the one under test, because a preload with no project
 * has almost nothing to do.
 */
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

  // Second launch: the one under test.
  // Above what the second launch takes on its own — about eleven seconds
  // with a project to open — so that anything past it is the minimum doing
  // its work and not the window simply being slow.
  const minimum = 20_000;
  const observed = await withKiwi(
    { preload: true, splashMinimumMs: minimum },
    async ({ waitForTarget, connect, evaluate, until, startedAt, log }) => {
      const splash = await waitForTarget((target) => target.url.startsWith("data:text/html"), budget(25_000), "Splash");
      const seenAt = Date.now();
      const cdp = await connect(splash.webSocketDebuggerUrl);
      await cdp.send("Runtime.enable", {}, budget(8_000));

      // Watch it until it goes, collecting the steps it reports.
      const steps = [];
      for (;;) {
        const reading = await evaluate(cdp, `JSON.stringify({
          schritt: document.getElementById("schritt")?.textContent || "",
          balken: document.getElementById("balken")?.style.width || "",
        })`, false, budget(5_000)).catch(() => null);
        if (!reading) break;
        const parsed = JSON.parse(reading);
        if (parsed.schritt && steps.at(-1)?.schritt !== parsed.schritt) steps.push(parsed);
        if (Date.now() - seenAt > budget(180_000)) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const visibleMs = Date.now() - seenAt;

      const editor = await waitForTarget((target) => target.url.includes("window=editor"), budget(40_000), "Editorfenster");
      const ui = await connect(editor.webSocketDebuggerUrl);
      await ui.send("Runtime.enable");
      await until(() => evaluate(ui, "document.readyState === 'complete' && Boolean(window.kiwi)"), budget(30_000), "Preload-Brücke");

      // The point of the whole exercise: the task list is already read, so
      // asking for it costs nothing.
      const askedAt = Date.now();
      const tasks = JSON.parse(await evaluate(ui, `window.kiwi.project.tasks(${JSON.stringify(fixture)})
        .then((result) => JSON.stringify({ anzahl: result.tasks.length, grund: result.reason || "" }))`, true, budget(240_000)));
      const answerMs = Date.now() - askedAt;
      ui.close();
      cdp.close();
      return { visibleMs, steps, tasks, answerMs, sinceLaunch: seenAt - startedAt, log: log() };
    },
  );

  for (const step of observed.steps) console.log(`  ... ${step.schritt} (${step.balken || "0"})`);
  console.log(`  ... Splash ${observed.visibleMs} ms sichtbar, Mindestzeit ${minimum} ms`);
  console.log(`  ... Task-Liste über IPC in ${observed.answerMs} ms (${observed.tasks.anzahl} Tasks)`);

  assert.ok(
    observed.visibleMs >= minimum - 500,
    `Der Splash war nur ${observed.visibleMs} ms zu sehen, verlangt sind ${minimum} ms.`,
  );
  // Every step it reported, and that it got to the end of them.
  assert.ok(
    observed.steps.some((step) => /Build-Tasks/.test(step.schritt)),
    `Der Splash hat die Build-Tasks nicht gemeldet: ${JSON.stringify(observed.steps.map((step) => step.schritt))}`,
  );
  // Which steps actually ran is read from the main process rather than from
  // the splash: a step that takes a few milliseconds is gone from the caption
  // before any polling loop can see it, and the last one is followed within
  // the same tick by the window being destroyed.
  const ran = [...observed.log.matchAll(/\[Start\] (.+?): (\d+) ms/g)].map((match) => match[1]);
  for (const line of ran) console.log(`  ... gelaufen: ${line}`);
  for (const expected of [
    "Java-Installationen werden gesucht",
    "Projekt wird gelesen",
    "Module werden bestimmt",
    "Build-Tasks werden geladen",
    "Tests werden gesucht",
    "Sprachserver wird gestartet",
    "Symbole werden indiziert",
  ]) {
    assert.ok(ran.includes(expected), `Der Vorladeschritt "${expected}" ist nicht gelaufen: ${JSON.stringify(ran)}`);
  }
  // A step that threw says so in the main process output, and a preload whose
  // steps all fail would still report "Bereit".
  assert.ok(
    !/\[Start\].*fehlgeschlagen/.test(observed.log),
    `Ein Vorladeschritt ist fehlgeschlagen:\n${observed.log.split("\n").filter((line) => line.includes("[Start]")).join("\n")}`,
  );
  assert.ok(observed.tasks.anzahl > 0, "Nach dem Vorladen muss die Task-Liste gefüllt sein.");
  // That the answer is stored rather than asked of Gradle again. It does not
  // by itself say the preload stored it — the workbench asks for the tasks as
  // it opens, so this passes with the preload switched off too. The steps
  // above are what proves the preload ran; this proves the cache works.
  assert.ok(
    observed.answerMs < budget(1_500),
    `Die Task-Liste kam erst nach ${observed.answerMs} ms — sie wurde nicht aus dem Zwischenspeicher beantwortet.`,
  );

  console.log("Startup preload passed: the splash holds, reports its steps and leaves the task list ready.");
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
    for (const cdp of sockets) cdp.close();
    child.kill();
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
    if (await read().catch(() => false)) return;
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
