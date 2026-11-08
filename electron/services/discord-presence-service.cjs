/**
 * What Discord shows about Kiwi while it is open.
 *
 * Discord's Rich Presence is not an HTTP API. The client listens on a local
 * named pipe — `\\.\pipe\discord-ipc-0` through `-9` on Windows, a socket of
 * the same name under the runtime directory everywhere else — and speaks a
 * frame format of its own: a little-endian opcode, a little-endian byte count,
 * then UTF-8 JSON. A handshake naming the application comes first, Discord
 * answers with a READY event, and only then does it accept an activity.
 *
 * None of this is allowed to matter to the workbench. Discord not running is
 * the normal case, not an error: the service retries quietly in the background
 * and the IDE never waits on it, never reports it, and never fails because of
 * it.
 *
 * Everything that talks to the outside is injected, so the whole protocol can
 * be exercised in tests without Discord, a pipe, or a clock.
 */
const net = require("node:net");
const path = require("node:path");

/** Discord's frame opcodes. Only three of them are ever sent from here. */
const OPCODE = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

/**
 * How long to leave between activity updates.
 *
 * Discord drops updates that arrive faster than roughly five in twenty seconds
 * and says nothing about it, so a presence that updates on every keystroke
 * ends up showing a file somebody closed ten minutes ago. Updates are coalesced
 * into this window instead: the newest one wins and is sent when the window
 * opens. Fifteen seconds is what the established clients settle on.
 */
const MIN_UPDATE_MS = 15_000;

/** How long to wait before looking for Discord again, and the ceiling on it. */
/**
 * What Discord sends back when the application id is not one of its own.
 *
 * Measured against the running client: opcode 2 with
 * `{"code":4000,"message":"Invalid Client ID"}`. Nothing about retrying
 * makes a wrong id right, so this one is reported instead of retried.
 */
const INVALID_CLIENT_ID = 4000;

const RETRY_START_MS = 20_000;
const RETRY_MAX_MS = 5 * 60_000;

const DEFAULT_APPLICATION_ID = "1565832167433445486";
const DEFAULT_PUBLIC_KEY = "274b823814095d52c69bb51d0f7abac55457ae209a0c271ed82b22fb27d038bf";

/**
 * The art in the Discord application, by key.
 *
 * Uploaded once in the developer portal under this name. A key that is not
 * there leaves the card without a picture; it does not fail.
 */
const LARGE_IMAGE = "kiwi";

/** A frame, as Discord wants it on the wire. */
function encodeFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.alloc(8 + body.length);
  frame.writeInt32LE(opcode, 0);
  frame.writeInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

/**
 * Frames out of a stream that does not respect their boundaries.
 *
 * A socket hands over whatever arrived, which is as likely to be half a header
 * as three whole frames. Everything is buffered until a length is known and a
 * body that long is present.
 */
class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    for (;;) {
      if (this.buffer.length < 8) break;
      const length = this.buffer.readInt32LE(4);
      // A negative or absurd length means the stream is not what it claims to
      // be. Stopping is right: continuing would allocate on a bad number.
      if (length < 0 || length > 4_000_000) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (this.buffer.length < 8 + length) break;
      const opcode = this.buffer.readInt32LE(0);
      const body = this.buffer.subarray(8, 8 + length).toString("utf8");
      this.buffer = this.buffer.subarray(8 + length);
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = null;
      }
      frames.push({ opcode, payload });
    }
    return frames;
  }
}

/** The pipe names Discord may be listening on, in the order to try them. */
function candidateSockets(platform = process.platform, env = process.env) {
  const names = [];
  for (let index = 0; index < 10; index += 1) {
    if (platform === "win32") {
      // Built by hand rather than joined: `path.join` would use the separator
      // of whatever platform is running, and this name has to stay a Windows
      // pipe name even when a test asks for one from somewhere else.
      names.push(`\\\\?\\pipe\\discord-ipc-${index}`);
      continue;
    }
    // Flatpak and Snap put the socket a level down, so the plain runtime
    // directory is not enough on a Linux desktop that installed Discord either
    // of those ways.
    const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
    // `path.posix`, not `path.join`: the latter takes the separator of the
    // host it runs on, which puts backslashes through a socket name that is
    // only ever a POSIX one.
    for (const folder of ["", "app/com.discordapp.Discord", "snap.discord"]) {
      names.push(path.posix.join(base, folder, `discord-ipc-${index}`));
    }
  }
  return names;
}

