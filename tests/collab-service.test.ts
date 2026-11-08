import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, Socket } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const {
  SharedDocument,
  MAX_SHARED_FILE_BYTES,
  applyEdit,
  createInviteCode,
  createLineReader,
  createToken,
  parseInviteCode,
  reachableAddresses,
  readSharedTree,
  readSharedText,
  rebaseEdit,
  resolveShared,
  resolveSharedExisting,
  sharedTextHash,
  shiftEdit,
  tokensMatch,
} = require("../electron/services/collab-service.cjs");

const { CollabGuest, CollabHost } = require("../electron/services/collab-session.cjs");
const { createRelayServer } = require("../electron/services/collab-relay-service.cjs");

describe("the Electron boundary", () => {
  it("validates the host root with the registered workspace guard", () => {
    const main = readFileSync(path.join(process.cwd(), "electron", "main.cjs"), "utf8");
    expect(main).toContain("const projectRoot = guard.assertWorkspace(root)");
    expect(main).not.toContain("pathGuard.assertWorkspace(root)");
    // What matters is the guarded root and that events are broadcast, not the
    // line breaks: the constructor call grew a fourth option and wrapped.
    expect(main).toMatch(/new CollabHost\(\{\s*root: projectRoot,\s*send: broadcast/);
    // The guest's events still reach the renderer, but they now pass through
    // a wrapper on the way: it is the one place that sees every change to a
    // file and can keep the guest's working copy in step. What this has to
    // hold is that nothing was swallowed there, not how the call is spelled.
    expect(main).toContain("const guest = new CollabGuest({");
    expect(main).toContain("broadcast(channel, message);");
    expect(main).toContain("collabRefresher.changed(message?.path)");
    expect(main).toContain("const host = collabHostFor(payload?.root)");
    expect(main).toContain("let collabJoinGeneration = 0");
    expect(main).toContain("let collabHostGeneration = 0");
    expect(main).toContain("generation !== collabJoinGeneration || collabGuest !== guest");
    expect(main).toContain("generation !== collabHostGeneration || collabHost !== host");
    expect(main).toContain('browserWindow.webContents.send("settings:context", { projectRoot: activeRoot })');
    expect(main).toContain("host.localEdit(payload.path, payload.edit, payload.baseVersion)");
    expect(main).toContain('ipcMain.handle("collab:localSnapshot"');
    expect(main).toContain('ipcMain.handle("collab:localSave"');
    expect(main).toContain("async function stopCollabHosting()");
    expect(main).toContain("if (isEditor) {\n      void stopCollabHosting();\n      stopCollabGuest()");
    expect(main).toContain('ipcMain.handle("app:showWelcome", async () => {\n    // Neither side');
    expect(main).toContain("stopCollabGuest();\n    await stopCollabHosting()");
    const preload = readFileSync(path.join(process.cwd(), "electron", "preload.cjs"), "utf8");
    expect(preload).toContain('invoke("collab:localEdit", { root, path, edit, baseVersion })');
    expect(preload).toContain('invoke("collab:localReplace", { root, path, text })');
    expect(preload).toContain('invoke("collab:localSnapshot", { root, path })');
    expect(preload).toContain('invoke("collab:localSave", { root, path })');
  });
});

let root = "";
const running: Array<{ stop: () => void }> = [];
const connected: Array<{ disconnect: () => void }> = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-collab-"));
});

afterEach(async () => {
  for (const guest of connected.splice(0)) guest.disconnect();
  await Promise.all(running.splice(0).map((host) => host.stop()));
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/** Starts a host on the loopback address, so no test opens a port to the network. */
async function startHost(options: Record<string, unknown> = {}) {
  // These sessions are about what the protocol does, not about who may do
  // it, so they grant editing unless a test is specifically about the other
  // case. The product's own default is the safer one.
  const host = new CollabHost({ root, defaultRole: "bearbeiten", ...options });
  running.push(host);
  const session = await host.start(0, "127.0.0.1");
  return { host, session };
}

/** Connects a guest to a running host. */
async function joinHost(session: { port: number; token: string }, name = "Gast") {
  const guest = new CollabGuest({ name });
  connected.push(guest);
  const welcome = await guest.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));
  return { guest, welcome };
}

describe("the invite code", () => {
  it("carries address, port and key in one string", () => {
    const code = createInviteCode({ host: "192.168.0.5", port: 7654, token: "abc", project: "beta" });
    expect(code).toMatch(/^kiwi:\/\/codetogether\/join\?/);
    expect(parseInviteCode(code))
      .toEqual({ host: "192.168.0.5", port: 7654, token: "abc", project: "beta", relay: false });
  });

  it("continues to read invite codes copied from older Kiwi versions", () => {
    const old = Buffer.from(JSON.stringify({ h: "127.0.0.1", p: 4321, t: "old", n: "alpha" }), "utf8")
      .toString("base64url");
    // A code copied before relays existed points straight at a host, and
    // still says so rather than being read as a relay address.
    expect(parseInviteCode(old))
      .toEqual({ host: "127.0.0.1", port: 4321, token: "old", project: "alpha", relay: false });
  });

  it("refuses what is not one, by name", () => {
    // A user who mistypes a code needs to know that is what happened, rather
    // than watching a connection fail for no stated reason.
    expect(() => parseInviteCode("")).toThrow(/leer/);
    expect(() => parseInviteCode("kein-code")).toThrow(/unlesbar|unvollständig/);
    expect(() => parseInviteCode(createInviteCode({ host: "h", port: 1, token: "t" }).slice(0, 6)))
      .toThrow(/unlesbar|unvollständig/);
  });

  it("prefers an address a guest could actually reach", () => {
    const addresses = reachableAddresses({
      Ethernet: [{ family: "IPv4", internal: false, address: "192.168.0.5" }],
      Loopback: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    });
    // Handing somebody 127.0.0.1 gives them an address that works on the
    // host's machine and nowhere else.
    expect(addresses).toEqual(["192.168.0.5"]);
  });
});

