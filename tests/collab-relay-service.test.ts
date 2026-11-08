import { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const {
  RELAY_VERSION,
  createRelayServer,
  isRoom,
  readRelayGreeting,
  relayGreeting,
  roomForToken,
} = require("../electron/services/collab-relay-service.cjs");

const token = "a".repeat(64);
const running: Array<{ close: () => Promise<unknown> }> = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const relay of running.splice(0)) await relay.close();
});

/** Starts a relay on loopback, so no test opens a port to the network. */
async function startRelay(options: Record<string, unknown> = {}) {
  const relay = createRelayServer(options);
  running.push(relay);
  const port = await relay.listen(0, "127.0.0.1");
  return { relay, port };
}

/** Connects and collects whatever the relay says, line by line. */
function connect(port: number, greeting: string) {
  const socket = new Socket();
  sockets.push(socket);
  const lines: string[] = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      lines.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  return new Promise<{ socket: Socket; lines: string[] }>((resolve) => {
    socket.connect(port, "127.0.0.1", () => {
      socket.write(greeting);
      resolve({ socket, lines });
    });
  });
}

/** Waits for the relay to have said something, or gives up. */
async function nextLine(lines: string[], index = 0) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (lines.length > index) return JSON.parse(lines[index]);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Das Relay hat nichts gesagt.");
}

/** The same, for the bytes the relay carries rather than what it says. */
async function nextRaw(lines: string[], index = 0) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (lines.length > index) return lines[index];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Es kam nichts an.");
}

describe("the room two ends meet in", () => {
  it("is derived from the invite, never the invite itself", () => {
    // The relay has to pair two connections without being handed the key that
    // would let it become one of them.
    const room = roomForToken(token);
    expect(isRoom(room)).toBe(true);
    expect(room).not.toContain(token);
    expect(token).not.toContain(room);
  });

  it("is the same on both ends and different for another invite", () => {
    expect(roomForToken(token)).toBe(roomForToken(token));
    expect(roomForToken(token)).not.toBe(roomForToken("b".repeat(64)));
  });

  it("refuses to make one without an invite", () => {
    expect(() => roomForToken("")).toThrow(/Einladungsschlüssel/);
  });

  it("recognises only a well-formed room", () => {
    expect(isRoom("nope")).toBe(false);
    expect(isRoom("")).toBe(false);
    expect(isRoom(`${roomForToken(token)}ff`)).toBe(false);
  });
});

describe("the greeting a client sends", () => {
  it("carries a version, a role and a room", () => {
    const read = readRelayGreeting(Buffer.from(relayGreeting("guest", roomForToken(token)), "utf8"));
    expect(read).toMatchObject({ role: "guest", room: roomForToken(token) });
  });

  it("keeps what arrived behind it", () => {
    // A guest's first encrypted frame usually shares a packet with its
    // greeting, and dropping it hangs the session before it starts.
    const line = relayGreeting("guest", roomForToken(token));
    const read = readRelayGreeting(Buffer.concat([Buffer.from(line, "utf8"), Buffer.from([7, 8, 9])]));
    expect([...read.rest]).toEqual([7, 8, 9]);
  });

  it("waits while the line is incomplete", () => {
    expect(readRelayGreeting(Buffer.from('{"v":1,"role":"gu', "utf8"))).toBeNull();
  });

  it("refuses what it cannot act on, by name", () => {
    expect(() => readRelayGreeting(Buffer.from("hallo\n", "utf8"))).toThrow(/Ungültige Anmeldung/);
    expect(() => readRelayGreeting(Buffer.from(`${JSON.stringify({ v: RELAY_VERSION + 1, role: "guest", room: roomForToken(token) })}\n`, "utf8")))
      .toThrow(/andere Version/);
    expect(() => readRelayGreeting(Buffer.from(`${JSON.stringify({ v: RELAY_VERSION, role: "guest", room: "kurz" })}\n`, "utf8")))
      .toThrow(/Raumkennung/);
    expect(() => readRelayGreeting(Buffer.from(`${JSON.stringify({ v: RELAY_VERSION, role: "spion", room: roomForToken(token) })}\n`, "utf8")))
      .toThrow(/Rolle/);
  });
});

/**
 * The relay paired both ends and the session never started, because a socket
 * that had a "data" listener is in flowing mode and removing the listener
 * makes Node throw its bytes away rather than buffer them.
 */
