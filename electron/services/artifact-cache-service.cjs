const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Repair for the shared artifact caches Maven and Gradle download into.
 *
 * The recovery that already exists quarantines what belongs to a project —
 * `.kiwi`, `.gradle`, the JDT workspace — and that is enough when the project's
 * own state went bad. It cannot help with the damage that actually strands a
 * build: a jar that arrived truncated sits in `~/.m2/repository` or
 * `~/.gradle/caches`, is shared by every project on the machine, and survives
 * any number of project-local repairs. Maven then refuses to fetch it again
 * because it wrote a `.lastUpdated` marker beside it.
 *
 * Deleting the whole repository would work and would also throw away gigabytes
 * that are perfectly good. What is removed here is only what can be shown to be
 * damaged, one artifact at a time, and it is moved to a quarantine folder
 * rather than deleted, so a wrong guess costs nothing.
 */

/** Bytes every zip begins with: a local entry, an empty archive, or a spanned one. */
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

/** Archives whose first bytes say whether the download finished. */
const ARCHIVE_SUFFIXES = [".jar", ".zip", ".war", ".ear", ".aar"];

/** Text artifacts that must at least look like XML. */
const DESCRIPTOR_SUFFIXES = [".pom", ".module"];

/** Directories that never hold artifacts and can be skipped whole. */
const SKIPPED_DIRECTORIES = new Set([".locks", "journal-1", "kiwi-quarantine"]);

function hasSuffix(file, suffixes) {
  const lower = file.toLowerCase();
  return suffixes.some((suffix) => lower.endsWith(suffix));
}

/** True when the first bytes are a zip header. */
function looksLikeArchive(head) {
  return ZIP_SIGNATURES.some((signature) => head.length >= signature.length && head.subarray(0, signature.length).equals(signature));
}

/**
 * Where Maven keeps downloaded artifacts.
 *
 * `M2_REPO` wins when it is set, because a developer who moved the repository
 * did so on purpose and repairing the default path would repair nothing.
 */
function mavenRepositoryPath(env = process.env, home = os.homedir()) {
  const explicit = String(env.M2_REPO || "").trim();
  if (explicit) return path.resolve(explicit);
  return path.join(home, ".m2", "repository");
}

/** Where Gradle keeps downloaded modules; `GRADLE_USER_HOME` wins the same way. */
function gradleModulesPath(env = process.env, home = os.homedir()) {
  const explicit = String(env.GRADLE_USER_HOME || "").trim();
  const base = explicit ? path.resolve(explicit) : path.join(home, ".gradle");
  return path.join(base, "caches", "modules-2", "files-2.1");
}

/**
 * What is wrong with one cached file, or "" when nothing is.
 *
 * Each answer is a reason a human can act on, because the reason is what the
 * repair report shows and what makes a removal defensible.
 */
async function describeDamage(file, options = {}) {
  const name = path.basename(file);
  if (name.endsWith(".lastUpdated")) {
    // Maven writes this when a download fails and then treats the failure as
    // the answer until the marker expires. Removing it is the whole repair.
    return "abgebrochener Download (Maven-Marker)";
  }
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return "";
  }
  if (!stat.isFile()) return "";
  if (stat.size === 0) return "leere Datei";
  if (hasSuffix(name, ARCHIVE_SUFFIXES)) {
    let head = Buffer.alloc(0);
    let handle;
    try {
      handle = await fs.open(file, "r");
      const buffer = Buffer.alloc(4);
      const { bytesRead } = await handle.read(buffer, 0, 4, 0);
      head = buffer.subarray(0, bytesRead);
    } catch {
      return "nicht lesbar";
    } finally {
      await handle?.close().catch(() => undefined);
    }
    if (!looksLikeArchive(head)) return "kein gültiges Archiv";
  }
  if (hasSuffix(name, DESCRIPTOR_SUFFIXES)) {
    try {
      const text = await fs.readFile(file, "utf8");
      if (!text.trim()) return "leere Beschreibung";
      // A truncated pom is the second half of the same story as a truncated
      // jar, and Maven reports it as an unhelpful parse error.
      if (name.endsWith(".pom") && !text.includes("</project>")) return "abgeschnittene POM";
    } catch {
      return "nicht lesbar";
    }
  }
  // Checksums cost a full read of the artifact, so they are only verified when
  // the caller asks — a scan after a failed build does, a routine one does not.
  if (options.verifyChecksums) {
    const mismatch = await checksumMismatch(file);
    if (mismatch) return mismatch;
  }
  return "";
}