describe("the key", () => {
  it("only matches itself, and never an empty one", () => {
    const token = createToken();
    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, `${token}x`)).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
  });

  it("is long enough not to be guessed", () => {
    expect(createToken()).toHaveLength(64);
    expect(createToken()).not.toBe(createToken());
  });
});

describe("paths a guest may name", () => {
  it("keeps every request inside the shared project", () => {
    // The guest is on the other side of a socket. This is the only thing
    // between a shared folder and the whole disk.
    expect(resolveShared(root, "src/Main.java")).toBe(path.join(root, "src", "Main.java"));
    expect(() => resolveShared(root, "../secrets.txt")).toThrow(/innerhalb/);
    expect(() => resolveShared(root, "src/../../etc/passwd")).toThrow(/innerhalb/);
    expect(() => resolveShared(root, "C:\\Windows\\System32\\config")).toThrow(/innerhalb/);
    expect(() => resolveShared(root, "/etc/passwd")).toThrow(/innerhalb/);
    expect(() => resolveShared(root, "")).toThrow(/kein Pfad/);
  });

  it("refuses hidden and generated paths even when a guest guesses their names", () => {
    for (const hidden of [".env", ".git/config", ".kiwi/session.json", "target/classes/A.class", "build/A.class", "node_modules/a/index.js"]) {
      expect(() => resolveShared(root, hidden)).toThrow(/nicht.*freigegeben/i);
    }
    expect(() => resolveShared(root, ".gitignore")).not.toThrow();
  });

  it("does not follow a project symlink onto the host's remaining disk", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "kiwi-collab-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "privat");
    const link = path.join(root, "link");
    try {
      await symlink(outside, link, "junction");
      await expect(resolveSharedExisting(root, "link/secret.txt")).rejects.toThrow(/innerhalb/);
    } finally {
      await rm(link, { recursive: true, force: true }).catch(() => undefined);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("opens only bounded UTF-8 text files", async () => {
    await writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    await expect(readSharedText(root, "binary.dat")).rejects.toThrow(/Binärdateien/);
    await writeFile(path.join(root, "broken.txt"), Buffer.from([0xc3, 0x28]));
    await expect(readSharedText(root, "broken.txt")).rejects.toThrow(/UTF-8/);
    await writeFile(path.join(root, "huge.txt"), Buffer.alloc(MAX_SHARED_FILE_BYTES + 1, 65));
    await expect(readSharedText(root, "huge.txt")).rejects.toThrow(/größer/);
  });
});

describe("applying an edit", () => {
  it("replaces the span it names", () => {
    expect(applyEdit("hallo welt", { start: 6, end: 10, text: "erde" })).toBe("hallo erde");
    expect(applyEdit("abc", { start: 3, end: 3, text: "d" })).toBe("abcd");
  });

  it("stays inside the text it was given", () => {
    // An offset from a peer that is out of step must not throw or truncate.
    expect(applyEdit("abc", { start: 99, end: 120, text: "!" })).toBe("abc!");
  });
});

describe("two people typing at once", () => {
  it("moves a later edit over an earlier one", () => {
    // The ordinary case: two people working in different places, which has to
    // keep working without anyone being told to wait.
    const shifted = shiftEdit({ start: 20, end: 25, text: "x" }, { start: 0, end: 0, text: "abc" });
    expect(shifted).toMatchObject({ start: 23, end: 28 });
  });

  it("leaves an edit before the other one where it is", () => {
    expect(shiftEdit({ start: 2, end: 4, text: "x" }, { start: 10, end: 12, text: "yy" }))
      .toMatchObject({ start: 2, end: 4 });
  });

  it("refuses to guess when both changed the same span", () => {
    // There is no answer here that is not an invented intent, so it says so
    // and the caller resynchronises instead.
    expect(shiftEdit({ start: 5, end: 9, text: "a" }, { start: 7, end: 12, text: "b" })).toBeNull();
  });

  it("carries an edit over a whole run of them", () => {
    const rebased = rebaseEdit({ start: 30, end: 30, text: "!" }, [
      { start: 0, end: 0, text: "12345" },
      { start: 0, end: 0, text: "67890" },
    ]);
    expect(rebased).toMatchObject({ start: 40, end: 40 });
  });
});

describe("a shared document", () => {
  it("applies an edit written against the current version", () => {
    const document = new SharedDocument("A.java", "class A {}");
    const result = document.apply({ start: 9, end: 9, text: " " }, 1);
    expect(result.ok).toBe(true);
    expect(document.text).toBe("class A { }");
    expect(document.version).toBe(2);
  });

  it("rebases an edit written against an older one", () => {
    const document = new SharedDocument("A.java", "class A {}");
    document.apply({ start: 0, end: 0, text: "// oben\n" }, 1);
    // The second editor still thinks the brace is at offset 9.
    const result = document.apply({ start: 9, end: 9, text: " " }, 1);
    expect(result.ok).toBe(true);
    expect(document.text).toBe("// oben\nclass A { }");
  });

  it("validates stale offsets against their base revision before rebasing", () => {
    const document = new SharedDocument("A.java", "abcdef");
    document.apply({ start: 0, end: 4, text: "" }, 1);
    expect(document.text).toBe("ef");
    // [5,6] was valid in v1 and points at `f`; after the deletion it belongs
    // at [1,2], even though 6 is beyond the current two-character text.
    const result = document.apply({ start: 5, end: 6, text: "F" }, 1);
    expect(result).toMatchObject({ ok: true, edit: { start: 1, end: 2, text: "F" } });
    expect(document.text).toBe("eF");
  });

  it("rejects offsets that never existed in the claimed base revision", () => {
    const document = new SharedDocument("A.java", "ab");
    document.apply({ start: 0, end: 0, text: "012345" }, 1);
    expect(document.text).toBe("012345ab");
    const result = document.apply({ start: 2, end: 7, text: "x" }, 1);
    expect(result).toMatchObject({ ok: false, reason: "ungültig" });
    expect(document.text).toBe("012345ab");
  });

  it("asks for a resynchronisation rather than merging a collision", () => {
    const document = new SharedDocument("A.java", "class A {}");
    document.apply({ start: 0, end: 5, text: "interface" }, 1);
    const result = document.apply({ start: 0, end: 5, text: "enum" }, 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("kollidiert");
    // The whole text comes back, because an editor that is out of step cannot
    // act on a refusal alone.
    expect(result.text).toBe("interface A {}");
  });

  it("says an edit is too old rather than placing it wrongly", () => {
    const document = new SharedDocument("A.java", "x");
    for (let step = 0; step < 250; step += 1) document.apply({ start: 0, end: 0, text: "y" }, document.version);
    const result = document.apply({ start: 0, end: 0, text: "z" }, 1);
    expect(result).toMatchObject({ ok: false, reason: "veraltet" });
  });

  it("refuses a missing, future or malformed base revision", () => {
    const document = new SharedDocument("A.java", "class A {}");
    expect(document.apply({ start: 0, end: 0, text: "x" }, Number.NaN)).toMatchObject({ ok: false, reason: "veraltet" });
    expect(document.apply({ start: 0, end: 0, text: "x" }, 99)).toMatchObject({ ok: false, reason: "veraltet" });
    expect(document.apply({ start: -1, end: 0, text: "x" }, 1)).toMatchObject({ ok: false, reason: "ungültig" });
    expect(document.apply({ start: 0.5, end: 1, text: "x" }, 1)).toMatchObject({ ok: false, reason: "ungültig" });
    expect(document.apply({ start: 0, end: 999, text: "x" }, 1)).toMatchObject({ ok: false, reason: "ungültig" });
    expect(document.text).toBe("class A {}");
  });

  it("refuses an edit whose resulting UTF-8 text exceeds its limit", () => {
    const document = new SharedDocument("A.java", "ab", undefined, 5);
    expect(document.apply({ start: 2, end: 2, text: "cde" }, 1)).toMatchObject({ ok: true });
    expect(document.apply({ start: 5, end: 5, text: "f" }, 2)).toMatchObject({ ok: false, reason: "zu groß" });
    expect(document.text).toBe("abcde");
  });
});

describe("reading the wire", () => {
  it("splits messages on newlines and ignores blank lines", () => {
    const seen: unknown[] = [];
    const read = createLineReader((message: unknown) => seen.push(message));
    read('{"a":1}\n\n{"b":');
    read('2}\n');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reports a line that is not a message instead of dying on it", () => {
    const problems: Error[] = [];
    const read = createLineReader(() => undefined, (error: Error) => problems.push(error));
    read("kein json\n");
    expect(problems[0].message).toMatch(/unlesbar/);
  });
});

describe("the tree a guest is shown", () => {
  it("leaves out what nobody needs to see", async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Main.java"), "class Main {}");
    await mkdir(path.join(root, "node_modules", "left-pad"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "");
    await mkdir(path.join(root, "build"), { recursive: true });
    await writeFile(path.join(root, "build", "Main.class"), "");

    const tree = await readSharedTree(root);
    const paths = tree.entries.map((entry: { path: string }) => entry.path);
    expect(paths).toContain("src/Main.java");
    expect(paths.some((entry: string) => entry.startsWith("node_modules"))).toBe(false);
    expect(paths.some((entry: string) => entry.startsWith("build"))).toBe(false);
  });

  it("stops at its limit and says the listing is incomplete", async () => {
    for (let index = 0; index < 20; index += 1) {
      await writeFile(path.join(root, `File${index}.java`), "");
    }
    const tree = await readSharedTree(root, { maxEntries: 5 });
    expect(tree.entries).toHaveLength(5);
    expect(tree.truncated).toBe(true);
  });
});

describe("a session over a real connection", () => {
  it("can restore the host panel without exposing a separate token", async () => {
    const { host, session } = await startHost({ projectName: "beta" });
    const state = host.state();
    expect(state).toMatchObject({ hosting: true, port: session.port, root, project: "beta", invite: session.invite });
    expect(state).not.toHaveProperty("token");
    expect(parseInviteCode(state.invite).token).toBe(session.token);
  });

  it("uses one revision stream for alternate spellings of the same path", async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Main.java"), "class Main {}");
    const { host } = await startHost();
    const slash = await host.document("src/Main.java");
    const native = await host.document(`src${path.sep}Main.java`);
    expect(native).toBe(slash);
    expect(host.documents.size).toBe(1);
  });

  it("rebases a host edit that was produced before a guest edit", async () => {
    await writeFile(path.join(root, "Main.java"), "abcdef");
    const { host, session } = await startHost();
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    await guest.request("edit", {
      path: "Main.java",
      edit: { start: 0, end: 4, text: "" },
      baseVersion: opened.version,
    });
    const hostEdit = await host.localEdit("Main.java", { start: 5, end: 6, text: "F" }, opened.version);
    expect(hostEdit).toMatchObject({ ok: true, edit: { start: 1, end: 2, text: "F" } });
    expect(await host.localSnapshot("Main.java")).toMatchObject({ text: "eF", version: hostEdit.version });
  });

  it("coalesces simultaneous first loads into one shared document", async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Main.java"), "class Main {}");
    const { host } = await startHost();
    const [first, second, third] = await Promise.all([
      host.document("src/Main.java"),
      host.document(`src${path.sep}Main.java`),
      host.localReplace("src/Main.java", "class Main { int value; }").then(() => host.document("src/Main.java")),
    ]);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(host.documents.size).toBe(1);
  });

  it("stops idempotently and clears its public session state", async () => {
    const { host } = await startHost();
    await host.stop();
    await host.stop();
    expect(host.state()).toMatchObject({ hosting: false, port: 0, invite: "", peers: [] });
  });

  it("cancels a server even when stop is called before listen completes", async () => {
    const host = new CollabHost({ root });
    running.push(host);
    const starting = host.start(0, "127.0.0.1");
    const stopping = host.stop();
    await expect(starting).rejects.toThrow(/abgebrochen/);
    await stopping;
    expect(host.state()).toMatchObject({ hosting: false, port: 0 });
    expect(host.server).toBeNull();
    // Reusing the service after the completed stop resets its stopping state;
    // this also proves no ghost listener still owns the old server.
    const restarted = await host.start(0, "127.0.0.1");
    expect(restarted.port).toBeGreaterThan(0);
  });

  it("lets a guest browse, open and change a file the host owns", async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Main.java"), "class Main {}");
    const { session } = await startHost({ projectName: "beta" });
    const { guest, welcome } = await joinHost(session, "Zweiter");

    expect(welcome.project).toBe("beta");
    const tree = await guest.request("tree");
    expect(tree.entries.map((entry: { path: string }) => entry.path)).toContain("src/Main.java");

    const opened = await guest.request("open", { path: "src/Main.java" });
    expect(opened.text).toBe("class Main {}");

    const edited = await guest.request("edit", {
      path: "src/Main.java",
      edit: { start: opened.text.length, end: opened.text.length, text: " // vom Gast" },
      baseVersion: opened.version,
    });
    expect(edited.applied).toBe(true);

    await guest.request("save", { path: "src/Main.java" });
    // The guest holds no file of its own: the change has to be on the host's
    // disk, or the session moved nothing.
    expect(await readFile(path.join(root, "src", "Main.java"), "utf8")).toBe("class Main {} // vom Gast");
  });

  it("does not overwrite a file that changed independently on the host", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "class Main {}");
    const { session } = await startHost();
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    await guest.request("edit", {
      path: "Main.java",
      edit: { start: opened.text.length, end: opened.text.length, text: " // Gast" },
      baseVersion: opened.version,
    });
    await writeFile(file, "class Main { int host; }");
    const saved = await guest.request("save", { path: "Main.java" });
    expect(saved).toMatchObject({ saved: false, conflict: true, text: "class Main { int host; }" });
    expect(await readFile(file, "utf8")).toBe("class Main { int host; }");
  });

  it("lets a guest save an unsaved host buffer over its verified disk baseline", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "A");
    const { host, session } = await startHost();
    await host.localReplace("Main.java", "B");
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    expect(opened.text).toBe("B");
    const saved = await guest.request("save", { path: "Main.java" });
    expect(saved).toMatchObject({ saved: true, version: opened.version });
    expect(await readFile(file, "utf8")).toBe("B");
  });

  it("accepts a host buffer whose matching contents were already written to disk", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "A");
    const { host, session } = await startHost();
    // Open once so the document retains A as its verified baseline, then model
    // the ordinary host-save order: disk write followed by editor sync.
    await host.document("Main.java");
    await writeFile(file, "B");
    await host.localReplace("Main.java", "B");
    const { guest } = await joinHost(session);
    const saved = await guest.request("save", { path: "Main.java" });
    expect(saved).toMatchObject({ saved: true });
    expect(saved).not.toHaveProperty("conflict");
    expect(await readFile(file, "utf8")).toBe("B");
  });

  it("refuses an oversized host buffer without replacing the shared text", async () => {
    await writeFile(path.join(root, "Main.java"), "A");
    const { host } = await startHost();
    await expect(host.localReplace("Main.java", "x".repeat(MAX_SHARED_FILE_BYTES + 1))).rejects.toThrow(/höchstens/);
    expect(await host.localSnapshot("Main.java")).toMatchObject({ text: "A", version: 1 });
  });

  it("records the exact save snapshot when another edit lands during the disk write", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "A");
    let releaseWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const delayedWrite = async (target: string, text: string, encoding: BufferEncoding) => {
      markWriteStarted();
      await release;
      await writeFile(target, text, encoding);
    };
    const { host, session } = await startHost({ writeFile: delayedWrite });
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    const firstEdit = await guest.request("edit", {
      path: "Main.java",
      edit: { start: 1, end: 1, text: "B" },
      baseVersion: opened.version,
    });
    const saving = guest.request("save", { path: "Main.java" });
    await writeStarted;
    const duringSave = await host.localEdit("Main.java", { start: 2, end: 2, text: "C" });
    releaseWrite();
    const saved = await saving;
    expect(saved).toMatchObject({
      saved: true,
      version: firstEdit.version,
      currentVersion: duringSave.version,
      dirty: true,
    });
    expect(await readFile(file, "utf8")).toBe("AB");
    const document = await host.document("Main.java");
    expect(document.text).toBe("ABC");
    expect(document.diskHash).toBe(sharedTextHash("AB"));
    expect(document.dirty).toBe(true);
  });

  it("serializes concurrent saves so an older write cannot finish last", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "A");
    const started: Array<() => void> = [];
    const releases: Array<Promise<void>> = [];
    const releaseWrite: Array<() => void> = [];
    const written: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      releases.push(new Promise<void>((resolve) => { releaseWrite[index] = resolve; }));
    }
    const writeStarted = [0, 1].map((index) => new Promise<void>((resolve) => { started[index] = resolve; }));
    let writeIndex = 0;
    const delayedWrite = async (target: string, text: string, encoding: BufferEncoding) => {
      const index = writeIndex;
      writeIndex += 1;
      written.push(text);
      started[index]();
      await releases[index];
      await writeFile(target, text, encoding);
    };
    const { host, session } = await startHost({ writeFile: delayedWrite });
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    const firstEdit = await guest.request("edit", {
      path: "Main.java",
      edit: { start: 1, end: 1, text: "B" },
      baseVersion: opened.version,
    });
    const firstSave = guest.request("save", { path: "Main.java" });
    await writeStarted[0];
    const secondEdit = await host.localEdit("Main.java", { start: 2, end: 2, text: "C" });
    const secondSave = guest.request("save", { path: "Main.java" });
    // The second writer must not start before the first one has completed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writeIndex).toBe(1);
    expect(written).toEqual(["AB"]);

    releaseWrite[0]();
    await writeStarted[1];
    expect(written).toEqual(["AB", "ABC"]);
    releaseWrite[1]();
    const [firstResult, secondResult] = await Promise.all([firstSave, secondSave]);
    expect(firstResult).toMatchObject({ saved: true, version: firstEdit.version, dirty: true });
    expect(secondResult).toMatchObject({ saved: true, version: secondEdit.version, dirty: false });
    expect(await readFile(file, "utf8")).toBe("ABC");
    const document = await host.document("Main.java");
    expect(document.diskHash).toBe(sharedTextHash("ABC"));
    expect(document.dirty).toBe(false);
    expect(host.saveQueues.size).toBe(0);
  });

  it("queues a host save behind a blocked guest save and persists the newest text", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "A");
    const releases: Array<Promise<void>> = [];
    const releaseWrite: Array<() => void> = [];
    const markStarted: Array<() => void> = [];
    const started = [0, 1].map((index) => {
      releases[index] = new Promise<void>((resolve) => { releaseWrite[index] = resolve; });
      return new Promise<void>((resolve) => { markStarted[index] = resolve; });
    });
    const written: string[] = [];
    const delayedWrite = async (target: string, text: string, encoding: BufferEncoding) => {
      const index = written.length;
      written.push(text);
      markStarted[index]();
      await releases[index];
      await writeFile(target, text, encoding);
    };
    const { host, session } = await startHost({ writeFile: delayedWrite });
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    await guest.request("edit", {
      path: "Main.java",
      edit: { start: 1, end: 1, text: "B" },
      baseVersion: opened.version,
    });
    const guestSave = guest.request("save", { path: "Main.java" });
    await started[0];
    const hostEdit = await host.localEdit("Main.java", { start: 2, end: 2, text: "C" });
    const hostSave = host.localSave("Main.java");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(written).toEqual(["AB"]);

    releaseWrite[0]();
    await started[1];
    expect(written).toEqual(["AB", "ABC"]);
    releaseWrite[1]();
    const [guestResult, hostResult] = await Promise.all([guestSave, hostSave]);
    expect(guestResult).toMatchObject({ saved: true, dirty: true });
    expect(hostResult).toMatchObject({ saved: true, version: hostEdit.version, dirty: false });
    expect(await readFile(file, "utf8")).toBe("ABC");
    expect(await host.localSnapshot("Main.java")).toMatchObject({ text: "ABC", version: hostEdit.version });
  });

  it("does not finish stop while an accepted disk write is still running", async () => {
    const file = path.join(root, "Main.java");
    await writeFile(file, "A");
    let markWriteStarted!: () => void;
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const delayedWrite = async (target: string, text: string, encoding: BufferEncoding) => {
      markWriteStarted();
      await release;
      await writeFile(target, text, encoding);
    };
    const { host, session } = await startHost({ writeFile: delayedWrite });
    const { guest } = await joinHost(session);
    const opened = await guest.request("open", { path: "Main.java" });
    await guest.request("edit", {
      path: "Main.java",
      edit: { start: 1, end: 1, text: "B" },
      baseVersion: opened.version,
    });
    const saving = guest.request("save", { path: "Main.java" }).catch((error: Error) => error);
    await writeStarted;
    let stopped = false;
    const stopping = host.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    releaseWrite();
    await stopping;
    await saving;
    expect(stopped).toBe(true);
    expect(await readFile(file, "utf8")).toBe("AB");
    expect(host.saveQueues.size).toBe(0);
    expect(host.documents.size).toBe(0);
  });

  it("turns away a guest whose key is wrong", async () => {
    const { session } = await startHost();
    const guest = new CollabGuest({ name: "Fremder" });
    connected.push(guest);
    await expect(guest.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: "falsch" })))
      .rejects.toThrow(/Einladungsschlüssel/);
  });

  it("cancels a superseded connection before it can become a ghost guest", async () => {
    const { host, session } = await startHost();
    const delayedConnection = (options: { host: string; port: number }, connected: () => void) => {
      const socket = new Socket();
      const timer = setTimeout(() => {
        if (!socket.destroyed) socket.connect(options, connected);
      }, 80);
      timer.unref?.();
      socket.once("close", () => clearTimeout(timer));
      return socket;
    };
    const first = new CollabGuest({ name: "Alt", createConnection: delayedConnection });
    connected.push(first);
    const oldJoin = first.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));
    const oldJoinRejected = expect(oldJoin).rejects.toThrow(/beendet|neuere Sitzung/);
    first.disconnect();

    const { welcome } = await joinHost(session, "Neu");
    await oldJoinRejected;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(welcome.project).toBe(host.projectName);
    expect(host.peerList().map((peer: { name: string }) => peer.name)).toEqual(["Neu"]);
  });

  it("disconnects a joined guest and rejects every pending request before returning to the hub", async () => {
    const { host, session } = await startHost();
    const { guest } = await joinHost(session, "Hub-Wechsel");
    const originalHandleMessage = host.handleMessage.bind(host);
    let releaseRequest!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseRequest = resolve; });
    host.handleMessage = async (peer: unknown, message: { type?: string }) => {
      if (message?.type === "lifecycle-test") {
        await blocked;
        return;
      }
      return originalHandleMessage(peer, message);
    };

    const pending = guest.request("lifecycle-test").catch((error: Error) => error);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(guest.pending.size).toBe(1);

    // This is the operation used by the editor-close and project-hub
    // lifecycles in main.cjs.
    guest.disconnect();
    const result = await pending;
    releaseRequest();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Sitzung wurde beendet/);
    expect(guest.socket).toBeNull();
    expect(guest.connecting).toBeNull();
    expect(guest.pending.size).toBe(0);
    expect(host.peerList()).toEqual([]);
    await expect(guest.request("tree")).rejects.toThrow(/keine Verbindung/);
  });

  it("destroys the socket when a connected host never answers hello", async () => {
    let markClosed!: () => void;
    const peerClosed = new Promise<void>((resolve) => { markClosed = resolve; });
    const silentServer = createServer((socket) => {
      socket.on("data", () => undefined);
      socket.once("close", markClosed);
    });
    await new Promise<void>((resolve, reject) => {
      silentServer.once("error", reject);
      silentServer.listen(0, "127.0.0.1", resolve);
    });
    const address = silentServer.address();
    if (!address || typeof address === "string") throw new Error("Testserver hat keinen TCP-Port.");
    const guest = new CollabGuest({ name: "Timeout", requestTimeoutMs: 30 });
    connected.push(guest);
    try {
      await expect(guest.connect(createInviteCode({ host: "127.0.0.1", port: address.port, token: "secret" })))
        .rejects.toThrow(/nicht geantwortet/);
      await peerClosed;
      expect(guest.socket).toBeNull();
      expect(guest.connecting).toBeNull();
      expect(guest.pending.size).toBe(0);
    } finally {
      await new Promise<void>((resolve) => silentServer.close(() => resolve()));
    }
  });

  it("refuses a path that climbs out of the project", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { session } = await startHost();
    const { guest } = await joinHost(session);
    // The guard is not only in the renderer: a guest is a program on another
    // machine and can send whatever it likes.
    await expect(guest.request("open", { path: "../../secrets.txt" })).rejects.toThrow(/innerhalb/);
  });

  it("also refuses direct requests for files omitted from the tree", async () => {
    await writeFile(path.join(root, ".env"), "TOKEN=secret");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git", "config"), "secret");
    const { session } = await startHost();
    const { guest } = await joinHost(session);
    await expect(guest.request("open", { path: ".env" })).rejects.toThrow(/nicht.*freigegeben/i);
    await expect(guest.request("open", { path: ".git/config" })).rejects.toThrow(/nicht.*freigegeben/i);
  });

  it("enforces the participant limit and answers cursor broadcasts", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { session } = await startHost({ maxPeers: 1 });
    const { guest } = await joinHost(session, "Eins");
    await expect(guest.request("cursor", { path: "Main.java", offset: 3 })).resolves.toMatchObject({ sent: true });
    const extra = new CollabGuest({ name: "Zwei" });
    connected.push(extra);
    await expect(extra.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token })))
      .rejects.toThrow(/voll/);
  });

  it("tells the host who is connected", async () => {
    const events: Array<{ channel: string; payload: Record<string, unknown> }> = [];
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const host = new CollabHost({
      root,
      send: (channel: string, payload: Record<string, unknown>) => events.push({ channel, payload }),
    });
    running.push(host);
    const session = await host.start(0, "127.0.0.1");
    await joinHost(session, "Zweiter");
    const joined = events.find((event) => event.channel === "collab:peers");
    expect(joined?.payload.joined).toBe("Zweiter");
    expect(joined?.payload.session).toBe("host");
    expect((joined?.payload.peers as Array<{ name: string }>)[0].name).toBe("Zweiter");
  });

  it("passes one guest's change on to the other", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { session } = await startHost();
    const { guest: first } = await joinHost(session, "Eins");
    const seen: Array<Record<string, unknown>> = [];
    const second = new CollabGuest({
      name: "Zwei",
      send: (_channel: string, payload: Record<string, unknown>) => seen.push(payload),
    });
    connected.push(second);
    await second.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));

    const opened = await first.request("open", { path: "Main.java" });
    await first.request("edit", {
      path: "Main.java",
      edit: { start: 12, end: 12, text: "!" },
      baseVersion: opened.version,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const edit = seen.find((event) => event.type === "edit");
    expect(edit).toMatchObject({ path: "Main.java", session: "guest" });
  });
});

