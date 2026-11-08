import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Proves that a project keeps its tool-window arrangement.
 *
 * Placing Terminal on the right and Debug on the left is only worth doing if
 * it survives closing Kiwi, and it has to be remembered per project — a layout
 * chosen for one project must not follow the user into another. Both are
 * claims the README makes, and neither is reachable in a single session, so
 * this drives two real launches of the same installation.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const startupOnly = process.argv.includes("--startup-only");
const packagedExecutable = process.env.KIWI_SMOKE_EXECUTABLE;
const packaged = Boolean(packagedExecutable) || process.argv.includes("--packaged");
const require = createRequire(import.meta.url);
const electronBinary = require(path.join(projectRoot, "node_modules", "electron"));
const executable = packagedExecutable || (packaged
  ? path.join(projectRoot, "release", "win-unpacked", "Kiwi IDE.exe")
  : electronBinary);

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(read, timeout, label) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Zeitüberschreitung: ${label}${lastError ? ` (${lastError.message})` : ""}`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, timeout = 30_000) {
        const command = new Promise((resolveCommand, rejectCommand) => {
          const commandId = ++id;
          const timer = setTimeout(() => {
            if (pending.delete(commandId)) rejectCommand(new Error(`${method} hat nicht geantwortet.`));
          }, timeout);
          pending.set(commandId, {
            resolve: (value) => { clearTimeout(timer); resolveCommand(value); },
            reject: (error) => { clearTimeout(timer); rejectCommand(error); },
          });
          socket.send(JSON.stringify({ id: commandId, method, params }));
        });
        command.catch(() => undefined);
        return command;
      },
      close: () => socket.close(),
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const item = message.id ? pending.get(message.id) : null;
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const [commandId, item] of [...pending]) {
        pending.delete(commandId);
        item.reject(new Error("Das DevTools-Ziel wurde geschlossen."));
      }
    });
    socket.addEventListener("error", () => reject(new Error("DevTools-Verbindung fehlgeschlagen.")));
  });
}

/** Runs one Kiwi session against a fixed userData directory. */
async function withKiwi(userData, run) {
  const port = await findAvailablePort();
  const child = spawn(executable, [
    ...(packaged ? [] : [projectRoot]),
    ...(process.platform === "linux" && process.env.GITHUB_ACTIONS === "true" ? ["--no-sandbox"] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
  ], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    // No fifteen-second splash in a gate that never looks at it; the
    // preload behind it still runs.
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      KIWI_LOAD_DIST: "1",
      KIWI_SPLASH_MINIMUM_MS: "300",
    KIWI_STARTUP_PRELOAD: "0",
    },
  });
  let logs = "";
  child.stdout.on("data", (data) => { logs += data.toString(); });
  child.stderr.on("data", (data) => { logs += data.toString(); });
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const openWindow = async (kind, timeout = 40_000, excludedId = "") => {
    const target = await waitFor(
      async () => (await targets()).find((item) => item.type === "page"
        && item.url.includes(`window=${kind}`)
        && item.id !== excludedId),
      timeout,
      `${kind}-Fenster`,
    );
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await waitFor(
      () => cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && Boolean(window.kiwi)", returnByValue: true })
        .then((result) => result?.result?.value),
      30_000,
      `${kind}-Preload`,
    );
    return {
      cdp,
      id: target.id,
      evaluate: async (expression, awaitPromise = false, timeout = 30_000) => {
        const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeout);
        if (result?.exceptionDetails) {
          const details = result.exceptionDetails;
          const description = details.exception?.description || details.text || "Auswertung fehlgeschlagen";
          throw new Error(`${description}\nAusdruck: ${expression}`);
        }
        return result?.result?.value;
      },
    };
  };
  try {
    return await run({ openWindow });
  } catch (error) {
    throw new Error(`${error.message}\n--- Kiwi-Ausgabe ---\n${logs.slice(-1_500)}`);
  } finally {
    // Kiwi is asked to close rather than killed: Chromium writes localStorage
    // asynchronously, so a killed process can lose exactly the layout this
    // check is about — and a user closing the window is the real case anyway.
    try {
      const page = (await targets()).find((item) => item.type === "page" && item.url.includes("window="));
      if (page) {
        const cdp = await connect(page.webSocketDebuggerUrl);
        // Deferred so this command is answered before its window disappears.
        await cdp.send("Runtime.evaluate", {
          expression: "setTimeout(() => window.kiwi.app.close(), 50); true",
          returnByValue: true,
        });
        cdp.close();
      }
    } catch {
      // A window that is already gone needs no closing.
    }
    const closed = await waitForProcessExit(child, 20_000);
    if (!closed) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    // The next launch must find a settled userData directory, not one that is
    // still being written while it starts reading.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

/** Avoids keeping this smoke test alive for the full timeout after Electron exits. */
function waitForProcessExit(processHandle, timeout) {
  if (processHandle.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      processHandle.removeListener("exit", onExit);
      resolve(false);
    }, timeout);
    processHandle.once("exit", onExit);
    if (processHandle.exitCode !== null) {
      processHandle.removeListener("exit", onExit);
      clearTimeout(timer);
      resolve(true);
    }
  });
}

const workspace = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "kiwi-layout-"));
try {
  const alpha = path.join(workspace, "alpha");
  const beta = path.join(workspace, "beta");
  for (const [root, name] of [[alpha, "Alpha"], [beta, "Beta"]]) {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", `${name}.java`),
      `public class ${name} {\n    public static void main(String[] args) {\n        System.out.println("${name}");\n    }\n}\n`,
    );
  }
  const userData = path.join(workspace, "userdata");

  const arrangement = (root) => `(async () => {
    await window.kiwi.workspace.add([${JSON.stringify(root)}]);
    await window.kiwi.app.openEditor(${JSON.stringify(root)});
    return true;
  })()`;

  if (startupOnly) {
    await verifyStartup(userData, alpha, arrangement);
  } else {
    await verifyLayout(userData, alpha, beta, arrangement);
  }
} finally {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
}

async function verifyStartup(userData, project, arrangement) {
  await withKiwi(userData, async ({ openWindow }) => {
    const welcome = await openWindow("welcome");
    await welcome.evaluate(arrangement(project), true);
    welcome.cdp.close();
    const editor = await openWindow("editor");
    const root = JSON.stringify(project);
    const command = JSON.stringify(process.platform === "win32"
      ? "Write-Output ('KIWI_' + 'TERMINAL_OK')"
      : "printf '%s%s\\n' 'KIWI_' 'TERMINAL_OK'");
    try {
      const health = await editor.evaluate("window.kiwi.app.health()", true);
      assert.equal(health.build.platform, process.platform);
      assert.equal(health.build.arch, process.arch);
      assert.equal(health.build.version, require("../package.json").version);
      const session = await editor.evaluate(`window.kiwi.terminal.start(${root}, "startup-smoke")`, true);
      assert.equal(session.started, true);
      await editor.evaluate(`window.kiwi.terminal.execute({ root: ${root}, sessionId: "startup-smoke", command: ${command} })`, true);
      await waitFor(
        () => editor.evaluate(`window.kiwi.terminal.snapshot(${root}, "startup-smoke")
          .then(session => session.output.includes("KIWI_TERMINAL_OK"))`, true),
        15_000,
        "terminal command",
      );
      // A cold JDT LS may spend up to a minute initializing before it can answer.
      const language = await editor.evaluate(`window.kiwi.language.start(${root})`, true, 120_000);
      assert.equal(language.available, true, language.reason);
    } finally {
      editor.cdp.close();
    }
  });
  console.log("Kiwi startup, project opening, terminal and JDT LS passed.");
}

async function verifyLayout(userData, alpha, beta, arrangement) {
  // First session: arrange the tool windows of project Alpha.
  const arranged = await withKiwi(userData, async ({ openWindow }) => {
    const welcome = await openWindow("welcome");
    await welcome.evaluate(arrangement(alpha), true);
    welcome.cdp.close();
    const editor = await openWindow("editor");
    await waitFor(
      () => editor.evaluate("Boolean(document.querySelector('.bottom-panel'))"),
      40_000,
      "Werkzeugfenster im Editor",
    );
    const dock = async (label, edge) => {
      await editor.evaluate(`(() => {
        const tab = [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes(${JSON.stringify(label)}));
        tab?.click();
        return Boolean(tab);
      })()`);
      /*
       * Wait for the click to have taken effect before reaching for the picker.
       *
       * Clicking a tab is a state change, and `.panel-focused` moves a render
       * later. Reading the picker straight away found the one belonging to
       * whichever panel was focused before — and the fallback to "any picker
       * on the page" made that silent. About one run in three docked PROBLEMS
       * where TERMINAL was asked for, on every version tried.
       */
      await waitFor(
        () => editor.evaluate(`(() => {
          const active = document.querySelector('.bottom-panel.panel-focused .panel-tabs button.active');
          return Boolean(active && active.textContent?.includes(${JSON.stringify(label)}));
        })()`),
        10_000,
        `${label} ist der aktive Reiter`,
      );
      await editor.evaluate(`(() => {
        // No fallback: a missing picker is a failure worth seeing, not a
        // reason to work on some other panel.
        const picker = document.querySelector('.bottom-panel.panel-focused .panel-dock-picker select');
        if (!picker) throw new Error('Kein Andock-Auswahlfeld im fokussierten Werkzeugfenster');
        picker.value = ${JSON.stringify(edge)};
        picker.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await waitFor(
        () => editor.evaluate(`document.querySelector('.bottom-panel.panel-dock-${edge}') !== null`),
        10_000,
        `${label} an Kante ${edge}`,
      );
    };
    await dock("TERMINAL", "bottom-right");
    await dock("DEBUG", "bottom-left");
    // A window of its own carries a position and a size instead of an edge,
    // and both have to come back with it.
    await dock("TODO", "floating");
    // A left-docked output is now a sibling tab of the Explorer and therefore
    // shares the sidebar width. Widen that common host with the keyboard; a
    // restart has to bring back this width rather than the default.
    await editor.evaluate(`(() => {
      const resizer = document.querySelector('.sidebar > .sidebar-resizer');
      if (!resizer) throw new Error('Der gemeinsame Sidebar-Resizer fehlt.');
      resizer.focus();
      for (let step = 0; step < 6; step += 1) {
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      }
      return true;
    })()`);
    await editor.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
    const state = JSON.parse(await editor.evaluate(`JSON.stringify({
      docks: [...document.querySelectorAll('.bottom-panel')].map(item => [item.dataset.panelDock, item.dataset.panelView]).sort(),
      leftHeight: Math.round(document.querySelector('.bottom-panel.panel-dock-bottom-left').getBoundingClientRect().height),
      floating: (() => {
        const box = document.querySelector('.bottom-panel.panel-dock-floating').getBoundingClientRect();
        return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width) };
      })(),
    })`));
    // The layout is written debounced; give that write its moment before the
    // process is killed, exactly as a real quit would.
    await editor.evaluate("new Promise(resolve => setTimeout(resolve, 800))", true);
    editor.cdp.close();
    return state;
  });
  assert.deepEqual(arranged.docks, [
    ["bottom", "problems"],
    ["bottom-left", "debug"],
    ["bottom-right", "terminal"],
    ["floating", "todos"],
  ], "Die vier Werkzeugfenster wurden nicht wie angeordnet dargestellt.");

  // Second session: the same project has to come back arranged, and a second
  // project must not inherit that arrangement.
  const restored = await withKiwi(userData, async ({ openWindow }) => {
    const editor = await openWindow("editor");
    await waitFor(
      () => editor.evaluate("Boolean(document.querySelector('.bottom-panel'))"),
      40_000,
      "Werkzeugfenster nach Neustart",
    );
    // A corner comes back visible at the foot of its column; there is no tab to
    // select first, so its size can be measured straight away.
    await waitFor(
      () => editor.evaluate(`Boolean(document.querySelector('.sidebar > .bottom-panel.panel-dock-bottom-left')
        && document.querySelector('.right-tool-window > .bottom-panel.panel-dock-bottom-right'))`),
      20_000,
      "wiederhergestellte Fuesse in ihren Spalten",
    );
    const alphaState = JSON.parse(await waitFor(
      () => editor.evaluate(`(() => {
        const windows = [...document.querySelectorAll('.bottom-panel')];
        return windows.length >= 4
          ? JSON.stringify(windows.map(item => [item.dataset.panelDock, item.dataset.panelView]).sort())
          : "";
      })()`),
      20_000,
      "wiederhergestellte Kanten",
    ));
    const restoredFloating = JSON.parse(await editor.evaluate(`JSON.stringify((() => {
      const box = document.querySelector('.bottom-panel.panel-dock-floating').getBoundingClientRect();
      return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width) };
    })())`));
    const restoredLeftHeight = Number(await editor.evaluate(
      "Math.round(document.querySelector('.bottom-panel.panel-dock-bottom-left').getBoundingClientRect().height)",
    ));

    // Closing one window individually is part of the arrangement too.
    await editor.evaluate(`document.querySelector('.bottom-panel.panel-dock-bottom .panel-actions button[title="Werkzeugfenster schließen"]')?.click()`);
    await waitFor(
      () => editor.evaluate("!document.querySelector('.bottom-panel.panel-dock-bottom')"),
      10_000,
      "unteres Werkzeugfenster geschlossen",
    );
    await editor.evaluate("new Promise(resolve => setTimeout(resolve, 800))", true);
    // Switching projects the way the user does: back to the Hub, open the
    // other project from there. Opening it in place would only change the
    // active project in the main process.
    const previousEditorId = editor.id;
    await editor.evaluate("window.kiwi.app.showWelcome()");
    editor.cdp.close();
    const hub = await openWindow("welcome");
    await hub.evaluate(arrangement(beta), true);
    hub.cdp.close();
    const betaEditor = await openWindow("editor", 40_000, previousEditorId);
    await waitFor(
      () => betaEditor.evaluate("Boolean(document.querySelector('.bottom-panel'))"),
      40_000,
      "Werkzeugfenster im zweiten Projekt",
    );
    await waitFor(
      () => betaEditor.evaluate(`window.kiwi.workspace.list().then(state => state.activeRoot === ${JSON.stringify(beta)})`, true),
      30_000,
      "zweites Projekt geöffnet",
    );
    const betaState = JSON.parse(await betaEditor.evaluate(`JSON.stringify(
      [...document.querySelectorAll('.bottom-panel')].map(item => [item.dataset.panelDock, item.dataset.panelView]).sort()
    )`));
    betaEditor.cdp.close();
    return { alphaState, betaState, restoredLeftHeight, restoredFloating };
  });

  assert.deepEqual(restored.alphaState, [
    ["bottom", "problems"],
    ["bottom-left", "debug"],
    ["bottom-right", "terminal"],
    ["floating", "todos"],
  ], "Das Projekt hat seine Werkzeugfenster nach dem Neustart nicht wiederhergestellt.");
  assert.deepEqual(restored.restoredFloating, arranged.floating,
    `Das eigene Fenster kam an anderer Stelle zurück: ${JSON.stringify({ arranged: arranged.floating, restored: restored.restoredFloating })}`);
  // Which tab a fresh project shows is up to the workbench; that it starts
  // with a single bottom window instead of inheriting the other project's
  // edges is the point.
  assert.deepEqual(restored.betaState.map(([edge]) => edge), ["bottom"],
    `Ein anderes Projekt darf die Anordnung nicht erben: ${JSON.stringify(restored.betaState)}`);

  assert.ok(
    Math.abs(restored.restoredLeftHeight - arranged.leftHeight) <= 2,
    `Die Höhe des linken Werkzeugfensters kam nicht zurück: ${restored.restoredLeftHeight} statt ${arranged.leftHeight}.`,
  );

  // Third session: the window that was closed individually stays closed, and
  // the other two are still where they belong.
  const afterClosing = await withKiwi(userData, async ({ openWindow }) => {
    // The previous session left the other project active, so this one returns
    // to the arranged project the way the user would.
    const betaEditor = await openWindow("editor");
    const previousEditorId = betaEditor.id;
    await betaEditor.evaluate("window.kiwi.app.showWelcome()");
    betaEditor.cdp.close();
    const hub = await openWindow("welcome");
    await hub.evaluate(`window.kiwi.app.openEditor(${JSON.stringify(alpha)})`, true);
    hub.cdp.close();
    const editor = await openWindow("editor", 40_000, previousEditorId);
    await waitFor(
      () => editor.evaluate("Boolean(document.querySelector('.bottom-panel'))"),
      40_000,
      "Werkzeugfenster nach dem Schließen",
    );
    await waitFor(
      () => editor.evaluate(`Boolean(document.querySelector('.sidebar > .bottom-panel.panel-dock-bottom-left')
        && document.querySelector('.right-tool-window > .bottom-panel.panel-dock-bottom-right'))`),
      20_000,
      "Fuesse in ihren Spalten nach dem Schließen",
    );
    await editor.evaluate("new Promise(resolve => setTimeout(resolve, 1500))", true);
    const state = JSON.parse(await editor.evaluate(`JSON.stringify(
      [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock).sort()
    )`));
    // What came back, and what might have opened it. A dock reappearing says
    // only that it is there; which view it shows, and whether the workbench was
    // announcing something at the time, is what separates a restore that read
    // the wrong state from a panel some notice pushed open again.
    const why = await editor.evaluate(`JSON.stringify({
      docks: [...document.querySelectorAll('.bottom-panel')].map(item => ({
        dock: item.dataset.panelDock,
        view: item.querySelector('.panel-tabs button.active')?.textContent || '',
      })),
      toasts: [...document.querySelectorAll('.toast')].map(item => (item.textContent || '').slice(0, 60)),
      stored: Object.keys(localStorage)
        .filter(key => key.startsWith('kiwi.panel.layout'))
        .map(key => [key.slice(-24), localStorage.getItem(key)?.slice(0, 120)]),
    })`);
    editor.cdp.close();
    return { state, why };
  });
  assert.deepEqual(afterClosing.state, ["bottom-left", "bottom-right", "floating"],
    `Ein geschlossenes Werkzeugfenster kam ungefragt zurück: ${JSON.stringify(afterClosing.state)}`
    + ` Diagnose: ${afterClosing.why}`);

  console.log("Layout persistence passed: edges, a floating window, sizes and a closed window return per project.");
}
