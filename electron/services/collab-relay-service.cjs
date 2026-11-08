const crypto = require("node:crypto");
const net = require("node:net");

/**
 * Meeting through a relay, so nobody has to configure a router.
 *
 * A router lets an outgoing connection through and blocks an incoming one. That
 * is the whole of the problem: the host has nothing to offer a guest that the
 * guest can reach. UPnP asks the router to make an exception and often works;
 * when it does not, the only remaining answer is for both sides to dial *out*
 * to somewhere they can both reach, and for that somewhere to put the two ends
 * together.
 *
 * The relay is a piece of plumbing, not a participant. It learns three things:
 * that two machines are talking, roughly how much, and a room identifier. It
 * does not learn the invite, because the room is an HMAC of it — knowing the
 * room tells you nothing you could join with. And it cannot read a byte of the
 * project: the session is already encrypted end to end with keys both ends
 * derive from the invite, and the relay never has the invite.
 *
 * What it can do, and what nobody should pretend away: refuse to carry traffic,
 * or record how much moved and when. A relay is trusted for availability, not
 * for confidentiality.
 */

/** The relay protocol both ends and the server agree on. */
const RELAY_VERSION = 1;

/** Long enough that two rooms never collide; short enough to read in a log. */
const ROOM_BYTES = 16;

/**
 * The room two ends of one session meet in.
 *
 * An HMAC of the invite rather than the invite itself: the relay has to match
 * two connections without being handed the key that would let it become one of
 * them. Recovering the token from the room means inverting HMAC-SHA256.
 */
function roomForToken(token) {
  const secret = String(token || "");
  if (!secret) throw new Error("Ohne Einladungsschlüssel gibt es keinen Raum.");
  return crypto.createHmac("sha256", secret)
    .update("kiwi-codetogether/room")
    .digest("hex")
    .slice(0, ROOM_BYTES * 2);
}

/** True for a room identifier this relay would accept. */
function isRoom(value) {
  return new RegExp(`^[0-9a-f]{${ROOM_BYTES * 2}}$`).test(String(value || ""));
}

/** The greeting a client sends the relay, as one line. */
function relayGreeting(role, room, id = "") {
  return `${JSON.stringify({ v: RELAY_VERSION, role, room, ...(id ? { id } : {}) })}\n`;
}

/**
 * Reads a client's greeting, or says why it is not one.
 *
 * Returns the bytes that followed it as well: a guest's first encrypted frame
 * usually shares a packet with its greeting, and dropping it would hang the
 * session before it starts.
 */
function readRelayGreeting(buffer) {
  const end = buffer.indexOf(0x0a);
  if (end < 0) {
    if (buffer.length > 2048) throw new Error("Ungültige Anmeldung am Relay.");
    return null;
  }
  let greeting;
  try {
    greeting = JSON.parse(buffer.subarray(0, end).toString("utf8"));
  } catch {
    throw new Error("Ungültige Anmeldung am Relay.");
  }
  if (Number(greeting?.v) !== RELAY_VERSION) throw new Error("Das Relay spricht eine andere Version.");
  if (!isRoom(greeting?.room)) throw new Error("Ungültige Raumkennung.");
  const role = String(greeting?.role || "");
  if (!["host", "host-data", "guest"].includes(role)) throw new Error("Unbekannte Rolle am Relay.");
  return { role, room: greeting.room, id: String(greeting?.id || ""), rest: buffer.subarray(end + 1) };
}

/**
 * Pipes two sockets into each other until either goes.
 *
 * Anything already read from one of them is written on before the pipe starts,
 * or the first message of the session is lost — which shows up much later as a
 * handshake that never completes.
 */
function joinSockets(left, right, leftRest = Buffer.alloc(0), rightRest = Buffer.alloc(0)) {
  if (leftRest.length) right.write(leftRest);
  if (rightRest.length) left.write(rightRest);
  left.pipe(right);
  right.pipe(left);
  const close = () => {
    left.destroy();
    right.destroy();
  };
  left.on("error", close);
  right.on("error", close);
  left.on("close", close);
  right.on("close", close);
}

/**
 * The relay itself: matches a guest with the host of the same room.
 *
 * A host keeps one control connection open and is told when somebody arrives;
 * it then dials back with a connection for that guest. The relay never dials
 * anybody — it could not reach the host if it tried, which is the reason it
 * exists.
 */
