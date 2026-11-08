import { describe, expect, it } from "vitest";
import {
  applyCollabEdit,
  canApplyCollabRemoteEdit,
  collabAbsolutePath,
  collabEditsFromChanges,
  collabHostEditNeedsSnapshot,
  collabRelativePath,
  collabRootsEqual,
  createCollabSerialQueue,
  enqueueCollabFileTask,
  isActiveCollabHost,
  isCurrentCollabSnapshot,
  shouldInitializeCollabHost,
} from "./client";

describe("CodeToGetter renderer paths", () => {
  it("uses project-relative forward-slash paths on the wire", () => {
    expect(collabRelativePath("C:\\work\\demo", "C:\\work\\demo\\src\\Main.java"))
      .toBe("src/Main.java");
    expect(collabRelativePath("C:\\work\\demo", "C:\\work\\other\\Main.java"))
      .toBe("");
    expect(collabRootsEqual("C:\\work\\demo\\", "c:/work/demo")).toBe(true);
    expect(collabRootsEqual("C:\\work\\demo", "C:\\work\\other")).toBe(false);
    expect(isActiveCollabHost(true, "C:\\work\\demo", "c:/work/demo")).toBe(true);
    expect(isActiveCollabHost(false, "C:\\work\\demo", "C:\\work\\demo")).toBe(false);
    expect(isActiveCollabHost(true, "C:\\remote", "C:\\local")).toBe(false);
    expect(shouldInitializeCollabHost(false, "", "C:\\work\\demo")).toBe(true);
    expect(shouldInitializeCollabHost(true, "C:\\work\\demo", "c:/work/demo")).toBe(false);
    expect(shouldInitializeCollabHost(true, "C:\\work\\demo", "C:\\work\\other")).toBe(true);
  });

  it("resolves only safe shared paths back into the host project", () => {
    expect(collabAbsolutePath("C:\\work\\demo", "src/Main.java"))
      .toBe("C:\\work\\demo\\src\\Main.java");
    expect(collabAbsolutePath("C:\\work\\demo", "../secret.txt")).toBe("");
    expect(collabAbsolutePath("C:\\work\\demo", "C:\\Windows\\win.ini")).toBe("");
  });

  it("applies authoritative remote edits and clamps stale offsets", () => {
    expect(applyCollabEdit("class A {}", { start: 6, end: 7, text: "Main" }))
      .toBe("class Main {}");
    expect(applyCollabEdit("abc", { start: 99, end: 120, text: "!" })).toBe("abc!");
  });

  it("orders every change in a Monaco event from the end of the old text", () => {
    expect(collabEditsFromChanges([
      { rangeOffset: 2, rangeLength: 1, text: "middle" },
      { rangeOffset: 12, rangeLength: 0, text: "last" },
      { rangeOffset: 0, rangeLength: 0, text: "first" },
    ])).toEqual([
      { start: 12, end: 12, text: "last" },
      { start: 2, end: 3, text: "middle" },
      { start: 0, end: 0, text: "first" },
    ]);
  });

  it("serializes edits and skips queued work from an invalidated document", async () => {
    const queue = createCollabSerialQueue();
    const calls: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const initialEpoch = queue.current();

    const first = queue.enqueue(initialEpoch, async () => {
      calls.push("first:start");
      await firstGate;
      calls.push("first:end");
      return 1;
    });
    const stale = queue.enqueue(initialEpoch, async () => {
      calls.push("stale");
      return 2;
    });
    await Promise.resolve();
    const nextEpoch = queue.invalidate();
    const current = queue.enqueue(nextEpoch, async () => {
      calls.push("current");
      return 3;
    });

    releaseFirst();
    await expect(first).resolves.toBe(1);
    await expect(stale).resolves.toBeUndefined();
    await expect(current).resolves.toBe(3);
    expect(calls).toEqual(["first:start", "first:end", "current"]);
  });

  it("orders a host save snapshot after its older incremental edits", async () => {
    const queues = new Map<string, Promise<void>>();
    const calls: string[] = [];
    let releaseEdit: () => void = () => undefined;
    let markEditStarted: () => void = () => undefined;
    const editStarted = new Promise<void>((resolve) => { markEditStarted = resolve; });
    const editGate = new Promise<void>((resolve) => { releaseEdit = resolve; });
    const edit = enqueueCollabFileTask(queues, "main.java", async () => {
      calls.push("edit:start");
      markEditStarted();
      await editGate;
      calls.push("edit:end");
    });
    const save = enqueueCollabFileTask(queues, "main.java", async () => {
      calls.push("snapshot");
    });

    await editStarted;
    expect(calls).toEqual(["edit:start"]);
    releaseEdit();
    await Promise.all([edit, save]);
    expect(calls).toEqual(["edit:start", "edit:end", "snapshot"]);
  });

  it("does not apply a resync snapshot after a newer optimistic edit", async () => {
    const queue = createCollabSerialQueue();
    const epoch = queue.current();
    let current = { epoch, path: "Main.java", localRevision: 1 };
    const requested = { ...current };
    let visibleText = "optimistic-one";
    let releasePending: () => void = () => undefined;
    const pendingGate = new Promise<void>((resolve) => { releasePending = resolve; });
    const pending = queue.enqueue(epoch, async () => pendingGate);
    const resync = queue.enqueue(epoch, async () => {
      if (isCurrentCollabSnapshot(requested, current)) visibleText = "server-snapshot";
    });

    current = { ...current, localRevision: 2 };
    visibleText = "optimistic-two";
    releasePending();
    await Promise.all([pending, resync]);
    expect(visibleText).toBe("optimistic-two");
  });

  it("resyncs a host after a rejected, rebased or revision-skipping edit", () => {
    const edit = { start: 4, end: 4, text: "x" };
    expect(collabHostEditNeedsSnapshot(7, edit, { ok: true, version: 8, edit })).toBe(false);
    expect(collabHostEditNeedsSnapshot(7, edit, { ok: false, version: 7 })).toBe(true);
    expect(collabHostEditNeedsSnapshot(7, edit, { ok: true, applied: false, version: 7 })).toBe(true);
    expect(collabHostEditNeedsSnapshot(7, edit, { ok: true, rebased: true, version: 9, edit })).toBe(true);
    expect(collabHostEditNeedsSnapshot(7, edit, {
      ok: true,
      version: 8,
      edit: { ...edit, start: 5, end: 5 },
    })).toBe(true);
  });

  it("applies a host remote edit only without pending work and without a version gap", () => {
    expect(canApplyCollabRemoteEdit(11, 12, false)).toBe(true);
    expect(canApplyCollabRemoteEdit(11, 13, false)).toBe(false);
    expect(canApplyCollabRemoteEdit(undefined, 1, false)).toBe(false);
    expect(canApplyCollabRemoteEdit(11, 12, true)).toBe(false);
  });
});
