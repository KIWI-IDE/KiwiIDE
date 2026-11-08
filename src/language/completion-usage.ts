/**
 * What has been chosen before, and how much that should still count.
 *
 * The old store was one flat table of name-and-detail counts shared by every
 * project, and nothing ever left it. So a `Player` chosen constantly in one
 * project kept lifting `Player` in another where it does not exist, and a habit
 * from a year ago still outranked one from this morning.
 *
 * A choice is remembered against where it was made: the project, the type the
 * member was reached through, and the prefix that had been typed. Those three
 * are what made the choice the right one — `get` after a `Map` is a different
 * decision from `get` after an `Optional` — and a count that ignores them is
 * measuring something else.
 */

export interface UsageEntry {
  /** How many times, before decay. */
  count: number;
  /** When it was last chosen, in milliseconds. */
  at: number;
}

export type UsageStore = Record<string, UsageEntry>;

/**
 * How long it takes for a choice to count half as much.
 *
 * Habits change with the project, and a preference from three weeks ago should
 * still be visible while no longer outweighing this week's. Nothing is ever
 * deleted for being old — it simply stops mattering, which is the difference
 * between forgetting and pretending it never happened.
 */
export const USAGE_HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1000;

/** Entries kept. Past this the least useful are dropped, not the oldest. */
export const USAGE_LIMIT = 800;

/**
 * The key a choice is remembered under.
 *
 * The receiver type and the prefix are both part of it: choosing `get` after
 * `Map` says nothing about what should come first after `Optional`, and
 * choosing `println` having typed `pr` says nothing about what to offer at
 * `sy`. Any of the three may be missing — there is no receiver at the start of
 * a statement — and the key is still well formed without it.
 */
export function usageKey(parts: {
  root?: string;
  receiverType?: string;
  prefix?: string;
  name: string;
}): string {
  return [
    String(parts.root || "").toLowerCase(),
    String(parts.receiverType || "").split(".").at(-1) || "",
    // Only the first few characters: the prefix is a hint about intent, and
    // remembering the whole of it makes a separate memory per keystroke.
    String(parts.prefix || "").slice(0, 3).toLowerCase(),
    String(parts.name || ""),
  ].join("\u0000");
}

/** Records one choice, at a given moment. */
export function recordUsage(store: UsageStore, key: string, now: number): UsageStore {
  const existing = store[key];
  // The count carries its own age forward, so a long-unused entry does not
  // jump back to full strength from a single use.
  const decayed = existing ? decayedCount(existing, now) : 0;
  return { ...store, [key]: { count: decayed + 1, at: now } };
}

/** What one entry is worth now, having faded since it was last chosen. */
export function decayedCount(entry: UsageEntry | undefined, now: number): number {
  if (!entry?.count) return 0;
  const age = Math.max(0, now - (entry.at || 0));
  return entry.count * Math.pow(0.5, age / USAGE_HALF_LIFE_MS);
}

/**
 * How much a proposal should be lifted for having been chosen before.
 *
 * Bounded on purpose. This is one signal among several and the weakest of
 * them — it knows what was picked, not what is correct — so it may nudge the
 * order and never decide it.
 */
export function usageScore(store: UsageStore, key: string, now: number): number {
  return Math.min(8, decayedCount(store[key], now));
}

/**
 * Keeps the store to a size, dropping what is worth least rather than what is
 * oldest — an entry used fifty times last month is worth more than one used
 * once yesterday, and dropping by age alone would lose exactly the habits the
 * store exists to remember.
 */
export function pruneUsage(store: UsageStore, now: number, limit = USAGE_LIMIT): UsageStore {
  const entries = Object.entries(store);
  if (entries.length <= limit) return store;
  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => decayedCount(right, now) - decayedCount(left, now))
      .slice(0, limit),
  );
}

/**
 * Reads a stored table, including one written before choices had a date.
 *
 * The old shape was a plain number per key. Those are kept and given the time
 * they were read, so an existing habit is not thrown away — it simply starts
 * fading from now rather than from whenever it was actually formed.
 */
export function readUsageStore(raw: unknown, now: number): UsageStore {
  if (!raw || typeof raw !== "object") return {};
  const store: UsageStore = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      store[key] = { count: value, at: now };
      continue;
    }
    const entry = value as Partial<UsageEntry>;
    if (entry && Number.isFinite(entry.count) && Number(entry.count) > 0) {
      store[key] = { count: Number(entry.count), at: Number(entry.at) || now };
    }
  }
  return store;
}
