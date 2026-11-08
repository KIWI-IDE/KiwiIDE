const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

/**
 * CodeToGetter — two developers on one project when only one of them has it.
 *
 * The host keeps the project, the disk and the toolchain. The guest keeps
 * nothing: it never writes a file, never resolves a path of its own, and holds
 * no copy of the project when the session ends. Everything it sees is served
 * over one connection, and everything it changes is applied on the host's disk
 * by the host.
 *
 * The connection is direct, host to guest, with no server in between. Kiwi is
 * a local IDE with no accounts and reaches the network nowhere except the JDK
 * download; routing somebody's source code through a third machine would be a
 * change of character, not a feature. The connection is encrypted end to end
 * with keys both sides derive from the invite — see collab-secure-channel.cjs
 * — so a host that is reachable across the internet is not a host whose
 * project can be read on the way. The invite is the key, which is why the
 * interface says so where it is copied.
 *
 * Both ends are Kiwi, so there is no browser to satisfy and no WebSocket
 * handshake to implement: the wire is newline-delimited JSON over TCP. JSON
 * escapes newlines, so a line is always exactly one message, and a file's
 * contents can travel in one without any framing of its own.
 */

/** Messages larger than this are refused rather than buffered. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

/** A collaborative editor is for source text, not archives or heap dumps. */
const MAX_SHARED_FILE_BYTES = 5 * 1024 * 1024;

/** Directories never worth sending to a guest. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".gradle", ".kiwi", "build", "target", "out", "bin", ".idea", "dist",
]);

/** How many entries one tree listing may carry. */
const MAX_TREE_ENTRIES = 20_000;

/** Rejects entries which are intentionally absent from the shared tree. */
function assertShareableRelative(relative) {
  const candidate = String(relative || "").replace(/\\/g, "/");
  const parts = candidate.split("/").filter(Boolean);
  const ignored = new Set([...IGNORED_DIRECTORIES].map((entry) => entry.toLowerCase()));
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (ignored.has(lower) || (part.startsWith(".") && part !== ".gitignore")) {
      throw new Error("Dieser Pfad ist nicht für CodeToGetter freigegeben.");
    }
  }
}

/**
 * What a guest is allowed to do in a session.
 *
 * Reading is the default and editing is granted, never the other way round: a
 * host who forgets to set anything has shared a project nobody can change,
 * which is recoverable — the opposite is not.
 */
const COLLAB_ROLES = ["lesen", "bearbeiten"];

/** The role an untrusted value stands for, falling back to the safer one. */
function normalizeRole(value, fallback = "lesen") {
  const candidate = String(value || "").trim().toLowerCase();
  if (COLLAB_ROLES.includes(candidate)) return candidate;
  return COLLAB_ROLES.includes(fallback) ? fallback : "lesen";
}

/**
 * What a guest is allowed to do, one answer per thing.
 *
 * A role was one of two words, and "bearbeiten" quietly meant every dangerous
 * thing at once. These are separate because they are separately dangerous:
 * editing a buffer is not saving it, and neither is running a build, starting
 * a debugger, opening a shell on the host's machine, or pushing a branch.
 */
const COLLAB_PERMISSIONS = ["bearbeiten", "speichern", "build", "debug", "terminal", "git"];

/** What each of the two older roles means in the newer terms. */
const ROLE_PERMISSIONS = {
  lesen: [],
  bearbeiten: ["bearbeiten", "speichern"],
};

/**
 * The permissions an untrusted value stands for.
 *
 * Anything unrecognised is dropped rather than guessed at, and a session that
 * only ever spoke of roles still gets the right answer through its role.
 */
function normalizePermissions(value, role = "lesen") {
  if (!Array.isArray(value)) return [...(ROLE_PERMISSIONS[normalizeRole(role)] || [])];
  const wanted = new Set(value.map((item) => String(item || "").trim().toLowerCase()));
  return COLLAB_PERMISSIONS.filter((permission) => wanted.has(permission));
}