/** "" when the artifact matches its checksum file, or there is none to match. */
async function checksumMismatch(file) {
  for (const [suffix, algorithm] of [[".sha1", "sha1"], [".md5", "md5"]]) {
    const checksumFile = `${file}${suffix}`;
    let expected;
    try {
      expected = (await fs.readFile(checksumFile, "utf8")).trim().split(/\s+/)[0].toLowerCase();
    } catch {
      continue;
    }
    if (!/^[0-9a-f]{32,40}$/.test(expected)) continue;
    const actual = crypto.createHash(algorithm).update(await fs.readFile(file)).digest("hex");
    if (actual !== expected) return `Prüfsumme stimmt nicht (${algorithm})`;
  }
  return "";
}

/**
 * Every damaged file under one cache directory.
 *
 * The walk is bounded: a repository with a hundred thousand files must not turn
 * a repair into a minute of disk grinding, so it stops at `maxFiles` and says
 * so rather than pretending it saw everything.
 */
async function scanArtifactCache(directory, options = {}) {
  const maxFiles = Number(options.maxFiles) > 0 ? Number(options.maxFiles) : 40_000;
  const result = { directory, scanned: 0, damaged: [], complete: true };
  if (!directory || !fsSync.existsSync(directory)) return { ...result, missing: true };
  const queue = [directory];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (result.scanned >= maxFiles) {
        result.complete = false;
        return result;
      }
      result.scanned += 1;
      const file = path.join(current, entry.name);
      const reason = await describeDamage(file, options);
      if (reason) result.damaged.push({ path: file, reason });
    }
  }
  return result;
}

/**
 * Moves the damaged files aside, keeping their path so they can be put back.
 *
 * Nothing is deleted. A file that turns out to have been fine is one move away
 * from where it was, and the folder says which cache it came from.
 */
async function quarantineDamaged(damaged, backupRoot, cacheRoot) {
  const moved = [];
  const failed = [];
  for (const entry of damaged) {
    const relative = path.relative(cacheRoot, entry.path);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      failed.push({ ...entry, error: "liegt außerhalb des Caches" });
      continue;
    }
    const target = path.join(backupRoot, relative);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(entry.path, target);
      moved.push(entry);
    } catch (error) {
      // A cache on another volume cannot be renamed into the quarantine, and a
      // file another process still holds cannot be moved at all.
      try {
        await fs.copyFile(entry.path, target);
        await fs.rm(entry.path, { force: true });
        moved.push(entry);
      } catch {
        failed.push({ ...entry, error: String(error?.message || error) });
      }
    }
  }
  return { moved, failed };
}

/**
 * Scans both shared caches and quarantines what is damaged.
 *
 * Returns what it found either way, because "nothing was wrong with your
 * caches" is an answer worth showing: it sends the search somewhere else
 * instead of leaving the impression that a repair was attempted and failed.
 */
async function repairSharedCaches(options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const quarantineRoot = options.quarantineRoot
    || path.join(home, ".kiwi-cache-quarantine", String(Date.now()));
  const caches = [
    { tool: "Maven", directory: options.mavenRepository || mavenRepositoryPath(env, home) },
    { tool: "Gradle", directory: options.gradleModules || gradleModulesPath(env, home) },
  ].filter((cache) => !options.tool || options.tool === cache.tool);

  const report = { quarantineRoot: "", caches: [], removed: 0 };
  for (const cache of caches) {
    const scan = await scanArtifactCache(cache.directory, options);
    const entry = {
      tool: cache.tool,
      directory: cache.directory,
      missing: Boolean(scan.missing),
      scanned: scan.scanned,
      complete: scan.complete,
      damaged: scan.damaged,
      moved: [],
      failed: [],
    };
    if (scan.damaged.length && !options.dryRun) {
      const target = path.join(quarantineRoot, cache.tool.toLowerCase());
      const outcome = await quarantineDamaged(scan.damaged, target, cache.directory);
      entry.moved = outcome.moved;
      entry.failed = outcome.failed;
      report.removed += outcome.moved.length;
      if (outcome.moved.length) report.quarantineRoot = quarantineRoot;
    }
    report.caches.push(entry);
  }
  return report;
}

module.exports = {
  ARCHIVE_SUFFIXES,
  checksumMismatch,
  describeDamage,
  gradleModulesPath,
  looksLikeArchive,
  mavenRepositoryPath,
  quarantineDamaged,
  repairSharedCaches,
  scanArtifactCache,
};
