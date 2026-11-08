import { describe, expect, it } from "vitest";
import {
  baselineFor,
  describeBaselines,
  detectMemoryTrend,
  detectRegression,
  median,
  percentile,
  regressionFloor,
  type PerformanceSample,
} from "../src/performance-baseline";

const startups = (...values: number[]): PerformanceSample[] =>
  values.map((value, index) => ({
    kind: "startup",
    value,
    unit: "ms",
    timestamp: new Date(2026, 0, 1, 0, index).toISOString(),
  }));

const memory = (...values: number[]): PerformanceSample[] =>
  values.map((value, index) => ({
    kind: "memory",
    value,
    unit: "MB",
    timestamp: new Date(2026, 0, 1, 0, index).toISOString(),
  }));

/**
 * One cold start after a reboot would drag a mean up for the rest of the week
 * and then quietly hide the regression it was supposed to catch.
 */
describe("what this machine usually does", () => {
  it("takes the middle value, not the average", () => {
    expect(median([100, 100, 100, 100, 9000])).toBe(100);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBe(0);
  });

  it("finds where the slowest quarter starts", () => {
    // Nearest rank, so the answer is a value that was actually measured: for
    // four runs the slowest quarter is the last one, and it starts at the
    // third. The maximum would be the 100th percentile, not the 75th.
    expect(percentile([10, 20, 30, 40], 0.75)).toBe(30);
    expect(percentile([10, 20, 30, 40], 1)).toBe(40);
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("needs enough history before it claims to know anything", () => {
    // Four numbers are four numbers, not a baseline.
    expect(baselineFor(startups(100, 110, 105, 120), "startup")).toBeNull();
    expect(baselineFor(startups(100, 110, 105, 120, 115, 108), "startup")).not.toBeNull();
  });

  it("leaves the newest measurement out of its own baseline", () => {
    // Otherwise the baseline moves toward whatever is being judged.
    const baseline = baselineFor(startups(100, 100, 100, 100, 100, 9000), "startup");
    expect(baseline?.median).toBe(100);
    expect(baseline?.samples).toBe(5);
  });

  it("ignores measurements of a different kind", () => {
    const mixed = [...startups(100, 100, 100, 100, 100, 100), ...memory(500, 600)];
    expect(baselineFor(mixed, "startup")?.median).toBe(100);
  });
});

/**
 * Something that normally takes 20 ms and once took 40 has doubled — true, and
 * not worth a word.
 */
describe("noticing that something got slower", () => {
  it("reports a run well past the usual", () => {
    const found = detectRegression(startups(900, 950, 920, 880, 940, 3000), "startup");
    expect(found?.factor).toBeGreaterThan(3);
    expect(found?.message).toContain("Der Start");
    expect(found?.message).toContain("sonst etwa");
  });

  it("stays quiet about a run inside the usual spread", () => {
    expect(detectRegression(startups(900, 950, 920, 880, 940, 1000), "startup")).toBeNull();
  });

  it("stays quiet when the difference is large in ratio and small in fact", () => {
    // 20 ms to 60 ms is three times as long and nothing anybody notices.
    expect(detectRegression(startups(20, 20, 20, 20, 20, 60), "startup")).toBeNull();
  });

  it("says nothing without enough history", () => {
    expect(detectRegression(startups(100, 9000), "startup")).toBeNull();
    expect(detectRegression([], "startup")).toBeNull();
  });

  it("scales what counts as enough with the size of the measurement", () => {
    // A fixed 400 ms would make anything that normally takes 40 ms
    // unwatchable: it would have to become ten times slower before anybody was
    // told. A fixed small number would report noise on a three-second thing.
    expect(regressionFloor(40, "ms")).toBe(150);
    expect(regressionFloor(3000, "ms")).toBe(400);
    expect(regressionFloor(200, "ms")).toBe(200);
    expect(regressionFloor(30, "MB")).toBe(60);
    expect(regressionFloor(900, "MB")).toBe(150);
  });

  it("reports a fast thing that became genuinely slow", () => {
    // 42 ms to 300 ms is not 400 ms more, and it is felt on every open.
    expect(detectRegression(startups(40, 45, 42, 38, 44, 300), "startup")?.factor)
      .toBeGreaterThan(6);
  });

  it("uses a bigger floor for megabytes than for milliseconds", () => {
    // 200 MB against a usual 180 MB is a ratio worth ignoring.
    const modest = memory(180, 180, 180, 180, 180, 300);
    expect(detectRegression(modest, "memory")).toBeNull();
    const real = memory(180, 180, 180, 180, 180, 900);
    expect(detectRegression(real, "memory")?.unit).toBe("MB");
  });
});

/**
 * A single high reading is not a leak: a big project legitimately needs more
 * than a small one. A leak is a floor that keeps rising.
 */
describe("telling a leak from a big project", () => {
  it("says nothing about memory that moves and comes back", () => {
    const steady = memory(200, 400, 210, 380, 205, 420, 215, 390);
    expect(detectMemoryTrend(steady)?.leaking).toBe(false);
  });

  it("reports a floor that keeps rising", () => {
    const climbing = memory(200, 320, 210, 340, 400, 520, 430, 560);
    const trend = detectMemoryTrend(climbing);
    expect(trend?.leaking).toBe(true);
    expect(trend?.growthMb).toBeGreaterThanOrEqual(120);
    expect(trend?.message).toContain("steigt dauerhaft");
  });

  it("ignores a rise that is small in absolute terms", () => {
    // 90 MB to 120 MB is more, and it is not a leak.
    expect(detectMemoryTrend(memory(90, 100, 95, 110, 118, 130, 120, 128))?.leaking).toBe(false);
  });

  it("says nothing from too few samples", () => {
    expect(detectMemoryTrend(memory(100, 200, 300))).toBeNull();
  });

  it("says nothing when there is no message to give", () => {
    expect(detectMemoryTrend(memory(200, 400, 210, 380, 205, 420, 215, 390))?.message).toBe("");
  });
});

/**
 * A median of three runs is not a baseline and should not read like one.
 */
describe("describing the baselines", () => {
  it("names the sample count beside the number", () => {
    const lines = describeBaselines(startups(900, 950, 920, 880, 940, 910));
    expect(lines[0]).toContain("Der Start");
    expect(lines[0]).toContain("6 Messungen");
  });

  it("leaves out a kind with too little history", () => {
    expect(describeBaselines(startups(900, 950))).toEqual([]);
  });

  it("reports each kind it has enough of", () => {
    const mixed = [...startups(900, 950, 920, 880, 940), ...memory(200, 210, 205, 215, 208)];
    expect(describeBaselines(mixed)).toHaveLength(2);
  });
});
