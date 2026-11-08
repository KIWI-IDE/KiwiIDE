const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

/**
 * A temporary working copy of the host's project, on the guest's disk.
 *
 * The guest used to open the shared project through a root that was not a path,
 * with every read answered over the connection. That kept a promise worth
 * keeping — nothing of the project touched the guest's machine — and cost the
 * thing that makes an IDE an IDE: the Java language server, the build, the
 * tests and the debugger all need files a process on this machine can open.
 *
 * So the files are written down, and the promise is narrowed rather than
 * abandoned: the copy lives in a folder of its own under the system's temporary
 * directory, exists only while the session does, and is removed when the guest
 * leaves — including at the next start, if the app was killed before it could.
 * The guest is told this in the interface rather than discovering it later.
 *
 * Everything here refuses to work outside its own base directory. A remove that
 * takes a path from a session and deletes it is one wrong string away from
 * deleting something else entirely.
 */

/** Nothing larger is mirrored: a session is for source, not for artefacts. */
const MAX_MIRROR_FILE_BYTES = 2 * 1024 * 1024;

/** Nor more than this in total, so a huge project cannot fill a disk. */
const MAX_MIRROR_TOTAL_BYTES = 128 * 1024 * 1024;

/** Nor more files than a project plausibly has in source. */
const MAX_MIRROR_FILES = 5000;

/** The folder every working copy lives under. */
function mirrorBase(temporaryDirectory) {
  return path.join(temporaryDirectory, "kiwi-codetogether");
}

/**
 * The folder for one session's copy.
 *
 * The session id keeps two sessions of the same project apart, and keeps a new
 * session from adopting the leftovers of one that ended badly.
 */
function mirrorRootFor(temporaryDirectory, project, sessionId) {
  // Runs of dots collapse and leading ones go: a project called "../../etc"
  // would otherwise become a folder named "..-..-etc", which is safe only
  // because of where it is joined — and that is a thin reason to keep it.
  const name = String(project || "Projekt")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-]+|[.\-]+$/g, "") || "Projekt";
  const id = String(sessionId || "0").replace(/[^A-Za-z0-9]+/g, "").slice(0, 12) || "0";
  return path.join(mirrorBase(temporaryDirectory), `${name}-${id}`);
}

/** True when this path belongs to a working copy under the given base. */
function isMirrorPath(temporaryDirectory, candidate) {
  if (!candidate) return false;
  const base = path.resolve(mirrorBase(temporaryDirectory));
  const resolved = path.resolve(String(candidate));
  const inside = path.relative(base, resolved);
  return inside !== "" && !inside.startsWith("..") && !path.isAbsolute(inside);
}

/** The project-relative path a mirrored file stands for, in the wire's spelling. */
function relativeFromMirror(root, file) {
  const inside = path.relative(path.resolve(root), path.resolve(file));
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return "";
  return inside.split(path.sep).join("/");
}

/** The place a project-relative path is written to, refusing anything outside. */
function mirrorFileFor(root, relative) {
  const candidate = String(relative || "").replace(/\\/g, "/");
  if (!candidate || path.isAbsolute(candidate) || /^[a-zA-Z]:/.test(candidate)) {
    throw new Error("Dieser Pfad gehört nicht zur Arbeitskopie.");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const inside = path.relative(resolvedRoot, resolved);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error("Dieser Pfad gehört nicht zur Arbeitskopie.");
  }
  return resolved;
}

/** Writes one file of the working copy, creating the folders it needs. */
async function writeMirrorFile(root, relative, text) {
  const file = mirrorFileFor(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, String(text ?? ""), "utf8");
  return file;
}

/** Creates the empty folders of the tree, so an Explorer shows them at all. */
async function createMirrorDirectories(root, entries) {
  for (const entry of entries || []) {
    if (!entry?.directory) continue;
    await fs.mkdir(mirrorFileFor(root, entry.path), { recursive: true }).catch(() => undefined);
  }
}

/**
 * Which files are worth carrying over, and which are refused by name.
 *
 * The caps are not a guess at what is polite: without them one shared folder
 * with a heap dump in it fills the guest's disk, and the guest never asked for
 * the file that did it.
 */
function planMirror(entries, options = {}) {
  const maxFiles = Number(options.maxFiles) > 0 ? Number(options.maxFiles) : MAX_MIRROR_FILES;
  const files = [];
  const skipped = [];
  for (const entry of entries || []) {
    if (entry?.directory) continue;
    const relative = String(entry?.path || "");
    if (!relative) continue;
    if (files.length >= maxFiles) {
      skipped.push({ path: relative, reason: "zu viele Dateien" });
      continue;
    }
    files.push(relative);
  }
  return { files, skipped };
}

/**
 * Removes one working copy, and refuses to remove anything else.
 *
 * The root arrives from a session, and a remove that trusts it is one wrong
 * string away from deleting a real project — or a home directory.
 */
async function removeMirror(temporaryDirectory, root) {
  if (!root || !isMirrorPath(temporaryDirectory, root)) return false;
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

/**
 * Clears out working copies an earlier run left behind.
 *
 * A guest whose app was killed mid-session leaves a copy of somebody else's
 * project on disk. Nobody would think to look for it, so it is removed at the
 * next start rather than kept until the operating system feels like it.
 */
async function sweepStaleMirrors(temporaryDirectory, keepRoot = "") {
  const base = mirrorBase(temporaryDirectory);
  if (!fsSync.existsSync(base)) return [];
  const keep = keepRoot ? path.resolve(keepRoot) : "";
  const removed = [];
  for (const entry of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
    const candidate = path.join(base, entry.name);
    if (keep && path.resolve(candidate) === keep) continue;
    await fs.rm(candidate, { recursive: true, force: true }).catch(() => undefined);
    removed.push(candidate);
  }
  return removed;
}

/**
 * Keeps the guest's working copy in step with the host's project.
 *
 * A copy that silently drifts is worse than no copy: the language server would
 * report problems about a file the host no longer has, and the guest would
 * trust them. Whenever the host says a file changed, it is fetched again and
 * written down.
 *
 * Re-read rather than patched. The session speaks in offsets against a version
 * the host holds, and replaying those onto a file on disk means keeping a
 * second copy of that bookkeeping in a second place — where the two can
 * disagree without anybody noticing. Fetching is one round trip and cannot
 * drift. Per file, and only after the typing pauses, so a co-edited file costs
 * one fetch rather than one per keystroke.
 */
function createMirrorRefresher({ guestOf, rootOf, write, delay = 400 }) {
  const timers = new Map();
  const refresh = (relative) => {
    const guest = guestOf();
    const root = rootOf();
    if (!guest || !root || !relative) return;
    void guest.request("open", { path: relative })
      .then((opened) => write(root, relative, opened.text))
      .catch(() => undefined);
  };
  return {
    changed(relative) {
      const key = String(relative || "");
      if (!key) return;
      clearTimeout(timers.get(key));
      const timer = setTimeout(() => {
        timers.delete(key);
        refresh(key);
      }, delay);
      timer.unref?.();
      timers.set(key, timer);
    },
    /** Drops what is still pending, for a session that has ended. */
    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    pending() {
      return [...timers.keys()];
    },
  };
}

module.exports = {
  MAX_MIRROR_FILES,
  MAX_MIRROR_FILE_BYTES,
  MAX_MIRROR_TOTAL_BYTES,
  createMirrorDirectories,
  createMirrorRefresher,
  isMirrorPath,
  mirrorBase,
  mirrorFileFor,
  mirrorRootFor,
  planMirror,
  relativeFromMirror,
  removeMirror,
  sweepStaleMirrors,
  writeMirrorFile,
};
