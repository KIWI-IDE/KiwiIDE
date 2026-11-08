const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * The open tabs and their unsaved drafts, on disk.
 *
 * They used to live in the renderer's local storage, which is the wrong place
 * for exactly the case they exist for. Chromium writes local storage to disk
 * on its own schedule; a process that is killed loses whatever had not been
 * flushed yet — and measuring it showed that is not a rare edge but the normal
 * outcome. The draft written a second before the crash was gone, and the
 * restore then wrote its empty result back over what was left.
 *
 * So the session goes through the main process, where a write can be waited
 * for. Atomically: a temporary file and a rename, so a crash during the write
 * leaves the previous session intact rather than half of the new one.
 */

/** Nothing larger is stored: a session is tabs and drafts, not a repository. */
const MAX_SESSION_BYTES = 8 * 1024 * 1024;

class SessionStoreService {
  /**
   * `folder` says which kind of record this instance keeps.
   *
   * The editor states use the same store under a name of their own: the
   * writing, the atomic rename and the per-project serialisation are the same
   * problem, and solving it twice is how the two would drift apart.
   */
  constructor(userDataPath, pathGuard, folder = "sessions") {
    this.directory = path.join(userDataPath, folder);
    this.pathGuard = pathGuard;
    /** One write at a time per project, so two saves cannot interleave. */
    this.writing = new Map();
  }

  /**
   * The file one project's session lives in.
   *
   * Hashed, because a project path can be longer than a file name may be and
   * contains characters a file name may not. The readable part is kept in
   * front so the directory can be looked at by a person.
   */
  fileFor(root) {
    const resolved = path.resolve(String(root || ""));
    const hash = crypto.createHash("sha256").update(resolved.toLowerCase()).digest("hex").slice(0, 16);
    const name = path.basename(resolved).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "projekt";
    return path.join(this.directory, `${name}-${hash}.json`);
  }

  /**
   * Writes one project's session.
   *
   * Serialised per project and awaited by the caller, so "saved" means the
   * bytes reached the disk rather than a buffer somewhere.
   */
  async save(root, payload) {
    const target = this.pathGuard ? this.pathGuard.assertWorkspace(root) : root;
    const file = this.fileFor(target);
    const text = JSON.stringify({ root: path.resolve(target), savedAt: Date.now(), ...payload });
    if (Buffer.byteLength(text, "utf8") > MAX_SESSION_BYTES) {
      throw new Error("Die Sitzung ist zu groß, um gesichert zu werden.");
    }
    const previous = this.writing.get(file) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      // Temp file plus rename: a crash during the write leaves the previous
      // session whole instead of half of this one.
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, text, "utf8");
      await renameWithRetry(temporary, file);
    });
    this.writing.set(file, next);
    await next;
    return { saved: true, file };
  }

  /** Reads it back. Answers null for a project that has none. */
  async load(root) {
    const target = this.pathGuard ? this.pathGuard.assertWorkspace(root) : root;
    try {
      const text = await fs.readFile(this.fileFor(target), "utf8");
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      // A missing or unreadable session is not an error: it is a project that
      // has not been open before, which is the common case.
      return null;
    }
  }

  /** Forgets it, for a project being removed from the workspace. */
  async clear(root) {
    const target = this.pathGuard ? this.pathGuard.assertWorkspace(root) : root;
    await fs.rm(this.fileFor(target), { force: true }).catch(() => undefined);
    return { cleared: true };
  }
}

/**
 * Renames over a file Windows may still be holding.
 *
 * The same EPERM that makes a build's jar rename fail: something reads what
 * was just written for a moment. Waiting and trying again is the whole fix.
 */
async function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const retryable = error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES";
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
}

module.exports = { MAX_SESSION_BYTES, SessionStoreService };
