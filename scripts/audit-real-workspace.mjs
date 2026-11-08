import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
// Read from package.json so a release bump needs no edit here.
const appVersion = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;
const executable = path.resolve(
  process.env.KIWI_AUDIT_EXE || path.join(root, "release", `Kiwi-IDE-${appVersion}-portable.exe`),
);
const userData = path.resolve(
  process.env.KIWI_AUDIT_PROFILE || path.join(process.env.APPDATA || os.homedir(), "kiwi-ide"),
);
let configuredProject = process.env.KIWI_AUDIT_PROJECT
  ? path.resolve(process.env.KIWI_AUDIT_PROJECT)
  : null;
const port = Number(process.env.KIWI_AUDIT_PORT || 9359);
const timeoutScale = Number(process.env.KIWI_AUDIT_TIMEOUT_SCALE || 1);
const unpackaged = process.env.KIWI_AUDIT_UNPACKAGED === "1";

/**
 * How long one DevTools command may take before the audit gives up on it.
 *
 * Every wait in this file is bounded except the command underneath it, and a
 * command that never answers took the whole run with it: the audit sat for
 * half an hour on a window it was trying to close, with no output and no
 * deadline, because the loop around it never got back to look at the clock.
 * A renderer call that awaits a promise — starting the language server, asking
 * it to stop — is the slowest thing here, so the bound is generous.
 */
const COMMAND_TIMEOUT_MS = 120_000;

await fs.access(executable);
await fs.access(userData);
if (!configuredProject) {
  const persistedWorkspace = JSON.parse(
    await fs.readFile(path.join(userData, "workspace-state.json"), "utf8"),
  );
  if (persistedWorkspace.activeRoot) configuredProject = path.resolve(persistedWorkspace.activeRoot);
}
const jdtLog = configuredProject
  ? path.join(
    userData,
    "jdtls-workspaces",
    crypto.createHash("sha256").update(configuredProject).digest("hex").slice(0, 20),
    ".metadata",
    ".log",
  )
  : "";
const initialJdtLogSize = jdtLog
  ? await fs.stat(jdtLog).then((stat) => stat.size).catch(() => 0)
  : 0;

