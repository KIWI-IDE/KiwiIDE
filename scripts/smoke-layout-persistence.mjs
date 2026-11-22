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
const themeOnly = process.argv.includes("--theme-only");
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
      KIWI_SPLASH_MINIMUM_MS: themeOnly ? "3000" : "300",
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
        && (kind === "splash" ? item.url.startsWith("data:text/html") : item.url.includes(`window=${kind}`))
        && item.id !== excludedId),
      timeout,
      `${kind}-Fenster`,
    );
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await waitFor(
      () => cdp.send("Runtime.evaluate", { expression: `document.readyState === 'complete' && ${kind === "splash" ? "true" : "Boolean(window.kiwi)"}`, returnByValue: true })
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

  if (themeOnly) {
    await verifyThemes(userData, alpha, arrangement);
  } else if (startupOnly) {
    await verifyStartup(userData, alpha, arrangement);
  } else {
    await verifyLayout(userData, alpha, beta, arrangement);
  }
} finally {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
}

async function verifyThemes(userData, project, arrangement) {
  const verifySplash = async (openWindow, theme, accent, scheme) => {
    const splash = await openWindow("splash");
    try {
      const actual = await splash.evaluate(`({
        theme: document.documentElement.dataset.theme,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        scheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
      })`);
      assert.equal(actual.theme, theme);
      assert.equal(actual.accent, accent);
      assert.equal(actual.scheme, scheme);
      assert.notEqual(actual.background, 'rgba(0, 0, 0, 0)');
    } finally { splash.cdp.close(); }
  };
  await withKiwi(userData, async ({ openWindow }) => {
    await verifySplash(openWindow, "kiwi-nord", "#88c0d0", "dark");
    const welcome = await openWindow("welcome");
    const initial = await welcome.evaluate("window.kiwi.settings.get()", true);
    assert.equal(initial.theme, "kiwi-nord");
    assert.equal(initial.accentColor, "#88c0d0");
    await welcome.evaluate(arrangement(project), true);
    welcome.cdp.close();
    const editor = await openWindow("editor");
    const windows = [editor];
    try {
      const root = JSON.stringify(project);
      for (const [kind, command] of [
        ["settings", `window.kiwi.app.openSettings(${root})`],
        ["structure", `window.kiwi.app.openStructure(${root})`],
        ["wizard", `window.kiwi.app.openNewProject()`],
        ["terminal", `window.kiwi.terminal.openWindow(${root}, "theme-smoke")`],
        ["panel", `window.kiwi.panel.openWindow(${root})`],
      ]) {
        await editor.evaluate(command, true);
        windows.push(await openWindow(kind));
      }
      const readAppearance = `(() => {
        const root = document.documentElement;
        const style = getComputedStyle(root);
        const title = document.querySelector('.titlebar');
        const flood = document.querySelector('.kiwi-logo-accent');
        const button = document.createElement('button');
        button.className = 'primary-button'; document.body.append(button);
        const primary = getComputedStyle(button).backgroundColor; button.remove();
        return {
          theme: root.dataset.theme,
          accent: style.getPropertyValue('--accent').trim(),
          roundness: style.getPropertyValue('--roundness').trim(),
          scheme: style.colorScheme,
          background: getComputedStyle(document.body).backgroundColor,
          line: title && getComputedStyle(title, '::after').backgroundImage,
          band: title && getComputedStyle(title, '::before').backgroundImage,
          logo: flood && getComputedStyle(flood).floodColor,
          primary,
        };
      })()`;
      for (const [theme, accent, scheme] of [
        ["kiwi-nord", "#3388ee", "dark"],
        ["kiwi-light", "#dd2266", "light"],
        ["kiwi-nord", "#88c0d0", "dark"],
      ]) {
        await editor.evaluate(`window.kiwi.settings.update(${JSON.stringify({ theme, uiRoundness: 140, themeTint: 8 })})`, true);
        await windows[1].evaluate(`(() => {
          [...document.querySelectorAll('.settings-categories button')].find(button => button.textContent.trim() === 'Darstellung')?.click();
          return true;
        })()`);
        await waitFor(() => windows[1].evaluate("[...document.querySelectorAll('.setting-row')].some(row => row.querySelector('strong')?.textContent === 'Akzentfarbe')"), 10_000, "accent setting");
        await windows[1].evaluate(`(() => {
          const row = [...document.querySelectorAll('.setting-row')].find(row => row.querySelector('strong')?.textContent === 'Akzentfarbe');
          const input = row.querySelector('input[type=color]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(accent)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          row.scrollIntoView({ block: 'center' });
          return true;
        })()`);
        await waitFor(() => windows[1].evaluate("Boolean(document.querySelector('.settings-apply-bar .primary-button:not(:disabled)'))"), 10_000, "pending accent change");
        await windows[1].evaluate("document.querySelector('.settings-apply-bar .primary-button').click(); true");
        await waitFor(() => editor.evaluate(`window.kiwi.settings.get().then(settings => settings.accentColor === ${JSON.stringify(accent)})`, true), 10_000, "saved accent color");
        const expected = await waitFor(async () => {
          const value = await editor.evaluate(readAppearance);
          return value.theme === theme && value.accent === accent && value.logo && value.roundness === '1.4' ? value : null;
        }, 15_000, "editor appearance after saving");
        for (const [index, page] of windows.entries()) {
          const actual = await waitFor(async () => {
            const value = await page.evaluate(readAppearance);
            return value.theme === theme && value.accent === accent && value.logo && value.roundness === '1.4' ? value : null;
          }, 15_000, `theme in window ${index}`);
          assert.deepEqual(actual, expected, `Window ${index} disagrees with the editor`);
          assert.equal(actual.scheme, scheme);
          assert.equal(actual.logo, `rgb(${[1, 3, 5].map(offset => parseInt(accent.slice(offset, offset + 2), 16)).join(', ')})`);
          assert.notEqual(actual.line, 'none');
        }
        if (process.env.KIWI_THEME_SCREENSHOT_DIR && theme === "kiwi-nord" && accent === "#3388ee") {
          await fs.mkdir(process.env.KIWI_THEME_SCREENSHOT_DIR, { recursive: true });
          for (const [name, page] of [["editor", editor], ["settings", windows[1]]]) {
            const screenshot = await page.cdp.send("Page.captureScreenshot", { format: "png" });
            await fs.writeFile(path.join(process.env.KIWI_THEME_SCREENSHOT_DIR, `${name}.png`), Buffer.from(screenshot.data, "base64"));
          }
        }
      }
      await editor.evaluate("window.kiwi.settings.update({theme: 'kiwi-light', accentColor: '#dd2266'})", true);
    } finally {
      // Close auxiliary windows before closing the workbench.
      for (const page of windows.slice(1)) {
        await page.evaluate("setTimeout(() => window.kiwi.app.close(), 50); true").catch(() => undefined);
        page.cdp.close();
      }
      editor.cdp.close();
    }
  });
  await withKiwi(userData, async ({ openWindow }) => {
    await verifySplash(openWindow, "kiwi-light", "#dd2266", "light");
  });
  console.log("Kiwi Nord default, saved startup appearance and live theme/accent/logo synchronization passed in all six window types.");
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