function createRelayServer(options = {}) {
  const maxRooms = Number(options.maxRooms) > 0 ? Number(options.maxRooms) : 200;
  const waitMs = Number(options.waitMs) > 0 ? Number(options.waitMs) : 20_000;
  const log = typeof options.log === "function" ? options.log : () => undefined;
  /** room -> { control, waiting: Map<id, {socket, rest, timer}> } */
  const rooms = new Map();
  // Every socket, not only the ones a room still points at. Once two are
  // piped together the room forgets them, and close() then waited forever
  // on connections nothing was tracking any more.
  const sockets = new Set();
  let nextId = 1;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const refuse = (message) => {
      socket.end(`${JSON.stringify({ type: "error", message })}\n`);
    };
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      if (greeted) return;
      buffer = Buffer.concat([buffer, chunk]);
      let greeting;
      try {
        greeting = readRelayGreeting(buffer);
      } catch (error) {
        refuse(error.message);
        return;
      }
      if (!greeting) return;
      greeted = true;
      socket.removeAllListeners("data");
      /*
       * Paused until something reads it again.
       *
       * A socket that had a "data" listener is in flowing mode, and removing
       * the listener does not stop it — it makes Node throw the bytes away.
       * A guest waits here for the whole round trip it takes the host to be
       * told and dial back, and everything it said in that window was lost.
       * Since the secure handshake begins right after the greeting, that was
       * always its first frames: the two ends were paired and then never
       * finished shaking hands. Pausing buffers instead, and pipe() resumes.
       */
      socket.pause();
      handle(socket, greeting);
    });
  });

  function handle(socket, greeting) {
    const { role, room, id, rest } = greeting;
    if (role === "host") {
      if (rooms.has(room)) {
        socket.end(`${JSON.stringify({ type: "error", message: "Für diesen Raum ist bereits ein Gastgeber verbunden." })}\n`);
        return;
      }
      if (rooms.size >= maxRooms) {
        socket.end(`${JSON.stringify({ type: "error", message: "Das Relay ist ausgelastet." })}\n`);
        return;
      }
      const entry = { control: socket, waiting: new Map() };
      rooms.set(room, entry);
      socket.write(`${JSON.stringify({ ok: true })}\n`);
      log("host", room);
      const drop = () => {
        if (rooms.get(room) !== entry) return;
        rooms.delete(room);
        for (const pending of entry.waiting.values()) {
          clearTimeout(pending.timer);
          pending.socket.destroy();
        }
        log("host-gone", room);
      };
      socket.on("close", drop);
      socket.on("error", drop);
      return;
    }
    if (role === "guest") {
      const entry = rooms.get(room);
      if (!entry) {
        // Said in words: without this a guest whose host is not there sees a
        // connection that opens and then closes, which reads as a broken relay.
        socket.end(`${JSON.stringify({ type: "error", message: "Zu diesem Einladungscode ist gerade kein Gastgeber verbunden." })}\n`);
        return;
      }
      const ticket = String(nextId);
      nextId += 1;
      const timer = setTimeout(() => {
        if (entry.waiting.delete(ticket)) socket.destroy();
      }, waitMs);
      timer.unref?.();
      entry.waiting.set(ticket, { socket, rest, timer });
      entry.control.write(`${JSON.stringify({ type: "connect", id: ticket })}\n`);
      log("guest", room);
      return;
    }
    // host-data: the other half of a guest that is already waiting.
    const entry = rooms.get(room);
    const pending = entry?.waiting.get(id);
    if (!pending) {
      socket.destroy();
      return;
    }
    entry.waiting.delete(id);
    clearTimeout(pending.timer);
    joinSockets(socket, pending.socket, rest, pending.rest);
    log("joined", room);
  }

  return {
    listen(port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      for (const entry of rooms.values()) entry.control.destroy();
      rooms.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      return new Promise((resolve) => server.close(resolve));
    },
    get rooms() {
      return rooms.size;
    },
  };
}

module.exports = {
  RELAY_VERSION,
  ROOM_BYTES,
  createRelayServer,
  isRoom,
  joinSockets,
  readRelayGreeting,
  relayGreeting,
  roomForToken,
};
