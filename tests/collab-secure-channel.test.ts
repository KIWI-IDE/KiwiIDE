import { describe, expect, it } from "vitest";

const {
  CHANNEL_VERSION,
  createGreeting,
  createHandshakeNonce,
  createSecureReader,
  createSecureWriter,
  deriveChannelKeys,
  frameNonce,
  openFrame,
  readGreeting,
  sealFrame,
} = require("../electron/services/collab-secure-channel.cjs");

const token = "a".repeat(64);
const hostNonce = "0".repeat(32);
const guestNonce = "1".repeat(32);

/** Wires a writer straight into a reader, the way a socket would. */
function pipe(key: Buffer, prefix: Buffer) {
  const seen: unknown[] = [];
  const problems: Error[] = [];
  const read = createSecureReader({
    key,
    prefix,
    maxFrameBytes: 1024 * 1024,
    onMessage: (message: unknown) => seen.push(message),
    onError: (error: Error) => problems.push(error),
  });
  const send = createSecureWriter({ key, prefix, write: (frame: Buffer) => read(frame) });
  return { send, seen, problems, read };
}

describe("the keys a session derives", () => {
  it("gives each direction its own key", () => {
    // A frame the host sent must never open as though a guest had sent it, or
    // it could simply be replayed back.
    const keys = deriveChannelKeys(token, hostNonce, guestNonce);
    expect(keys.hostToGuest).toHaveLength(32);
    expect(keys.guestToHost).toHaveLength(32);
    expect(keys.hostToGuest.equals(keys.guestToHost)).toBe(false);
  });

  it("gives both ends the same keys from the same handshake", () => {
    const left = deriveChannelKeys(token, hostNonce, guestNonce);
    const right = deriveChannelKeys(token, hostNonce, guestNonce);
    expect(left.hostToGuest.equals(right.hostToGuest)).toBe(true);
  });

  it("changes completely when either nonce changes", () => {
    // Both sides contribute, so neither alone decides the key material and a
    // recorded session cannot be replayed against a later one.
    const base = deriveChannelKeys(token, hostNonce, guestNonce);
    const otherHost = deriveChannelKeys(token, "2".repeat(32), guestNonce);
    const otherGuest = deriveChannelKeys(token, hostNonce, "3".repeat(32));
    expect(base.hostToGuest.equals(otherHost.hostToGuest)).toBe(false);
    expect(base.hostToGuest.equals(otherGuest.hostToGuest)).toBe(false);
  });

  it("refuses to build a channel without an invite key", () => {
    expect(() => deriveChannelKeys("", hostNonce, guestNonce)).toThrow(/Einladungsschlüssel/);
  });

  it("never repeats a nonce while the counter runs", () => {
    const prefix = Buffer.from("0011223344556677", "hex");
    const seen = new Set<string>();
    for (let counter = 0; counter < 500; counter += 1) {
      seen.add(frameNonce(prefix, counter).toString("hex"));
    }
    expect(seen.size).toBe(500);
    // A different connection uses a different prefix, so the pairs cannot
    // collide across sessions that share a key.
    expect(frameNonce(Buffer.from("7766554433221100", "hex"), 0).equals(frameNonce(prefix, 0))).toBe(false);
  });
});