describe("what a guest says while it waits", () => {
  const room = roomForToken(token);

  /** A write that lands in its own packet, after the greeting was consumed. */
  const later = async (socket: Socket, text: string) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    socket.write(text + "\n");
  };

  it("keeps what the guest sent before the host dialled back", async () => {
    const { port } = await startRelay();
    const host = await connect(port, relayGreeting("host", room));
    await nextLine(host.lines);

    const guest = await connect(port, relayGreeting("guest", room));
    // The secure handshake sends its first frame right behind the greeting,
    // long before the host has been told anybody is here.
    await later(guest.socket, "erstes Wort des Gastes");

    const notice = await nextLine(host.lines, 1);
    const data = await connect(port, relayGreeting("host-data", room, notice.id));
    expect(await nextRaw(data.lines)).toBe("erstes Wort des Gastes");
  });

  it("keeps them in order when the guest waits a long time", async () => {
    const { port } = await startRelay();
    const host = await connect(port, relayGreeting("host", room));
    await nextLine(host.lines);

    const guest = await connect(port, relayGreeting("guest", room));
    await later(guest.socket, "eins");
    await later(guest.socket, "zwei");
    await later(guest.socket, "drei");

    const notice = await nextLine(host.lines, 1);
    const data = await connect(port, relayGreeting("host-data", room, notice.id));
    expect(await nextRaw(data.lines, 2)).toBe("drei");
    expect(data.lines.slice(0, 3)).toEqual(["eins", "zwei", "drei"]);
  });
});

describe("a relay putting two ends together", () => {
  const room = roomForToken(token);

  it("accepts a host and tells it when somebody arrives", async () => {
    const { port } = await startRelay();
    const host = await connect(port, relayGreeting("host", room));
    expect(await nextLine(host.lines)).toEqual({ ok: true });

    await connect(port, relayGreeting("guest", room));
    expect(await nextLine(host.lines, 1)).toMatchObject({ type: "connect" });
  });

  it("carries bytes between the two once both halves are there", async () => {
    // This is the whole job: neither side had to be reachable, and what they
    // say to each other passes through untouched.
    const { port } = await startRelay();
    const host = await connect(port, relayGreeting("host", room));
    await nextLine(host.lines);
    const guest = await connect(port, relayGreeting("guest", room));
    const notice = await nextLine(host.lines, 1);
    const data = await connect(port, relayGreeting("host-data", room, notice.id));

    data.socket.write("hallo vom Gastgeber\n");
    guest.socket.write("hallo vom Gast\n");
    expect(await nextRaw(guest.lines)).toBe("hallo vom Gastgeber");
    expect(await nextRaw(data.lines)).toBe("hallo vom Gast");
  });

  it("delivers what the guest already said before the host dialled back", async () => {
    const { port } = await startRelay();
    const host = await connect(port, relayGreeting("host", room));
    await nextLine(host.lines);
    // Sent in the same breath as the greeting, the way a real guest does.
    const guest = await connect(port, `${relayGreeting("guest", room)}frueh\n`);
    const notice = await nextLine(host.lines, 1);
    const data = await connect(port, relayGreeting("host-data", room, notice.id));
    expect(await nextRaw(data.lines)).toBe("frueh");
  });

  it("tells a guest whose host is not there, in words", async () => {
    // Without this the guest sees a connection that opens and closes, which
    // reads as a broken relay rather than a session nobody is hosting.
    const { port } = await startRelay();
    const guest = await connect(port, relayGreeting("guest", room));
    expect(await nextLine(guest.lines)).toMatchObject({ message: expect.stringMatching(/kein Gastgeber/) });
  });

  it("refuses a second host for the same room", async () => {
    const { port } = await startRelay();
    const first = await connect(port, relayGreeting("host", room));
    await nextLine(first.lines);
    const second = await connect(port, relayGreeting("host", room));
    expect(await nextLine(second.lines)).toMatchObject({ message: expect.stringMatching(/bereits ein Gastgeber/) });
  });

  it("says it is full rather than taking a room it cannot serve", async () => {
    const { port } = await startRelay({ maxRooms: 1 });
    const first = await connect(port, relayGreeting("host", roomForToken("eins")));
    await nextLine(first.lines);
    const second = await connect(port, relayGreeting("host", roomForToken("zwei")));
    expect(await nextLine(second.lines)).toMatchObject({ message: expect.stringMatching(/ausgelastet/) });
  });

  it("lets go of a room when its host disconnects", async () => {
    const { relay, port } = await startRelay();
    const host = await connect(port, relayGreeting("host", room));
    await nextLine(host.lines);
    expect(relay.rooms).toBe(1);
    host.socket.destroy();
    for (let attempt = 0; attempt < 50 && relay.rooms > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(relay.rooms).toBe(0);
  });

  it("drops a guest nobody came back for", async () => {
    // Otherwise a host that goes quiet leaves sockets parked on the relay for
    // as long as the process lives.
    const { port } = await startRelay({ waitMs: 30 });
    const host = await connect(port, relayGreeting("host", room));
    await nextLine(host.lines);
    const guest = await connect(port, relayGreeting("guest", room));
    await nextLine(host.lines, 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(guest.socket.destroyed).toBe(true);
  });
});
