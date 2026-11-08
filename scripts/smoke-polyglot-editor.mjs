import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Real editor smoke: language detection and visible completion for every family. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require(path.join(root, "node_modules", "electron"));
const temporaryRoot = path.resolve(os.tmpdir());
const fixture = await fs.mkdtemp(path.join(temporaryRoot, "kiwi-polyglot-editor-"));
const project = path.join(fixture, "hybrid");
const userData = path.join(fixture, "userdata");
const screenshotsOnly = process.argv.includes("--screenshots-only");
const capture = screenshotsOnly || process.argv.includes("--capture");
const cases = [
  ["Main.kt", "kotlin", "fun helper() {}\npri", "println"],
  ["main.py", "python", "def helper():\n    pass\npri", "print"],
  ["main.rs", "rust", "fn helper() {}\npri", "println!"],
  ["index.php", "php", "<?php\nstrl", "strlen"],
  ["main.lua", "lua", "local value = 1\npri", "print"],
  ["main.go", "go", "package main\nfunc main() {}\nappe", "append"],
  ["main.c", "c", "#include <stdio.h>\npri", "printf"],
  ["main.cpp", "cpp", "#include <vector>\nstd::vec", "vector"],
  ["Program.cs", "csharp", "using System;\nConsole.Wri", "WriteLine"],
  ["App.m", "objective-c", "#import <Foundation/Foundation.h>\nNSL", "NSLog"],
  ["Bridge.mm", "objective-cpp", "#include <vector>\nstd::vec", "vector"],
  ["main.ts", "typescript", 'const greeting = "hello";\ngreeting.toU', "toUpperCase"],
  ["main.js", "javascript", 'const greeting = "hello";\ngreeting.toU', "toUpperCase"],
  ["index.html", "html", "<!doctype html>\n<htm", "html"],
  ["style.css", "css", "body {\n  backg", "background"],
  ["style.scss", "scss", "body {\n  backg", "background"],
  ["style.less", "less", "body {\n  backg", "background"],
  ["settings.json", "json", '{"enabled":true}', null],
];

async function until(read, budget, label) {
  const deadline = Date.now() + budget;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let sequence = 0;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCommand, rejectCommand) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectCommand(new Error(`${method} did not answer`));
          }, 30_000);
          pending.set(id, {
            resolve: (value) => { clearTimeout(timer); resolveCommand(value); },
            reject: (error) => { clearTimeout(timer); rejectCommand(error); },
          });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close: () => socket.close(),
    }));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      if (message.error) command.reject(new Error(message.error.message));
      else command.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const command of pending.values()) command.reject(new Error("Electron window closed"));
      pending.clear();
    });
    socket.addEventListener("error", () => reject(new Error("DevTools connection failed")));
  });
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function press(cdp, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}

await fs.mkdir(path.join(project, ".kiwi"), { recursive: true });
await fs.mkdir(userData, { recursive: true });
await fs.writeFile(path.join(project, ".kiwi", "language.json"), JSON.stringify({ version: 1, language: "python" }));
await Promise.all(cases.map(([file, _language, content]) => fs.writeFile(path.join(project, file), content)));
// This gate must prove that the fallback is useful without downloaded servers.
// The server service has a separate real-protocol integration suite.
await fs.writeFile(path.join(userData, "settings.json"), JSON.stringify({
  schemaVersion: 6,
  explorerOpenMode: "single",
  languageServers: Object.fromEntries(cases.filter((item) => !["typescript", "javascript", "html", "css", "scss", "less", "json"].includes(item[1])).map((item) => [item[1], { enabled: false, command: "", args: [] }])),
}));
const port = await availablePort();
const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, KIWI_LOAD_DIST: "1", KIWI_STARTUP_PRELOAD: "0", KIWI_SPLASH_MINIMUM_MS: "200", ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
const sockets = [];
const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());

async function windowFor(kind) {
  const target = await until(async () => (await targets()).find((item) => item.type === "page" && item.url.includes(`window=${kind}`)), 45_000, `${kind} window`);
  const cdp = await connect(target.webSocketDebuggerUrl);
  sockets.push(cdp);
  await cdp.send("Runtime.enable");
  await until(() => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), 20_000, `${kind} preload`);
  return cdp;
}