const child = spawn(executable, [
  ...(unpackaged ? [root] : []),
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`,
], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    // Measuring how long a real workspace takes to open should not be
    // measuring how long the splash is held.
    KIWI_SPLASH_MINIMUM_MS: "300",
    ...(unpackaged ? { KIWI_LOAD_DIST: "1" } : {}),
  },
});

let processOutput = "";
child.stdout.on("data", (data) => { processOutput += data.toString(); });
child.stderr.on("data", (data) => { processOutput += data.toString(); });

const rendererFailures = [];
const rendererWarnings = [];
let cdp;

try {
  const target = await waitForTarget("editor", seconds(40));
  cdp = await createCdp(target.webSocketDebuggerUrl, (message) => {
    if (message.method === "Runtime.exceptionThrown") {
      rendererFailures.push(message.params?.exceptionDetails?.exception?.description
        || message.params?.exceptionDetails?.text
        || "Unbekannte Renderer-Ausnahme");
    }
    if (message.method === "Inspector.targetCrashed") rendererFailures.push("Renderer-Prozess abgestürzt");
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry;
      if (entry?.level === "error") rendererFailures.push(entry.text);
      else if (entry?.level === "warning") rendererWarnings.push(entry.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      const text = (message.params.args || []).map((argument) => argument.value || argument.description || "").join(" ");
      if (text) rendererFailures.push(text);
    }
  });
  await Promise.all([
    cdp.send("Runtime.enable"),
    cdp.send("Log.enable"),
  ]);

  await waitFor(
    () => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"),
    seconds(20),
    "Preload-API",
  );
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active'))"),
    seconds(45),
    "aktives Projekt im Explorer",
  );
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.workspace-loading-overlay')"),
    seconds(90),
    "abgeschlossener Workspace-Start",
  );

  const workspace = await evaluate(cdp, "window.kiwi.workspace.list()", true);
  const projectRoot = configuredProject || workspace.activeRoot;
  assert.ok(projectRoot, "Im echten Profil ist kein aktives Projekt gespeichert.");
  assert.equal(
    path.resolve(workspace.activeRoot).toLocaleLowerCase(),
    path.resolve(projectRoot).toLocaleLowerCase(),
    `Aktives Projekt weicht ab: ${workspace.activeRoot}`,
  );
  await fs.access(projectRoot);

  const shellProbe = await evaluate(cdp, `({
    projectTrees: document.querySelectorAll('.workspace-project-tree').length,
    projectName: document.querySelector('.workspace-project-tree.active .project-heading span')?.textContent || '',
    hasEditor: Boolean(document.querySelector('.main-area')),
    embeddedHub: Boolean(document.querySelector('.editor-container .project-hub')),
    overlay: Boolean(document.querySelector('.workspace-loading-overlay')),
    status: document.querySelector('.statusbar')?.textContent || '',
    viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  })`);
  assert.equal(shellProbe.projectTrees, 1, "Der Explorer muss genau ein aktives Projekt zeigen.");
  assert.equal(shellProbe.hasEditor, true);
  assert.equal(shellProbe.embeddedHub, false);
  assert.equal(shellProbe.overlay, false);
  assert.equal(shellProbe.viewportOverflow, false);

  const escapedRoot = JSON.stringify(projectRoot);
  const restoredSessionProbe = await evaluate(cdp, `(async () => {
    const raw = localStorage.getItem('kiwi.session.v2:' + ${escapedRoot});
    const session = raw ? JSON.parse(raw) : null;
    const files = await Promise.all((session?.files || []).map(async file => {
      const disk = await window.kiwi.file.read(file.path).catch(() => null);
      return {
        path: file.path,
        storedLength: typeof file.content === 'string' ? file.content.length : null,
        diskLength: typeof disk === 'string' ? disk.length : null,
        dirty: typeof file.content === 'string' && typeof disk === 'string' && file.content !== disk
      };
    }));
    return { activePath: session?.activePath || null, files };
  })()`, true);
  const serviceProbe = await evaluate(cdp, `Promise.allSettled([
    window.kiwi.workspace.tree(${escapedRoot}),
    window.kiwi.project.detect(${escapedRoot}),
    window.kiwi.modules.list(${escapedRoot}),
    window.kiwi.project.tasks(${escapedRoot}),
    window.kiwi.project.dependencies(${escapedRoot}),
    window.kiwi.project.dependencyTree(${escapedRoot}),
    window.kiwi.tests.discover(${escapedRoot}),
    window.kiwi.runConfigurations.list(${escapedRoot}),
    window.kiwi.workflow.get(${escapedRoot}),
    window.kiwi.git.status(${escapedRoot})
  ]).then(results => results.map(result => result.status === 'fulfilled'
    ? { status: result.status, value: result.value }
    : { status: result.status, reason: result.reason?.message || String(result.reason) }))`, true);

  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(
      serviceProbe[index].status,
      "fulfilled",
      `Read-only Service ${index} ist fehlgeschlagen: ${serviceProbe[index].reason || ""}`,
    );
  }
  assert.ok(Array.isArray(serviceProbe[0].value) && serviceProbe[0].value.length > 0, "Explorer-Baum ist leer.");
  assert.ok(serviceProbe[1].value?.type, "Projekttyp wurde nicht erkannt.");
  assert.ok(Array.isArray(serviceProbe[2].value) && serviceProbe[2].value.length > 0, "Kein Modul wurde erkannt.");
  assert.ok(
    Array.isArray(serviceProbe[3].value?.tasks) && serviceProbe[3].value.tasks.length > 0,
    `Build-Tasks fehlen: ${JSON.stringify(serviceProbe[3].value)}`,
  );

  const javaFiles = await findJavaFiles(projectRoot);
  assert.ok(javaFiles.length > 0, "Das echte Projekt enthält keine Java-Datei.");
  const bootstrap = javaFiles.find((file) => path.basename(file).toLocaleLowerCase() === "bootstrap.java")
    || javaFiles[0];
  const source = await fs.readFile(bootstrap, "utf8");
  const sourceLines = source.split(/\r?\n/);

  const languageStart = await evaluate(cdp, `window.kiwi.language.start(${escapedRoot})`, true);
  assert.equal(languageStart.available, true, languageStart.reason || "JDT LS ist nicht verfügbar.");
  assert.ok(Number(languageStart.jdk?.major || 0) >= 21, "JDT LS läuft nicht mit Java 21 oder neuer.");

  const uri = pathToFileURL(bootstrap).toString();
  await evaluate(cdp, `window.kiwi.language.open({
    root: ${escapedRoot},
    file: ${JSON.stringify(bootstrap)},
    languageId: "java",
    text: ${JSON.stringify(source)}
  })`, true);

  const memberLine = sourceLines.findIndex((line) => line.includes("Bukkit."));
  if (memberLine >= 0) {
    const memberCharacter = sourceLines[memberLine].indexOf("Bukkit.") + "Bukkit.".length;
    const completion = await evaluate(cdp, `window.kiwi.language.request(
      ${escapedRoot},
      "textDocument/completion",
      {
        textDocument: { uri: ${JSON.stringify(uri)} },
        position: { line: ${memberLine}, character: ${memberCharacter} },
        context: { triggerKind: 2, triggerCharacter: "." }
      }
    ).then(result => {
      const items = Array.isArray(result) ? result : result?.items || [];
      return { count: items.length, labels: items.map(item => String(item.label)) };
    })`, true);
    assert.ok(completion.count > 10, `Dependency-Completion lieferte nur ${completion.count} Einträge.`);
    assert.ok(
      completion.labels.some((label) => /getPluginManager/i.test(label)),
      `Bukkit.getPluginManager fehlt in der Dependency-Completion: ${completion.labels.slice(0, 25).join(", ")}`,
    );
  }

  const typeLine = sourceLines.findIndex((line) => line.includes("EventBuss"));
  if (typeLine >= 0) {
    const typeCharacter = sourceLines[typeLine].indexOf("EventBuss") + 2;
    const [definition, hover] = await evaluate(cdp, `Promise.all([
      window.kiwi.language.request(${escapedRoot}, "textDocument/definition", {
        textDocument: { uri: ${JSON.stringify(uri)} },
        position: { line: ${typeLine}, character: ${typeCharacter} }
      }),
      window.kiwi.language.request(${escapedRoot}, "textDocument/hover", {
        textDocument: { uri: ${JSON.stringify(uri)} },
        position: { line: ${typeLine}, character: ${typeCharacter} }
      })
    ])`, true);
    assert.ok(definition, "Definition-Navigation für einen Projekttyp liefert kein Ziel.");
    assert.ok(hover, "Hover-Dokumentation für einen Projekttyp ist leer.");
  }

  const symbols = await evaluate(cdp, `window.kiwi.language.request(
    ${escapedRoot},
    "textDocument/documentSymbol",
    { textDocument: { uri: ${JSON.stringify(uri)} } }
  )`, true);
  assert.ok(Array.isArray(symbols) && symbols.length > 0, "Structure/Outline enthält keine Java-Symbole.");

  await exerciseActivity(cdp, "Modules", "MODULES");
  await exerciseActivity(cdp, "Suche", "SUCHE");
  await exerciseActivity(cdp, "Structure", "STRUCTURE");
  await exerciseActivity(cdp, "Source Control", "SOURCE CONTROL");
  await exerciseActivity(cdp, "Tests", "TESTS");
  await exerciseActivity(cdp, "Run and Debug", "RUN AND DEBUG");
  await exerciseActivity(cdp, "Hierarchien und Verwendungen", "HIERARCHIE");
  await exerciseActivity(cdp, "Explorer", "EXPLORER");

  // The button toggles, and this profile is a real one: whatever the last
  // session left open is what it starts from. Deciding once whether to click
  // it therefore closed the tool window as often as it opened it. Click until
  // the window is actually showing the tasks.
  await clickUntil(
    cdp,
    () => clickByTitle(cdp, "Build Tool"),
    // The window is the tasks, so ask for the task list. The header used to
    // read "Tasks" and now carries the build system's name, which is why this
    // asked for a word that is no longer on the screen.
    () => evaluate(cdp, "Boolean(document.querySelector('.right-tool-window .build-task-tree'))"),
    "Build-Toolfenster",
    seconds(20),
  ).catch(async (error) => {
    // Three things end here: the rail button is not called what this asks for,
    // the window does not open, or it opens showing something else. Saying
    // which one saves the next reader from guessing between them.
    const probe = await evaluate(cdp, `JSON.stringify({
      rail: [...document.querySelectorAll('.right-tool-rail button, .right-rail button')].map(node => node.title),
      hasWindow: Boolean(document.querySelector('.right-tool-window')),
      header: document.querySelector('.right-tool-header')?.textContent || '',
      buildButton: Boolean(document.querySelector('[title="Build Tool"]')),
    })`);
    throw new Error(`${error.message} Zustand: ${probe}`);
  });
  await clickUntil(
    cdp,
    () => clickByTitle(cdp, "Build Tool"),
    () => evaluate(cdp, "!document.querySelector('.right-tool-window')"),
    "Schließen des Build-Toolfensters",
    seconds(10),
  );
  await clickUntil(
    cdp,
    () => clickByTitle(cdp, "Dependencies"),
    () => evaluate(cdp, "Boolean(document.querySelector('.dependency-tool'))"),
    "Dependency-Toolfenster",
    seconds(25),
  );
  await clickUntil(
    cdp,
    () => clickByTitle(cdp, "Dependencies"),
    () => evaluate(cdp, "!document.querySelector('.dependency-tool')"),
    "Schließen des Dependency-Toolfensters",
    seconds(10),
  );

  // Ctrl+, opens the settings in a window of their own, not as an editor tab.
  // This waited for a tab that no longer exists, on a shortcut that had worked
  // the whole time.
  await dispatchShortcut(cdp, { key: ",", code: "Comma", modifiers: 2 });
  const settingsTarget = await waitForTarget("settings", seconds(10));
  const settingsCdp = await createCdp(settingsTarget.webSocketDebuggerUrl);
  try {
    await waitFor(
      () => evaluate(settingsCdp, "Boolean(document.querySelector('.settings-document, .settings-window, .settings-page'))"),
      seconds(10),
      "Einstellungsfenster",
    );
    // The key that closes the window also closes the connection the key was
    // sent over, so the second half of the keystroke may never be answered.
    // Whether it worked is decided below, by the window being gone.
    await dispatchKey(settingsCdp, "Escape", "Escape", 27).catch(() => undefined);
  } finally {
    settingsCdp.close();
  }
  await waitFor(
    () => listPageTargets().then((targets) => !targets.some((entry) => {
      try { return new URL(entry.url).searchParams.get("window") === "settings"; }
      catch { return false; }
    })),
    seconds(10),
    "Schließen der Einstellungen",
  );

  await dispatchShortcut(cdp, { key: "P", code: "KeyP", modifiers: 2 | 8 });
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.palette'))"), seconds(8), "Command Palette");
  assert.ok(
    (await evaluate(cdp, "document.querySelectorAll('.palette-results button').length")) > 5,
    "Command Palette enthält zu wenige Aktionen.",
  );
  await dispatchKey(cdp, "Escape", "Escape", 27);

  await rightClickElement(cdp, ".workspace-project-tree.active .project-heading");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), seconds(8), "Explorer-Kontextmenü");
  await clickBySelector(cdp, '[data-explorer-submenu="new"]');
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.explorer-submenu-portal[data-submenu=\"new\"]'))"),
    seconds(5),
    "Neu-Untermenü",
  );
  const contextText = await evaluate(cdp, "document.querySelector('.explorer-submenu-portal')?.textContent || ''");
  // "Java-Typ" was renamed to "Java Class" with the kinds as its subtitle.
  for (const label of ["Package", "Java Class", "Modul", "Datei"]) assert.match(contextText, new RegExp(label));
  assert.match(contextText, /Ordner|Verzeichnis/);
  await dispatchKey(cdp, "Escape", "Escape", 27);

  await dispatchShortcut(cdp, { key: "`", code: "Backquote", modifiers: 2 });
  await waitFor(
    () => evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes('TERMINAL'));
      return Boolean(button?.classList.contains('active') && document.querySelector('.terminal'));
    })()`),
    seconds(8),
    "Terminal über Ctrl+`",
  );
  const marker = `KIWI_REAL_AUDIT_${Date.now()}`;
  await evaluate(cdp, `window.kiwi.terminal.execute({
    root: ${escapedRoot},
    command: ${JSON.stringify(`Write-Output ${marker}`)}
  })`, true);
  await waitFor(
    () => evaluate(cdp, `document.querySelector('.terminal')?.textContent?.includes(${JSON.stringify(marker)})`),
    seconds(15),
    "Terminalausgabe",
  );

  await evaluate(cdp, `window.kiwi.language.stop(${escapedRoot})`, true);
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  if (jdtLog) {
    const runtimeLog = await fs.readFile(jdtLog).catch(() => Buffer.alloc(0));
    const newRuntimeLog = runtimeLog.subarray(Math.min(initialJdtLogSize, runtimeLog.length)).toString("utf8");
    const fatalJdtPatterns = [
      /Missing system library/i,
      /options is null/i,
      /PreferenceManager\.getPreferences/i,
      /getPreferencesManager\(\).*null/i,
      /BadLocationException/i,
    ];
    const fatalJdtError = fatalJdtPatterns.find((pattern) => pattern.test(newRuntimeLog));
    assert.equal(
      fatalJdtError,
      undefined,
      `JDT-Runtime-Log enthält einen neuen internen Fehler (${fatalJdtError}). Wiederhergestellte Sitzung: ${JSON.stringify(restoredSessionProbe)}\n${newRuntimeLog.slice(-4_000)}`,
    );
  }

  const knownHarmless = [
    /Autofill.enable is not allowed/i,
    /Electron Security Warning/i,
  ];
  const actionableFailures = [...new Set(rendererFailures)]
    .filter(Boolean)
    .filter((message) => !knownHarmless.some((pattern) => pattern.test(message)));
  assert.deepEqual(actionableFailures, [], `Renderer-Fehler: ${actionableFailures.join("\n---\n")}`);

  console.log(JSON.stringify({
    executable,
    userData,
    projectRoot,
    projectType: serviceProbe[1].value.type,
    modules: serviceProbe[2].value.length,
    tasks: serviceProbe[3].value.tasks.length,
    javaFiles: javaFiles.length,
    languageJdk: languageStart.jdk?.major,
    dependenciesIndexed: languageStart.index?.dependencies,
    restoredSession: restoredSessionProbe,
    rendererWarnings: [...new Set(rendererWarnings)].length,
    result: "passed",
  }, null, 2));
} finally {
  if (cdp) {
    try {
      await evaluate(cdp, "setTimeout(() => window.kiwi.app.close(), 50); true");
    } catch {
      // The renderer may already be closing.
    }
    cdp.close();
  }
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, seconds(20))),
    ]);
  }
  if (child.exitCode === null) await terminateWindowsProcessTree(child.pid);
  if (child.exitCode && child.exitCode !== 0 && processOutput) process.stderr.write(processOutput);
}

