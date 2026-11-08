const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { manifestTrust, readPublicKeys } = require("./update-signature.cjs");

/**
 * The public halves of the keys releases are signed with.
 *
 * Empty here, and filled by whoever builds a release — from
 * `resources/update-keys.pem` at package time, or from
 * KIWI_UPDATE_PUBLIC_KEYS for a build that keeps its keys elsewhere. A build
 * with none behaves as it always did and says its updates are unsigned;
 * breaking updates for everybody who has not set a key up yet would be a worse
 * outcome than the one being guarded against.
 */
function loadTrustedKeys(explicit, keyFile = "") {
  const listed = Array.isArray(explicit) ? explicit : [];
  if (listed.length) return listed.map(String).filter(Boolean);
  const fromEnvironment = String(process.env.KIWI_UPDATE_PUBLIC_KEYS || "")
    .split("|")
    .map((entry) => entry.trim().replace(/\\n/g, "\n"))
    .filter(Boolean);
  if (fromEnvironment.length) return fromEnvironment;
  // The file a packaged build ships with. Read once at startup and
  // synchronously: an update check that had to wait for a disk read to know
  // whether it may trust anything would be a check with a moment in which it
  // does not.
  if (!keyFile) return [];
  try {
    return readPublicKeys(require("node:fs").readFileSync(keyFile, "utf8"));
  } catch {
    return [];
  }
}

const MAX_UPDATE_BYTES = 600 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const GITHUB_REPOSITORY = "KIWI-IDE/KiwiIDE";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;
const GITHUB_DOWNLOAD_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * electron-builder's assisted NSIS installer understands these switches.
 * `/S` removes the wizard, `--updated` selects the update path and
 * `--force-run` starts the freshly installed Kiwi process when it is done.
 * Keep this in one testable function: omitting any one of the switches turns
 * an apparently automatic update back into an interactive or non-restarting
 * install.
 */
function nsisUpdateArguments(platform = process.platform) {
  if (platform !== "win32") throw new Error("Der automatische NSIS-Updatepfad wird nur unter Windows unterstützt.");
  return ["/S", "--updated", "--force-run"];
}

/**
 * Pure state used by the main-process/renderer flush handshake. BrowserWindow
 * ids are deliberately the only authority: a late or forged acknowledgement
 * from another renderer cannot complete a pending update.
 */
function createUpdatePrepareState(targetIds, requestId = crypto.randomUUID()) {
  const pending = [...new Set((targetIds || [])
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  return {
    requestId: String(requestId),
    pending,
    acknowledged: [],
    failures: [],
  };
}

function acknowledgeUpdatePrepare(state, senderId, acknowledgement) {
  if (!state || !acknowledgement || acknowledgement.requestId !== state.requestId) return state;
  const id = Number(senderId);
  if (!state.pending.includes(id)) return state;
  const pending = state.pending.filter((candidate) => candidate !== id);
  const failure = acknowledgement.ok === false
    ? { id, reason: String(acknowledgement.reason || "Renderer konnte die Sitzung nicht speichern.").slice(0, 500) }
    : null;
  return {
    ...state,
    pending,
    acknowledged: [...state.acknowledged, id],
    failures: failure ? [...state.failures, failure] : [...state.failures],
  };
}

function updatePrepareComplete(state) {
  return Boolean(state && state.pending.length === 0);
}

async function writeAll(handle, value) {
  const chunk = Buffer.from(value);
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("Das Update-Paket konnte nicht vollständig auf den Datenträger geschrieben werden.");
    }
    offset += bytesWritten;
  }
  return chunk;
}

