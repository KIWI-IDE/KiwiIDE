/**
 * The Discord card, without Discord.
 *
 * Everything the service touches on the outside — the pipe, the clock, the
 * timers — is injected, so the protocol can be driven here exactly as the real
 * client drives it: a handshake, a READY, then activities that have to respect
 * a rate limit nobody reports when it is broken.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

const {
  DiscordPresenceService,
  buildActivity,
  candidateSockets,
  encodeFrame,
  presenceLine,
  FrameReader,
  MIN_UPDATE_MS,
  OPCODE,
} = require("../electron/services/discord-presence-service.cjs");

/** A socket that records what was written and can be answered on demand. */
class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;

  write(chunk: Buffer) {
    this.written.push(Buffer.from(chunk));
    return true;
  }

  destroy() {
    this.destroyed = true;
  }

  /** The frames this socket was asked to send, decoded. */
  frames() {
    const reader = new FrameReader();
    return this.written.flatMap((chunk) => reader.push(chunk));
  }

  /** Answer as Discord does once the handshake is accepted. */
  sendReady() {
    this.emit("data", encodeFrame(OPCODE.FRAME, { cmd: "DISPATCH", evt: "READY", data: {} }));
  }
}

/** A service wired to a fake pipe and a clock the test moves itself. */
function harness(settings: Record<string, unknown> = {}) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  let clock = 1_000_000;
  let nextTimer = 1;

  const service = new DiscordPresenceService({
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => clock,
    schedule: (run: () => void, delay: number) => {
      const id = nextTimer += 1;
      timers.push({ at: clock + delay, run, id });
      return id;
    },
    cancel: (id: number) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    pid: 4242,
    platform: "win32",
    env: {},
  });
  service.configure({
    enabled: true,
    applicationId: "123456789",
    showProject: true,
    showFile: true,
    showElapsed: true,
    ...settings,
  });

  return {
    service,
    sockets,
    get socket() { return sockets[sockets.length - 1]; },
    /** Move the clock and run whatever became due. */
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.filter((entry) => entry.at <= clock)) {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
        timer.run();
      }
    },
    activities() {
      return this.socket.frames()
        .filter((frame: { payload: { cmd?: string } }) => frame.payload?.cmd === "SET_ACTIVITY")
        .map((frame: { payload: { args: { activity: Record<string, unknown> } } }) => frame.payload.args.activity);
    },
  };
}

