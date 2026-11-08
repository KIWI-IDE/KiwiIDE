const fs = require("node:fs");

/**
 * "tail -f" for a single file, in the main process.
 *
 * One file is followed at a time — the Tailer tool window shows one log. A
 * short poll reads whatever was appended, splits it on newlines and streams
 * complete lines to the renderer. It notices the three things a log file does
 * between restarts: it grows (normal), it shrinks (truncate or rotation, so the
 * view is reset and the new file read from the top) and it goes missing for a
 * moment (we wait for it to come back).
 *
 * The renderer trusts nothing here: the path is run through the PathGuard, so a
 * file can only be followed once it sits inside an opened project or was picked
 * through the native dialog (which registers it).
 */
const POLL_MS = 150;
const DEFAULT_LAST_LINES = 500;
const MAX_CHUNK = 1 << 20; // 1 MB per poll is plenty for a log view
const NL = 0x0a;
const CR = 0x0d;

class TailerService {
  /**
   * @param {{ assertAllowed: (candidate: string) => string }} guard
   * @param {(channel: string, payload: unknown) => void} send streams to the workbench
   */
  constructor(guard, send) {
    this.guard = guard;
    this.send = send;
    this.fd = null;
    this.path = "";
    this.position = 0;
    this.lastLines = DEFAULT_LAST_LINES;
    this.carry = Buffer.alloc(0);
    this.fileIdentity = null;
    this.available = null;
    this.timer = null;
  }

  /** Starts following {@code file}; any file already followed is dropped. */
  open(file, options = {}) {
    const resolved = this.guard.assertAllowed(typeof file === "string" ? file : file?.path);
    this.stop();
    this.path = resolved;
    this.lastLines = Number.isFinite(options.lastLines) ? Math.max(0, options.lastLines) : DEFAULT_LAST_LINES;
    this.position = 0;
    this.carry = Buffer.alloc(0);
    this.fileIdentity = null;
    this.available = null;
    this.send("tailer:reset", { path: resolved });
    // Read the existing tail right away rather than waiting a poll.
    this._pollSafely();
    this.timer = setInterval(() => this._pollSafely(), POLL_MS);
    return { path: resolved };
  }

  /** Stops following and releases the file. The view keeps what it has. */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._closeFd();
    this.carry = Buffer.alloc(0);
    this.position = 0;
    this.path = "";
    this.fileIdentity = null;
    this.available = null;
    return true;
  }

  // ---- internals -------------------------------------------------------

  _setAvailable(available) {
    if (this.available === available) return;
    this.available = available;
    this.send("tailer:status", { path: this.path, available });
  }

  /** Byte offset where the last {@code lastLines} lines begin. */
  _startForLastLines(size) {
    if (size === 0) return 0;
    const buf = Buffer.alloc(8192);
    let pos = size;
    let newlines = 0;
    while (pos > 0) {
      const chunk = Math.min(buf.length, pos);
      const readStart = pos - chunk;
      fs.readSync(this.fd, buf, 0, chunk, readStart);
      for (let i = chunk - 1; i >= 0; i--) {
        if (buf[i] === NL) {
          newlines++;
          if (newlines > this.lastLines) return readStart + i + 1;
        }
      }
      pos = readStart;
    }
    return 0;
  }

  _pollSafely() {
    try {
      this._poll();
    } catch (error) {
      this._setAvailable(false);
      this.send("tailer:error", { path: this.path, message: error instanceof Error ? error.message : String(error) });
    } finally {
      // Reopen the current path on the next poll instead of continuing to
      // follow an old descriptor after the writer replaces the file.
      this._closeFd();
    }
  }

  _poll() {
    if (!this.path) return;

    try {
      this.fd = fs.openSync(this.path, "r");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this._setAvailable(false);
      return;
    }

    const stat = fs.fstatSync(this.fd);
    const size = stat.size;
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    if (this.fileIdentity === null) {
      this.position = this.lastLines <= 0 ? size : this._startForLastLines(size);
    } else if (identity !== this.fileIdentity || size < this.position) {
      // A replacement may already be larger than the old file. Size alone
      // cannot distinguish it from an append; compare the file identity too.
      this.position = 0;
      this.carry = Buffer.alloc(0);
      this.send("tailer:reset", { path: this.path });
    }
    this.fileIdentity = identity;
    this._setAvailable(true);
    if (size > this.position) {
      this._read(size);
    }
  }

  _read(size) {
    const total = size - this.position;
    const buf = Buffer.alloc(Math.min(MAX_CHUNK, total));
    let readFrom = this.position;
    let remaining = total;
    const lines = [];

    while (remaining > 0) {
      const want = Math.min(buf.length, remaining);
      const bytes = fs.readSync(this.fd, buf, 0, want, readFrom);
      if (bytes <= 0) break;
      readFrom += bytes;
      remaining -= bytes;
      this.carry = Buffer.concat([this.carry, buf.subarray(0, bytes)]);
      let index;
      while ((index = this.carry.indexOf(NL)) !== -1) {
        let line = this.carry.subarray(0, index);
        if (line.length > 0 && line[line.length - 1] === CR) {
          line = line.subarray(0, line.length - 1); // strip \r of \r\n
        }
        lines.push(line.toString("utf8"));
        this.carry = this.carry.subarray(index + 1);
      }
    }
    this.position = readFrom;
    if (lines.length > 0) {
      this.send("tailer:lines", { path: this.path, lines });
    }
  }

  _closeFd() {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // already gone
      }
      this.fd = null;
    }
  }
}

module.exports = { TailerService };