/**
 * The things a guest may ask the host's machine to do.
 *
 * The build, debug and terminal permissions existed for a while and granted
 * nothing: output flowed to guests, and starting anything was the host's alone.
 * A permission that grants nothing is worse than no permission, because it
 * reads like a promise.
 */
const SHARED_ACTIONS = ["build", "test", "run", "debug"];

/**
 * The permission an action needs.
 *
 * Running and testing are builds in every way that matters here: they compile
 * the host's code and start a process on the host's machine. Debugging is
 * separate because it also stops that process wherever it likes.
 */
function permissionForAction(action) {
  const candidate = String(action || "").trim().toLowerCase();
  if (candidate === "debug") return "debug";
  if (candidate === "build" || candidate === "test" || candidate === "run") return "build";
  return "";
}

/** Whether a value names something a guest may ask for at all. */
function isSharedAction(action) {
  return SHARED_ACTIONS.includes(String(action || "").trim().toLowerCase());
}

/**
 * Whether a guest may do one particular thing.
 *
 * Asked on the host and nowhere else. A guest is a program on another machine:
 * whatever its interface shows, the only thing that decides what happens to
 * these files is this check, on the side that owns the disk.
 */
function mayDo(peer, permission) {
  return normalizePermissions(peer?.permissions, peer?.role).includes(permission);
}

/**
 * Whether this role may change the project.
 *
 * Kept because a great deal asks it. It is now the "bearbeiten" permission
 * under its old name.
 */
function mayEdit(role) {
  return normalizeRole(role) === "bearbeiten";
}

/** A token a guest must present. 32 bytes, so guessing is not a strategy. */
function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Compares two tokens without leaking where they start to differ.
 *
 * A plain `===` on a secret answers faster the earlier it finds a mismatch,
 * which is enough to recover the token one character at a time from a machine
 * on the same network.
 */
function tokensMatch(expected, candidate) {
  const left = Buffer.from(String(expected || ""), "utf8");
  const right = Buffer.from(String(candidate || ""), "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * The one string a host sends a guest.
 *
 * Address, port and token travel together because all three are needed and a
 * user asked to copy three separate values will get one of them wrong.
 */
function createInviteCode({ host, port, token, project = "", relay = false }) {
  if (!host || !port || !token) throw new Error("Für einen Einladungscode fehlen Adresse, Port oder Schlüssel.");
  const invite = new URL("kiwi://codetogether/join");
  invite.searchParams.set("host", String(host));
  invite.searchParams.set("port", String(Number(port)));
  invite.searchParams.set("token", String(token));
  if (project) invite.searchParams.set("project", String(project));
  // Says how to reach the host, not merely where: through a relay the guest
  // has to announce itself in the relay's own words first, and a code that
  // did not say so would just look like a host that never answers.
  if (relay) invite.searchParams.set("relay", "1");
  return invite.toString();
}

/** Reads an invite URL back, while retaining the pre-1.3.4 code format. */
function parseInviteCode(code) {
  const trimmed = String(code || "").trim();
  if (!trimmed) throw new Error("Der Einladungscode ist leer.");
  let parsed;
  if (/^kiwi:\/\//i.test(trimmed)) {
    try {
      const invite = new URL(trimmed);
      if (invite.hostname !== "codetogether" || invite.pathname !== "/join") throw new Error("wrong route");
      parsed = {
        h: invite.searchParams.get("host"),
        p: invite.searchParams.get("port"),
        t: invite.searchParams.get("token"),
        n: invite.searchParams.get("project"),
        r: invite.searchParams.get("relay"),
      };
    } catch {
      throw new Error("Die Einladungs-URL ist unlesbar.");
    }
  } else {
    try {
      parsed = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf8"));
    } catch {
      throw new Error("Der Einladungscode ist unlesbar.");
    }
  }
  const host = String(parsed?.h || "").trim();
  const port = Number(parsed?.p);
  const token = String(parsed?.t || "").trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535 || !token) {
    throw new Error("Der Einladungscode ist unvollständig.");
  }
  return { host, port, token, project: String(parsed?.n || ""), relay: parsed?.r === "1" || parsed?.r === 1 };
}

/**
 * The addresses a guest could reach this machine on.
 *
 * Loopback is listed last and only when nothing else exists: an invite that
 * says 127.0.0.1 works on the host's own machine and nowhere else, which is
 * the least useful thing to hand somebody.
 */
function reachableAddresses(interfaces = os.networkInterfaces()) {
  const external = [];
  const loopback = [];
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" && entry.family !== 4) continue;
      if (entry.internal) loopback.push(entry.address);
      else external.push(entry.address);
    }
  }
  return external.length ? external : loopback;
}

