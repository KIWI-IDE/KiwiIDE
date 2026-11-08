import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  MAX_MIRROR_FILES,
  createMirrorDirectories,
  createMirrorRefresher,
  isMirrorPath,
  mirrorBase,
  mirrorFileFor,
  mirrorRootFor,
  planMirror,
  relativeFromMirror,
  removeMirror,
  sweepStaleMirrors,
  writeMirrorFile,
} = require("../electron/services/collab-mirror-service.cjs");

let temporary = "";

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "kiwi-mirror-test-"));
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
});

describe("where a working copy lives", () => {
  it("keeps every copy under one folder of its own", () => {
    const root = mirrorRootFor(temporary, "beta", "abc123");
    expect(root.startsWith(mirrorBase(temporary))).toBe(true);
    expect(path.basename(root)).toBe("beta-abc123");
  });

  it("keeps two sessions of the same project apart", () => {
    // Also keeps a new session from adopting what an earlier one left behind.
    expect(mirrorRootFor(temporary, "beta", "one")).not.toBe(mirrorRootFor(temporary, "beta", "two"));
  });

  it("takes a project name a filesystem would refuse", () => {
    expect(path.basename(mirrorRootFor(temporary, "../../etc", "x"))).toBe("etc-x");
    expect(path.basename(mirrorRootFor(temporary, "", ""))).toBe("Projekt-0");
  });

  it("recognises its own paths and nothing else", () => {
    const root = mirrorRootFor(temporary, "beta", "abc");
    expect(isMirrorPath(temporary, path.join(root, "src", "Main.java"))).toBe(true);
    expect(isMirrorPath(temporary, "C:\\Users\\dev\\beta\\Main.java")).toBe(false);
    expect(isMirrorPath(temporary, mirrorBase(temporary))).toBe(false);
    expect(isMirrorPath(temporary, "")).toBe(false);
  });
});

describe("writing the copy", () => {
  it("writes a file and the folders above it", async () => {
    const root = mirrorRootFor(temporary, "beta", "abc");
    const file = await writeMirrorFile(root, "src/util/Strings.java", "class Strings {}");
    expect(await readFile(file, "utf8")).toBe("class Strings {}");
    expect(relativeFromMirror(root, file)).toBe("src/util/Strings.java");
  });

  it("refuses a path that climbs out of the copy", async () => {
    // The path comes from the other end of a connection, so this is the only
    // thing standing between a session and the rest of the guest's disk.
    const root = mirrorRootFor(temporary, "beta", "abc");
    for (const escape of ["../outside.txt", "src/../../outside.txt", "/etc/passwd", "C:\\Windows\\x", ""]) {
      await expect(writeMirrorFile(root, escape, "x")).rejects.toThrow(/Arbeitskopie/);
    }
  });

  it("creates the empty folders too, so the Explorer shows the real shape", async () => {
    const root = mirrorRootFor(temporary, "beta", "abc");
    await createMirrorDirectories(root, [{ path: "src/leer", directory: true }, { path: "a.txt", directory: false }]);
    expect(existsSync(mirrorFileFor(root, "src/leer"))).toBe(true);
  });

  it("answers with nothing for a file outside the copy", () => {
    const root = mirrorRootFor(temporary, "beta", "abc");
    expect(relativeFromMirror(root, path.join(temporary, "woanders.java"))).toBe("");
  });
});

describe("what gets carried over", () => {
  it("takes the files and leaves the directories to be created", () => {
    const plan = planMirror([
      { path: "src", directory: true },
      { path: "src/Main.java", directory: false },
      { path: "pom.xml", directory: false },
    ]);
    expect(plan.files).toEqual(["src/Main.java", "pom.xml"]);
  });

  it("stops at its limit and says what it left", () => {
    // Without a cap, one shared folder with a heap dump in it fills the guest's
    // disk, and the guest never asked for the file that did it.
    const entries = Array.from({ length: 12 }, (_, index) => ({ path: `F${index}.java`, directory: false }));
    const plan = planMirror(entries, { maxFiles: 5 });
    expect(plan.files).toHaveLength(5);
    expect(plan.skipped).toHaveLength(7);
    expect(plan.skipped[0].reason).toMatch(/zu viele/);
  });

  it("has a limit even when nobody passes one", () => {
    expect(MAX_MIRROR_FILES).toBeGreaterThan(0);
  });
});

