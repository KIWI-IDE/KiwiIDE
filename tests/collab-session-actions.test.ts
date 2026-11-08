import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const { createInviteCode } = require("../electron/services/collab-service.cjs");
const { CollabGuest, CollabHost } = require("../electron/services/collab-session.cjs");

let root = "";
const running: any[] = [];
const connected: any[] = [];

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "kiwi-collab-actions-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "A.java"), "class A {}\n", "utf8");
});

afterEach(async () => {
  for (const guest of connected.splice(0)) guest.disconnect();
  for (const host of running.splice(0)) await host.stop();
  rmSync(root, { recursive: true, force: true });
});

async function startHost(options: Record<string, unknown> = {}) {
  const host = new CollabHost({ root, ...options });
  running.push(host);
  const session = await host.start(0, "127.0.0.1");
  return { host, session };
}

async function joinHost(session: { port: number; token: string }, name = "Gast") {
  const guest = new CollabGuest({ name });
  connected.push(guest);
  const welcome = await guest.connect(
    createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));
  return { guest, welcome };
}

/** The peer id of the one guest connected to a host. */
const onlyPeer = (host: any) => [...host.peers.keys()][0];

/**
 * The build, debug and terminal permissions existed for a while and granted
 * nothing: output flowed to guests, and starting anything was the host's alone.
 */
describe("a guest asking the host to build", () => {
  it("is refused when the permission was never granted", async () => {
    const { host, session } = await startHost();
    const { guest } = await joinHost(session);
    await expect(guest.request("run", { action: "build" }))
      .rejects.toThrow(/bauen oder ausführen/);
    expect(host).toBeTruthy();
  });

  it("is refused for an editor, who was never granted a build", async () => {
    // "bearbeiten" used to mean everything dangerous at once, and must not
    // start meaning it again through a back door.
    const { session } = await startHost({ defaultRole: "bearbeiten" });
    const { guest } = await joinHost(session);
    await expect(guest.request("run", { action: "test" })).rejects.toThrow(/bauen oder ausführen/);
  });

  it("reaches the project's own window once the host grants it", async () => {
    const events: any[] = [];
    const { host, session } = await startHost({ send: (channel: string, payload: any) => events.push({ channel, payload }) });
    const { guest } = await joinHost(session, "Robin");
    host.setPeerPermissions(onlyPeer(host), ["build"]);

    const answer = await guest.request("run", { action: "test" });
    expect(answer.started).toBe(true);
    // The session does not own the build. It says what was asked and by whom,
    // and the window that owns the project runs it — one code path for running
    // means guests see exactly the output the host sees.
    const request = events.filter((event) => event.channel === "collab:runRequest").at(-1);
    expect(request?.payload).toMatchObject({ action: "test", name: "Robin", projectRoot: path.resolve(root) });
  });

  it("keeps building and debugging apart", async () => {
    const { host, session } = await startHost();
    const { guest } = await joinHost(session);
    host.setPeerPermissions(onlyPeer(host), ["build"]);
    await expect(guest.request("run", { action: "debug" })).rejects.toThrow(/nicht debuggen/);

    host.setPeerPermissions(onlyPeer(host), ["debug"]);
    await expect(guest.request("run", { action: "build" })).rejects.toThrow(/bauen oder ausführen/);
    expect((await guest.request("run", { action: "debug" })).started).toBe(true);
  });

  it("refuses something that is not an action at all", async () => {
    const { host, session } = await startHost();
    const { guest } = await joinHost(session);
    host.setPeerPermissions(onlyPeer(host), ["build", "debug", "terminal", "git"]);
    await expect(guest.request("run", { action: "terminal" })).rejects.toThrow(/Unbekannte Aktion/);
  });
});

/**
 * A guest cannot offer a button for something it does not know it may do, so
 * the welcome has to carry the permissions and not only the role.
 */
describe("what the welcome tells a guest", () => {
  it("carries the permissions, not only the role", async () => {
    const { session } = await startHost({ defaultRole: "bearbeiten" });
    const { welcome } = await joinHost(session);
    expect(welcome.permissions).toEqual(["bearbeiten", "speichern"]);
  });

  it("tells a reader it has none", async () => {
    const { session } = await startHost();
    const { welcome } = await joinHost(session);
    expect(welcome.permissions).toEqual([]);
  });
});

/**
 * For a codebase that may not leave this machine, the usual trade goes the
 * other way: nothing is written down, and the guest works through the
 * connection alone.
 */
describe("the strict host-only mode", () => {
  it("tells the guest there will be no copy", async () => {
    const { session } = await startHost({ hostOnly: true });
    const { welcome } = await joinHost(session);
    expect(welcome.hostOnly).toBe(true);
  });

  it("refuses to hand out the files a copy is built from", async () => {
    // The flag told the guest not to write anything down; this is what makes
    // it true for a guest that did not listen.
    const { session } = await startHost({ hostOnly: true });
    const { guest } = await joinHost(session);
    await expect(guest.request("bundle", { paths: ["src/A.java"] }))
      .rejects.toThrow(/keine lokale Kopie/);
  });

  it("still lets a guest read one file at a time", async () => {
    // Reading through the connection is the whole point of the mode; only the
    // copy on disk is refused.
    const { session } = await startHost({ hostOnly: true });
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "src/A.java" });
    expect(opened.text).toContain("class A");
  });

  it("hands out bundles again when the host has not asked for the mode", async () => {
    const { session } = await startHost();
    const { guest } = await joinHost(session);
    const bundle = await guest.request("bundle", { paths: ["src/A.java"] });
    expect(bundle.files?.[0]?.text).toContain("class A");
  });

  it("is not retroactive, and says so by only changing what comes next", async () => {
    // A guest that already built a copy has the files; a flag cannot take them
    // back, and pretending otherwise would be a promise the host cannot keep.
    const { host, session } = await startHost();
    const { guest } = await joinHost(session);
    expect((await guest.request("bundle", { paths: ["src/A.java"] })).files).toHaveLength(1);
    host.setHostOnly(true);
    await expect(guest.request("bundle", { paths: ["src/A.java"] })).rejects.toThrow(/keine lokale Kopie/);
    expect(host.state().hostOnly).toBe(true);
  });
});
