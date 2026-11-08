import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  assertChannel,
  createManifest,
  sha256File,
  writeJsonAtomic,
} from "./update-core.mjs";

const { signManifest } = createRequire(import.meta.url)("../electron/services/update-signature.cjs");

/** Reads a renderer bundle's main-process fingerprint with Kiwi's own reader. */
async function readRendererMainHash(file) {
  const { readRendererBundle } = createRequire(import.meta.url)("../electron/services/renderer-update-service.cjs");
  return readRendererBundle(await fs.readFile(file)).mainHash;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/*
 * Where the built artifacts are.
 *
 * The project's own `release` unless told otherwise. The override exists so
 * this script can be exercised against a staged directory without going
 * anywhere near the real one, which holds builds that cannot be made again.
 */
const releaseRoot = process.env.KIWI_RELEASE_DIR
  ? path.resolve(process.env.KIWI_RELEASE_DIR)
  : path.join(projectRoot, "release");
const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const channel = assertChannel(process.env.KIWI_UPDATE_CHANNEL || "stable");
const publicBaseUrl = String(process.env.KIWI_UPDATE_PUBLIC_BASE_URL || process.env.KIWI_UPDATE_BASE_URL || "").trim();

if (!publicBaseUrl) {
  const message = "KIWI_UPDATE_PUBLIC_BASE_URL fehlt; Update-Manifest wird übersprungen (keine Platzhalter-Adresse).";
  if (process.env.KIWI_REQUIRE_UPDATE_MANIFEST === "1") throw new Error(message);
  console.log(message);
  process.exit(0);
}

const files = await fs.readdir(releaseRoot).catch(() => []);
const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const installerName = files.find((name) => new RegExp(`^Kiwi-IDE-${escapedVersion}-setup\\.exe$`, "i").test(name));
if (!installerName) throw new Error(`Installer Kiwi-IDE-${pkg.version}-setup.exe wurde nicht gefunden.`);
const portableName = files.find((name) => new RegExp(`^Kiwi-IDE-${escapedVersion}-portable\\.exe$`, "i").test(name));
if (!portableName && process.env.KIWI_ALLOW_SETUP_ONLY !== "1") {
  throw new Error(`Portable-Paket Kiwi-IDE-${pkg.version}-portable.exe fehlt. Setup-only muss mit KIWI_ALLOW_SETUP_ONLY=1 ausdrücklich erlaubt werden.`);
}

let releaseNotes = process.env.KIWI_RELEASE_NOTES || `Kiwi IDE ${pkg.version}`;
if (process.env.KIWI_RELEASE_NOTES_FILE) {
  releaseNotes = await fs.readFile(path.resolve(process.env.KIWI_RELEASE_NOTES_FILE), "utf8");
}
const installer = path.join(releaseRoot, installerName);
const digest = await sha256File(installer);
const portable = portableName
  ? { filename: portableName, ...await sha256File(path.join(releaseRoot, portableName)) }
  : undefined;
// The renderer bundle is what an installed Kiwi applies without restarting.
// It is optional, and its main-process fingerprint is read from the bundle
// itself so a manifest can never advertise a mismatched pair.
const rendererName = files.find((name) => new RegExp(`^Kiwi-IDE-${escapedVersion}-renderer\\.kiwi$`, "i").test(name));
const renderer = rendererName
  ? {
    filename: rendererName,
    ...await sha256File(path.join(releaseRoot, rendererName)),
    mainHash: await readRendererMainHash(path.join(releaseRoot, rendererName)),
  }
  : undefined;
const unsigned = createManifest({
  channel,
  version: pkg.version,
  filename: installerName,
  ...digest,
  portable,
  renderer,
  releaseNotes,
  publicBaseUrl,
});

/*
 * Signing it.
 *
 * The checksum in the manifest proves the download was not corrupted. It
 * proves nothing about who wrote the manifest, and whoever can serve that URL
 * decides what every Kiwi installs. The signature is what closes that.
 *
 * A build without a key still writes a manifest and says so, because a release
 * pipeline that has not been given a key yet should not fail silently — but it
 * is said out loud every time, not once in a changelog.
 */
const privateKeyFile = String(process.env.KIWI_UPDATE_PRIVATE_KEY_FILE || "").trim();
const privateKey = privateKeyFile
  ? await fs.readFile(path.resolve(privateKeyFile), "utf8")
  : String(process.env.KIWI_UPDATE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();

const keyId = String(process.env.KIWI_UPDATE_KEY_ID || "").trim();
const manifest = privateKey
  ? {
    ...unsigned,
    ...(keyId ? { keyId } : {}),
    signature: signManifest({ ...unsigned, ...(keyId ? { keyId } : {}) }, privateKey),
  }
  : unsigned;

if (!privateKey) {
  const message = "KIWI_UPDATE_PRIVATE_KEY fehlt; das Manifest wird NICHT signiert.";
  if (process.env.KIWI_REQUIRE_SIGNED_MANIFEST === "1") throw new Error(message);
  console.warn(message);
}

await writeJsonAtomic(path.join(releaseRoot, "manifests", channel, "latest.json"), manifest);
// The legacy location remains useful for static hosting and older clients.
await writeJsonAtomic(path.join(releaseRoot, "latest.json"), manifest);
console.log(`Update-Manifest: release/manifests/${channel}/latest.json (${manifest.sha256})`);
console.log(privateKey ? `Signiert${keyId ? ` mit ${keyId}` : ""}.` : "Ohne Signatur.");