describe("who may read and who may change", () => {
  it("lets a guest read but refuses the edit, on the host", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { session } = await startHost({ defaultRole: "lesen" });
    const { guest, welcome } = await joinHost(session);
    // Reading is what a guest gets by default. Nothing about the interface it
    // happens to be running decides this.
    expect(welcome.role).toBe("lesen");
    const opened = await guest.request("open", { path: "Main.java" });
    expect(opened.text).toBe("class Main {}");
    await expect(guest.request("edit", {
      path: "Main.java",
      edit: { start: 0, end: 0, text: "// " },
      baseVersion: opened.version,
    })).rejects.toThrow(/nur lesen/);
    await expect(guest.request("save", { path: "Main.java" })).rejects.toThrow(/nur lesen/);
    // The refusal has to leave the file exactly as it was.
    expect(await readFile(path.join(root, "Main.java"), "utf8")).toBe("class Main {}");
  });

  it("accepts the same edit once the host grants it", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { host, session } = await startHost({ defaultRole: "lesen" });
    const { guest, welcome } = await joinHost(session);
    host.setPeerRole(welcome.peerId, "bearbeiten");
    const opened = await guest.request("open", { path: "Main.java" });
    const result = await guest.request("edit", {
      path: "Main.java",
      edit: { start: opened.text.length, end: opened.text.length, text: " // vom Gast" },
      baseVersion: opened.version,
    });
    expect(result.applied).toBe(true);
    await guest.request("save", { path: "Main.java" });
    expect(await readFile(path.join(root, "Main.java"), "utf8")).toBe("class Main {} // vom Gast");
  });

  it("takes the right back, and says so rather than going quiet", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const seen: Array<Record<string, unknown>> = [];
    const { host, session } = await startHost({ defaultRole: "bearbeiten" });
    const guest = new CollabGuest({
      name: "Zweiter",
      send: (_channel: string, payload: Record<string, unknown>) => seen.push(payload),
    });
    connected.push(guest);
    const welcome = await guest.connect(
      createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));

    host.setPeerRole(welcome.peerId, "bearbeiten");
    host.setPeerRole(welcome.peerId, "lesen");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // An editor that quietly stops accepting what is typed into it is worse
    // than one that says it is read-only now.
    expect(seen.some((event) => event.role === "lesen")).toBe(true);
    const opened = await guest.request("open", { path: "Main.java" });
    await expect(guest.request("edit", {
      path: "Main.java",
      edit: { start: 0, end: 0, text: "x" },
      baseVersion: opened.version,
    })).rejects.toThrow(/nur lesen/);
  });

  it("gives a new guest whatever the host set as the default", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { host, session } = await startHost({ defaultRole: "lesen" });
    host.setDefaultRole("bearbeiten");
    const { welcome } = await joinHost(session, "Dritter");
    expect(welcome.role).toBe("bearbeiten");
    expect(host.peerList()[0]).toMatchObject({ name: "Dritter", role: "bearbeiten" });
  });

  it("falls back to reading when asked for a role that does not exist", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { host, session } = await startHost({ defaultRole: "lesen" });
    const { welcome } = await joinHost(session);
    // A value from anywhere but this codebase must not widen what a guest may
    // do, so anything unrecognised means the safer of the two.
    host.setDefaultRole("administrator");
    expect(host.defaultRole).toBe("lesen");
    expect(host.setPeerRole(welcome.peerId, "alles").role).toBe("lesen");
  });
});