async function findJavaFiles(directory, result = []) {
  const ignored = new Set([".git", ".gradle", ".idea", ".kiwi", "node_modules", "target", "build", "out"]);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await findJavaFiles(absolute, result);
    else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".java")) result.push(absolute);
    if (result.length >= 500) return result;
  }
  return result;
}

async function exerciseActivity(client, label, expectedHeader) {
  const clicked = await evaluate(client, `(() => {
    const button = document.querySelector('.activitybar button[aria-label=${JSON.stringify(label)}]');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(clicked, true, `Toolfenster ${label} fehlt.`);
  await waitFor(
    () => evaluate(client, `document.querySelector('.sidebar-header')?.textContent?.includes(${JSON.stringify(expectedHeader)})`),
    seconds(10),
    `Toolfenster ${label}`,
  );
}

/**
 * Repeats a click until it has had its effect.
 *
 * A single measured click is enough for a control that only ever goes one way.
 * These toggle, and this audit starts from whatever the last real session left
 * behind, so what the click should do cannot be decided in advance — only
 * checked afterwards.
 */
async function clickUntil(client, click, effect, label, timeout) {
  await waitFor(
    async () => {
      if (await effect()) return true;
      await click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return effect();
    },
    timeout,
    label,
  );
}

async function clickByTitle(client, title) {
  return clickBySelector(client, `[title=${JSON.stringify(title)}]`);
}

async function clickBySelector(client, selector) {
  const point = await elementPoint(client, selector);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function rightClickElement(client, selector) {
  const point = await elementPoint(client, selector);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "right",
    buttons: 2,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "right",
    buttons: 0,
    clickCount: 1,
  });
}

async function elementPoint(client, selector) {
  const point = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `Element nicht sichtbar: ${selector}`);
  return point;
}

async function dispatchShortcut(client, { key, code, modifiers }) {
  const virtualKey = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKey,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKey,
  });
}

async function dispatchKey(client, key, code, virtualKey) {
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
  });
}

async function terminateWindowsProcessTree(pid) {
  if (!pid) return;
  await new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", resolve);
    killer.once("exit", resolve);
  });
}

async function listPageTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
  if (!response?.ok) return [];
  const targets = await response.json();
  return targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
}

async function waitForTarget(kind, timeout) {
  return waitFor(async () => {
    const targets = await listPageTargets();
    return targets.find((item) => {
      try {
        return new URL(item.url).searchParams.get("window") === kind;
      } catch {
        return item.url.includes(`window=${kind}`);
      }
    });
  }, timeout, `${kind}-Fenster`);
}


function createCdp(url, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    // A rejection nobody is waiting for would take the process down, and a
    // window that closes while a command is in flight is ordinary here.
    const failAll = (reason) => {
      for (const [commandId, item] of [...pending]) {
        pending.delete(commandId);
        item.reject(new Error(reason));
      }
    };
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCommand, rejectCommand) => {
          const commandId = ++id;
          const timer = setTimeout(() => {
            if (!pending.delete(commandId)) return;
            rejectCommand(new Error(`DevTools-Befehl ${method} hat nach ${COMMAND_TIMEOUT_MS} ms nicht geantwortet.`));
          }, COMMAND_TIMEOUT_MS);
          pending.set(commandId, {
            resolve: (value) => { clearTimeout(timer); resolveCommand(value); },
            reject: (error) => { clearTimeout(timer); rejectCommand(error); },
          });
          socket.send(JSON.stringify({ id: commandId, method, params }));
        });
      },
      close: () => socket.close(),
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        onEvent?.(message);
        return;
      }
      if (!pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    // A closed connection answers nothing. Without this, every command still
    // waiting when the window goes away waits for good.
    socket.addEventListener("close", () => failAll("Die DevTools-Verbindung wurde geschlossen."));
    socket.addEventListener("error", () => {
      failAll("Die DevTools-Verbindung ist fehlgeschlagen.");
      reject(new Error("DevTools WebSocket konnte nicht geöffnet werden."));
    });
  });
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Renderer-Auswertung fehlgeschlagen.",
    );
  }
  return result.result.value;
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} nicht rechtzeitig verfügbar.${lastError ? ` ${lastError.message}` : ""}`);
}

function seconds(value) {
  return Math.round(value * 1_000 * timeoutScale);
}