try {
  const welcome = await windowFor("welcome");
  await evaluate(welcome, `(async () => { await window.kiwi.workspace.add([${JSON.stringify(project)}]); await window.kiwi.app.openEditor(${JSON.stringify(project)}); return true; })()`, true);
  const cdp = await windowFor("editor");
  await cdp.send("Page.bringToFront");
  await until(() => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active'))"), 30_000, "project tree");

  for (const [name, language, _content, expected] of cases.filter((item) => !screenshotsOnly || item[1] === "python")) {
    const file = path.join(project, name);
    console.log(`  ... ${name}: ${language}${expected ? ` → ${expected}` : ""}`);
    await until(() => evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')].find(item => item.getAttribute('title') === ${JSON.stringify(file)});
      if (!row) return false;
      row.click(); return true;
    })()`), 12_000, `Explorer row ${name}`);
    await until(() => evaluate(cdp, `Boolean(document.querySelector('.tab.active[data-file-path="' + CSS.escape(${JSON.stringify(file)}) + '"]'))`), 12_000, `active tab ${name}`);
    await until(() => evaluate(cdp, `Boolean(document.querySelector('[data-mode-id="${language}"] .monaco-editor textarea'))`), 20_000, `Monaco language ${language}`);
    if (!expected) continue;
    await evaluate(cdp, `document.querySelector('[data-mode-id="${language}"] .monaco-editor textarea')?.focus()`);
    await press(cdp, "End", "End", 35, 2);
    await press(cdp, " ", "Space", 32, 2);
    await until(async () => {
      const found = await evaluate(cdp, `(() => {
        const rows = [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')];
        return rows.some(row => row.textContent?.includes(${JSON.stringify(expected)}));
      })()`);
      if (found) return true;
      await press(cdp, " ", "Space", 32, 2);
      return false;
    }, 20_000, `${name} visible completion ${expected}`);
    if (capture && language === "python") {
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await fs.writeFile(path.join(root, ".kiwi", "polyglot-editor.png"), Buffer.from(screenshot.data, "base64"));
    }
    await press(cdp, "Escape", "Escape", 27);
  }
  if (capture) {
    await evaluate(cdp, `window.kiwi.app.openSettings(${JSON.stringify(project)})`, true);
    const settings = await windowFor("settings");
    await settings.send("Page.bringToFront");
    await until(() => evaluate(settings, `(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Sprachen & Sprachserver');
      button?.click(); return Boolean(button);
    })()`), 15_000, "language-server settings navigation");
    await until(() => evaluate(settings, "document.querySelectorAll('.language-server-card').length >= 11"), 15_000, "language-server overview");
    const screenshot = await settings.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(path.join(root, ".kiwi", "polyglot-settings.png"), Buffer.from(screenshot.data, "base64"));
    await evaluate(settings, "setTimeout(() => window.kiwi.app.close(), 50); true");
  }
  const health = await evaluate(cdp, "window.kiwi.app.health()", true);
  assert.equal(health.language.sessions, 0, "A non-Java project must not start JDT LS.");
  console.log(screenshotsOnly ? "Hybrid editor screenshots saved: .kiwi/polyglot-editor.png and .kiwi/polyglot-settings.png." : `Hybrid editor smoke passed: ${cases.length} file languages, all 11 native families, local completions and web workers.`);
} catch (error) {
  throw new Error(`${error.message}\n--- Kiwi output ---\n${logs.slice(-4_000)}`);
} finally {
  try {
    const pages = await targets();
    const target = pages.find((item) => item.type === "page" && item.url.includes("window=editor"));
    if (target) {
      const cdp = await connect(target.webSocketDebuggerUrl);
      await evaluate(cdp, "setTimeout(() => window.kiwi.app.close(), 50); true");
      cdp.close();
    }
  } catch { /* A failed launch may already have exited. */ }
  sockets.forEach((socket) => socket.close());
  await Promise.race([new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 8_000))]);
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  // Delete only the exact temporary directory this run created.
  if (path.dirname(path.resolve(fixture)) === temporaryRoot && path.basename(fixture).startsWith("kiwi-polyglot-editor-")) {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}
