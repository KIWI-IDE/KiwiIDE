const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_PER_WINDOW = 200;

/**
 * Short-lived capabilities for files that a renderer dropped onto the Explorer.
 * The renderer authorizes every dropped file separately, so all tokens issued
 * for one drop must stay valid until `file:importDropped` consumes them.
 */
class DropTokenService {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxPerWindow = DEFAULT_MAX_PER_WINDOW, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxPerWindow = maxPerWindow;
    this.now = now;
    this.tokens = new Map();
  }

  prune(now = this.now()) {
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt <= now) this.tokens.delete(token);
    }
  }

  issue(source, webContentsId) {
    const now = this.now();
    this.prune(now);
    // Only bound the number of outstanding tokens per window; dropping the
    // window's earlier tokens here would leave a multi-file drop with a single
    // importable file.
    const own = [...this.tokens.entries()].filter(([, entry]) => entry.webContentsId === webContentsId);
    for (const [token] of own.slice(0, Math.max(0, own.length + 1 - this.maxPerWindow))) {
      this.tokens.delete(token);
    }
    const value = crypto.randomUUID();
    this.tokens.set(value, { source, webContentsId, expiresAt: now + this.ttlMs });
    return value;
  }

  consume(tokens, webContentsId, limit = 100) {
    const now = this.now();
    const sources = [];
    for (const token of [...new Set(Array.isArray(tokens) ? tokens : [])].slice(0, limit)) {
      const entry = this.tokens.get(token);
      this.tokens.delete(token);
      if (!entry || entry.webContentsId !== webContentsId || entry.expiresAt <= now) continue;
      sources.push(entry.source);
    }
    this.prune(now);
    return sources;
  }

  clear() {
    this.tokens.clear();
  }

  get size() {
    return this.tokens.size;
  }
}

module.exports = { DropTokenService, DEFAULT_TTL_MS, DEFAULT_MAX_PER_WINDOW };
