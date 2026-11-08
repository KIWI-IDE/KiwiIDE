const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

/**
 * Updating Kiwi without restarting it.
 *
 * Almost everything a Kiwi release changes lives in the renderer bundle: the
 * workbench, the editor, the tool windows. Shipping those changes as a small
 * verified archive means an update can be applied to the running application
 * and picked up by reloading its windows — no installer, no relaunch, no lost
 * session. Anything that touches the main process still needs the full
 * installer, and that is exactly what `mainProcessHash` decides: a renderer
 * bundle is only ever applied on top of the identical main process it was
 * built against, so preload, IPC and the renderer can never disagree.
 */

const MAGIC = Buffer.from("KIWIRND\0", "ascii");
const FORMAT_VERSION = 1;
const MAX_HEADER_BYTES = 4 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 4_000;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CURRENT_FILE = "current.json";

/** Rejects anything that could escape the target directory when written. */
function assertBundlePath(value) {
  const supplied = String(value || "");
  if (!supplied || supplied.length > 400) throw new Error("Der Bundle-Pfad ist ungültig.");
  if (supplied.includes("\\") || supplied.startsWith("/") || /^[A-Za-z]:/.test(supplied)) {
    throw new Error(`Der Bundle-Pfad ${supplied} ist nicht relativ.`);
  }
  const segments = supplied.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment)) {
      throw new Error(`Der Bundle-Pfad ${supplied} enthält einen unzulässigen Abschnitt.`);
    }
  }
  return segments;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Fingerprint of everything the renderer talks to.
 *
 * Every main-process source file plus the Electron and dependency versions it
 * runs with. The build script and the running application compute this from
 * the same code, so "was this bundle built for exactly this main process?" has
 * a single answer instead of a judgement call.
 */
function mainProcessHash(appRoot, { electronVersion = "", dependencies = null } = {}) {
  const root = path.resolve(appRoot);
  const electronDirectory = path.join(root, "electron");
  const entries = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".cjs")) {
        const relative = path.relative(electronDirectory, absolute).split(path.sep).join("/");
        entries.push(`${relative}:${sha256(fs.readFileSync(absolute))}`);
      }
    }
  };
  walk(electronDirectory);
  const packageJson = dependencies || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies || {};
  const declared = Object.keys(packageJson).sort().map((name) => `${name}@${packageJson[name]}`);
  return sha256(Buffer.from([
    `format:${FORMAT_VERSION}`,
    `electron:${String(electronVersion)}`,
    ...declared,
    ...entries,
  ].join("\n"), "utf8"));
}

/** Packs a built renderer directory into one verifiable archive. */
async function createRendererBundle(sourceDirectory, { version, mainHash }) {
  const root = path.resolve(sourceDirectory);
  const files = [];
  const collect = async (directory) => {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await collect(root);
  if (!files.length) throw new Error("Das Renderer-Verzeichnis ist leer.");
  if (files.length > MAX_FILES) throw new Error("Das Renderer-Verzeichnis enthält zu viele Dateien.");

  const payloads = [];
  const described = [];
  for (const absolute of files) {
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    assertBundlePath(relative);
    const content = await fsp.readFile(absolute);
    payloads.push(content);
    described.push({ path: relative, bytes: content.length, sha256: sha256(content) });
  }
  if (!described.some((entry) => entry.path === "index.html")) {
    throw new Error("Das Renderer-Verzeichnis enthält keine index.html.");
  }
  const header = Buffer.from(JSON.stringify({
    format: FORMAT_VERSION,
    version: String(version),
    mainHash: String(mainHash),
    createdAt: new Date().toISOString(),
    files: described,
  }), "utf8");
  if (header.length > MAX_HEADER_BYTES) throw new Error("Der Bundle-Kopf ist zu groß.");
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length, 0);
  const payload = zlib.gzipSync(Buffer.concat(payloads), { level: 9 });
  return Buffer.concat([MAGIC, headerLength, header, payload]);
}

/** Reads and fully verifies a bundle without writing anything. */
function readRendererBundle(bundle) {
  if (!Buffer.isBuffer(bundle) || bundle.length < MAGIC.length + 4) {
    throw new Error("Das Renderer-Bundle ist unvollständig.");
  }
  if (!bundle.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Das Renderer-Bundle hat kein gültiges Kiwi-Format.");
  }
  const headerLength = bundle.readUInt32LE(MAGIC.length);
  if (!headerLength || headerLength > MAX_HEADER_BYTES || MAGIC.length + 4 + headerLength > bundle.length) {
    throw new Error("Der Kopf des Renderer-Bundles ist ungültig.");
  }
  const headerStart = MAGIC.length + 4;
  let header;
  try {
    header = JSON.parse(bundle.subarray(headerStart, headerStart + headerLength).toString("utf8"));
  } catch {
    throw new Error("Der Kopf des Renderer-Bundles ist nicht lesbar.");
  }
  if (!header || header.format !== FORMAT_VERSION || !Array.isArray(header.files) || !header.files.length) {
    throw new Error("Diese Version des Renderer-Bundles wird nicht unterstützt.");
  }
  if (header.files.length > MAX_FILES) throw new Error("Das Renderer-Bundle enthält zu viele Dateien.");

  const payload = zlib.gunzipSync(bundle.subarray(headerStart + headerLength), { maxOutputLength: MAX_BUNDLE_BYTES });
  const files = [];
  let offset = 0;
  for (const entry of header.files) {
    const segments = assertBundlePath(entry?.path);
    const bytes = Number(entry?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || offset + bytes > payload.length) {
      throw new Error(`Die Größe von ${entry?.path} im Renderer-Bundle stimmt nicht.`);
    }
    const content = payload.subarray(offset, offset + bytes);
    if (sha256(content) !== String(entry?.sha256 || "").toLowerCase()) {
      throw new Error(`Die Prüfsumme von ${entry.path} im Renderer-Bundle stimmt nicht.`);
    }
    files.push({ path: entry.path, segments, content });
    offset += bytes;
  }
  if (offset !== payload.length) throw new Error("Das Renderer-Bundle enthält unerwartete Daten.");
  if (!files.some((file) => file.path === "index.html")) {
    throw new Error("Das Renderer-Bundle enthält keine index.html.");
  }
  return { version: String(header.version || ""), mainHash: String(header.mainHash || ""), files };
}