describe("Discord presence", () => {
  it("reads frames out of a stream that splits them anywhere", () => {
    const reader = new FrameReader();
    const first = encodeFrame(OPCODE.HANDSHAKE, { v: 1, client_id: "a" });
    const second = encodeFrame(OPCODE.FRAME, { cmd: "SET_ACTIVITY" });
    const stream = Buffer.concat([first, second]);

    // A header split down the middle is the case that breaks a naive reader.
    expect(reader.push(stream.subarray(0, 3))).toHaveLength(0);
    expect(reader.push(stream.subarray(3, first.length + 6))).toHaveLength(1);
    const rest = reader.push(stream.subarray(first.length + 6));
    expect(rest).toHaveLength(1);
    expect(rest[0].payload.cmd).toBe("SET_ACTIVITY");
  });

  it("throws away a stream claiming an impossible length", () => {
    // Not Discord on the other end, or not any more. Allocating on the number
    // it just sent is the one thing not to do.
    const bogus = Buffer.alloc(8);
    bogus.writeInt32LE(1, 0);
    bogus.writeInt32LE(-5, 4);
    expect(new FrameReader().push(bogus)).toHaveLength(0);
  });

  it("names Windows pipes as Windows pipes whatever host is asking", () => {
    const windows = candidateSockets("win32", {});
    expect(windows).toHaveLength(10);
    expect(windows[0]).toBe("\\\\?\\pipe\\discord-ipc-0");

    // Flatpak and Snap hide it a level down; the plain runtime directory alone
    // misses a Discord installed either of those ways.
    const linux = candidateSockets("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }).join(" ");
    expect(linux).toContain("/run/user/1000/discord-ipc-0");
    expect(linux).toContain("com.discordapp.Discord");
    expect(linux).toContain("snap.discord");
  });

  it("drops a line Discord would reject and truncates one it would not", () => {
    // Under two characters is refused outright, and it takes the whole
    // activity with it rather than just that line.
    expect(presenceLine("A")).toBe("");
    expect(presenceLine("  Mein   Projekt ")).toBe("Mein Projekt");
    expect(presenceLine("x".repeat(400))).toHaveLength(128);
  });

  it("hands over the application id before anything else", () => {
    const rig = harness();
    rig.socket.emit("connect");

    const [handshake] = rig.socket.frames();
    expect(handshake.opcode).toBe(OPCODE.HANDSHAKE);
    expect(handshake.payload).toEqual({ v: 1, client_id: "123456789" });
    // Nothing else until Discord has answered.
    expect(rig.activities()).toHaveLength(0);
  });

  it("sends nothing until Discord says READY", () => {
    const rig = harness();
    rig.socket.emit("connect");
    rig.service.setState({ projectName: "honeymc-cloud", fileName: "Cloud.java" });
    expect(rig.activities()).toHaveLength(0);

    rig.socket.sendReady();
    expect(rig.activities()).toHaveLength(1);
    expect(rig.activities()[0]).toMatchObject({ details: "honeymc-cloud", state: "Cloud.java" });
  });

  it("coalesces a burst into one update rather than losing it", () => {
    /**
     * Discord drops activities that arrive faster than roughly five in twenty
     * seconds and says nothing. Somebody moving through files for a minute
     * would leave the card showing one they closed at the start.
     */
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.sendReady();
    expect(rig.activities()).toHaveLength(1);

    for (const file of ["A.java", "B.java", "C.java", "D.java"]) {
      rig.advance(400);
      rig.service.setState({ projectName: "honeymc-cloud", fileName: file });
    }
    // Still one: everything since is waiting for the window to open.
    expect(rig.activities()).toHaveLength(1);

    rig.advance(MIN_UPDATE_MS);
    const sent = rig.activities();
    expect(sent).toHaveLength(2);
    // The newest wins; the three in between were never worth sending.
    expect(sent[1].state).toBe("D.java");
  });

  it("sends the pid Discord has to attribute the activity to", () => {
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.sendReady();
    const frame = rig.socket.frames()
      .find((entry: { payload: { cmd?: string } }) => entry.payload?.cmd === "SET_ACTIVITY");
    expect(frame.payload.args.pid).toBe(4242);
    expect(String(frame.payload.nonce)).toMatch(/^kiwi-\d+$/);
  });

  it("answers a ping so Discord does not drop the connection", () => {
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.emit("data", encodeFrame(OPCODE.PING, { nonce: "abc" }));
    const pong = rig.socket.frames().find((entry: { opcode: number }) => entry.opcode === OPCODE.PONG);
    expect(pong.payload).toEqual({ nonce: "abc" });
  });

  it("never opens a pipe while it is switched off or has no id", () => {
    for (const settings of [{ enabled: false }, { applicationId: "" }]) {
      const rig = harness(settings);
      expect(rig.sockets).toHaveLength(0);
    }
  });

  it("lets go of the pipe when it is switched off again", () => {
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.sendReady();
    const socket = rig.socket;

    rig.service.configure({ enabled: false, applicationId: "123456789" });
    expect(socket.destroyed).toBe(true);
    expect(rig.service.ready).toBe(false);
  });

  it("walks the pipes and gives up quietly when Discord is not there", () => {
    const rig = harness();
    // Ten pipes, each refusing in turn. None of this reaches the workbench.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(rig.sockets).toHaveLength(attempt + 1);
      rig.socket.emit("error", new Error("ENOENT"));
    }
    expect(rig.sockets).toHaveLength(10);
    // And it tries again later rather than for ever.
    rig.advance(60_000);
    expect(rig.sockets.length).toBeGreaterThan(10);
  });

  it("stops asking when Discord says the id is not one of its own", () => {
    /**
     * Measured against the Discord running on a real machine: a handshake with
     * an id it does not know comes back as opcode 2 with
     * `{"code":4000,"message":"Invalid Client ID"}`. Retrying that is a silent
     * loop over the one thing only the person at the keyboard can fix, so the
     * reason is kept and the settings page says it.
     */
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.emit("data", encodeFrame(OPCODE.CLOSE, { code: 4000, message: "Invalid Client ID" }));

    expect(rig.service.previewActivity().rejection).toEqual({ code: 4000, message: "Invalid Client ID" });
    const opened = rig.sockets.length;
    rig.advance(10 * 60_000);
    expect(rig.sockets).toHaveLength(opened);

    // A different id is a fresh start, not a continuation of the refusal.
    rig.service.configure({ enabled: true, applicationId: "987654321" });
    expect(rig.service.previewActivity().rejection).toBeNull();
    expect(rig.sockets.length).toBeGreaterThan(opened);
  });

  it("keeps retrying when Discord hangs up for any other reason", () => {
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.emit("data", encodeFrame(OPCODE.CLOSE, { code: 1000, message: "going away" }));
    expect(rig.service.previewActivity().rejection).toBeNull();
    rig.advance(60_000);
    expect(rig.sockets.length).toBeGreaterThan(1);
  });

  it("stops for good when the application is quitting", () => {
    const rig = harness();
    rig.socket.emit("connect");
    rig.socket.sendReady();
    rig.service.stop();
    const opened = rig.sockets.length;

    rig.advance(10 * 60_000);
    expect(rig.sockets).toHaveLength(opened);
  });
});

