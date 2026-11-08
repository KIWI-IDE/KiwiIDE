const crypto = require("node:crypto");

/**
 * The encrypted channel a CodeToGetter session speaks over.
 *
 * A session used to be plain TCP, which was defensible only while both ends sat
 * on the same trusted network. Once a host can be reached across the internet
 * that is no longer true: a project's source, and every keystroke made in it,
 * would cross machines nobody in the session chose. So the wire is encrypted,
 * and there is no unencrypted mode to fall back to — an option to turn this off
 * would be an option to leak, chosen by whoever is in the greatest hurry.
 *
 * There is no certificate and no authority, because there is no server to run
 * one. The two ends already share a secret nobody else has: the invite token.
 * Both derive their keys from it, so a peer that cannot produce a frame this
 * side can open is a peer without the invite — authentication and encryption
 * from the same fact, rather than a password checked after an open channel is
 * already established.
 *
 * What this does not do: hide that a connection exists, or protect a session
 * whose invite has been passed to somebody it should not have been. The invite
 * is the key, which is why the interface says so where it is copied.
 */

/** AES-256-GCM: authenticated, so a modified frame fails to open rather than decoding wrongly. */
const CIPHER = "aes-256-gcm";
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
/** Random half of a nonce; the other four bytes are the frame counter. */
const NONCE_PREFIX_BYTES = 8;
const HANDSHAKE_NONCE_BYTES = 16;
const LENGTH_BYTES = 4;

/** The protocol version both ends must agree on before anything is encrypted. */
const CHANNEL_VERSION = 2;

/**
 * The two directional keys for one session.
 *
 * Each direction gets its own key, so a frame the host sent can never be
 * replayed back at the host as though a guest had sent it. Both nonces go into
 * the salt, which means neither side alone decides the key material and a
 * recorded session cannot be replayed against a later one.
 */
function deriveChannelKeys(token, hostNonce, guestNonce) {
  const secret = Buffer.from(String(token || ""), "utf8");
  if (!secret.length) throw new Error("Ohne Einladungsschlüssel lässt sich kein Kanal aufbauen.");
  const salt = Buffer.concat([Buffer.from(hostNonce, "hex"), Buffer.from(guestNonce, "hex")]);
  const derive = (label) => Buffer.from(crypto.hkdfSync("sha256", secret, salt, Buffer.from(label, "utf8"), KEY_BYTES));
  return {
    hostToGuest: derive("kiwi-codetogether/host->guest"),
    guestToHost: derive("kiwi-codetogether/guest->host"),
  };
}

/** A fresh handshake nonce, as hex so it can travel in the plaintext greeting. */
function createHandshakeNonce() {
  return crypto.randomBytes(HANDSHAKE_NONCE_BYTES).toString("hex");
}

/**
 * The nonce for one frame.
 *
 * A random per-direction prefix plus a counter. The counter alone would repeat
 * across sessions that share a key, and a repeated nonce with GCM does not
 * merely weaken the encryption — it exposes the keystream. The prefix is fresh
 * for every connection, so the pair cannot repeat.
 */
function frameNonce(prefix, counter) {
  const nonce = Buffer.alloc(NONCE_BYTES);
  prefix.copy(nonce, 0, 0, NONCE_PREFIX_BYTES);
  nonce.writeUInt32BE(counter >>> 0, NONCE_PREFIX_BYTES);
  return nonce;
}

/** Encrypts one message into a length-prefixed frame. */
function sealFrame(key, prefix, counter, message) {
  const plain = Buffer.from(JSON.stringify(message), "utf8");
  const cipher = crypto.createCipheriv(CIPHER, key, frameNonce(prefix, counter));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const frame = Buffer.alloc(LENGTH_BYTES);
  frame.writeUInt32BE(body.length + TAG_BYTES, 0);
  return Buffer.concat([frame, body, tag]);
}

/**
 * Decrypts one frame body, or throws.
 *
 * A frame that does not open is not a recoverable condition: either the peer
 * does not hold the invite, or something on the way changed the bytes. Both
 * end the connection rather than being retried.
 */