/**
 * A line of the card, trimmed to what Discord accepts.
 *
 * Fewer than two characters is rejected outright and the whole activity with
 * it, so a one-letter project name has to be dropped rather than sent. Longer
 * than 128 is truncated rather than refused.
 */
function presenceLine(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 2) return "";
  return text.length > 128 ? `${text.slice(0, 127)}…` : text;
}

/**
 * What the card says, from what the workbench is doing.
 *
 * Nothing about the project or the file leaves the machine unless it was
 * switched on: each line is its own setting, and with all of them off the card
 * says only that Kiwi is open.
 */
function buildActivity(state, settings = {}, startedAt) {
  const customDetails = settings.details ? presenceLine(settings.details) : "";
  const customState = settings.state ? presenceLine(settings.state) : "";

  const details = settings.showProject && state.projectName
    ? presenceLine(state.projectName)
    : customDetails;

  const file = settings.showFile && state.fileName ? presenceLine(state.fileName) : "";
  const state_ = file || customState;

  const activity = {
    assets: {
      large_image: settings.largeImageKey || LARGE_IMAGE,
      large_text: presenceLine(settings.largeImageText || `Kiwi IDE ${state.version || ""}`.trim()) || "Kiwi IDE",
    },
  };
  const smallKey = settings.smallImageKey !== undefined ? settings.smallImageKey : LARGE_IMAGE;
  if (smallKey && smallKey !== "Keine") {
    activity.assets.small_image = smallKey;
    activity.assets.small_text = presenceLine(settings.smallImageText || `Kiwi IDE ${state.version || ""}`.trim()) || "Kiwi IDE";
  }
  if (details) activity.details = details;
  if (state_ && state_ !== details) activity.state = state_;
  if (settings.partyId) {
    activity.party = {
      id: settings.partyId,
      size: [Number(settings.partySize) || 1, Number(settings.partyMax) || 5],
    };
  }
  if (settings.joinSecret) {
    activity.secrets = { join: settings.joinSecret };
  }
  if (settings.showElapsed) {
    activity.timestamps = {
      start: settings.startTimestamp ? Number(settings.startTimestamp) : startedAt,
    };
    if (settings.endTimestamp) {
      activity.timestamps.end = Number(settings.endTimestamp);
    }
  }
  return activity;
}

class DiscordPresenceService {
  /**
   * @param {object} options
   * @param {(socketPath: string) => import("node:net").Socket} [options.connect]
   * @param {() => number} [options.now]
   * @param {typeof setTimeout} [options.schedule]
   * @param {typeof clearTimeout} [options.cancel]
   * @param {number} [options.pid] what Discord is told owns the activity
   * @param {(message: string, error?: unknown) => void} [options.log]
   */
  constructor(options = {}) {
    this.connectSocket = options.connect || ((socketPath) => net.connect({ path: socketPath }));
    this.now = options.now || (() => Date.now());
    this.schedule = options.schedule || setTimeout;
    this.cancel = options.cancel || clearTimeout;
    this.pid = options.pid ?? process.pid;
    this.log = options.log || (() => {});
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;

    this.settings = {
      enabled: true,
      applicationId: DEFAULT_APPLICATION_ID,
      publicKey: DEFAULT_PUBLIC_KEY,
      showProject: false,
      showFile: false,
      showElapsed: true,
      state: "",
      details: "",
      largeImageKey: "kiwi",
      largeImageText: "Kiwi IDE",
      smallImageKey: "kiwi",
      smallImageText: "Kiwi IDE",
      partyId: "",
      partySize: 1,
      partyMax: 5,
      joinSecret: "",
    };
    this.state = { projectName: "", fileName: "", version: "" };
    /** When the session the card counts from began. */
    this.startedAt = this.now();

    this.socket = null;
    this.reader = new FrameReader();
    this.ready = false;
    this.candidates = [];
    this.retryDelay = RETRY_START_MS;
    this.retryTimer = null;
    this.flushTimer = null;
    this.lastSentAt = 0;
    this.pendingActivity = null;
    this.nonce = 0;
    this.stopped = false;
    /** Why Discord refused, when it said so. Cleared on a new id. */
    this.rejection = null;
  }