/**
 * A path a guest asked for, resolved inside the shared project.
 *
 * The guest sends relative paths and nothing else. Anything absolute, anything
 * that climbs out with `..`, and anything that lands outside the root after
 * resolution is refused — the guest is on the other side of a socket, so this
 * is the only thing standing between a shared project and the whole disk.
 */
function resolveShared(root, relative) {
  const candidate = String(relative || "");
  if (!candidate) throw new Error("Es wurde kein Pfad angegeben.");
  if (path.isAbsolute(candidate) || /^[a-zA-Z]:/.test(candidate)) {
    throw new Error("Nur Pfade innerhalb des geteilten Projekts sind erlaubt.");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const inside = path.relative(resolvedRoot, resolved);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error("Nur Pfade innerhalb des geteilten Projekts sind erlaubt.");
  }
  assertShareableRelative(candidate);
  return resolved;
}

/**
 * Resolves an existing entry and verifies its real path as well.
 *
 * A lexical `..` check is not sufficient when `project/link` is a symlink to
 * a directory outside the project. Guest file operations therefore use this
 * stricter form before reading or writing anything.
 */
async function resolveSharedExisting(root, relative) {
  const resolved = resolveShared(root, relative);
  let realRoot;
  let realTarget;
  try {
    [realRoot, realTarget] = await Promise.all([fs.realpath(path.resolve(root)), fs.realpath(resolved)]);
  } catch {
    throw new Error("Die angeforderte Datei existiert beim Gastgeber nicht.");
  }
  const inside = path.relative(realRoot, realTarget);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error("Nur Pfade innerhalb des geteilten Projekts sind erlaubt.");
  }
  return realTarget;
}

/** Reads a bounded UTF-8 source file and refuses directories and binary data. */
async function readSharedText(root, relative) {
  const absolute = await resolveSharedExisting(root, relative);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error("CodeToGetter kann nur Dateien öffnen.");
  if (stat.size > MAX_SHARED_FILE_BYTES) {
    throw new Error(`Die Datei ist größer als ${Math.floor(MAX_SHARED_FILE_BYTES / 1024 / 1024)} MiB.`);
  }
  const bytes = await fs.readFile(absolute);
  if (bytes.includes(0)) throw new Error("Binärdateien werden nicht über CodeToGetter geöffnet.");
  try {
    return { absolute, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), stat };
  } catch {
    throw new Error("Die Datei ist kein gültiger UTF-8-Text.");
  }
}

/** The project-relative form of an absolute path, in the wire's spelling. */
function shareRelative(root, absolute) {
  return path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join("/");
}

/**
 * Applies one edit to a text.
 *
 * Offsets, not line and column: a line number means nothing once somebody else
 * has inserted a line above it, and every rule below is about offsets moving.
 */
function applyEdit(text, edit) {
  const start = Math.max(0, Math.min(Number(edit?.start) || 0, text.length));
  const end = Math.max(start, Math.min(Number(edit?.end) || 0, text.length));
  return text.slice(0, start) + String(edit?.text ?? "") + text.slice(end);
}

