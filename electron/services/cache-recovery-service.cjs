const crypto = require("node:crypto");
const { repairSharedCaches } = require("./artifact-cache-service.cjs");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_RECOVERY_BACKUPS = 5;

const CORRUPTION_PATTERNS = [
  /zip end header not found/i,
  /invalid loc header/i,
  /error in opening zip file/i,
  /invalid (?:cen|entry) header/i,
  /checksum (?:failed|mismatch)/i,
  /(?:cache|metadata|workspace|repository).{0,48}(?:corrupt|damaged|invalid|unreadable)/i,
  /(?:corrupt|damaged|invalid|unreadable).{0,48}(?:cache|metadata|workspace|repository)/i,
  /could not read workspace metadata/i,
  /workspace was not properly initialized/i,
  /invalid project description/i,
  /failed to load.*(?:cache|metadata)/i,
];

function buildToolFromCommand(command) {
  const name = path.basename(String(command || "")).toLowerCase();
  if (/^(?:mvn|mvnw)(?:\.cmd|\.bat|\.exe)?$/.test(name)) return "Maven";
  if (/^(?:gradle|gradlew)(?:\.cmd|\.bat|\.exe)?$/.test(name)) return "Gradle";
  return "";
}

function looksLikeCacheCorruption(text) {
  const value = String(text || "");
  return CORRUPTION_PATTERNS.some((pattern) => pattern.test(value));
}

function retryArgsForBuild(tool, args) {
  const current = [...(args || [])];
  if (tool === "Maven" && !current.includes("-o") && !current.includes("--offline") && !current.includes("-U")) {
    current.unshift("-U");
  }
  if (tool === "Gradle" && !current.includes("--offline") && !current.includes("--refresh-dependencies")) {
    current.push("--refresh-dependencies");
  }
  return current;
}

async function moveSafely(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
    return "rename";
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await fs.cp(source, target, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    await fs.stat(target);
    await fs.rm(source, { recursive: true, force: false });
    return "copy";
  }
}

class CacheRecoveryService {
  /**
   * @param sharedCaches where Maven and Gradle keep their downloads. It is a
   *   parameter rather than a lookup because a repair moves files: a test that
   *   forgot to override it would quarantine artifacts out of the developer's
   *   own repository and take them with it when its temp folder is removed.
   */
  constructor(userDataPath, send = () => undefined, sharedCaches = {}) {
    this.userDataPath = path.resolve(userDataPath);
    this.send = send;
    this.sharedCaches = sharedCaches;
    this.recent = new Map();
    this.inFlight = new Set();
  }

  canRecover(key, force = false) {
    if (force) return true;
    const last = this.recent.get(key) || 0;
    return Date.now() - last >= RECOVERY_COOLDOWN_MS;
  }

  markRecovery(key) {
    this.recent.set(key, Date.now());
  }

  reserveRecovery(key, force = false) {
    if (this.inFlight.has(key)) return "in-progress";
    if (!this.canRecover(key, force)) return "cooldown";
    this.inFlight.add(key);
    return "";
  }

