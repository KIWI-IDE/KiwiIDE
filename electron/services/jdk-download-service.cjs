const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

/**
 * Fetching a Java runtime from Adoptium.
 *
 * Kiwi needs a JDK and cannot compile a line without one, so "install Java
 * first" is the wall a new user hits before they have seen anything. The API is
 * public and needs no account, which is why it can be offered inside the IDE at
 * all.
 *
 * Everything that can be decided without a network is a plain function here —
 * which build belongs to this machine, whether an answer is usable, what the
 * folder will be called. Only three functions reach the network, and each takes
 * its `fetch` as an argument, so the tests never do.
 */

const ADOPTIUM_BASE = "https://api.adoptium.net/v3";
const installLocks = new Map();
const METADATA_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/**
 * One bounded AbortSignal for a network operation.
 *
 * A stalled Adoptium request used to keep the per-version install lock and the
 * Settings button busy forever. The caller may still provide its own signal;
 * the timeout is an independent upper bound and every listener/timer is
 * released as soon as the request finishes.
 */
function requestAbort(options = {}, fallbackMs = METADATA_TIMEOUT_MS) {
  const controller = new AbortController();
  const external = options.signal;
  const configured = options.timeoutMs === 0 ? 0 : Number(options.timeoutMs);
  const timeoutMs = options.timeoutMs === 0
    ? 0
    : Number.isFinite(configured) && configured > 0
      ? configured
      : fallbackMs;
  let timedOut = false;
  const abortFromCaller = () => controller.abort(external?.reason);
  if (external?.aborted) abortFromCaller();
  else external?.addEventListener?.("abort", abortFromCaller, { once: true });
  let timer = null;
  const armTimeout = () => {
    if (timer) clearTimeout(timer);
    timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("network-timeout"));
    }, timeoutMs) : null;
    timer?.unref?.();
  };
  armTimeout();
  return {
    signal: controller.signal,
    // Archive downloads use this as an inactivity timeout. A healthy slow
    // connection may take longer overall, but it must keep delivering bytes.
    touch: armTimeout,
    dispose() {
      if (timer) clearTimeout(timer);
      external?.removeEventListener?.("abort", abortFromCaller);
    },
    failure(error, label) {
      if (timedOut) return new Error(`${label} hat zu lange nicht geantwortet. Bitte prüfe die Internetverbindung und versuche es erneut.`);
      if (external?.aborted) return new Error(`${label} wurde abgebrochen.`);
      return error;
    },
  };
}

function normalizeFeature(feature) {
  const version = Number(feature);
  if (!Number.isInteger(version) || version < 8 || version > 99) {
    throw new Error("Die ausgewählte Java-Version ist ungültig.");
  }
  return version;
}

/** How Adoptium spells the platform this copy of Kiwi is running on. */
function adoptiumPlatform(platform = process.platform, arch = process.arch) {
  const operatingSystems = { win32: "windows", darwin: "mac", linux: "linux" };
  const architectures = { x64: "x64", arm64: "aarch64", ia32: "x86" };
  const os = operatingSystems[platform];
  const architecture = architectures[arch];
  if (!os || !architecture) throw new Error(`Für ${platform}/${arch} bietet Adoptium keine Pakete an.`);
  return { os, architecture };
}

/** The versions worth offering, newest first, with the LTS ones marked. */
function parseAvailableReleases(payload) {
  const available = Array.isArray(payload?.available_releases) ? payload.available_releases : [];
  const lts = new Set(Array.isArray(payload?.available_lts_releases) ? payload.available_lts_releases : []);
  const versions = available
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 8)
    .sort((left, right) => right - left);
  return {
    versions: versions.map((version) => ({ version, lts: lts.has(version) })),
    mostRecentLts: Number(payload?.most_recent_lts) || versions.find((version) => lts.has(version)) || 0,
  };
}

/**
 * Turns byte updates into stable renderer events. The reporter intentionally
 * knows nothing about Electron: main.cjs can direct it to the window that
 * started the download instead of accidentally updating only the editor.
 */
