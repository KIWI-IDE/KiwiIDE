import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { normalizeRepeatCount, resolveNpmRunner, runRepeatedE2E } from "../scripts/repeat-e2e.mjs";

describe("repeated Electron E2E build gate", () => {
  it("uses three attempts by default and keeps the configured range safe", () => {
    expect(normalizeRepeatCount(undefined)).toBe(3);
    expect(normalizeRepeatCount("1")).toBe(2);
    expect(normalizeRepeatCount("7")).toBe(7);
    expect(normalizeRepeatCount("99")).toBe(10);
    expect(normalizeRepeatCount("invalid")).toBe(3);
  });

  it("runs every attempt with its sequence in the environment", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(runRepeatedE2E({ repeats: 3, command: "npm", spawn: spawn as never })).toBe(3);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn.mock.calls.map((call) => call[2].env.KIWI_E2E_ATTEMPT)).toEqual(["1", "2", "3"]);
    // The gate reaches these runs on a machine that has just built the
    // renderer and is about to write two installers, so every wait inside a
    // run gets more room than it does for a developer running the suite alone.
    for (const call of spawn.mock.calls) {
      expect(Number(call[2].env.KIWI_E2E_PATIENCE)).toBeGreaterThan(1);
    }
  });

  it("starts the real npm CLI without relying on spawning npm.cmd directly", () => {
    const runner = resolveNpmRunner();
    if (process.env.npm_execpath) {
      expect(runner.command).toBe(process.execPath);
      expect(runner.prefixArgs[0]).toBe(process.env.npm_execpath);
    }
    const result = spawnSync(runner.command, [...runner.prefixArgs, "--version"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+/);
  });

  it("fails immediately when an intermittent attempt fails", () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });
    expect(() => runRepeatedE2E({ repeats: 3, command: "npm", spawn: spawn as never }))
      .toThrow(/Durchlauf 2\/3/);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