function openFrame(key, prefix, counter, body) {
  if (body.length < TAG_BYTES) throw new Error("Die Gegenstelle hat einen unvollständigen Rahmen gesendet.");
  const tag = body.subarray(body.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv(CIPHER, key, frameNonce(prefix, counter));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

/**
 * Splits a byte stream into frames and opens each one in order.
 *
 * The counter is kept here rather than sent: a peer that could choose its own
 * nonce could replay an earlier frame, and one that skips a number would go
 * unnoticed. Counting locally means a frame that arrives out of order simply
 * fails to open.
 */
function createSecureReader({ key, prefix, maxFrameBytes, onMessage, onError }) {
  let buffer = Buffer.alloc(0);
  let counter = 0;
  let broken = false;
  return (chunk) => {
    if (broken) return;
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    for (;;) {
      if (buffer.length < LENGTH_BYTES) return;
      const length = buffer.readUInt32BE(0);
      if (length > maxFrameBytes) {
        broken = true;
        onError(new Error("Die Gegenstelle hat einen überlangen Rahmen gesendet."));
        return;
      }
      if (buffer.length < LENGTH_BYTES + length) return;
      const body = buffer.subarray(LENGTH_BYTES, LENGTH_BYTES + length);
      buffer = buffer.subarray(LENGTH_BYTES + length);
      let message;
      try {
        message = openFrame(key, prefix, counter, body);
      } catch {
        broken = true;
        onError(new Error("Die Gegenstelle konnte nicht bestätigt werden — Schlüssel oder Daten stimmen nicht."));
        return;
      }
      counter += 1;
      onMessage(message);
    }
  };
}

/** Seals outgoing messages, counting frames the same way the far side does. */
function createSecureWriter({ key, prefix, write }) {
  let counter = 0;
  return (message) => {
    const frame = sealFrame(key, prefix, counter, message);
    counter += 1;
    write(frame);
  };
}

/** The greeting sent in the clear: a version and a nonce, neither of them secret. */
function createGreeting(nonce, prefix) {
  return `${JSON.stringify({ v: CHANNEL_VERSION, nonce, prefix: prefix.toString("hex") })}\n`;
}

/**
 * Reads the peer's greeting out of the head of the stream.
 *
 * Returns what was left over, because the first encrypted frame usually arrives
 * in the same packet as the greeting and discarding it would hang the session.
 */
function readGreeting(buffer) {
  const end = buffer.indexOf(0x0a);
  if (end < 0) {
    if (buffer.length > 4096) throw new Error("Die Gegenstelle hat keine gültige Begrüßung gesendet.");
    return null;
  }
  let greeting;
  try {
    greeting = JSON.parse(buffer.subarray(0, end).toString("utf8"));
  } catch {
    throw new Error("Die Gegenstelle hat keine gültige Begrüßung gesendet.");
  }
  // A plaintext error is the one thing a peer may say before the channel
  // exists, so that "wrong key" can be reported as words rather than as a
  // connection that closes for no stated reason.
  if (greeting?.type === "error") {
    throw new Error(String(greeting.message || "Die Gegenstelle hat die Verbindung abgelehnt."));
  }
  if (Number(greeting?.v) !== CHANNEL_VERSION) {
    throw new Error("Die Gegenstelle spricht eine andere CodeToGetter-Version.");
  }
  const nonce = String(greeting?.nonce || "");
  const prefix = String(greeting?.prefix || "");
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{16}$/.test(prefix)) {
    throw new Error("Die Gegenstelle hat keine gültige Begrüßung gesendet.");
  }
  return { nonce, prefix: Buffer.from(prefix, "hex"), rest: buffer.subarray(end + 1) };
}

/**
 * Puts an encrypted channel on a socket, from the first byte.
 *
 * Both ends greet in the clear with a version and a nonce — neither is secret,
 * and the invite they both hold never travels at all — then everything after
 * that is sealed. A message handed over before the handshake finishes is kept
 * and sent once it has, because the alternative is a caller that has to know
 * about a state it cannot see.
 */
function attachSecureChannel(socket, { token, isHost, maxFrameBytes = 16 * 1024 * 1024, onMessage, onError }) {
  const nonce = createHandshakeNonce();
  const prefix = crypto.randomBytes(NONCE_PREFIX_BYTES);
  const waiting = [];
  let pending = Buffer.alloc(0);
  let reader = null;
  let send = null;
  const write = (frame) => { if (!socket.destroyed) socket.write(frame); };
  write(Buffer.from(createGreeting(nonce, prefix), "utf8"));
  socket.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (reader) { reader(bytes); return; }
    pending = Buffer.concat([pending, bytes]);
    let greeting;
    try {
      greeting = readGreeting(pending);
    } catch (error) {
      onError(error);
      return;
    }
    if (!greeting) return;
    const keys = deriveChannelKeys(
      token,
      isHost ? nonce : greeting.nonce,
      isHost ? greeting.nonce : nonce,
    );
    reader = createSecureReader({
      key: isHost ? keys.guestToHost : keys.hostToGuest,
      prefix: greeting.prefix,
      maxFrameBytes,
      onMessage,
      onError,
    });
    send = createSecureWriter({ key: isHost ? keys.hostToGuest : keys.guestToHost, prefix, write });
    pending = Buffer.alloc(0);
    for (const message of waiting.splice(0)) send(message);
    // The first sealed frame usually shares a packet with the greeting.
    if (greeting.rest.length) reader(greeting.rest);
  });
  return {
    send: (message) => { if (send) send(message); else waiting.push(message); },
  };
}

module.exports = {
  CHANNEL_VERSION,
  attachSecureChannel,
  NONCE_PREFIX_BYTES,
  createGreeting,
  createHandshakeNonce,
  createSecureReader,
  createSecureWriter,
  deriveChannelKeys,
  frameNonce,
  openFrame,
  readGreeting,
  sealFrame,
};