function createProgressReporter(feature, emit) {
  const version = normalizeFeature(feature);
  const publish = typeof emit === "function" ? emit : () => undefined;
  let lastKey = "";
  let latestReceived = 0;
  let latestTotal = 0;
  const report = (phase, received = 0, total = 0, done = false) => {
    const safeReceived = Math.max(0, Number(received) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const percent = done
      ? 100
      : safeTotal > 0
        ? Math.max(0, Math.min(100, Math.floor((safeReceived / safeTotal) * 100)))
        : 0;
    const payload = { feature: version, received: safeReceived, total: safeTotal, percent, phase, done };
    const key = `${phase}:${percent}:${done}`;
    if (key === lastKey) return payload;
    lastKey = key;
    publish(payload);
    return payload;
  };
  return {
    preparing: () => report("preparing"),
    downloading: ({ received, total }) => {
      latestReceived = Math.max(0, Number(received) || 0);
      latestTotal = Math.max(0, Number(total) || 0);
      return report("downloading", latestReceived, latestTotal);
    },
    verifying: () => report("verifying", latestReceived, latestTotal),
    extracting: () => report("extracting", latestReceived, latestTotal),
    installing: () => report("installing", latestReceived, latestTotal),
    complete: () => report("done", 0, 0, true),
  };
}

/**
 * The one usable binary out of an assets answer, or null.
 *
 * A release without a checksum is refused rather than downloaded and hoped
 * about: an unverified JDK is a program that will be handed every keystroke of
 * source code on this machine.
 */
function parseBinary(payload) {
  const asset = Array.isArray(payload) ? payload[0] : payload;
  const binary = asset?.binary || asset?.binaries?.[0];
  const pack = binary?.package;
  if (!pack?.link || !pack?.checksum) return null;
  return {
    release: String(asset?.release_name || "").trim(),
    version: String(asset?.version?.semver || asset?.version?.openjdk_version || "").trim(),
    major: Number(asset?.version?.major) || 0,
    link: String(pack.link),
    checksum: String(pack.checksum).toLowerCase(),
    size: Number(pack.size) || 0,
    name: String(pack.name || path.basename(pack.link)),
  };
}

/**
 * The folder a release is installed into.
 *
 * Adoptium's release names carry characters Windows will not accept in a path,
 * and a name that collides with another vendor's would make two different JDKs
 * look like one.
 */
function installDirectoryName(binary) {
  const base = binary.release || binary.version || `jdk-${binary.major || "unbekannt"}`;
  return `temurin-${base.replace(/^jdk-?/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** Every Java version Adoptium builds for this machine. */
async function listAvailableJdks(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const base = options.base || ADOPTIUM_BASE;
  const request = requestAbort(options);
  try {
    const response = await fetchImpl(`${base}/info/available_releases`, { redirect: "follow", signal: request.signal });
    if (!response.ok) throw new Error(`Adoptium antwortete mit ${response.status}.`);
    return parseAvailableReleases(await response.json());
  } catch (error) {
    throw request.failure(error, "Die Abfrage der Java-Versionen");
  } finally {
    request.dispose();
  }
}

/** What Adoptium would send for one version on this machine. */
async function describeJdk(feature, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const base = options.base || ADOPTIUM_BASE;
  const { os, architecture } = adoptiumPlatform(options.platform, options.arch);
  const query = `architecture=${architecture}&image_type=jdk&os=${os}&vendor=eclipse`;
  const version = normalizeFeature(feature);
  const request = requestAbort(options);
  try {
    const response = await fetchImpl(`${base}/assets/latest/${version}/hotspot?${query}`, { redirect: "follow", signal: request.signal });
    if (!response.ok) throw new Error(`Adoptium antwortete mit ${response.status}.`);
    const binary = parseBinary(await response.json());
    if (!binary) throw new Error(`Für Java ${version} gibt es auf dieser Plattform kein prüfbares Paket.`);
    return binary;
  } catch (error) {
    throw request.failure(error, `Die Abfrage für Java ${version}`);
  } finally {
    request.dispose();
  }
}

/**
 * Streams the archive to disk, hashing it on the way.
 *
 * Reading the whole file again to check it would double the wait for a package
 * of two hundred megabytes, and holding it in memory first is worse still.
 */
async function downloadArchive(binary, target, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => undefined;
  const request = requestAbort(options, DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(binary.link, { redirect: "follow", signal: request.signal });
    if (!response.ok || !response.body) throw new Error(`Der Download antwortete mit ${response.status}.`);
    request.touch();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const hash = crypto.createHash("sha256");
    const handle = await fs.open(target, "w");
    let received = 0;
    let streamCompleted = false;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        hash.update(buffer);
        await handle.write(buffer);
        received += buffer.length;
        onProgress({ received, total: binary.size });
        request.touch();
      }
      streamCompleted = true;
    } finally {
      await handle.close();
      if (!streamCompleted) await fs.rm(target, { force: true }).catch(() => undefined);
    }
    if (typeof options.onPhase === "function") options.onPhase("verifying");
    const digest = hash.digest("hex");
    if (digest !== binary.checksum) {
      await fs.rm(target, { force: true });
      throw new Error("Die Prüfsumme des Downloads stimmt nicht — die Datei wurde verworfen.");
    }
    return { path: target, bytes: received, checksum: digest };
  } catch (error) {
    throw request.failure(error, "Der Java-Download");
  } finally {
    request.dispose();
  }
}

/**
 * The Java home inside an unpacked archive.
 *
 * Every distribution wraps its files in one folder whose name nobody should
 * have to predict, and macOS puts the home three levels further down again.
 */
function findJavaHome(directory, platform = process.platform) {
  const executable = platform === "win32" ? "java.exe" : "java";
  const compiler = platform === "win32" ? "javac.exe" : "javac";
  const queue = [directory];
  for (let depth = 0; depth < 4 && queue.length; depth += 1) {
    const next = [];
    for (const candidate of queue) {
      if (fsSync.existsSync(path.join(candidate, "bin", executable))
        && fsSync.existsSync(path.join(candidate, "bin", compiler))) return candidate;
      let entries = [];
      try {
        entries = fsSync.readdirSync(candidate, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) next.push(path.join(candidate, entry.name));
      }
    }
    queue.length = 0;
    queue.push(...next);
  }
  return "";
}

/**
 * Downloads one Java version and unpacks it under `root`.
 *
 * The archive is removed once it is unpacked, and a half-finished install is
 * cleaned up rather than left to be discovered later as a JDK that does not
 * run.
 */
async function installJdk(feature, root, options = {}) {
  const version = normalizeFeature(feature);
  if (!root || !path.isAbsolute(root)) throw new Error("Für die Java-Installation fehlt ein gültiger Zielordner.");
  const lockKey = `${path.resolve(root).toLocaleLowerCase()}|${version}`;
  const pending = installLocks.get(lockKey);
  if (pending) return pending;
  const installation = performInstallJdk(version, root, options);
  installLocks.set(lockKey, installation);
  try {
    return await installation;
  } finally {
    if (installLocks.get(lockKey) === installation) installLocks.delete(lockKey);
  }
}

async function performInstallJdk(feature, root, options = {}) {
  const onPhase = typeof options.onPhase === "function" ? options.onPhase : () => undefined;
  onPhase("preparing");
  const binary = options.binary || await describeJdk(feature, options);
  const name = installDirectoryName(binary);
  const home = path.join(root, name);
  if (findJavaHome(home, options.platform)) {
    return { installed: false, reason: "already-present", path: findJavaHome(home, options.platform), binary };
  }
  const archiveName = path.basename(String(binary.name || ""));
  if (!archiveName || !/\.(?:zip|tar(?:\.gz|\.xz)?|tgz)$/i.test(archiveName)) {
    throw new Error("Adoptium hat keinen unterstützten JDK-Archivnamen geliefert.");
  }
  const staging = path.join(root, `.${name}.partial`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  const archive = path.join(staging, archiveName);
  try {
    onPhase("downloading");
    await downloadArchive(binary, archive, options);
    onPhase("extracting");
    const extract = options.extract || defaultExtract;
    const unpacked = path.join(staging, "unpacked");
    await fs.mkdir(unpacked, { recursive: true });
    await extract(archive, unpacked);
    await fs.rm(archive, { force: true });
    const extracted = findJavaHome(unpacked, options.platform);
    if (!extracted) throw new Error("Im entpackten Archiv wurde kein vollständiges JDK mit java und javac gefunden.");
    onPhase("installing");
    await fs.mkdir(path.dirname(home), { recursive: true });
    // A killed update may have left this deterministic Kiwi-managed folder in
    // place without a working compiler. Such a folder used to make every
    // later attempt fail with EEXIST; replacing it makes retrying self-healing.
    await fs.rm(home, { recursive: true, force: true });
    await fs.rename(extracted, home);
    return { installed: true, path: home, binary };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Unpacks a zip or a tarball, chosen by what the archive is called. */
async function defaultExtract(archive, destination) {
  if (/\.zip$/i.test(archive)) {
    const extractZip = require("extract-zip");
    await extractZip(archive, { dir: destination });
    return;
  }
  const tar = require("tar");
  await tar.x({ file: archive, cwd: destination });
}

/** The Java installations Kiwi downloaded itself. */
function listDownloadedJdks(root, platform = process.platform) {
  if (!root || !fsSync.existsSync(root)) return [];
  const homes = [];
  for (const entry of fsSync.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const home = findJavaHome(path.join(root, entry.name), platform);
    if (home) homes.push(home);
  }
  return homes;
}

module.exports = {
  ADOPTIUM_BASE,
  adoptiumPlatform,
  describeJdk,
  downloadArchive,
  findJavaHome,
  installDirectoryName,
  installJdk,
  listAvailableJdks,
  listDownloadedJdks,
  parseAvailableReleases,
  parseBinary,
  createProgressReporter,
  normalizeFeature,
};
