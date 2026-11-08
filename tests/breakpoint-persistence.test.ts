import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toggleJavaLineBreakpoint } from "../src/debug/breakpoint-gutter";

const { BreakpointService } = require("../electron/services/breakpoint-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");

let root = "";
let service: {
  list: (root: string) => Promise<Array<Record<string, unknown>>>;
  save: (root: string, breakpoints: unknown[]) => Promise<unknown>;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-breakpoints-"));
  // The service goes through the same guard the workbench uses, so the
  // project has to be a registered one here too.
  const guard = new PathGuard();
  guard.register(root);
  service = new BreakpointService(guard);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

const lineBreakpoint = (over: Record<string, unknown> = {}) => ({
  type: "line",
  className: "Beta",
  path: "C:/projekt/app/src/Beta.java",
  line: 3,
  enabled: true,
  ...over,
});

describe("what survives a save", () => {
  it("keeps the file a breakpoint was set in", async () => {
    // Without this the identity fix only held in memory: the next load handed
    // back a breakpoint with no path, matching fell back to the class name,
    // and two files called Beta.java shared one breakpoint again.
    await service.save(root, [lineBreakpoint()]);
    const [loaded] = await service.list(root);
    expect(loaded.path).toBe("C:/projekt/app/src/Beta.java");
    expect(loaded).toMatchObject({ type: "line", className: "Beta", line: 3 });
  });

  it("keeps two files with the same class name apart across the round trip", async () => {
    // The whole failure in one test: save, load, and then a click on one of
    // them must not remove the other.
    const both = [
      lineBreakpoint({ path: "C:/a/Beta.java" }),
      lineBreakpoint({ path: "C:/b/Beta.java" }),
    ];
    await service.save(root, both);
    const loaded = await service.list(root);
    expect(loaded).toHaveLength(2);

    const afterClick = toggleJavaLineBreakpoint(loaded as never, "Beta", 3, "C:/a/Beta.java");
    expect(afterClick).toHaveLength(1);
    expect(afterClick[0].path).toBe("C:/b/Beta.java");
  });

  it("still writes a breakpoint that never had a path", async () => {
    // Anything saved before this change has none, and dropping those would
    // lose breakpoints on the first run after an update.
    await service.save(root, [{ type: "line", className: "demo.Main", line: 7, enabled: true }]);
    const [loaded] = await service.list(root);
    expect(loaded).toMatchObject({ className: "demo.Main", line: 7 });
    expect(loaded.path).toBeUndefined();
  });

  it("writes no path field rather than an empty one", async () => {
    // An empty string is not "no path": the matching rule tests for a value,
    // and "" would send it down the path branch with nothing to compare.
    await service.save(root, [lineBreakpoint({ path: "" })]);
    const written = JSON.parse(await readFile(path.join(root, ".kiwi", "breakpoints.json"), "utf8"));
    expect("path" in written.breakpoints[0]).toBe(false);
  });

  it("keeps an exception breakpoint, which belongs to no file", async () => {
    await service.save(root, [{
      type: "exception", className: "java.lang.NullPointerException", caught: true, uncaught: false,
    }]);
    const [loaded] = await service.list(root);
    expect(loaded).toMatchObject({ type: "exception", className: "java.lang.NullPointerException", uncaught: false });
  });

  it("drops an entry that is not a breakpoint at all", async () => {
    await service.save(root, [
      lineBreakpoint(),
      { className: "OhneZeile" },
      { line: 4 },
      null,
    ] as never);
    expect(await service.list(root)).toHaveLength(1);
  });

  it("answers with nothing for a project that never saved any", async () => {
    expect(await service.list(root)).toEqual([]);
  });
});
