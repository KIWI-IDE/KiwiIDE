import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const { SessionStoreService, MAX_SESSION_BYTES } = require("../electron/services/session-store-service.cjs");

let userData = "";
let project = "";
let store: any;

beforeEach(() => {
  userData = mkdtempSync(path.join(os.tmpdir(), "kiwi-session-store-"));
  project = mkdtempSync(path.join(os.tmpdir(), "kiwi-session-project-"));
  store = new SessionStoreService(userData, null);
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

/**
 * Local storage was the wrong place for exactly the case this exists for:
 * Chromium flushes it on its own schedule, and a killed process loses whatever
 * had not been written yet.
 */
describe("keeping a session across a crash", () => {
  it("reads back what it wrote", async () => {
    await store.save(project, { files: [{ path: "A.java", content: "Entwurf" }], activePath: "A.java" });
    const loaded = await store.load(project);
    expect(loaded.files).toEqual([{ path: "A.java", content: "Entwurf" }]);
    expect(loaded.activePath).toBe("A.java");
  });

  it("records which project it belongs to and when", async () => {
    await store.save(project, { files: [] });
    const loaded = await store.load(project);
    expect(loaded.root).toBe(path.resolve(project));
    expect(loaded.savedAt).toBeGreaterThan(0);
  });

  it("answers nothing for a project that has never been open", async () => {
    expect(await store.load(project)).toBeNull();
  });

  it("keeps two projects apart", async () => {
    const other = mkdtempSync(path.join(os.tmpdir(), "kiwi-session-other-"));
    try {
      await store.save(project, { files: [{ path: "A.java" }] });
      await store.save(other, { files: [{ path: "B.java" }] });
      expect((await store.load(project)).files[0].path).toBe("A.java");
      expect((await store.load(other)).files[0].path).toBe("B.java");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("names the file after the project so a person can look at it", async () => {
    await store.save(project, { files: [] });
    const written = readdirSync(path.join(userData, "sessions"));
    expect(written[0]).toContain(path.basename(project).slice(0, 20));
    expect(written[0].endsWith(".json")).toBe(true);
  });

  it("leaves nothing temporary behind", async () => {
    // A crash during the write leaves the previous session whole; a clean
    // write leaves only the session.
    await store.save(project, { files: [{ path: "A.java" }] });
    expect(readdirSync(path.join(userData, "sessions")).some((name) => name.includes(".tmp"))).toBe(false);
  });

  it("does not interleave two writes for one project", async () => {
    await Promise.all([
      store.save(project, { files: [{ path: "A.java" }] }),
      store.save(project, { files: [{ path: "B.java" }] }),
      store.save(project, { files: [{ path: "C.java" }] }),
    ]);
    const loaded = await store.load(project);
    // Whichever won, the file is one whole session rather than a mixture.
    expect(loaded.files).toHaveLength(1);
    expect(["A.java", "B.java", "C.java"]).toContain(loaded.files[0].path);
  });

  it("refuses a session too large to be one", async () => {
    const huge = { files: [{ path: "A.java", content: "x".repeat(MAX_SESSION_BYTES + 1) }] };
    await expect(store.save(project, huge)).rejects.toThrow(/zu groß/);
  });

  it("treats a damaged file as no session rather than as an error", async () => {
    await store.save(project, { files: [{ path: "A.java" }] });
    const file = store.fileFor(project);
    writeFileSync(file, "{ kaputt", "utf8");
    expect(await store.load(project)).toBeNull();
  });

  it("forgets a project on request", async () => {
    await store.save(project, { files: [{ path: "A.java" }] });
    await store.clear(project);
    expect(await store.load(project)).toBeNull();
  });

  it("survives clearing something that was never there", async () => {
    await expect(store.clear(project)).resolves.toMatchObject({ cleared: true });
  });
});

/**
 * The workspace guard decides which roots may be touched at all; the store
 * asks it rather than trusting the path it was handed.
 */
describe("what it will write for", () => {
  it("asks the guard when it has one", async () => {
    const refusing = new SessionStoreService(userData, {
      assertWorkspace: () => { throw new Error("Nicht freigegeben."); },
    });
    await expect(refusing.save(project, { files: [] })).rejects.toThrow(/Nicht freigegeben/);
    await expect(refusing.load(project)).rejects.toThrow(/Nicht freigegeben/);
  });

  it("uses the root the guard hands back", async () => {
    const guarded = new SessionStoreService(userData, { assertWorkspace: () => project });
    await guarded.save("egal", { files: [{ path: "A.java" }] });
    expect(readFileSync(guarded.fileFor(project), "utf8")).toContain("A.java");
  });
});
