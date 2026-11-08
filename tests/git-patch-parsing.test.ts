import { describe, expect, it } from "vitest";

const {
  parseRebaseTodo,
  partialPatchHunk,
  safeGitRef,
  selectableChanges,
  splitPatchHunks,
} = require("../electron/services/git-service.cjs");

/** A patch the way `git diff` writes one, with two hunks in one file. */
const patch = [
  "diff --git a/A.java b/A.java",
  "index 1111111..2222222 100644",
  "--- a/A.java",
  "+++ b/A.java",
  "@@ -1,3 +1,4 @@",
  " eins",
  "-zwei",
  "+ZWEI",
  "+drei",
  " vier",
  "@@ -10,2 +11,2 @@",
  " zehn",
  "-elf",
  "+ELF",
].join("\n");

describe("a reference handed to git", () => {
  it("passes the shapes a branch or a commit really has", () => {
    for (const ref of ["main", "feature/x", "v1.2.3", "HEAD~2", "origin/main", "abc123", "HEAD^"]) {
      expect({ ref, accepted: safeGitRef(ref) }).toEqual({ ref, accepted: ref });
    }
  });

  it("refuses anything that would be read as an option", () => {
    // A ref beginning with a dash lands in the argument list as a flag, which
    // is how a branch name turns into `--upload-pack=…`.
    expect(() => safeGitRef("--upload-pack=touch /tmp/pwn")).toThrow(/Ungültige Git-Referenz/);
    expect(() => safeGitRef("-f")).toThrow(/Ungültige Git-Referenz/);
  });

  it("refuses the characters a shell would act on", () => {
    for (const ref of ["main; rm -rf /", "main && echo", "main | cat", "$(whoami)", "main`id`", "main\nrm"]) {
      expect({ ref, refused: (() => { try { safeGitRef(ref); return false; } catch { return true; } })() })
        .toEqual({ ref, refused: true });
    }
  });

  it("refuses a range, which is two references pretending to be one", () => {
    expect(() => safeGitRef("main..other")).toThrow(/Ungültige Git-Referenz/);
    expect(() => safeGitRef("")).toThrow(/Ungültige Git-Referenz/);
  });
});

describe("splitting a patch into hunks", () => {
  it("keeps the file header with every hunk", () => {
    // A hunk applied without its header is a patch git cannot place.
    const hunks = splitPatchHunks(patch);
    expect(hunks).toHaveLength(2);
    for (const entry of hunks) {
      expect(entry.fileHeader).toContain("diff --git a/A.java b/A.java");
      expect(entry.fileHeader).toContain("+++ b/A.java");
      expect(entry.hunk.startsWith("@@")).toBe(true);
    }
  });

  it("answers with nothing for something that is not a patch", () => {
    expect(splitPatchHunks("")).toEqual([]);
    expect(splitPatchHunks("nur Text")).toEqual([]);
    expect(splitPatchHunks(null)).toEqual([]);
  });
});

describe("the changes a reader can pick from a hunk", () => {
  it("pairs a removal with the addition that replaced it", () => {
    // Shown as one change rather than two, because that is what the edit was.
    const changes = selectableChanges(splitPatchHunks(patch)[0].hunk);
    expect(changes[0]).toMatchObject({ kind: "replace", before: "zwei", after: "ZWEI" });
    expect(changes[1]).toMatchObject({ kind: "add", after: "drei" });
  });

  it("gives every change the line numbers it is made of", () => {
    const changes = selectableChanges(splitPatchHunks(patch)[0].hunk);
    expect(changes[0].indexes).toEqual([1, 2]);
    expect(changes[1].indexes).toEqual([3]);
  });

  it("ignores context lines, which are not changes", () => {
    const changes = selectableChanges(["@@ -1,2 +1,2 @@", " eins", " zwei"].join("\n"));
    expect(changes).toEqual([]);
  });
});

describe("staging part of a hunk", () => {
  it("keeps the chosen lines and turns the rest back into context", () => {
    // The unchosen removal has to stay in the file, so it goes back to being a
    // context line. Dropping it instead would stage a deletion nobody picked.
    const hunk = splitPatchHunks(patch)[0].hunk;
    const staged = partialPatchHunk(hunk, new Set([2]));
    expect(staged).toContain("+ZWEI");
    expect(staged).not.toContain("+drei");
    expect(staged).toContain(" zwei");
    expect(staged).not.toContain("-zwei");
  });

  it("keeps a no-newline marker only with the line it belongs to", () => {
    // Counted from the body: the header is taken off before the lines are
    // numbered, which is the same numbering selectableChanges() hands out.
    const hunk = ["@@ -1 +1 @@", "-alt", "\\ No newline at end of file", "+neu"].join("\n");
    const withRemoval = partialPatchHunk(hunk, new Set([0]));
    expect(withRemoval).toContain("\\ No newline at end of file");
    const withoutRemoval = partialPatchHunk(hunk, new Set([2]));
    expect(withoutRemoval).not.toContain("\\ No newline");
  });

  it("counts the lines it produced rather than repeating the old header", () => {
    // A header that disagrees with the body is a patch git refuses to apply,
    // and it refuses without saying which number was wrong.
    const staged = partialPatchHunk(splitPatchHunks(patch)[0].hunk, new Set([2]));
    const header = staged.split("\n")[0];
    expect(header.startsWith("@@")).toBe(true);
    const counts = header.match(/@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    const body = staged.split("\n").slice(1).filter((line: string) => line && !line.startsWith("\\"));
    const before = body.filter((line: string) => !line.startsWith("+")).length;
    const after = body.filter((line: string) => !line.startsWith("-")).length;
    expect(Number(counts?.[1] ?? 1)).toBe(before);
    expect(Number(counts?.[2] ?? 1)).toBe(after);
  });
});

describe("reading a rebase plan", () => {
  it("reads the action, the commit and what it was called", () => {
    expect(parseRebaseTodo("pick abc123 Erster Commit")).toEqual([
      { action: "pick", hash: "abc123", subject: "Erster Commit" },
    ]);
  });

  it("skips comments and blank lines, which git writes plenty of", () => {
    const plan = parseRebaseTodo(["# Rebase 1234..5678", "", "pick abc123 Eins", "  ", "fixup def456 Zwei"].join("\n"));
    expect(plan.map((entry: { action: string }) => entry.action)).toEqual(["pick", "fixup"]);
  });

  it("marks a line it did not understand instead of dropping it", () => {
    // A silently dropped line is a commit that disappears from the plan, and
    // the rebase then does something the reader did not ask for.
    const plan = parseRebaseTodo("pick abc123 Eins\nvöllig anderes");
    expect(plan[1]).toEqual({ action: "unknown", hash: "", subject: "völlig anderes" });
  });

  it("takes every action git offers, in any case", () => {
    const plan = parseRebaseTodo(["PICK aaa111 A", "Reword bbb222 B", "squash ccc333 C", "drop ddd444 D"].join("\n"));
    expect(plan.map((entry: { action: string }) => entry.action)).toEqual(["pick", "reword", "squash", "drop"]);
  });
});