function sharedTextHash(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** How much longer a text becomes when an edit is applied to it. */
function editDelta(edit) {
  return String(edit?.text ?? "").length - (Number(edit.end) - Number(edit.start));
}

/**
 * Moves an edit over one that was already applied, or refuses to.
 *
 * Two people typing in different places is the ordinary case and has to keep
 * working: an edit made against an older version is still meaningful, it just
 * sits at different offsets now. Two people changing the same span is not
 * something this can resolve without inventing an intent neither of them had,
 * so it answers null and the caller resynchronises instead of guessing.
 */
function shiftEdit(edit, applied) {
  const start = Number(edit.start);
  const end = Number(edit.end);
  const appliedStart = Number(applied.start);
  const appliedEnd = Number(applied.end);
  const delta = editDelta(applied);
  // Entirely after what was applied: both ends move by the same amount.
  if (start >= appliedEnd) return { ...edit, start: start + delta, end: end + delta };
  // Entirely before it: nothing moves.
  if (end <= appliedStart) return { ...edit };
  return null;
}

/**
 * Brings an edit written against an older version up to the current one.
 *
 * `history` holds the edits applied since, oldest first.
 */
function rebaseEdit(edit, history) {
  let current = { ...edit };
  for (const applied of history) {
    current = shiftEdit(current, applied);
    if (!current) return null;
  }
  return current;
}

/**
 * One shared document: its text, its version, and what has happened to it.
 *
 * The host is the authority. A guest's edit carries the version it was written
 * against; if the document has moved on, the edit is rebased onto the current
 * text, and only an edit that genuinely collides is rejected.
 */
class SharedDocument {
  constructor(relativePath, text, diskHash = sharedTextHash(text), maxBytes = MAX_SHARED_FILE_BYTES) {
    this.path = relativePath;
    this.text = text;
    this.version = 1;
    /** Applied edits by the version they produced, so a rebase can find them. */
    this.history = new Map();
    /** Text length at each revision retained for a possible stale edit. */
    this.lengths = new Map([[this.version, text.length]]);
    this.dirty = false;
    this.diskHash = diskHash;
    this.maxBytes = maxBytes;
  }

  /** The edits applied after `version`, oldest first. */
  since(version) {
    const edits = [];
    for (let step = Number(version) + 1; step <= this.version; step += 1) {
      const applied = this.history.get(step);
      if (!applied) return null;
      edits.push(applied);
    }
    return edits;
  }

  /**
   * Applies a guest's edit, rebasing it if the document has moved on.
   *
   * Returns what actually happened, because the guest has to be told: an edit
   * that was rebased landed at different offsets than it asked for, and an
   * edit that collided did not land at all.
   */
  apply(edit, baseVersion) {
    if (!Number.isInteger(baseVersion) || baseVersion < 1 || baseVersion > this.version) {
      return { ok: false, reason: "veraltet", text: this.text, version: this.version };
    }
    const baseLength = this.lengths.get(baseVersion);
    if (baseLength === undefined) {
      return { ok: false, reason: "veraltet", text: this.text, version: this.version };
    }
    if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < 0 || edit.end < edit.start || edit.end > baseLength
      || typeof edit.text !== "string") {
      return { ok: false, reason: "ungültig", text: this.text, version: this.version };
    }
    const history = this.since(baseVersion);
    // History is kept bounded, so an edit written against a version that has
    // scrolled out of it cannot be placed. Resynchronising is the honest
    // answer; pretending the offsets still mean something is not.
    if (history === null) return { ok: false, reason: "veraltet", text: this.text, version: this.version };
    const rebased = history.length ? rebaseEdit(edit, history) : { ...edit };
    if (!rebased) return { ok: false, reason: "kollidiert", text: this.text, version: this.version };
    if (rebased.start < 0 || rebased.end < rebased.start || rebased.end > this.text.length) {
      return { ok: false, reason: "ungültig", text: this.text, version: this.version };
    }
    const insertedBytes = Buffer.byteLength(edit.text, "utf8");
    const replacedBytes = Buffer.byteLength(this.text.slice(rebased.start, rebased.end), "utf8");
    const nextBytes = Buffer.byteLength(this.text, "utf8") - replacedBytes + insertedBytes;
    if (insertedBytes > this.maxBytes || nextBytes > this.maxBytes) {
      return { ok: false, reason: "zu groß", text: this.text, version: this.version };
    }
    this.text = applyEdit(this.text, rebased);
    this.version += 1;
    this.dirty = true;
    this.history.set(this.version, rebased);
    this.lengths.set(this.version, this.text.length);
    // Only as much history as a rebase can need. A session that runs for hours
    // must not grow a list of every keystroke it ever saw.
    for (const version of this.history.keys()) {
      if (version <= this.version - 200) this.history.delete(version);
    }
    for (const version of this.lengths.keys()) {
      if (version < this.version - 200) this.lengths.delete(version);
    }
    return { ok: true, edit: rebased, version: this.version, text: this.text };
  }
}