/** Writes a verified bundle into its own directory, replacing a partial one. */
async function extractRendererBundle(bundle, targetDirectory) {
  const verified = readRendererBundle(bundle);
  const target = path.resolve(targetDirectory);
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  for (const file of verified.files) {
    const absolute = path.join(target, ...file.segments);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, file.content);
  }
  return verified;
}

function rendererDirectory(userDataPath) {
  return path.join(path.resolve(userDataPath), "renderer");
}

async function writeCurrentRenderer(userDataPath, state) {
  const directory = rendererDirectory(userDataPath);
  await fsp.mkdir(directory, { recursive: true });
  const target = path.join(directory, CURRENT_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, target);
  return state;
}

function readCurrentRenderer(userDataPath) {
  try {
    const raw = fs.readFileSync(path.join(rendererDirectory(userDataPath), CURRENT_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Which renderer the windows should load.
 *
 * An applied bundle only counts while it belongs to this exact main process
 * and is actually newer than the installed application; every other case falls
 * back to the renderer inside the package. That is what makes a later full
 * installer take precedence automatically, and what makes a damaged or
 * half-written directory harmless instead of fatal.
 */
function resolveRendererRoot(userDataPath, bundledDirectory, { mainHash, appVersion, compareVersions }) {
  const fallback = { directory: path.resolve(bundledDirectory), version: String(appVersion), hot: false };
  const current = readCurrentRenderer(userDataPath);
  if (!current) return fallback;
  const version = String(current.version || "");
  const directory = String(current.directory || "");
  if (!version || !directory) return { ...fallback, stale: true };
  if (String(current.mainHash || "") !== String(mainHash)) return { ...fallback, stale: true };
  if (typeof compareVersions === "function" && compareVersions(version, String(appVersion)) <= 0) {
    return { ...fallback, stale: true };
  }
  const resolved = path.resolve(rendererDirectory(userDataPath), directory);
  if (path.relative(rendererDirectory(userDataPath), resolved).startsWith("..")) return { ...fallback, stale: true };
  if (!fs.existsSync(path.join(resolved, "index.html"))) return { ...fallback, stale: true };
  return { directory: resolved, version, hot: true };
}

/**
 * Applies a downloaded bundle for the running main process.
 *
 * The bundle is only trusted once its own header agrees with the manifest that
 * was verified before the download: same version, same main-process hash.
 */
async function applyRendererUpdate({ bundlePath, userDataPath, mainHash, version }) {
  const bundle = await fsp.readFile(path.resolve(bundlePath));
  if (bundle.length > MAX_BUNDLE_BYTES) throw new Error("Das Renderer-Bundle ist zu groß.");
  const verified = readRendererBundle(bundle);
  if (verified.mainHash !== String(mainHash)) {
    throw new Error("Das Renderer-Update gehört zu einer anderen Kiwi-Programmversion.");
  }
  if (version && verified.version !== String(version)) {
    throw new Error("Die Version des Renderer-Updates stimmt nicht mit dem Manifest überein.");
  }
  const name = `${verified.version.replace(/[^0-9A-Za-z.+-]/g, "-")}-${sha256(bundle).slice(0, 12)}`;
  const target = path.join(rendererDirectory(userDataPath), name);
  await extractRendererBundle(bundle, target);
  await writeCurrentRenderer(userDataPath, {
    version: verified.version,
    mainHash: verified.mainHash,
    directory: name,
    appliedAt: new Date().toISOString(),
  });
  return { version: verified.version, directory: target, files: verified.files.length };
}

/** Drops an applied renderer, so the next load uses the packaged one. */
async function discardRendererUpdate(userDataPath) {
  const directory = rendererDirectory(userDataPath);
  await fsp.rm(path.join(directory, CURRENT_FILE), { force: true });
  return true;
}

/** Removes applied renderers that are no longer the current one. */
async function pruneRendererUpdates(userDataPath, keepDirectory = "") {
  const directory = rendererDirectory(userDataPath);
  let entries = [];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keepDirectory) continue;
    await fsp.rm(path.join(directory, entry.name), { recursive: true, force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

module.exports = {
  applyRendererUpdate,
  assertBundlePath,
  createRendererBundle,
  discardRendererUpdate,
  extractRendererBundle,
  mainProcessHash,
  pruneRendererUpdates,
  readCurrentRenderer,
  readRendererBundle,
  rendererDirectory,
  resolveRendererRoot,
  writeCurrentRenderer,
  RENDERER_BUNDLE_FORMAT: FORMAT_VERSION,
};