describe("what a session puts on the wire", () => {
  it("sends nothing readable, in either direction", async () => {
    // The claim this feature rests on once it can cross networks: the project's
    // source and every keystroke in it stop being visible to anything between
    // the two machines. Tested at the session level rather than only on the
    // frame, because it is the session that must never take a shortcut.
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Geheim.java"), "class Geheim { int passwort = 1; }");
    const { session } = await startHost({ projectName: "geheimprojekt" });

    const captured: Buffer[] = [];
    const guest = new CollabGuest({
      name: "Mitleser",
      createConnection: (options: Record<string, unknown>, onConnect: () => void) => {
        const socket = new Socket();
        const write = socket.write.bind(socket);
        socket.write = ((chunk: Buffer | string, ...rest: unknown[]) => {
          captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
        }) as typeof socket.write;
        socket.on("data", (chunk: Buffer) => captured.push(Buffer.from(chunk)));
        socket.connect(options as never, onConnect);
        return socket;
      },
    });
    connected.push(guest);
    await guest.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));
    const opened = await guest.request("open", { path: "src/Geheim.java" });
    expect(opened.text).toContain("passwort");

    const wire = Buffer.concat(captured).toString("latin1");
    for (const secret of ["Geheim", "passwort", "class", "src/", "open", "geheimprojekt", session.token]) {
      expect({ secret, onTheWire: wire.includes(secret) }).toEqual({ secret, onTheWire: false });
    }
    // The greeting is the one thing sent in the clear, and it carries a version
    // and two nonces — nothing that is worth anything without the invite.
    expect(wire).toContain("\"v\":2");
  });
});

