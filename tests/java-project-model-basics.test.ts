import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  createLimiter,
  detectBuildSystem,
  mapConcurrent,
} = require("../electron/services/java-project-model.cjs");

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-model-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("running work a few pieces at a time", () => {
  it("never has more running than it was told to", async () => {
    // The limit is the whole point: scanning a large project opened every
    // file at once and ran the machine out of handles.
    //
    // Counted after a turn of the event loop, because a queued task starts
    // on a microtask rather than the moment it is handed over.
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const settle: Array<() => void> = [];
    const tasks = Array.from({ length: 10 }, () => limit(() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<void>((resolve) => settle.push(() => { active -= 1; resolve(); }));
    }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(active).toBe(3);
    expect(peak).toBe(3);
    while (settle.length) {
      settle.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await Promise.all(tasks);
    // Ten pieces went through, and never more than three at a time.
    expect(peak).toBe(3);
  });

  it("starts the next piece when one finishes", async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => limit(async () => { order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
  });

  it("keeps going after one piece fails", async () => {
    // One unreadable file must not stop a scan of the other nine hundred.
    const limit = createLimiter(2);
    const failed = limit(() => Promise.reject(new Error("kaputt")));
    const after = limit(async () => "danach");
    await expect(failed).rejects.toThrow("kaputt");
    await expect(after).resolves.toBe("danach");
  });

  it("hands the failure to the caller rather than swallowing it", async () => {
    const limit = createLimiter(2);
    await expect(limit(() => { throw new Error("sofort"); })).rejects.toThrow("sofort");
  });
});

describe("mapping over many items at once", () => {
  it("keeps the answers in the order the items were in", async () => {
    // The results are matched with their inputs by position later on, so an
    // order that depends on which finished first would mislabel every one.
    const items = [5, 1, 4, 2, 3];
    const result = await mapConcurrent(items, 2, async (value: number) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      return value * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
  });

  it("passes the position along with the item", async () => {
    const seen = await mapConcurrent(["a", "b"], 2, async (value: string, index: number) => `${index}:${value}`);
    expect(seen).toEqual(["0:a", "1:b"]);
  });

  it("does nothing at all for an empty list", async () => {
    expect(await mapConcurrent([], 4, async () => "x")).toEqual([]);
  });
});

describe("recognising what builds a project", () => {
  it("calls a project with a pom Maven", async () => {
    await writeFile(path.join(root, "pom.xml"), "<project/>");
    expect(detectBuildSystem(root)).toBe("Maven");
  });

  it("recognises Gradle in all four spellings", async () => {
    for (const name of ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]) {
      const folder = path.join(root, name.replace(/\./g, "_"));
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, name), "");
      expect({ name, detected: detectBuildSystem(folder) }).toEqual({ name, detected: "Gradle" });
    }
  });

  it("prefers Maven when a project carries both", async () => {
    // A project with both is a Gradle build wrapped around a pom far more
    // often than the other way round, but either way the answer has to be the
    // same every time rather than depending on which file was looked at first.
    await writeFile(path.join(root, "pom.xml"), "<project/>");
    await writeFile(path.join(root, "build.gradle"), "");
    expect(detectBuildSystem(root)).toBe("Maven");
  });

  it("recognises an Eclipse project by what Eclipse leaves behind", async () => {
    await writeFile(path.join(root, ".classpath"), "");
    expect(detectBuildSystem(root)).toBe("Eclipse");
  });

  it("calls a folder of sources plain Java rather than guessing", async () => {
    await writeFile(path.join(root, "Main.java"), "class Main {}");
    expect(detectBuildSystem(root)).toBe("Java");
  });
});
