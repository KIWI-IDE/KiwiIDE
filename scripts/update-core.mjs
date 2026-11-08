import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const UPDATE_CHANNELS = Object.freeze(["stable", "beta", "canary"]);
export const MAX_UPDATE_BYTES = 600 * 1024 * 1024;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function assertChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  if (!UPDATE_CHANNELS.includes(channel)) throw new Error("Unbekannter Update-Kanal.");
  return channel;
}

export function parseVersion(value) {
  const version = String(value || "").trim();
  const match = version.match(SEMVER_PATTERN);
  if (!match) throw new Error("Ungültige semantische Version.");
  return {
    value: version,
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function compareSemanticVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart, "en");
  }
  return 0;
}

export function assertPublicBaseUrl(value, { allowHttp = false } = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("KIWI_UPDATE_PUBLIC_BASE_URL ist keine gültige URL.");
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("Die öffentliche Update-Adresse muss HTTPS verwenden.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Die öffentliche Update-Adresse darf keine Zugangsdaten, Query oder Fragmente enthalten.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function safeResolve(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Pfad liegt außerhalb des Update-Speichers.");
  return target;
}

export async function sha256File(file) {
  const handle = await fs.open(file, "r");
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream()) {
      bytes += chunk.length;
      hash.update(chunk);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** Names of the packages a release can carry, by kind. */
export function artifactFilename(kind, version) {
  return kind === "renderer" ? `Kiwi-IDE-${version}-renderer.kiwi` : `Kiwi-IDE-${version}-${kind}.exe`;
}

function normalizeArtifact({ filename, sha256, bytes, mainHash }, kind, version, baseUrl, channel) {
  const safeFilename = path.basename(String(filename || ""));
  const expected = artifactFilename(kind, version);
  if (safeFilename !== filename || safeFilename.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Ungültiger ${kind === "portable" ? "Portable-" : kind === "renderer" ? "Renderer-" : "Installer-"}Dateiname.`);
  }
  const normalizedHash = String(sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new Error("Ungültige SHA-256-Prüfsumme.");
  const normalizedBytes = Number(bytes);
  if (!Number.isSafeInteger(normalizedBytes) || normalizedBytes <= 0 || normalizedBytes > MAX_UPDATE_BYTES) {
    throw new Error("Ungültige Paketgröße.");
  }
  // A renderer bundle is only installable on the exact main process it was
  // built against, so the manifest has to carry that fingerprint. Without it
  // a client could never tell whether skipping the installer is safe.
  const normalizedMainHash = String(mainHash || "").toLowerCase();
  if (kind === "renderer" && !/^[a-f0-9]{64}$/.test(normalizedMainHash)) {
    throw new Error("Dem Renderer-Paket fehlt die Prüfsumme des Hauptprozesses.");
  }
  return {
    filename: safeFilename,
    url: `${baseUrl}/v1/releases/${channel}/${encodeURIComponent(version)}/${encodeURIComponent(safeFilename)}`,
    sha256: normalizedHash,
    bytes: normalizedBytes,
    ...(kind === "renderer" ? { mainHash: normalizedMainHash } : {}),
  };
}

export function createManifest({
  channel,
  version,
  filename,
  sha256,
  bytes,
  portable,
  renderer,
  releaseNotes = "",
  publishedAt,
  publicBaseUrl,
}) {
  const normalizedChannel = assertChannel(channel);
  const parsedVersion = parseVersion(version);
  if (normalizedChannel === "stable" && parsedVersion.prerelease.length) {
    throw new Error("Vorabversionen dürfen nicht im Stable-Kanal veröffentlicht werden.");
  }
  const baseUrl = assertPublicBaseUrl(publicBaseUrl);
  const setupArtifact = normalizeArtifact({ filename, sha256, bytes }, "setup", parsedVersion.value, baseUrl, normalizedChannel);
  const portableArtifact = portable
    ? normalizeArtifact(portable, "portable", parsedVersion.value, baseUrl, normalizedChannel)
    : undefined;
  const rendererArtifact = renderer
    ? normalizeArtifact(renderer, "renderer", parsedVersion.value, baseUrl, normalizedChannel)
    : undefined;
  return {
    schemaVersion: 3,
    channel: normalizedChannel,
    version: parsedVersion.value,
    // Schema-1/2 clients continue to consume the setup package from these
    // fields. Schema-3 clients choose an artifact for their runtime instead.
    url: setupArtifact.url,
    sha256: setupArtifact.sha256,
    bytes: setupArtifact.bytes,
    artifacts: {
      setup: setupArtifact,
      ...(portableArtifact ? { portable: portableArtifact } : {}),
      ...(rendererArtifact ? { renderer: rendererArtifact } : {}),
    },
    releaseNotes: String(releaseNotes || `Kiwi IDE ${parsedVersion.value}`).slice(0, 20_000),
    publishedAt: publishedAt || new Date().toISOString(),
  };
}

export async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}
