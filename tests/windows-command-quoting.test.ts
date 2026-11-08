import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { prepareCommand, quoteForCmd, spawnCapture } = require("../electron/services/process-utils.cjs");

/**
 * Starting a build tool from a path that contains a space.
 *
 * Which is every installed Kiwi: the default location is
 * `…\Programs\Kiwi IDE\`, and the bundled Gradle and Maven live under it. The
 * repository this is developed in has no space in its path, so the whole class
 * of failure was invisible until somebody ran the installed application.
 */
let root = "";
const windows = process.platform === "win32";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-quoting-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("quoting one argument for cmd.exe", () => {
  it("leaves an argument that needs no quotes alone", () => {
    expect(quoteForCmd("clean")).toBe("clean");
    expect(quoteForCmd("--console=plain")).toBe("--console=plain");
    expect(quoteForCmd("C:\\werkzeug\\gradle.bat")).toBe("C:\\werkzeug\\gradle.bat");
  });

  it("quotes what cmd would otherwise split", () => {
    expect(quoteForCmd("C:\\Programs\\Kiwi IDE\\gradle.bat")).toBe('"C:\\Programs\\Kiwi IDE\\gradle.bat"');
    expect(quoteForCmd("a&b")).toBe('"a&b"');
    expect(quoteForCmd("a|b")).toBe('"a|b"');
  });

  it("writes an empty argument as an empty pair rather than nothing", () => {
    // Dropped instead of quoted, an empty argument shifts every one after it.
    expect(quoteForCmd("")).toBe('""');
  });
});

describe("preparing a batch file for cmd.exe", () => {
  it("wraps the whole line, which is what /s takes its quotes from", () => {
    // cmd /s strips the first and the last quote after /c. Without the outer
    // pair those two are the ones holding the path together.
    const prepared = prepareCommand("C:\\Programs\\Kiwi IDE\\gradle.bat", ["clean", "--parallel"]);
    if (!windows) return;
    expect(prepared.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(prepared.args[3]).toBe('""C:\\Programs\\Kiwi IDE\\gradle.bat" clean --parallel"');
    // Node would quote the line a second time otherwise.
    expect(prepared.verbatim).toBe(true);
  });

  it("leaves an ordinary executable to be spawned directly", () => {
    const prepared = prepareCommand("java", ["-version"]);
    expect(prepared.command).toBe("java");
    expect(prepared.args).toEqual(["-version"]);
    expect(prepared.verbatim).toBe(false);
  });
});

describe("actually running a batch file from a path with a space", () => {
  it("finds it, and hands it its arguments unbroken", async () => {
    // The failure this covers: "Der Befehl C:\…\Programs\Kiwi ist entweder
    // falsch geschrieben oder konnte nicht gefunden werden" — the path cut at
    // its space, on every build an installed Kiwi ran.
    if (!windows) return;
    const directory = path.join(root, "Kiwi IDE", "resources", "toolchain");
    await mkdir(directory, { recursive: true });
    const script = path.join(directory, "gradle.bat");
    await writeFile(script, "@echo off\r\necho ARGUMENTE:%*\r\n", "utf8");

    const result = await spawnCapture(script, ["clean", "--console=plain", "--no-daemon"], { cwd: root });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ARGUMENTE:clean --console=plain --no-daemon");
  }, 30_000);

  it("keeps an argument that has a space in it in one piece", async () => {
    if (!windows) return;
    const directory = path.join(root, "Kiwi IDE");
    await mkdir(directory, { recursive: true });
    const script = path.join(directory, "werkzeug.cmd");
    await writeFile(script, "@echo off\r\necho ERSTES:%1\r\n", "utf8");

    const result = await spawnCapture(script, ["mit Leerzeichen"], { cwd: root });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ERSTES:"mit Leerzeichen"');
  }, 30_000);

  it("reports the batch file's own exit code", async () => {
    if (!windows) return;
    const directory = path.join(root, "Kiwi IDE");
    await mkdir(directory, { recursive: true });
    const script = path.join(directory, "fehler.bat");
    await writeFile(script, "@echo off\r\nexit /b 3\r\n", "utf8");

    expect((await spawnCapture(script, [], { cwd: root })).code).toBe(3);
  }, 30_000);
});
