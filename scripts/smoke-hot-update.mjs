import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Proves that Kiwi runs an applied renderer update instead of the packaged
 * renderer — the load path that makes an update work without a restart.
 *
 * The bundle is built from the real `dist` with one extra marker element, so
 * the check cannot pass by accident: the marker only exists in the update. The
 * first launch must not see it, the second must. Nothing here is a test hook;
 * the application resolves the renderer exactly as it does for users.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `--packaged` runs the same proof against the built application, where the
// main process lives inside app.asar and has to fingerprint itself from there.
const packaged = process.argv.includes("--packaged");
const require = createRequire(import.meta.url);
const {
  applyRendererUpdate,
  createRendererBundle,
  mainProcessHash,
  readCurrentRenderer,
} = require(path.join(projectRoot, "electron", "services", "renderer-update-service.cjs"));
const electronBinary = require(path.join(projectRoot, "node_modules", "electron"));
const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const electronPkg = JSON.parse(await fs.readFile(path.join(projectRoot, "node_modules", "electron", "package.json"), "utf8"));

const MARKER = "kiwi-hot-update-marker";

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
      send(method, params = {}) {
        return new Promise((resolveCommand, rejectCommand) => {
          const commandId = ++id;
          const timer = setTimeout(() => {
            if (pending.delete(commandId)) rejectCommand(new Error(`${method} hat nicht geantwortet.`));
          }, 30_000);
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
      const item = message.id ? pending.get(message.id) : null;
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("DevTools-Verbindung fehlgeschlagen.")));
  });
}

/** Launches Kiwi on a userData directory and reads one value from its window. */
async function launchAndRead(userData, expression, label, awaitPromise = false) {
  const port = await findAvailablePort();
  const executable = packaged
    ? path.join(projectRoot, "release", "win-unpacked", "Kiwi IDE.exe")
    : electronBinary;
  const child = spawn(executable, [
    ...(packaged ? [] : [projectRoot]),
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
  try {
    const target = await waitFor(async () => {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return targets.find((item) => item.type === "page" && item.url.includes("window="));
    }, 30_000, `${label}: Kiwi-Fenster`);
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    // The document has to be complete before the marker means anything; a
    // falsy answer is a result, not a reason to keep waiting.
    await waitFor(async () => {
      const ready = await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      return ready?.result?.value === "complete";
    }, 30_000, `${label}: geladenes Dokument`);
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    cdp.close();
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || `${label}: Auswertung fehlgeschlagen.`);
    return result?.result?.value;
  } catch (error) {
    throw new Error(`${error.message}\n--- Kiwi-Ausgabe ---\n${logs.slice(-2_000)}`);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-hot-update-"));
try {
  // A copy of the real renderer with one added marker. Everything else stays
  // byte identical, so this is the same content the application normally runs.
  const source = path.join(workspace, "dist");
  await fs.cp(path.join(projectRoot, "dist"), source, { recursive: true });
  const indexFile = path.join(source, "index.html");
  const index = await fs.readFile(indexFile, "utf8");
  assert.ok(index.includes("</head>"), "dist/index.html hat keinen Head-Bereich.");
  await fs.writeFile(indexFile, index.replace("</head>", `<meta name="${MARKER}" content="applied"></head>`));

  const mainHash = mainProcessHash(projectRoot, {
    electronVersion: electronPkg.version,
    dependencies: pkg.dependencies,
  });
  const [major, minor, patch] = pkg.version.split(".").map(Number);
  const nextVersion = `${major}.${minor}.${patch + 1}`;
  const bundleFile = path.join(workspace, `Kiwi-IDE-${nextVersion}-renderer.kiwi`);
  await fs.writeFile(bundleFile, await createRendererBundle(source, { version: nextVersion, mainHash }));

  const packagedUserData = path.join(workspace, "userdata-packaged");
  const beforeMarker = await launchAndRead(
    packagedUserData,
    `Boolean(document.querySelector('meta[name="${MARKER}"]'))`,
    "vor dem Update",
  );
  assert.equal(beforeMarker, false, "Ohne angewendetes Update darf der Marker nicht existieren.");

  // The application has to be able to fingerprint its own main process at all;
  // without that value it would silently never accept a renderer update.
  const health = JSON.parse(await launchAndRead(
    packagedUserData,
    "window.kiwi.app.health().then(value => JSON.stringify(value.renderer))",
    "Hauptprozess-Fingerabdruck",
    true,
  ) || "null");
  assert.equal(health?.hot, false, "Ohne Update darf keine angewendete Oberfläche gemeldet werden.");
  assert.match(String(health?.mainHash), /^[a-f0-9]{12}$/, "Der Hauptprozess konnte nicht fingerprintet werden.");

  const updatedUserData = path.join(workspace, "userdata-updated");
  await fs.mkdir(updatedUserData, { recursive: true });
  const applied = await applyRendererUpdate({
    bundlePath: bundleFile,
    userDataPath: updatedUserData,
    mainHash,
    version: nextVersion,
  });
  assert.equal(applied.version, nextVersion);
  assert.equal(readCurrentRenderer(updatedUserData)?.mainHash, mainHash);

  const afterMarker = await launchAndRead(
    updatedUserData,
    `Boolean(document.querySelector('meta[name="${MARKER}"]'))`,
    "nach dem Update",
  );
  assert.equal(afterMarker, true, "Kiwi hat den angewendeten Renderer nicht geladen.");

  // A bundle for a different main process must be ignored, so a mismatched
  // renderer can never reach preload and IPC it was not built against.
  const foreignUserData = path.join(workspace, "userdata-foreign");
  await fs.mkdir(foreignUserData, { recursive: true });
  const foreignBundle = path.join(workspace, `Kiwi-IDE-${nextVersion}-foreign.kiwi`);
  const foreignHash = crypto.createHash("sha256").update("other main process").digest("hex");
  await fs.writeFile(foreignBundle, await createRendererBundle(source, { version: nextVersion, mainHash: foreignHash }));
  await applyRendererUpdate({
    bundlePath: foreignBundle,
    userDataPath: foreignUserData,
    mainHash: foreignHash,
    version: nextVersion,
  });
  const foreignMarker = await launchAndRead(
    foreignUserData,
    `Boolean(document.querySelector('meta[name="${MARKER}"]'))`,
    "fremdes Update",
  );
  assert.equal(foreignMarker, false, "Ein Paket für einen anderen Hauptprozess darf nicht geladen werden.");

  console.log("Hot-Update passed: applied renderer is loaded, foreign bundle is ignored.");
} finally {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
}