class UpdateService {
  constructor(settings, currentVersion, userDataPath = "", fetchImpl = globalThis.fetch, runtime = {}) {
    if (typeof userDataPath === "function") {
      fetchImpl = userDataPath;
      userDataPath = "";
    }
    this.settings = settings;
    this.currentVersion = parseVersion(currentVersion).value;
    this.userDataPath = userDataPath;
    this.fetchImpl = fetchImpl;
    this.runtime = {
      artifactKind: runtime?.artifactKind === "portable" || runtime?.portableExecutableFile ? "portable" : "setup",
      platform: runtime.platform || process.platform,
      arch: runtime.arch || process.arch,
      githubReleases: runtime.githubReleases === true,
      manifestUpdates: runtime.manifestUpdates !== false,
      portableExecutableFile: String(runtime?.portableExecutableFile || ""),
      // Fingerprint of this build's main process. A release that only changed
      // the renderer offers a bundle carrying the same value, and that is the
      // update Kiwi can apply while it keeps running.
      mainHash: String(runtime?.mainHash || ""),
    };
    this.approvedUpdate = null;
    this.downloads = new Map();
    this.trustedKeys = loadTrustedKeys(runtime?.trustedKeys, runtime?.trustedKeyFile);
  }

  async check() {
    this.approvedUpdate = null;
    const settings = this.settings.get();
    // Managed installations can set a machine-level source without rewriting
    // user settings; an explicit setting always wins.
    const manifestUrl = this.runtime.manifestUpdates
      ? String(settings.updateManifestUrl || process.env.KIWI_UPDATE_MANIFEST_URL || "").trim()
      : "";
    if (!manifestUrl) {
      if (this.runtime.githubReleases) return this.checkGithub(normalizeChannel(settings.updateChannel));
      return {
        configured: false,
        available: false,
        currentVersion: this.currentVersion,
        reason: "Keine Update-Quelle konfiguriert.",
      };
    }
    const channel = normalizeChannel(settings.updateChannel);
    const url = assertHttpsUrl(manifestUrl, "Die Update-Manifest-URL");
    url.searchParams.set("channel", channel);
    const response = await this.fetchImpl(url, {
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": `Kiwi-IDE/${this.currentVersion}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Update-Prüfung fehlgeschlagen (HTTP ${response.status}).`);
    if (response.url) assertHttpsUrl(response.url, "Die endgültige Update-Manifest-URL");
    const manifest = await readManifestResponse(response);
    /*
     * Who wrote it, before what it says.
     *
     * Everything below trusts the manifest: the URL it points at, the checksum
     * it claims, the version it names. TLS protects the road, not the sender —
     * whoever can serve that URL decides what every Kiwi installs, and the
     * checksum they publish will match the file they publish. So the signature
     * is checked first, and a manifest that fails is not read any further.
     */
    const trust = manifestTrust(manifest, this.trustedKeys);
    if (!trust.trusted) throw new Error(trust.error || "Das Update-Manifest ist nicht vertrauenswürdig.");
    const validated = validateManifest(manifest, channel, this.runtime.artifactKind, this.runtime.mainHash);
    const available = compareVersions(validated.version, this.currentVersion) > 0;
    const result = {
      configured: true,
      available,
      currentVersion: this.currentVersion,
      version: validated.version,
      downloadUrl: validated.downloadUrl,
      sha256: validated.sha256,
      bytes: validated.bytes,
      releaseNotes: validated.releaseNotes,
      publishedAt: validated.publishedAt,
      artifactKind: validated.artifactKind,
      filename: validated.filename,
      mainHash: validated.mainHash,
      channel,
      /** Whether the manifest proved who wrote it, and what to say when not. */
      signed: trust.signed,
      signatureWarning: trust.warning || "",
      reason: available ? undefined : `Kiwi ${this.currentVersion} ist aktuell.`,
    };
    return this.approveResult(result);
  }

  async checkGithub(channel) {
    const response = await this.fetchImpl(new URL(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=20`), {
      redirect: "error",
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Kiwi-IDE/${this.currentVersion}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub-Update-Prüfung fehlgeschlagen (HTTP ${response.status}).`);
    const releases = await readManifestResponse(response, 2 * 1024 * 1024, "Die GitHub-Release-Liste");
    if (!Array.isArray(releases)) throw new Error("Die GitHub-Release-Liste ist ungültig.");
    const update = selectGithubUpdate(releases, channel, this.currentVersion, this.runtime);
    return this.approveResult({
      configured: true,
      available: Boolean(update),
      currentVersion: this.currentVersion,
      source: "github",
      channel,
      releaseUrl: GITHUB_RELEASES_URL,
      ...update,
      reason: update ? undefined : "Auf GitHub ist kein neueres passendes Update verfügbar.",
    });
  }

  approveResult(result) {
    if (!result.available) return result;
    result.approvalId = crypto.randomUUID();
    this.approvedUpdate = Object.freeze({ ...result });
    return result;
  }

  async download(update) {
    const approved = this.assertApproved(update);
    const key = `${approved.version}:${approved.artifactKind}:${approved.sha256}`;
    if (this.downloads.has(key)) return this.downloads.get(key);
    const pending = this.downloadApproved(approved).finally(() => this.downloads.delete(key));
    this.downloads.set(key, pending);
    return pending;
  }

  async downloadApproved(approved) {
    if (!this.userDataPath) throw new Error("Kein Update-Verzeichnis konfiguriert.");
    const directory = path.join(this.userDataPath, "updates");
    const target = path.join(
      directory,
      `Kiwi-IDE-${approved.version}-${approved.sha256.slice(0, 12)}-${approved.artifactKind}${artifactExtension(approved.artifactKind)}`,
    );
    await fs.mkdir(directory, { recursive: true });
    const cached = await hashExistingFile(target);
    if (cached && cached.sha256 === approved.sha256 && cached.bytes === approved.bytes) {
      return { path: target, sha256: cached.sha256, bytes: cached.bytes, version: approved.version, artifactKind: approved.artifactKind, cached: true };
    }

    const downloadUrl = assertUpdateDownloadUrl(approved.downloadUrl);
    const response = await this.fetchImpl(downloadUrl, {
      redirect: "follow",
      headers: { Accept: "application/octet-stream", "User-Agent": `Kiwi-IDE/${this.currentVersion}` },
      signal: AbortSignal.timeout(approved.source === "github" ? 900_000 : 120_000),
    });
    if (!response.ok) throw new Error(`Update-Download fehlgeschlagen (HTTP ${response.status}).`);
    if (response.url) {
      const finalUrl = assertHttpsUrl(response.url, "Die endgültige Update-Download-URL");
      if (approved.source === "github" && !GITHUB_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
        throw new Error("Der Update-Download wurde außerhalb von GitHub umgeleitet.");
      }
    }
    const announcedBytes = Number(response.headers?.get?.("content-length") || 0);
    if (announcedBytes && announcedBytes !== approved.bytes) {
      throw new Error("Die angekündigte Download-Größe stimmt nicht mit dem Manifest überein.");
    }

    const temporary = `${target}.${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`;
    const handle = await fs.open(temporary, "wx");
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    try {
      const writeChunk = async (value) => {
        const chunk = Buffer.from(value);
        bytes += chunk.length;
        if (bytes > MAX_UPDATE_BYTES || bytes > approved.bytes) throw new Error("Das Update-Paket ist größer als im Manifest angegeben.");
        hash.update(chunk);
        await writeAll(handle, chunk);
      };
      if (response.body && typeof response.body[Symbol.asyncIterator] === "function") {
        for await (const chunk of response.body) await writeChunk(chunk);
      } else {
        await writeChunk(await response.arrayBuffer());
      }
      await handle.sync();
      await handle.close();
      if (!bytes || bytes !== approved.bytes) throw new Error("Die Größe des Update-Pakets stimmt nicht mit dem Manifest überein.");
      const actualHash = hash.digest("hex");
      if (actualHash !== approved.sha256) throw new Error("Die SHA-256-Prüfsumme des Updates stimmt nicht.");
      // Verify the bytes actually persisted on disk, not only the incoming
      // chunks. A partial filesystem write must never become a trusted EXE.
      const persisted = await hashExistingFile(temporary);
      if (!persisted || persisted.bytes !== approved.bytes || persisted.sha256 !== approved.sha256) {
        throw new Error("Das gespeicherte Update-Paket hat die Datenträgerprüfung nicht bestanden.");
      }
      // A damaged file with the same version/hash-derived name can only be an
      // incomplete Kiwi cache entry. Replacing it is scoped to userData/updates.
      await fs.unlink(target).catch((error) => { if (error?.code !== "ENOENT") throw error; });
      await fs.rename(temporary, target);
      return { path: target, sha256: actualHash, bytes, version: approved.version, artifactKind: approved.artifactKind, cached: false };
    } finally {
      await handle.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  assertApproved(update) {
    if (!this.approvedUpdate) throw new Error("Das Update muss unmittelbar vor dem Download erneut geprüft werden.");
    const keys = ["approvalId", "version", "downloadUrl", "sha256", "bytes", "channel", "artifactKind", "mainHash", "source"];
    if (!update || keys.some((key) => update[key] !== this.approvedUpdate[key])) {
      throw new Error("Die Update-Daten wurden verändert oder sind nicht mehr gültig.");
    }
    return this.approvedUpdate;
  }
}

async function readManifestResponse(response, maxBytes = MAX_MANIFEST_BYTES, label = "Das Update-Manifest") {
  if (Number(response.headers?.get?.("content-length") || 0) > maxBytes) throw new Error(`${label} ist zu groß.`);
  if (typeof response.text === "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`${label} ist zu groß.`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} enthält kein gültiges JSON.`);
    }
  }
  return response.json();
}

/** File extension of each update package, by kind. */
function artifactExtension(artifactKind) {
  return { renderer: ".kiwi", dmg: ".dmg", appimage: ".AppImage" }[artifactKind] || ".exe";
}

function githubPackage(version, { platform, arch, artifactKind }) {
  const prefix = `Kiwi-IDE-${version}`;
  if (platform === "win32" && arch === "x64") {
    return { artifactKind, names: [`${prefix}-${artifactKind}.exe`] };
  }
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) {
    return { artifactKind: "dmg", names: [`${prefix}-${arch}.dmg`] };
  }
  if (platform === "linux" && ["x64", "arm64"].includes(arch)) {
    return {
      artifactKind: "appimage",
      names: arch === "x64" ? [`${prefix}-x86_64.AppImage`, `${prefix}-x64.AppImage`] : [`${prefix}-arm64.AppImage`],
    };
  }
  return null;
}

function selectGithubUpdate(releases, channel, currentVersion, runtime) {
  let update;
  for (const release of releases) {
    if (release?.draft || typeof release?.tag_name !== "string" || !Array.isArray(release.assets)) continue;
    const tag = release.tag_name;
    const version = tag.replace(/^v/i, "");
    const match = version.match(SEMVER_PATTERN);
    if (!match || (channel === "stable" && (release.prerelease || match[4]))) continue;
    if (compareVersions(version, update?.version || currentVersion) <= 0) continue;
    const variant = githubPackage(version, runtime);
    const asset = variant && release.assets.find((entry) => entry?.state === "uploaded"
      && variant.names.includes(entry.name)
      && /^sha256:[a-f0-9]{64}$/i.test(entry.digest || "")
      && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= MAX_UPDATE_BYTES);
    if (!asset) continue;
    const releaseUrl = `${GITHUB_RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
    update = {
      version,
      releaseUrl,
      downloadUrl: `${GITHUB_RELEASES_URL}/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`,
      sha256: asset.digest.slice(7).toLowerCase(),
      bytes: asset.size,
      artifactKind: variant.artifactKind,
      filename: asset.name,
      releaseNotes: String(release.body || "").slice(0, 20_000),
      publishedAt: String(release.published_at || ""),
    };
  }
  return update;
}

/**
 * Picks the package this Kiwi should install.
 *
 * A renderer bundle wins whenever the release published one for exactly this
 * main process, because that is the update that needs no restart. Everything
 * else falls back to the installer or portable EXE of the running runtime.
 */
function selectArtifactKind(artifacts, runtimeKind, mainHash) {
  const renderer = artifacts?.renderer;
  const rendererHash = String(renderer?.mainHash || "");
  if (mainHash && renderer && rendererHash && rendererHash === String(mainHash)) return "renderer";
  return runtimeKind === "portable" ? "portable" : "setup";
}

function validateManifest(manifest, requestedChannel, requestedArtifactKind = "setup", mainHash = "") {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Das Update-Manifest ist ungültig.");
  const schemaVersion = Number(manifest.schemaVersion || 1);
  if (![1, 2, 3].includes(schemaVersion)) throw new Error("Diese Update-Manifest-Version wird nicht unterstützt.");
  const version = parseVersion(manifest.version).value;
  const channel = normalizeChannel(manifest.channel || requestedChannel);
  if (channel !== requestedChannel) throw new Error("Das Update-Manifest gehört zu einem anderen Kanal.");
  if (channel === "stable" && parseVersion(version).prerelease.length) {
    throw new Error("Der Stable-Kanal darf keine Vorabversion anbieten.");
  }
  const artifacts = manifest.artifacts && typeof manifest.artifacts === "object" && !Array.isArray(manifest.artifacts)
    ? manifest.artifacts
    : {};
  const artifactKind = schemaVersion >= 3
    ? selectArtifactKind(artifacts, requestedArtifactKind, mainHash)
    : (requestedArtifactKind === "portable" ? "portable" : "setup");
  if (artifactKind === "portable" && schemaVersion < 3) {
    throw new Error("Für diese Version wurde kein portables Update-Paket veröffentlicht.");
  }
  const artifact = schemaVersion >= 3
    ? artifacts[artifactKind]
    : { url: manifest.url, sha256: manifest.sha256, bytes: manifest.bytes };
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(artifactKind === "portable"
      ? "Für diese Version wurde kein portables Update-Paket veröffentlicht."
      : "Das Update-Manifest enthält keinen Setup-Installer.");
  }
  const expectedFilename = `Kiwi-IDE-${version}-${artifactKind}${artifactExtension(artifactKind)}`;
  const filename = schemaVersion >= 3 ? String(artifact.filename || "") : expectedFilename;
  if (schemaVersion >= 3 && filename.toLocaleLowerCase() !== expectedFilename.toLocaleLowerCase()) {
    throw new Error(`Das Update-Manifest enthält keinen gültigen ${artifactKind === "portable" ? "Portable" : artifactKind === "renderer" ? "Renderer" : "Setup"}-Dateinamen.`);
  }
  const downloadUrl = assertUpdateDownloadUrl(artifact.url);
  const sha256 = String(artifact.sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Das Update-Manifest enthält keine gültige SHA-256-Prüfsumme.");
  const bytes = Number(artifact.bytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPDATE_BYTES) {
    throw new Error("Das Update-Manifest enthält keine gültige Installer-Größe.");
  }
  const publishedAt = String(manifest.publishedAt || "");
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error("Das Veröffentlichungsdatum im Update-Manifest ist ungültig.");
  return {
    version,
    channel,
    downloadUrl,
    sha256,
    bytes,
    artifactKind,
    filename,
    mainHash: artifactKind === "renderer" ? String(artifact.mainHash || "") : "",
    releaseNotes: String(manifest.releaseNotes || "").slice(0, 20_000),
    publishedAt,
  };
}

function parseVersion(value) {
  const version = String(value || "").trim();
  const match = version.match(SEMVER_PATTERN);
  if (!match) throw new Error("Das Update-Manifest enthält keine gültige Version.");
  return {
    value: version,
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(left, right) {
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

function normalizeChannel(value) {
  const channel = String(value || "stable").trim().toLowerCase();
  // Canary is beta's faster sibling: the same prereleases, published sooner
  // and with no promise that any of them lasts. Kept a separate channel rather
  // than a flag on beta so that nobody lands on it by accident.
  if (!["stable", "beta", "canary"].includes(channel)) throw new Error("Unbekannter Update-Kanal.");
  return channel;
}

function assertHttpsUrl(value, label = "Die URL") {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} ist ungültig.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} muss HTTPS verwenden.`);
  if (url.username || url.password || url.hash) throw new Error(`${label} darf keine Zugangsdaten oder Fragmente enthalten.`);
  return url;
}

function assertUpdateDownloadUrl(value) {
  return assertHttpsUrl(value, "Der Update-Download").toString();
}

async function hashExistingFile(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream()) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    return { bytes, sha256: hash.digest("hex") };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

module.exports = {
  UpdateService,
  artifactExtension,
  compareVersions,
  assertUpdateDownloadUrl,
  selectArtifactKind,
  validateManifest,
  parseVersion,
  nsisUpdateArguments,
  createUpdatePrepareState,
  acknowledgeUpdatePrepare,
  updatePrepareComplete,
  writeAll,
};
