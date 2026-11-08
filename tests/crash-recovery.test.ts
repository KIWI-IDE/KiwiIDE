import { describe, expect, it } from "vitest";
import {
  countStoredDrafts,
  describeDroppedDrafts,
  describeRecovery,
  draftsToStore,
  endedBadly,
  isDraft,
  MAX_DRAFT_BYTES,
} from "../src/crash-recovery";

const saved = (path: string) => ({ path, content: "gleich", savedContent: "gleich" });
const draft = (path: string, size = 10) => ({
  path,
  content: "x".repeat(size),
  savedContent: "",
});

/**
 * The drafts were kept only on unload, and a crashed renderer fires no unload.
 * So the one case they were kept for was the one case they were not kept in.
 */
describe("which files carry something unsaved", () => {
  it("sees a buffer that differs from the disk", () => {
    expect(isDraft(draft("A.java"))).toBe(true);
    expect(isDraft(saved("B.java"))).toBe(false);
  });

  it("says nothing about a file it has no content for", () => {
    expect(isDraft({ path: "C.java" })).toBe(false);
    expect(isDraft({ path: "C.java", content: "x" })).toBe(false);
  });
});

describe("what gets written", () => {
  it("keeps every path and the drafts among them", () => {
    const result = draftsToStore([saved("A.java"), draft("B.java"), saved("C.java")]);
    expect(result.files.map((file) => file.path)).toEqual(["A.java", "B.java", "C.java"]);
    expect(result.kept).toBe(1);
    expect(result.files[1].content).toBe("xxxxxxxxxx");
    expect(result.files[0].content).toBeUndefined();
  });

  it("drops a draft larger than one file may take, keeping its tab", () => {
    // Half a file restored is worse than an honest gap.
    const result = draftsToStore([draft("Riesig.java", MAX_DRAFT_BYTES + 1)]);
    expect(result.files[0]).toEqual({ path: "Riesig.java" });
    expect(result.kept).toBe(0);
    expect(result.dropped).toEqual(["Riesig.java"]);
  });

  it("stops once the whole budget is used, newest first", () => {
    // What somebody was just typing is what they would miss.
    const result = draftsToStore(
      [draft("Zuerst.java", 80), draft("Dann.java", 80), draft("Zuletzt.java", 80)],
      { maxTotal: 160 },
    );
    expect(result.kept).toBe(2);
    expect(result.dropped).toEqual(["Zuletzt.java"]);
    expect(result.files[2]).toEqual({ path: "Zuletzt.java" });
  });

  it("writes nothing extra for a session with no drafts", () => {
    const result = draftsToStore([saved("A.java"), saved("B.java")]);
    expect(result.kept).toBe(0);
    expect(result.files.every((file) => file.content === undefined)).toBe(true);
  });

  it("survives an empty session", () => {
    expect(draftsToStore([])).toEqual({ files: [], kept: 0, dropped: [] });
  });
});

/**
 * "Some drafts were not kept" leaves somebody guessing which file to check.
 */
describe("saying what was too large", () => {
  it("names the one file", () => {
    expect(describeDroppedDrafts(["C:/p/Riesig.java"])).toBe(
      "Riesig.java war zu groß, um ungespeichert gesichert zu werden.");
  });

  it("names several", () => {
    const message = describeDroppedDrafts(["C:/p/A.java", "C:/p/B.java"]);
    expect(message).toContain("2 Dateien");
    expect(message).toContain("A.java, B.java");
  });

  it("says nothing when nothing was dropped", () => {
    expect(describeDroppedDrafts([])).toBe("");
  });
});

/**
 * A mark still saying "running" means nothing cleared it, which means nothing
 * ran the shutdown.
 */
describe("whether the last session ended", () => {
  const now = 1_000_000_000_000;

  it("sees a session that was cut off", () => {
    expect(endedBadly({ running: true, at: now - 60_000 }, now)).toBe(true);
  });

  it("sees a session that ended properly", () => {
    expect(endedBadly({ running: false, at: now - 60_000 }, now)).toBe(false);
    expect(endedBadly(null, now)).toBe(false);
  });

  it("treats a mark from long ago as nothing to report", () => {
    // Somebody who last used Kiwi a month ago learns nothing from being told
    // their session was interrupted.
    expect(endedBadly({ running: true, at: now - 40 * 24 * 60 * 60 * 1000 }, now)).toBe(false);
  });

  it("ignores a mark from the future, which is a clock that moved", () => {
    expect(endedBadly({ running: true, at: now + 60_000 }, now)).toBe(false);
  });
});

describe("what the reader is told", () => {
  it("counts the recovered drafts", () => {
    expect(describeRecovery(0)).toContain("Sitzung ist wiederhergestellt");
    expect(describeRecovery(1)).toContain("Eine ungespeicherte Datei");
    expect(describeRecovery(3)).toContain("3 ungespeicherte Dateien");
  });

  it("counts what a stored session actually carries", () => {
    expect(countStoredDrafts([{ path: "A" }, { path: "B", content: "x" }])).toBe(1);
    expect(countStoredDrafts([])).toBe(0);
  });
});
