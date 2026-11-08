import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertChannel,
  assertPublicBaseUrl,
  parseVersion,
  sha256File,
} from "./update-core.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await fsp.readFile(path.join(projectRoot, "package.json"), "utf8"));

function argumentsMap(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith("--")) throw new Error(`Unbekanntes Argument: ${current}`);
    const key = current.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      if (key === "allow-setup-only") {
        result[key] = true;
        continue;
      }
      throw new Error(`Wert für --${key} fehlt.`);
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

const args = argumentsMap(process.argv.slice(2));
const version = parseVersion(args.version || process.env.KIWI_RELEASE_VERSION || pkg.version).value;
const channel = assertChannel(args.channel || process.env.KIWI_UPDATE_CHANNEL || "stable");
const serverUrl = assertPublicBaseUrl(args.server || process.env.KIWI_UPDATE_SERVER_URL || process.env.KIWI_UPDATE_PUBLIC_BASE_URL);
const token = String(process.env.KIWI_UPDATE_PUBLISH_TOKEN || "");
if (Buffer.byteLength(token) < 32) throw new Error("KIWI_UPDATE_PUBLISH_TOKEN fehlt oder ist kürzer als 32 Byte.");

const artifact = path.resolve(args.artifact || process.env.KIWI_RELEASE_ARTIFACT
  || path.join(projectRoot, "release", `Kiwi-IDE-${version}-setup.exe`));
const stat = await fsp.stat(artifact);
if (!stat.isFile() || stat.size <= 0) throw new Error("Der Installer ist leer oder keine Datei.");
const expectedFilename = `Kiwi-IDE-${version}-setup.exe`;
if (path.basename(artifact).toLowerCase() !== expectedFilename.toLowerCase()) {
  throw new Error(`Der Installer muss ${expectedFilename} heißen.`);
}
const portable = path.resolve(args.portable || process.env.KIWI_RELEASE_PORTABLE_ARTIFACT
  || path.join(projectRoot, "release", `Kiwi-IDE-${version}-portable.exe`));
const renderer = path.resolve(args.renderer || process.env.KIWI_RELEASE_RENDERER_ARTIFACT
  || path.join(projectRoot, "release", `Kiwi-IDE-${version}-renderer.kiwi`));
const allowSetupOnly = args["allow-setup-only"] === true || process.env.KIWI_ALLOW_SETUP_ONLY === "1";
const portableStat = await fsp.stat(portable).catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});
if (!portableStat && !allowSetupOnly) {
  throw new Error(`Portable-Paket Kiwi-IDE-${version}-portable.exe fehlt. Setup-only muss mit --allow-setup-only oder KIWI_ALLOW_SETUP_ONLY=1 ausdrücklich erlaubt werden.`);
}
if (portableStat && (!portableStat.isFile() || portableStat.size <= 0)) throw new Error("Das Portable-Paket ist leer oder keine Datei.");
const expectedPortableFilename = `Kiwi-IDE-${version}-portable.exe`;
if (portableStat && path.basename(portable).toLowerCase() !== expectedPortableFilename.toLowerCase()) {
  throw new Error(`Das Portable-Paket muss ${expectedPortableFilename} heißen.`);
}

// The renderer bundle is what lets an installed Kiwi update itself without a
// restart. It is optional — a release that changed the main process has none —
// but a present bundle must be a real, correctly named file.
const expectedRendererFilename = `Kiwi-IDE-${version}-renderer.kiwi`;
const rendererStat = await fsp.stat(renderer).catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});
if (rendererStat && (!rendererStat.isFile() || rendererStat.size <= 0)) throw new Error("Das Renderer-Bundle ist leer oder keine Datei.");
if (rendererStat && path.basename(renderer).toLowerCase() !== expectedRendererFilename.toLowerCase()) {
  throw new Error(`Das Renderer-Bundle muss ${expectedRendererFilename} heißen.`);
}

let releaseNotes = process.env.KIWI_RELEASE_NOTES || `Kiwi IDE ${version}`;
const notesFile = args["notes-file"] || process.env.KIWI_RELEASE_NOTES_FILE;
if (notesFile) releaseNotes = await fsp.readFile(path.resolve(notesFile), "utf8");
const notesBytes = Buffer.from(releaseNotes, "utf8");
const safeReleaseNotes = notesBytes.length <= 4_000
  ? releaseNotes
  : notesBytes.subarray(0, 4_000).toString("utf8").replace(/\uFFFD$/, "");
/**
 * Reads the main-process fingerprint out of a renderer bundle.
 *
 * The server publishes that value in the manifest, and a client only applies
 * the bundle when it matches its own main process. Taking it from the bundle
 * itself keeps it impossible to publish a mismatched pair by hand.
 */
function readRendererMainHash(file) {
  const handle = fs.openSync(file, "r");
  try {
    const prefix = Buffer.alloc(12);
    fs.readSync(handle, prefix, 0, prefix.length, 0);
    if (prefix.subarray(0, 8).toString("ascii") !== "KIWIRND\0") throw new Error("Kein Kiwi-Renderer-Bundle.");
    const headerLength = prefix.readUInt32LE(8);
    if (!headerLength || headerLength > 4 * 1024 * 1024) throw new Error("Ungültiger Bundle-Kopf.");
    const header = Buffer.alloc(headerLength);
    fs.readSync(handle, header, 0, headerLength, 12);
    const mainHash = String(JSON.parse(header.toString("utf8")).mainHash || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(mainHash)) throw new Error("Dem Renderer-Bundle fehlt die Hauptprozess-Prüfsumme.");
    return mainHash;
  } finally {
    fs.closeSync(handle);
  }
}

async function upload(file, filename, targetUrl, extraHeaders = {}) {
  const fileDigest = await sha256File(file);
  console.log(`Veröffentliche ${filename} (${Math.round(fileDigest.bytes / 1024 / 1024)} MB) in ${channel} …`);
  const response = await fetch(targetUrl, {
    method: "PUT",
    redirect: "error",
    duplex: "half",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(fileDigest.bytes),
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "X-Kiwi-Filename": filename,
      "X-Kiwi-Sha256": fileDigest.sha256,
      ...extraHeaders,
    },
    body: fs.createReadStream(file),
  });
  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try { message = JSON.parse(body).error || body; } catch { /* plain-text proxy response */ }
    throw new Error(`Publishing fehlgeschlagen (HTTP ${response.status}): ${message}`);
  }
  return body;
}

const releaseEndpoint = `${serverUrl}/v1/admin/releases/${encodeURIComponent(channel)}/${encodeURIComponent(version)}`;
if (portableStat) {
  await upload(portable, expectedPortableFilename, `${releaseEndpoint}/portable`);
}
if (rendererStat) {
  await upload(renderer, expectedRendererFilename, `${releaseEndpoint}/renderer`, {
    "Content-Type": "application/octet-stream",
    "X-Kiwi-Main-Hash": readRendererMainHash(renderer),
  });
}
// Setup is deliberately last: only this request atomically activates latest.
const body = await upload(artifact, expectedFilename, releaseEndpoint, {
  "X-Kiwi-Release-Notes-Base64": Buffer.from(safeReleaseNotes, "utf8").toString("base64"),
});
const manifest = JSON.parse(body);
console.log(`Veröffentlicht: ${manifest.version} → ${serverUrl}/v1/updates/${channel}/latest.json`);
console.log(`SHA-256: ${manifest.sha256}`);