describe("removing the copy", () => {
  it("removes its own folder", async () => {
    const root = mirrorRootFor(temporary, "beta", "abc");
    await writeMirrorFile(root, "Main.java", "class Main {}");
    expect(await removeMirror(temporary, root)).toBe(true);
    expect(existsSync(root)).toBe(false);
  });

  it("refuses to remove anything that is not one", async () => {
    // The root arrives from a session. A remove that trusts it is one wrong
    // string away from deleting a real project, or a home directory.
    const real = path.join(temporary, "echtes-projekt");
    await mkdir(real, { recursive: true });
    await writeFile(path.join(real, "Main.java"), "class Main {}");
    expect(await removeMirror(temporary, real)).toBe(false);
    expect(await removeMirror(temporary, "")).toBe(false);
    expect(await removeMirror(temporary, path.parse(temporary).root)).toBe(false);
    expect(existsSync(real)).toBe(true);
  });

  it("clears out what an earlier run left behind, but not the live one", async () => {
    // A guest whose app was killed mid-session leaves somebody else's project
    // on disk, and nobody would think to look for it.
    const stale = mirrorRootFor(temporary, "alt", "eins");
    const live = mirrorRootFor(temporary, "neu", "zwei");
    await writeMirrorFile(stale, "Alt.java", "class Alt {}");
    await writeMirrorFile(live, "Neu.java", "class Neu {}");
    const removed = await sweepStaleMirrors(temporary, live);
    expect(removed).toHaveLength(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it("does not mind being asked to sweep a folder that was never made", async () => {
    expect(await sweepStaleMirrors(path.join(temporary, "nie-da"))).toEqual([]);
  });
});

describe("keeping the copy in step", () => {
  /** A refresher wired to a guest that answers from a table. */
  function refresherOver(texts: Record<string, string>, delay = 5) {
    const written: Array<[string, string]> = [];
    const asked: string[] = [];
    const guest = {
      request: async (_type: string, payload: { path: string }) => {
        asked.push(payload.path);
        return { text: texts[payload.path] ?? "", version: 1 };
      },
    };
    const refresher = createMirrorRefresher({
      guestOf: () => guest,
      rootOf: () => "C:/tmp/kiwi-codetogether/beta-1",
      write: async (_root: string, relative: string, text: string) => { written.push([relative, text]); },
      delay,
    });
    return { refresher, written, asked };
  }

  it("fetches a file again once the typing pauses", async () => {
    const { refresher, written, asked } = refresherOver({ "src/Main.java": "class Main { int x; }" });
    refresher.changed("src/Main.java");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(asked).toEqual(["src/Main.java"]);
    expect(written).toEqual([["src/Main.java", "class Main { int x; }"]]);
  });

  it("costs one fetch for a burst of changes, not one per change", async () => {
    // A co-edited file changes on every keystroke. One request each would make
    // the guest's own connection the slowest thing in the session.
    const { refresher, asked } = refresherOver({ "A.java": "class A {}" });
    for (let index = 0; index < 20; index += 1) refresher.changed("A.java");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(asked).toEqual(["A.java"]);
  });

  it("keeps two files apart", async () => {
    const { refresher, written } = refresherOver({ "A.java": "class A {}", "B.java": "class B {}" });
    refresher.changed("A.java");
    refresher.changed("B.java");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(written.map(([file]) => file).sort()).toEqual(["A.java", "B.java"]);
  });

  it("drops what is queued when the session ends", async () => {
    // Otherwise a fetch lands after the copy has been deleted and writes one
    // file of somebody else's project back onto this disk.
    const { refresher, written } = refresherOver({ "A.java": "class A {}" }, 30);
    refresher.changed("A.java");
    expect(refresher.pending()).toEqual(["A.java"]);
    refresher.stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(written).toEqual([]);
  });

  it("does nothing without a session or a copy", async () => {
    const written: string[] = [];
    const refresher = createMirrorRefresher({
      guestOf: () => null,
      rootOf: () => "",
      write: async (_root: string, relative: string) => { written.push(relative); },
      delay: 5,
    });
    refresher.changed("A.java");
    refresher.changed("");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(written).toEqual([]);
  });
});

describe("what the teardown is allowed to reach for", () => {
  it("never names something that only exists inside the IPC registration", () => {
    // stopCollabGuest() sits at module level; the PathGuard, the workspace
    // service and everything else are consts inside registerIpc(). Naming one
    // of them there throws a ReferenceError — and only on the path where a
    // guest with a working copy leaves, which no test of the workbench walks.
    // It is checked in the source because that is where the scope lives.
    const main = readFileSync(path.join(process.cwd(), "electron", "main.cjs"), "utf8");
    const teardown = main.slice(main.indexOf("function stopCollabGuest"));
    const body = teardown.slice(0, teardown.indexOf("\nconst {"));
    for (const inaccessible of ["guard.", "workspace.", "language.", "terminal."]) {
      expect({ inaccessible, used: body.includes(inaccessible) }).toEqual({ inaccessible, used: false });
    }
    // What it may use instead: something set where those actually exist.
    expect(body).toContain("unregisterMirrorRoot(root)");
    expect(main).toContain("unregisterMirrorRoot = (root) => guard.unregister(root)");
  });
});