describe("managing who is in the session", () => {
  it("lists a guest with what the host needs to act on them", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { host, session } = await startHost();
    await joinHost(session, "Zweiter");
    const [peer] = host.peerList();
    expect(peer).toMatchObject({ name: "Zweiter", role: "bearbeiten" });
    expect(peer.address).toBeTruthy();
    expect(peer.since).toBeGreaterThan(0);
  });

  it("tells a guest it was removed before the socket goes", async () => {
    // A connection that simply drops looks exactly like a network that failed,
    // and somebody who believes that reconnects immediately.
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const seen: Array<Record<string, unknown>> = [];
    const { host, session } = await startHost();
    const guest = new CollabGuest({
      name: "Zweiter",
      send: (channel: string, payload: Record<string, unknown>) => seen.push({ channel, ...payload }),
    });
    connected.push(guest);
    const welcome = await guest.connect(
      createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token }));

    host.disconnectPeer(welcome.peerId);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const removed = seen.find((event) => event.channel === "collab:removed");
    expect(removed).toBeTruthy();
    expect(String(removed?.message)).toMatch(/Gastgeber/);
    expect(host.peerList()).toEqual([]);
  });

  it("refuses a blocked guest when it comes back", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { host, session } = await startHost();
    const { welcome } = await joinHost(session, "Unerwünscht");
    host.blockPeer(welcome.peerId);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const again = new CollabGuest({ name: "Unerwünscht" });
    connected.push(again);
    await expect(again.connect(createInviteCode({ host: "127.0.0.1", port: session.port, token: session.token })))
      .rejects.toThrow(/gesperrt|abgelehnt/);
  });

  it("lets a blocked guest back in once the host relents", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { host, session } = await startHost();
    const { welcome } = await joinHost(session, "Zweiter");
    const blocked = host.blockPeer(welcome.peerId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    host.unblock(blocked.address);
    const { welcome: second } = await joinHost(session, "Zweiter");
    expect(second.project).toBeTruthy();
  });

  it("refuses to manage a guest who already left", async () => {
    // The list a host is looking at is a moment old, and the difference
    // between "gone" and "silently did nothing" matters when the intent was
    // to remove somebody.
    const { host } = await startHost();
    expect(() => host.disconnectPeer(99)).toThrow(/nicht mehr verbunden/);
    expect(() => host.blockPeer(99)).toThrow(/nicht mehr verbunden/);
  });

  it("hands over many files in one answer, for a guest building its copy", async () => {
    // One request per file is hundreds of round trips before the project is
    // usable, and on anything but a local network that is the whole of what
    // joining feels like.
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Main.java"), "class Main {}");
    await writeFile(path.join(root, "src", "Util.java"), "class Util {}");
    await writeFile(path.join(root, "pom.xml"), "<project/>");
    const { session } = await startHost({ projectName: "beta" });
    const { guest } = await joinHost(session);

    const bundle = await guest.request("bundle", { paths: ["src/Main.java", "src/Util.java", "pom.xml"] });
    expect(bundle.files.map((file: { path: string }) => file.path))
      .toEqual(["src/Main.java", "src/Util.java", "pom.xml"]);
    expect(bundle.files[0].text).toBe("class Main {}");
  });

  it("names the file it could not send instead of dropping it", async () => {
    // A guest whose copy is missing something should be able to see which file
    // and why, rather than finding a hole in their project later.
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { session } = await startHost();
    const { guest } = await joinHost(session);
    const bundle = await guest.request("bundle", { paths: ["Main.java", "gibt-es-nicht.java"] });
    expect(bundle.files[0].text).toBe("class Main {}");
    expect(bundle.files[1]).toMatchObject({ path: "gibt-es-nicht.java" });
    expect(bundle.files[1].error).toBeTruthy();
  });

  it("keeps a bundle inside the shared project", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    const { session } = await startHost();
    const { guest } = await joinHost(session);
    const bundle = await guest.request("bundle", { paths: ["../../secrets.txt", ".git/config"] });
    expect(bundle.files.every((file: { text?: string }) => typeof file.text !== "string")).toBe(true);
  });
});

