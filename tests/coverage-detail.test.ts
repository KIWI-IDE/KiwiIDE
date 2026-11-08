import { describe, expect, it } from "vitest";
import {
  branchSummary,
  changedLinesFromDiff,
  describeDiffCoverage,
  diffCoverage,
  partiallyCoveredLines,
} from "../src/coverage-detail";

const line = (nr: number, covered: boolean, cb = 0, mb = 0) => ({
  line: nr,
  covered,
  coveredBranches: cb,
  missedBranches: mb,
});

/**
 * A line holding `if (a && b)` counts as covered the moment it runs once,
 * whichever way it went — so a file can read 100% with half its decisions
 * never taken.
 */
describe("which decisions were actually decided both ways", () => {
  it("adds up the branches JaCoCo counted", () => {
    expect(branchSummary([line(1, true, 2, 0), line(2, true, 1, 3)]))
      .toEqual({ covered: 3, missed: 3, percentage: 50 });
  });

  it("says nothing about a file that has no decisions in it", () => {
    // Reporting it as perfect would put it beside files that earned the number.
    expect(branchSummary([line(1, true), line(2, false)]).percentage).toBe(-1);
    expect(branchSummary([]).percentage).toBe(-1);
  });

  it("names the lines that only ever went one way", () => {
    // The most misleading kind: green in the gutter, half untested.
    expect(partiallyCoveredLines([
      line(4, true, 1, 1),
      line(5, true, 2, 0),
      line(6, false, 0, 2),
    ])).toEqual([4]);
  });
});

/**
 * A project-wide percentage answers a question nobody asked. The one worth
 * answering is: of the lines this change touches, how many are covered?
 */
describe("coverage of the change rather than of the project", () => {
  const files = [
    { path: "C:/projekt/src/main/java/Welt.java", lines: [line(10, true), line(11, false), line(12, true)] },
    { path: "C:/projekt/src/main/java/Alt.java", lines: [line(3, false)] },
  ];

  it("counts only the lines the change touched", () => {
    const changed = new Map([["src/main/java/Welt.java", new Set([10, 11])]]);
    expect(diffCoverage(files, changed)).toMatchObject({ covered: 1, missed: 1, percentage: 50 });
  });

  it("leaves a file the change did not touch out of it", () => {
    const changed = new Map([["src/main/java/Welt.java", new Set([10])]]);
    expect(diffCoverage(files, changed).gaps).toEqual([]);
  });

  it("does not count a touched line the report says nothing about", () => {
    // A comment or a closing brace is neither covered nor missed, and counting
    // it as missed would make every one of them an argument for another test.
    const changed = new Map([["src/main/java/Welt.java", new Set([10, 99])]]);
    expect(diffCoverage(files, changed)).toMatchObject({ covered: 1, missed: 0 });
  });

  it("says where the gaps are", () => {
    const changed = new Map([
      ["src/main/java/Welt.java", new Set([10, 11])],
      ["src/main/java/Alt.java", new Set([3])],
    ]);
    const gaps = diffCoverage(files, changed).gaps;
    // One gap each, so the order falls to the name.
    expect(gaps.map((gap) => gap.path.split("/").at(-1))).toEqual(["Alt.java", "Welt.java"]);
    expect(gaps.map((gap) => gap.lines)).toEqual([[3], [11]]);
  });

  it("puts the file with the most untested lines first", () => {
    const uneven = [
      { path: "Zweit.java", lines: [line(1, false), line(2, false)] },
      { path: "Erst.java", lines: [line(1, false)] },
    ];
    const changed = new Map([["Zweit.java", new Set([1, 2])], ["Erst.java", new Set([1])]]);
    expect(diffCoverage(uneven, changed).gaps.map((gap) => gap.path)).toEqual(["Zweit.java", "Erst.java"]);
  });

  it("matches a path however the two sides spell it", () => {
    // Coverage names a file absolutely, git relatively, and Windows disagrees
    // with itself about the drive letter's case.
    const changed = new Map([["src\\main\\java\\Welt.java", new Set([11])]]);
    expect(diffCoverage(files, changed).missed).toBe(1);
  });

  it("says so when the change touches nothing measurable", () => {
    expect(diffCoverage(files, new Map()).percentage).toBe(-1);
    expect(describeDiffCoverage(diffCoverage(files, new Map())))
      .toBe("Die Änderung berührt keinen messbaren Code.");
  });
});

/**
 * Only the new side of a diff matters: a deleted line cannot be covered, and
 * asking for a test that runs it would be asking for the change to be undone.
 */
describe("reading which lines a change touches", () => {
  const DIFF = [
    "diff --git a/src/Welt.java b/src/Welt.java",
    "--- a/src/Welt.java",
    "+++ b/src/Welt.java",
    "@@ -8,6 +8,8 @@ public class Welt {",
    " public class Welt {",
    "+    int neu = 1;",
    "+    int auchNeu = 2;",
    "     int alt = 0;",
    "-    int weg = 3;",
    "     void run() {}",
    " }",
  ].join("\n");

  it("names the added lines by their number on the new side", () => {
    expect([...(changedLinesFromDiff(DIFF).get("src/Welt.java") || [])]).toEqual([9, 10]);
  });

  it("keeps count across a removed line", () => {
    // A removed line does not exist on the new side and must not advance it.
    const lines = changedLinesFromDiff([
      "+++ b/A.java",
      "@@ -1,3 +1,3 @@",
      " eins",
      "-zwei",
      "+zwei neu",
      " drei",
    ].join("\n"));
    expect([...(lines.get("A.java") || [])]).toEqual([2]);
  });

  it("reads several files in one diff", () => {
    const lines = changedLinesFromDiff([
      "+++ b/A.java",
      "@@ -1,1 +1,2 @@",
      " eins",
      "+zwei",
      "+++ b/B.java",
      "@@ -5,1 +5,2 @@",
      " fuenf",
      "+sechs",
    ].join("\n"));
    expect([...lines.keys()]).toEqual(["A.java", "B.java"]);
    expect([...(lines.get("B.java") || [])]).toEqual([6]);
  });

  it("ignores a file that was deleted outright", () => {
    expect(changedLinesFromDiff("+++ /dev/null\n@@ -1,1 +0,0 @@\n-weg").size).toBe(0);
  });

  it("survives a diff that is not one", () => {
    expect(changedLinesFromDiff("").size).toBe(0);
    expect(changedLinesFromDiff("irgendwas").size).toBe(0);
  });
});

describe("saying it in one line", () => {
  it("names the share and what is missing", () => {
    const changed = new Map([["src/main/java/Welt.java", new Set([10, 11])]]);
    const files = [{ path: "src/main/java/Welt.java", lines: [line(10, true), line(11, false)] }];
    expect(describeDiffCoverage(diffCoverage(files, changed)))
      .toBe("50% der geänderten Zeilen abgedeckt, 1 Zeile ohne Test");
  });

  it("leaves the complaint off when there is nothing missing", () => {
    const changed = new Map([["A.java", new Set([1])]]);
    const files = [{ path: "A.java", lines: [line(1, true)] }];
    expect(describeDiffCoverage(diffCoverage(files, changed))).toBe("100% der geänderten Zeilen abgedeckt");
  });
});
