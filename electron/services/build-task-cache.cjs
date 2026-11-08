const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

/** Bumped when the stored shape changes, so old files are simply ignored. */
const TASK_CACHE_SCHEMA = 1;

/**
 * The build files a task list depends on.
 *
 * Asking Gradle what tasks exist costs a configuration phase — thirteen
 * seconds on a small build, more on a real one — and the answer only changes
 * when one of these files does. Watching their timestamps is cheaper than the
 * question by four orders of magnitude, and it is self-healing: a file edited
 * outside Kiwi invalidates the entry just as a file edited inside it does.
 */
function buildFilesFor(root, type, subprojects = []) {
  const names = type === "Maven"
    ? [
      "pom.xml",
      // The wrapper decides which Maven runs, and a different one reports
      // different goals while every pom stays byte for byte the same.
      ".mvn/wrapper/maven-wrapper.properties",
    ]
    : [
      "settings.gradle.kts",
      "settings.gradle",
      "build.gradle.kts",
      "build.gradle",
      "gradle.properties",
      "gradle/libs.versions.toml",
      // Same for Gradle: upgrading the wrapper changes the version that
      // answers, and with it the tasks and the groups it puts them in.
      "gradle/wrapper/gradle-wrapper.properties",
    ];
  const files = names.map((name) => path.join(root, name));
  for (const relative of subprojects) {
    const directory = path.resolve(root, ...String(relative).split(/[\\/:]+/).filter(Boolean));
    // Never leave the project: a settings file may name anything at all, and a
    // path outside the workspace is not ours to stat.
    if (directory !== path.resolve(root) && !directory.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    for (const name of type === "Maven" ? ["pom.xml"] : ["build.gradle.kts", "build.gradle"]) {
      files.push(path.join(directory, name));
    }
  }
  return [...new Set(files)];
}

/**
 * When each of those files was last written, missing ones included.
 *
 * A file that does not exist is recorded as 0 rather than left out, so
 * creating one is a change and not merely a longer list.
 */
async function stampFiles(files) {
  const stamps = {};
  await Promise.all(files.map(async (file) => {
    stamps[file] = await fs.stat(file).then((info) => info.mtimeMs).catch(() => 0);
  }));
  return stamps;
}

/** Whether every file still carries the timestamp the entry was built with. */
async function stampsMatch(stamps) {
  const current = await stampFiles(Object.keys(stamps || {}));
  return Object.entries(stamps || {}).every(([file, when]) => current[file] === when);
}

/**
 * The one spelling of a path this cache files an answer under.
 *
 * Callers spell the same project differently — the startup preload uses the
 * workspace state's path, the renderer its own — and on Windows those differ
 * in slashes and in case. Normalising inside the cache rather than at every
 * call site means nobody can forget: every entry was once written under one
 * key and looked up under another, and the cache never answered at all.
 *
 * Deliberately not PathGuard's normalize: a cache key is needed for paths that
 * are not registered workspaces, and that method refuses them.
 */
function cacheKeyFor(root) {
  const resolved = path.resolve(String(root || ""));
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}

/**
 * Task lists kept per project, valid until a build file changes.
 *
 * Kept in memory and, when a directory is given, on disk as well. The whole
 * point of an entry is that it can be proven current, and the timestamps do
 * that across a restart just as well as within one — a build file edited while
 * Kiwi was closed invalidates the entry the moment it is read back.
 *
 * What timestamps alone cannot see is the tool changing underneath an
 * unchanged build: a different bundled Gradle, a Kiwi that parses the task
 * list differently. Those go into the fingerprint, and an entry whose
 * fingerprint does not match is discarded unread.
 */
class BuildTaskCache {
  constructor({ directory = "", fingerprint = "" } = {}) {
    this.entries = new Map();
    this.directory = directory;
    this.fingerprint = String(fingerprint || "");
  }

  /** The file one project's task list lives in, or "" when nothing is stored. */
  fileFor(root) {
    if (!this.directory) return "";
    const resolved = path.resolve(String(root || ""));
    // Hashed: a project path can be longer than a file name may be and holds
    // characters a file name may not. The readable part stays in front so the
    // directory can be looked at by a person.
    const hash = crypto.createHash("sha256").update(resolved.toLowerCase()).digest("hex").slice(0, 16);
    const name = path.basename(resolved).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "projekt";
    return path.join(this.directory, `${name}-${hash}.json`);
  }

  /** The stored answer for a project, if its build files are untouched. */
  async get(root) {
    const key = cacheKeyFor(root);
    const entry = this.entries.get(key) || await this.readFromDisk(root);
    if (!entry) return null;
    if (!await stampsMatch(entry.stamps)) {
      this.entries.delete(key);
      await this.forgetOnDisk(root);
      return null;
    }
    this.entries.set(key, entry);
    return entry.value;
  }

  async set(root, value, files) {
    const entry = { value, stamps: await stampFiles(files) };
    this.entries.set(cacheKeyFor(root), entry);
    await this.writeToDisk(root, entry);
    return value;
  }

  clear(root = "") {
    if (root) {
      this.entries.delete(cacheKeyFor(root));
      void this.forgetOnDisk(root);
    } else {
      this.entries.clear();
    }
  }

  get size() {
    return this.entries.size;
  }

  /**
   * Reads an entry back from disk.
   *
   * Every failure is the same answer — nothing stored. A file that is missing,
   * truncated, from another Kiwi or written by a different toolchain is not an
   * error to report; it is a task list that will simply be read again.
   */
  async readFromDisk(root) {
    const file = this.fileFor(root);
    if (!file) return null;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.schema !== TASK_CACHE_SCHEMA) return null;
      if (parsed.fingerprint !== this.fingerprint) return null;
      if (!parsed.stamps || typeof parsed.stamps !== "object") return null;
      if (!parsed.value || typeof parsed.value !== "object") return null;
      return { value: parsed.value, stamps: parsed.stamps };
    } catch {
      return null;
    }
  }

  async writeToDisk(root, entry) {
    const file = this.fileFor(root);
    if (!file) return;
    try {
      await fs.mkdir(this.directory, { recursive: true });
      // Temp file plus rename: a crash mid-write leaves the previous entry
      // whole rather than half of this one.
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({
        schema: TASK_CACHE_SCHEMA,
        fingerprint: this.fingerprint,
        root: path.resolve(String(root || "")),
        savedAt: Date.now(),
        stamps: entry.stamps,
        value: entry.value,
      }), "utf8");
      await fs.rename(temporary, file);
    } catch {
      // A task list that could not be stored costs the next start a few
      // seconds. It is not worth interrupting anybody over.
    }
  }

  async forgetOnDisk(root) {
    const file = this.fileFor(root);
    if (!file) return;
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

module.exports = { BuildTaskCache, TASK_CACHE_SCHEMA, buildFilesFor, cacheKeyFor, stampFiles, stampsMatch };