  async jdtFailureLooksRecoverable(dataPath, error) {
    if (!dataPath || !fsSync.existsSync(dataPath)) return false;
    const reason = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error || "");
    if (looksLikeCacheCorruption(reason)) return true;
    const metadata = path.join(dataPath, ".metadata");
    if (!fsSync.existsSync(metadata)) return false;
    // A live JVM can remain blocked forever while Eclipse reads damaged
    // workspace state. Language-service timeouts carry this code so one safe
    // rebuild is attempted instead of leaving indexing stuck indefinitely.
    if (error?.code === "KIWI_JDT_TIMEOUT") return true;
    try {
      const log = await fs.readFile(path.join(metadata, ".log"), "utf8");
      if (looksLikeCacheCorruption(log)) return true;
    } catch {}
    // A workspace which already contains Eclipse metadata but whose JVM dies
    // during initialization is safe to rebuild once. The old data is retained
    // in quarantine, so this never destroys a user's project or settings.
    return /unerwartet beendet|connection.*closed|verbindung.*geschlossen|service.*failed/i.test(reason);
  }

  async recoverJdt(root, dataPath, error, options = {}) {
    const hash = crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 20);
    const key = `jdt:${hash}`;
    const reservation = this.reserveRecovery(key, options.force);
    if (reservation) return { recovered: false, reason: reservation };
    try {
      if (!(await this.jdtFailureLooksRecoverable(dataPath, error)) && !options.force) {
        return { recovered: false, reason: "not-corruption" };
      }
      const expectedRoot = path.join(this.userDataPath, "jdtls-workspaces");
      const resolved = path.resolve(dataPath);
      if (resolved !== expectedRoot && !resolved.startsWith(`${expectedRoot}${path.sep}`)) {
        throw new Error("Der JDT-Cache liegt außerhalb des Kiwi-Benutzerdatenordners.");
      }
      if (!fsSync.existsSync(resolved)) return { recovered: false, reason: "missing" };

      const backupRoot = this.createBackupRoot("jdt", hash);
      const target = path.join(backupRoot, "workspace");
      const method = await moveSafely(resolved, target);
      await fs.mkdir(resolved, { recursive: true });
      await this.writeMetadata(backupRoot, { root, scope: "JDT", error, moved: [resolved], method });
      this.markRecovery(key);
      await this.pruneBackups(path.dirname(backupRoot));
      this.send("cache:recovered", { projectRoot: root, scope: "JDT", backupRoot });
      return { recovered: true, backupRoot, moved: [resolved], method };
    } finally {
      this.inFlight.delete(key);
    }
  }

  async recoverBuild(root, tool, error, options = {}) {
    root = path.resolve(root);
    const normalizedTool = tool === "Maven" || tool === "Gradle" ? tool : "Build";
    const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 20);
    const key = `${normalizedTool.toLowerCase()}:${hash}`;
    const reservation = this.reserveRecovery(key, options.force);
    if (reservation) return { recovered: false, reason: reservation };
    try {
      if (!looksLikeCacheCorruption(error) && !options.force) return { recovered: false, reason: "not-corruption" };

      const candidates = [
        path.join(root, ".kiwi", "cache"),
        path.join(root, ".kiwi", "index"),
        path.join(root, ".kiwi", "build-model.json"),
        path.join(root, ".kiwi", "classpath-cache.json"),
        path.join(root, ".kiwi", "sync-state.json"),
        ...(normalizedTool === "Gradle" ? [path.join(root, ".gradle")] : []),
      ];
      // Build caches can be many gigabytes. Keep their quarantine on the same
      // project volume so recovery is an atomic rename even when Electron's
      // userData lives on C: and the project on D:.
      const backupRoot = path.join(
        root,
        ".kiwi",
        "recovery-backups",
        normalizedTool.toLowerCase(),
        `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      );
      const moved = [];
      const methods = [];
      for (const source of candidates) {
        if (!fsSync.existsSync(source)) continue;
        const relative = path.relative(root, source);
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
        const target = path.join(backupRoot, "project-cache", relative);
        methods.push(await moveSafely(source, target));
        moved.push(source);
      }
      // The artifact that actually stranded the build usually is not in the
      // project at all: a truncated jar sits in the shared repository, is used
      // by every project on the machine, and survives any number of local
      // repairs. Maven then refuses to fetch it again because it wrote a
      // marker beside it. Only files that can be shown to be damaged are
      // touched, and they are moved rather than deleted — the shared cache is
      // too expensive to rebuild for a guess.
      const shared = await repairSharedCaches({
        ...this.sharedCaches,
        tool: normalizedTool === "Build" ? "" : normalizedTool,
        quarantineRoot: path.join(backupRoot, "shared-cache"),
      }).catch(() => null);
      await this.writeMetadata(backupRoot, { root, scope: normalizedTool, error, moved, methods, shared });
      this.markRecovery(key);
      await this.pruneBackups(path.dirname(backupRoot));
      this.send("cache:recovered", {
        projectRoot: root,
        scope: normalizedTool,
        backupRoot,
        sharedRemoved: shared?.removed || 0,
      });
      return { recovered: true, backupRoot, moved, retry: normalizedTool, shared };
    } finally {
      this.inFlight.delete(key);
    }
  }

  createBackupRoot(scope, hash) {
    const id = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    return path.join(this.userDataPath, "cache-recovery", scope, hash, id);
  }

  async writeMetadata(backupRoot, value) {
    await fs.mkdir(backupRoot, { recursive: true });
    const serializable = {
      ...value,
      error: value.error instanceof Error ? value.error.message : String(value.error || ""),
      recoveredAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(backupRoot, "recovery.json"), `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
  }

  async pruneBackups(parent) {
    try {
      const entries = (await fs.readdir(parent, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
      await Promise.all(entries.slice(MAX_RECOVERY_BACKUPS).map((name) =>
        fs.rm(path.join(parent, name), { recursive: true, force: true }),
      ));
    } catch {}
  }
}

module.exports = {
  CacheRecoveryService,
  buildToolFromCommand,
  looksLikeCacheCorruption,
  retryArgsForBuild,
  moveSafely,
  RECOVERY_COOLDOWN_MS,
  MAX_RECOVERY_BACKUPS,
};
