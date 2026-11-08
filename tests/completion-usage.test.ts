import { describe, expect, it } from "vitest";
import {
  USAGE_HALF_LIFE_MS,
  decayedCount,
  pruneUsage,
  readUsageStore,
  recordUsage,
  usageKey,
  usageScore,
} from "../src/language/completion-usage";

const now = 1_700_000_000_000;
const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1000;

/**
 * What has been chosen before, and where.
 *
 * The old store was one flat table shared by every project that never forgot
 * anything: a name chosen constantly in one project kept lifting it in another
 * where it does not exist, and a habit from a year ago outranked one from this
 * morning.
 */
describe("remembering a choice where it was made", () => {
  it("keeps two projects apart", () => {
    const a = usageKey({ root: "C:/a", name: "Player" });
    const b = usageKey({ root: "C:/b", name: "Player" });
    expect(a).not.toBe(b);
  });

  it("keeps two receivers apart", () => {
    // "get" after a Map is a different decision from "get" after an Optional,
    // and one count for both is measuring neither.
    const map = usageKey({ root: "C:/a", receiverType: "java.util.Map", name: "get" });
    const optional = usageKey({ root: "C:/a", receiverType: "java.util.Optional", name: "get" });
    expect(map).not.toBe(optional);
    // The package is not part of it; the type is.
    expect(map).toBe(usageKey({ root: "C:/a", receiverType: "Map", name: "get" }));
  });

  it("groups a prefix rather than remembering every keystroke", () => {
    const short = usageKey({ root: "C:/a", prefix: "pri", name: "println" });
    const longer = usageKey({ root: "C:/a", prefix: "printl", name: "println" });
    expect(short).toBe(longer);
    expect(usageKey({ root: "C:/a", prefix: "sy", name: "println" })).not.toBe(short);
  });

  it("is well formed when there is no receiver or prefix", () => {
    expect(usageKey({ name: "Player" })).toContain("Player");
    expect(() => usageKey({ name: "" })).not.toThrow();
  });
});

describe("letting an old choice fade", () => {
  it("counts a fresh choice fully", () => {
    const store = recordUsage({}, "k", now);
    expect(decayedCount(store.k, now)).toBeCloseTo(1, 5);
  });

  it("halves after the half-life", () => {
    const store = { k: { count: 4, at: now - USAGE_HALF_LIFE_MS } };
    expect(decayedCount(store.k, now)).toBeCloseTo(2, 5);
    expect(decayedCount({ count: 4, at: now - USAGE_HALF_LIFE_MS * 2 }, now)).toBeCloseTo(1, 5);
  });

  it("does not restore a faded habit to full strength on one use", () => {
    // The count carries its own age forward: choosing something once after a
    // long absence is one recent use, not the old total plus one.
    const old = { k: { count: 8, at: daysAgo(63) } };
    const after = recordUsage(old, "k", now);
    expect(after.k.count).toBeLessThan(3);
    expect(after.k.count).toBeGreaterThan(1);
  });

  it("never lets history decide the order on its own", () => {
    const store = { k: { count: 10_000, at: now } };
    // One signal among several, and the weakest: it knows what was picked, not
    // what is correct.
    expect(usageScore(store, "k", now)).toBeLessThanOrEqual(8);
    expect(usageScore({}, "fehlt", now)).toBe(0);
  });
});

describe("keeping the store to a size", () => {
  it("drops what is worth least, not what is oldest", () => {
    const store = {
      oft: { count: 50, at: daysAgo(30) },
      einmal: { count: 1, at: daysAgo(1) },
      neu: { count: 2, at: now },
    };
    const pruned = pruneUsage(store, now, 2);
    // Fifty uses last month beat one use yesterday; dropping by age would lose
    // exactly the habit the store exists to remember.
    expect(Object.keys(pruned)).toContain("oft");
    expect(Object.keys(pruned)).not.toContain("einmal");
  });

  it("leaves a store that already fits alone", () => {
    const store = { a: { count: 1, at: now } };
    expect(pruneUsage(store, now, 10)).toBe(store);
  });
});

describe("reading what was stored before", () => {
  it("keeps counts written before choices had a date", () => {
    // The old shape was a plain number. Those start fading from now rather
    // than being thrown away.
    const store = readUsageStore({ alt: 5 }, now);
    expect(store.alt).toEqual({ count: 5, at: now });
  });

  it("keeps the new shape as it is", () => {
    const store = readUsageStore({ neu: { count: 3, at: daysAgo(2) } }, now);
    expect(store.neu.count).toBe(3);
    expect(store.neu.at).toBe(daysAgo(2));
  });

  it("refuses anything that is not a count", () => {
    expect(readUsageStore({ a: "viel", b: 0, c: -2, d: null, e: {} }, now)).toEqual({});
    expect(readUsageStore(null, now)).toEqual({});
    expect(readUsageStore("kaputt", now)).toEqual({});
  });
});