/**
 * Reads the project tree a guest may browse.
 *
 * Bounded on purpose: a guest asking for the tree of a repository with a
 * hundred thousand files must not turn the host's IDE into a stopped program.
 */
async function readSharedTree(root, options = {}) {
  const limit = Number(options.maxEntries) > 0 ? Number(options.maxEntries) : MAX_TREE_ENTRIES;
  const ignored = options.ignored || IGNORED_DIRECTORIES;
  const entries = [];
  let truncated = false;
  const walk = async (directory) => {
    if (truncated) return;
    let listing;
    try {
      listing = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of listing) {
      if (truncated) return;
      if (item.name.startsWith(".") && item.name !== ".gitignore") continue;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) {
        if (ignored.has(item.name)) continue;
        entries.push({ path: shareRelative(root, absolute), directory: true });
        if (entries.length >= limit) { truncated = true; return; }
        await walk(absolute);
        continue;
      }
      if (!item.isFile()) continue;
      entries.push({ path: shareRelative(root, absolute), directory: false });
      if (entries.length >= limit) { truncated = true; return; }
    }
  };
  await walk(path.resolve(root));
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { entries, truncated };
}

/** Splits a stream of newline-delimited JSON into messages. */
function createLineReader(onMessage, onOverflow) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_MESSAGE_BYTES) {
      buffer = "";
      onOverflow?.(new Error("Die Gegenstelle hat eine überlange Nachricht gesendet."));
      return;
    }
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          onOverflow?.(new Error("Die Gegenstelle hat eine unlesbare Nachricht gesendet."));
        }
      }
      index = buffer.indexOf("\n");
    }
  };
}

/** Writes one message as a line. */
function sendMessage(socket, message) {
  if (!socket || socket.destroyed) return;
  socket.write(`${JSON.stringify(message)}\n`);
}

module.exports = {
  COLLAB_PERMISSIONS,
  ROLE_PERMISSIONS,
  normalizePermissions,
  isSharedAction,
  permissionForAction,
  SHARED_ACTIONS,
  mayDo,
  COLLAB_ROLES,
  IGNORED_DIRECTORIES,
  MAX_MESSAGE_BYTES,
  MAX_SHARED_FILE_BYTES,
  SharedDocument,
  applyEdit,
  assertShareableRelative,
  createInviteCode,
  createLineReader,
  createToken,
  editDelta,
  mayEdit,
  normalizeRole,
  parseInviteCode,
  reachableAddresses,
  readSharedTree,
  readSharedText,
  rebaseEdit,
  resolveShared,
  resolveSharedExisting,
  sendMessage,
  sharedTextHash,
  shareRelative,
  shiftEdit,
  tokensMatch,
};