describe("what the Discord card says", () => {
  const session = { projectName: "honeymc-cloud", fileName: "TerminalDriver.java", version: "1.3.50" };
  const all = { showProject: true, showFile: true, showElapsed: true };

  it("shows the project and the file when both are allowed", () => {
    const card = buildActivity(session, all, 1_700_000_000_000);
    expect(card.details).toBe("honeymc-cloud");
    expect(card.state).toBe("TerminalDriver.java");
    expect(card.timestamps).toEqual({ start: 1_700_000_000_000 });
    expect(card.assets.large_image).toBe("kiwi");
  });

  it("says only that Kiwi is open when nothing may be shared", () => {
    /**
     * The point of the switches: with all three off the card still appears --
     * that is what somebody asked for by turning the feature on -- but it says
     * nothing about what they are working on.
     */
    const card = buildActivity(session, { showProject: false, showFile: false, showElapsed: false }, 1);
    expect(card.details).toBeUndefined();
    expect(card.state).toBeUndefined();
    expect(card.timestamps).toBeUndefined();
    expect(card.assets.large_image).toBe("kiwi");
    expect(card.assets.small_image).toBe("kiwi");
    expect(JSON.stringify(card)).not.toContain("honeymc");
    expect(JSON.stringify(card)).not.toContain("TerminalDriver");
  });

  it("keeps the file off the card on its own switch", () => {
    const card = buildActivity(session, { ...all, showFile: false }, 1);
    expect(card.details).toBe("honeymc-cloud");
    expect(card.state).toBeUndefined();
    expect(JSON.stringify(card)).not.toContain("TerminalDriver");
  });

  it("never repeats one line as the other", () => {
    // Two identical lines read as a bug in the card, which is what a project
    // with no file open produced before the state was compared to the details.
    const card = buildActivity({ projectName: "", fileName: "", version: "1.3.50" }, all, 1);
    expect(card.details).toBeUndefined();
    expect(card.state).toBeUndefined();
  });

  it("drops a name too short for Discord instead of being refused", () => {
    // A one-character project name makes Discord reject the whole activity.
    const card = buildActivity({ projectName: "x", fileName: "", version: "1.3.50" }, all, 1);
    expect(card.details).toBeUndefined();
    expect(card.assets.large_text).toBe("Kiwi IDE 1.3.50");
  });

  it("supports custom state, details, party and secrets for RPC app", () => {
    const card = buildActivity({ projectName: "", fileName: "" }, {
      details: "Competitive",
      state: "Playing Solo",
      largeImageText: "Numbani",
      smallImageText: "Rogue - Level 100",
      smallImageKey: "rogue",
      partyId: "ae488379-351d-4a4f-ad32-2b9b01c91657",
      partySize: 1,
      partyMax: 5,
      joinSecret: "MTI4NzM0OjFpMmhuZToxMjMxMjM=",
    }, 1507665886);
    expect(card.details).toBe("Competitive");
    expect(card.state).toBe("Playing Solo");
    expect(card.assets.large_text).toBe("Numbani");
    expect(card.assets.small_text).toBe("Rogue - Level 100");
    expect(card.assets.small_image).toBe("rogue");
    expect(card.party).toEqual({
      id: "ae488379-351d-4a4f-ad32-2b9b01c91657",
      size: [1, 5],
    });
    expect(card.secrets).toEqual({
      join: "MTI4NzM0OjFpMmhuZToxMjMxMjM=",
    });
  });
});