  /** What the settings say now. Only a real change does any work. */
  configure(next = {}) {
    const previous = this.settings;
    const appId = next.applicationId !== undefined
      ? String(next.applicationId || "").trim()
      : (next.enabled !== false ? DEFAULT_APPLICATION_ID : "");
    this.settings = {
      enabled: Boolean(next.enabled),
      applicationId: appId,
      publicKey: String(next.publicKey || DEFAULT_PUBLIC_KEY),
      showProject: next.showProject !== false,
      showFile: next.showFile !== false,
      showElapsed: next.showElapsed !== false,
      state: next.state !== undefined ? next.state : previous.state,
      details: next.details !== undefined ? next.details : previous.details,
      largeImageKey: next.largeImageKey !== undefined ? next.largeImageKey : previous.largeImageKey,
      largeImageText: next.largeImageText !== undefined ? next.largeImageText : previous.largeImageText,
      smallImageKey: next.smallImageKey !== undefined ? next.smallImageKey : previous.smallImageKey,
      smallImageText: next.smallImageText !== undefined ? next.smallImageText : previous.smallImageText,
      partyId: next.partyId !== undefined ? next.partyId : previous.partyId,
      partySize: next.partySize !== undefined ? next.partySize : previous.partySize,
      partyMax: next.partyMax !== undefined ? next.partyMax : previous.partyMax,
      joinSecret: next.joinSecret !== undefined ? next.joinSecret : previous.joinSecret,
    };
    const identityChanged = previous.enabled !== this.settings.enabled
      || previous.applicationId !== this.settings.applicationId;
    if (!this.settings.enabled || !this.settings.applicationId) {
      if (identityChanged || this.socket) this.disconnect();
      return;
    }
    if (identityChanged || !this.socket) {
      if (this.socket) this.disconnect();
      this.rejection = null;
      this.startedAt = this.now();
      this.connect();
      return;
    }
    this.publish();
  }

  /** What the workbench is doing, as far as the card is concerned. */
  setState(next = {}) {
    this.state = {
      projectName: String(next.projectName || ""),
      fileName: String(next.fileName || ""),
      version: String(next.version || this.state.version || ""),
    };
    this.publish();
  }

  /**
   * The card as it stands, without sending anything.
   *
   * The settings page shows this rather than a mock-up of it. A drawing of
   * what Kiwi might share is worth nothing next to the thing itself, and a
   * second implementation of these rules would eventually disagree with the
   * one that does the sending.
   */
  previewActivity() {
    return {
      activity: buildActivity(this.state, this.settings, this.startedAt),
      connected: this.ready,
      configured: Boolean(this.settings.enabled && this.settings.applicationId),
      rejection: this.rejection,
    };
  }

  /** Give up the connection and leave nothing running. */
  stop() {
    this.stopped = true;
    this.disconnect();
  }