describe("a whole session through a relay", () => {
  const relays: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    for (const relay of relays.splice(0)) await relay.close();
  });

  /** A relay on loopback, standing in for one on a machine both sides can reach. */
  async function startRelay() {
    const relay = createRelayServer();
    relays.push(relay);
    const port = await relay.listen(0, "127.0.0.1");
    return { relay, port };
  }

  it("connects two ends that never listened for anything", async () => {
    // The point of the whole arrangement: the host opens no port, the guest
    // dials nothing but the relay, and neither router is asked for a favour.
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "Main.java"), "class Main {}");
    const { port: relayPort } = await startRelay();
    const host = new CollabHost({ root, projectName: "beta", defaultRole: "bearbeiten" });
    running.push(host);
    const session = await host.startViaRelay("127.0.0.1", relayPort);

    expect(session.invite).toContain("relay=1");
    expect(host.state().hosting).toBe(true);

    const guest = new CollabGuest({ name: "Zweiter" });
    connected.push(guest);
    const welcome = await guest.connect(session.invite);
    expect(welcome.project).toBe("beta");

    const opened = await guest.request("open", { path: "src/Main.java" });
    expect(opened.text).toBe("class Main {}");
    await guest.request("edit", {
      path: "src/Main.java",
      edit: { start: opened.text.length, end: opened.text.length, text: " // durchs Relay" },
      baseVersion: opened.version,
    });
    await guest.request("save", { path: "src/Main.java" });
    expect(await readFile(path.join(root, "src", "Main.java"), "utf8"))
      .toBe("class Main {} // durchs Relay");
  });

  it("carries nothing the relay could read", async () => {
    // The relay is trusted to pass bytes along, not with the project. What
    // moves through it has to stay unreadable even to the machine carrying it.
    await writeFile(path.join(root, "Geheim.java"), "class Geheim { int passwort = 1; }");
    const { port: relayPort } = await startRelay();
    const host = new CollabHost({ root, projectName: "geheimprojekt", defaultRole: "bearbeiten" });
    running.push(host);
    const session = await host.startViaRelay("127.0.0.1", relayPort);

    const captured: Buffer[] = [];
    const guest = new CollabGuest({
      name: "Mitleser",
      createConnection: (options: Record<string, unknown>, onConnect: () => void) => {
        const socket = new Socket();
        const write = socket.write.bind(socket);
        socket.write = ((chunk: Buffer | string, ...rest: unknown[]) => {
          captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
        }) as typeof socket.write;
        socket.on("data", (chunk: Buffer) => captured.push(Buffer.from(chunk)));
        socket.connect(options as never, onConnect);
        return socket;
      },
    });
    connected.push(guest);
    await guest.connect(session.invite);
    const opened = await guest.request("open", { path: "Geheim.java" });
    expect(opened.text).toContain("passwort");

    const wire = Buffer.concat(captured).toString("latin1");
    for (const secret of ["Geheim", "passwort", "geheimprojekt", session.token]) {
      expect({ secret, onTheWire: wire.includes(secret) }).toEqual({ secret, onTheWire: false });
    }
  });

  it("says so when the relay cannot be reached", async () => {
    // A relay that is down and a relay address that was mistyped look the same
    // from here, and both are worth more than a session that never starts.
    const host = new CollabHost({ root, projectName: "beta" });
    running.push(host);
    await expect(host.startViaRelay("127.0.0.1", 1)).rejects.toThrow(/Relay/);
  });

  it("turns a guest away when no host is in that room", async () => {
    const { port: relayPort } = await startRelay();
    const guest = new CollabGuest({ name: "Zuerst" });
    connected.push(guest);
    const invite = createInviteCode({
      host: "127.0.0.1", port: relayPort, token: "a".repeat(64), project: "beta", relay: true,
    });
    await expect(guest.connect(invite)).rejects.toThrow(/Gastgeber/);
  });

  it("gives the room back when the session ends", async () => {
    // Otherwise the next session cannot claim its own room, and the second
    // attempt at sharing the same project fails for no visible reason.
    const { relay, port: relayPort } = await startRelay();
    const first = new CollabHost({ root, projectName: "beta" });
    await first.startViaRelay("127.0.0.1", relayPort);
    expect(relay.rooms).toBe(1);
    await first.stop();
    for (let attempt = 0; attempt < 50 && relay.rooms > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = new CollabHost({ root, projectName: "beta" });
    running.push(second);
    await expect(second.startViaRelay("127.0.0.1", relayPort)).resolves.toMatchObject({ project: "beta" });
  });
});
