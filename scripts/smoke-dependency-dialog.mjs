import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-dependency-dialog-"));
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
let child;
let socket;
let log = "";
try {
  await require("esbuild").build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { DependencyDialog } from "./src/components/DependencyDialog";
        import "./src/styles.css";
        const candidates = Array.from({length: 30}, (_, index) => ({
          groupId: "org.example", artifactId: "library-" + index,
          version: "2.0.0-" + "release".repeat(35), packaging: "jar", updatedAt: 0,
        }));
        window.versionRequests = [];
        window.added = [];
        createRoot(document.getElementById("root")).render(
          <DependencyDialog buildType="Maven" buildFiles={["/project/pom.xml"]}
            onSearch={async () => candidates}
            onVersions={(group, artifact) => new Promise(resolve => window.versionRequests.push({artifact, resolve}))}
            onAdd={async target => { window.added.push(target); }}
            onClose={() => { window.closed = true; }}
          />
        );
      `,
    },
    bundle: true,
    outfile: path.join(temporary, "fixture.js"),
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await fs.writeFile(path.join(temporary, "index.html"), '<html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  await fs.writeFile(path.join(temporary, "main.cjs"), `
    const {app, BrowserWindow}=require("electron");
    app.commandLine.appendSwitch("remote-debugging-port", ${JSON.stringify(String(port))});
    app.whenReady().then(() => {
      const window = new BrowserWindow({width: 1000, height: 760, show: false});
      window.loadFile(${JSON.stringify(path.join(temporary, "index.html"))});
    });
    app.on("window-all-closed", () => app.quit());
  `);
  child = spawn(require("electron"), [
    path.join(temporary, "main.cjs"),
    "--user-data-dir=" + path.join(temporary, "profile"),
    ...(process.platform === "linux" && process.env.GITHUB_ACTIONS === "true" ? ["--no-sandbox"] : []),
  ], {windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
      .then(items => items.find(item => item.type === "page")).catch(() => null);
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(target, log);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, {once: true}));
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const result = JSON.parse(event.data);
    pending.get(result.id)?.(result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    const timeout = setTimeout(() => { pending.delete(current); reject(new Error(method + " timed out")); }, 15_000);
    pending.set(current, result => {
      clearTimeout(timeout);
      pending.delete(current);
      if (result.error) reject(new Error(JSON.stringify(result.error)));
      else resolve(result.result);
    });
    socket.send(JSON.stringify({id: current, method, params}));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true});
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await evaluate(`new Promise(resolve => {
    const wait = () => document.querySelector(".dependency-search input") ? resolve(true) : setTimeout(wait, 25);
    wait();
  })`);
  await evaluate('document.querySelector(".dependency-search input").focus()');
  await send("Input.insertText", {text: "library"});
  await evaluate(`new Promise(resolve => {
    const wait = () => document.querySelectorAll(".dependency-result").length === 30 ? resolve(true) : setTimeout(wait, 25);
    wait();
  })`);
  await evaluate('document.querySelector(".dependency-result button").click()');
  await evaluate('window.versionRequests[0].resolve(["1.9.0", "1.8.0"])');
  await evaluate('new Promise(resolve => setTimeout(resolve, 50))');
  const layout = await evaluate(`(() => {
    const dialog=document.querySelector(".dependency-dialog");
    const footer=dialog.querySelector("footer");
    const select=footer.querySelector("select");
    const rect=dialog.getBoundingClientRect();
    const foot=footer.getBoundingClientRect();
    return {visible: foot.bottom <= rect.bottom && foot.top >= rect.top,
      fits: footer.scrollWidth <= footer.clientWidth,
      value: select.value, selected: select.selectedIndex};
  })()`);
  assert(layout.visible, "The selected dependency hid the action bar");
  assert(layout.fits, "The version selector overflowed the dialog");
  assert.equal(layout.selected, 0, "Search result version must stay in the version menu");
  assert.match(layout.value, /^2\.0\.0-/);
  const keyboard = await evaluate(`(() => {
    const select=document.querySelector("footer select");
    select.focus();
    const event=new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true});
    select.dispatchEvent(event);
    return {prevented:event.defaultPrevented, requests:window.versionRequests.length};
  })()`);
  assert.equal(keyboard.prevented, false, "Version keys were stolen by result navigation");
  assert.equal(keyboard.requests, 1, "Changing version selected a different dependency");
  await evaluate('document.querySelector(".dependency-dialog .primary-button").click()');
  assert.deepEqual(await evaluate('window.added.map(entry => entry.artifactId)'), ["library-0"]);
  console.log("Dependency selection passed: action bar, long versions, selected version, keyboard and add.");
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
  await fs.rm(temporary, {recursive: true, force: true}).catch(() => undefined);
}