  disconnect() {
    if (this.retryTimer) this.cancel(this.retryTimer);
    if (this.flushTimer) this.cancel(this.flushTimer);
    this.retryTimer = null;
    this.flushTimer = null;
    this.pendingActivity = null;
    this.ready = false;
    this.reader = new FrameReader();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        // Already gone, which is the outcome either way.
      }
    }
  }

  /** Try the pipes in turn; the first that handshakes wins. */
  connect() {
    if (this.stopped || this.socket || !this.settings.enabled || !this.settings.applicationId) return;
    if (!this.candidates.length) this.candidates = candidateSockets(this.platform, this.env);
    const socketPath = this.candidates.shift();
    if (!socketPath) {
      // Discord is not running. This is ordinary, so it is retried rather than
      // reported, and the wait grows so a machine without Discord is not
      // probing a pipe every twenty seconds all day.
      this.scheduleRetry();
      return;
    }

    let socket;
    try {
      socket = this.connectSocket(socketPath);
    } catch {
      this.connect();
      return;
    }
    this.socket = socket;
    socket.on("connect", () => {
      this.write(OPCODE.HANDSHAKE, { v: 1, client_id: this.settings.applicationId });
    });
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", () => this.dropAndRetry());
    socket.on("close", () => this.dropAndRetry());
  }

  dropAndRetry() {
    if (this.stopped) return;
    const hadReady = this.ready;
    this.disconnect();
    // A connection that worked and then went means Discord closed: start the
    // list again from the top rather than walking off the end of it.
    if (hadReady) this.candidates = [];
    if (this.candidates.length) this.connect();
    else this.scheduleRetry();
  }

  scheduleRetry() {
    if (this.stopped || this.retryTimer || !this.settings.enabled) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(RETRY_MAX_MS, Math.round(this.retryDelay * 1.6));
    this.retryTimer = this.schedule(() => {
      this.retryTimer = null;
      this.candidates = [];
      this.connect();
    }, delay);
    if (typeof this.retryTimer?.unref === "function") this.retryTimer.unref();
  }

  receive(chunk) {
    for (const frame of this.reader.push(chunk)) {
      if (frame.opcode === OPCODE.PING) {
        this.write(OPCODE.PONG, frame.payload ?? {});
        continue;
      }
      if (frame.opcode === OPCODE.CLOSE) {
        /**
         * Discord says why it is hanging up, and one reason is worth keeping.
         *
         * A mistyped application id comes back as 4000 "Invalid Client ID" —
         * measured against the running client. Retrying that forever is a
         * silent loop over something only the person can fix, so the reason is
         * remembered, the retrying stops, and the settings page says it out
         * loud. Any other reason is ordinary and is retried as before.
         */
        const code = Number(frame.payload?.code || 0);
        const message = String(frame.payload?.message || "");
        if (code === INVALID_CLIENT_ID) {
          this.rejection = { code, message };
          this.disconnect();
          return;
        }
        this.dropAndRetry();
        return;
      }
      if (frame.payload?.evt === "READY") {
        this.ready = true;
        this.rejection = null;
        // A handshake that worked resets the back-off, so a Discord restarted
        // after an hour away is found again in twenty seconds.
        this.retryDelay = RETRY_START_MS;
        this.lastSentAt = 0;
        this.log("[Discord] verbunden");
        this.publish();
      }
    }
  }

  write(opcode, payload) {
    if (!this.socket) return false;
    try {
      this.socket.write(encodeFrame(opcode, payload));
      return true;
    } catch (error) {
      this.log("[Discord] Senden fehlgeschlagen", error);
      this.dropAndRetry();
      return false;
    }
  }

  /**
   * Hand the newest card to Discord, no faster than it will take one.
   *
   * Within the window the activity is remembered rather than sent, and the
   * timer sends whatever is remembered when the window opens. Somebody moving
   * through ten files in a minute produces one update, not ten dropped ones.
   */
  publish() {
    if (!this.ready || !this.settings.enabled) return;
    this.pendingActivity = buildActivity(this.state, this.settings, this.startedAt);
    const since = this.now() - this.lastSentAt;
    if (since >= MIN_UPDATE_MS) {
      this.flush();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = this.schedule(() => {
      this.flushTimer = null;
      this.flush();
    }, MIN_UPDATE_MS - since);
    if (typeof this.flushTimer?.unref === "function") this.flushTimer.unref();
  }

  flush() {
    if (!this.ready || !this.pendingActivity) return;
    const activity = this.pendingActivity;
    this.pendingActivity = null;
    this.nonce += 1;
    const sent = this.write(OPCODE.FRAME, {
      cmd: "SET_ACTIVITY",
      args: { pid: this.pid, activity },
      nonce: `kiwi-${this.nonce}`,
    });
    if (sent) this.lastSentAt = this.now();
  }
}

module.exports = {
  DiscordPresenceService,
  buildActivity,
  candidateSockets,
  encodeFrame,
  presenceLine,
  FrameReader,
  MIN_UPDATE_MS,
  OPCODE,
  DEFAULT_APPLICATION_ID,
  DEFAULT_PUBLIC_KEY,
};