describe("frames on the wire", () => {
  const keys = deriveChannelKeys(token, hostNonce, guestNonce);
  const prefix = Buffer.from("0011223344556677", "hex");

  it("carries a message there and back", () => {
    const { send, seen } = pipe(keys.hostToGuest, prefix);
    send({ type: "hello", name: "Zweiter" });
    send({ type: "edit", edit: { start: 0, end: 0, text: "x" } });
    expect(seen).toEqual([
      { type: "hello", name: "Zweiter" },
      { type: "edit", edit: { start: 0, end: 0, text: "x" } },
    ]);
  });

  it("puts nothing readable on the wire", () => {
    // The whole point: a project's source and every keystroke in it stop being
    // visible to anything between the two machines.
    const written: Buffer[] = [];
    const send = createSecureWriter({ key: keys.hostToGuest, prefix, write: (frame: Buffer) => written.push(frame) });
    send({ type: "open", path: "src/Geheim.java", text: "class Geheim {}" });
    const wire = Buffer.concat(written).toString("latin1");
    expect(wire).not.toContain("Geheim");
    expect(wire).not.toContain("open");
  });

  it("reassembles a message split across packets", () => {
    const { seen, read } = pipe(keys.hostToGuest, prefix);
    const frame = sealFrame(keys.hostToGuest, prefix, 0, { type: "tree" });
    for (const byte of frame) read(Buffer.from([byte]));
    expect(seen).toEqual([{ type: "tree" }]);
  });

  it("refuses a frame that somebody changed on the way", () => {
    const { seen, problems, read } = pipe(keys.hostToGuest, prefix);
    const frame = sealFrame(keys.hostToGuest, prefix, 0, { type: "save", path: "A.java" });
    frame[frame.length - 3] ^= 0xff;
    read(frame);
    expect(seen).toEqual([]);
    expect(problems[0].message).toMatch(/nicht bestätigt/);
  });

  it("refuses a frame sealed with another key", () => {
    // This is also how a wrong invite is caught: a peer without the token
    // cannot produce a frame this side can open.
    const { seen, problems, read } = pipe(keys.hostToGuest, prefix);
    const stranger = deriveChannelKeys("b".repeat(64), hostNonce, guestNonce);
    read(sealFrame(stranger.hostToGuest, prefix, 0, { type: "hello" }));
    expect(seen).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it("refuses a frame replayed out of its place in the stream", () => {
    // The counter is kept locally and never sent, so a recorded frame cannot
    // be pushed back into the stream later.
    const { send, seen, problems, read } = pipe(keys.hostToGuest, prefix);
    const first = sealFrame(keys.hostToGuest, prefix, 0, { type: "erste" });
    send({ type: "erste" });
    read(first);
    expect(seen).toEqual([{ type: "erste" }]);
    expect(problems).toHaveLength(1);
  });

  it("stops reading after the first frame it could not open", () => {
    // A channel that failed to authenticate once is not one to keep listening
    // to; everything after it comes from the same unverified peer.
    const { seen, problems, read } = pipe(keys.hostToGuest, prefix);
    read(sealFrame(keys.hostToGuest, prefix, 7, { type: "falsch" }));
    read(sealFrame(keys.hostToGuest, prefix, 0, { type: "richtig" }));
    expect(seen).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it("refuses a length nobody could mean", () => {
    const { problems, read } = pipe(keys.hostToGuest, prefix);
    const claim = Buffer.alloc(4);
    claim.writeUInt32BE(4_000_000_000, 0);
    read(claim);
    expect(problems[0].message).toMatch(/überlangen/);
  });

  it("opens only at the counter it was sealed at", () => {
    expect(() => openFrame(keys.hostToGuest, prefix, 1, sealFrame(keys.hostToGuest, prefix, 0, { a: 1 }).subarray(4)))
      .toThrow();
  });
});

describe("the greeting", () => {
  it("carries the version and the nonces in the clear", () => {
    // Neither is secret: the secret is the invite, which never travels.
    const nonce = createHandshakeNonce();
    const prefix = Buffer.from("0011223344556677", "hex");
    const greeting = createGreeting(nonce, prefix);
    expect(greeting.endsWith("\n")).toBe(true);
    expect(greeting).not.toContain(token);
    const read = readGreeting(Buffer.from(greeting, "utf8"));
    expect(read.nonce).toBe(nonce);
    expect(read.prefix.equals(prefix)).toBe(true);
  });

  it("keeps whatever arrived behind it", () => {
    // The first encrypted frame usually shares a packet with the greeting, and
    // dropping it would hang the session on its very first message.
    const greeting = createGreeting(createHandshakeNonce(), Buffer.alloc(8, 1));
    const read = readGreeting(Buffer.concat([Buffer.from(greeting, "utf8"), Buffer.from([1, 2, 3])]));
    expect([...read.rest]).toEqual([1, 2, 3]);
  });

  it("waits rather than guessing while the line is incomplete", () => {
    expect(readGreeting(Buffer.from('{"v":2,"non', "utf8"))).toBeNull();
  });

  it("says so when the other side speaks a different version", () => {
    const older = `${JSON.stringify({ v: CHANNEL_VERSION + 1, nonce: "0".repeat(32), prefix: "0".repeat(16) })}\n`;
    expect(() => readGreeting(Buffer.from(older, "utf8"))).toThrow(/andere CodeToGetter-Version/);
  });

  it("passes on a plaintext refusal as words", () => {
    // The one thing a peer may say before the channel exists, so that a wrong
    // invite is reported rather than showing as a connection that just closes.
    const refusal = `${JSON.stringify({ type: "error", message: "Der Einladungsschlüssel stimmt nicht." })}\n`;
    expect(() => readGreeting(Buffer.from(refusal, "utf8"))).toThrow(/Einladungsschlüssel/);
  });

  it("refuses a greeting that is not one", () => {
    expect(() => readGreeting(Buffer.from("hallo\n", "utf8"))).toThrow(/gültige Begrüßung/);
    const short = `${JSON.stringify({ v: CHANNEL_VERSION, nonce: "ab", prefix: "cd" })}\n`;
    expect(() => readGreeting(Buffer.from(short, "utf8"))).toThrow(/gültige Begrüßung/);
    expect(() => readGreeting(Buffer.alloc(5000, 0x41))).toThrow(/gültige Begrüßung/);
  });
});
