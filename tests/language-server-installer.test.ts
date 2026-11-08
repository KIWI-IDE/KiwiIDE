import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installManagedLanguageServer, installAllLanguageServers, PACKAGES } = require("../electron/services/language-server-installer.cjs");
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-server-install-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("local language server installation", () => {
  it.each(["python", "php"])("installs %s only in Kiwi's directory without package scripts", async (languageId) => {
    const run = vi.fn(async () => ({ code: 0, stderr: "", output: "" }));
    await expect(installManagedLanguageServer(languageId, root, { run })).resolves.toEqual({ installed: true });
    const [command, args, options] = run.mock.calls[0] as unknown as [string, string[], { cwd: string }];
    expect(command).toMatch(/^npm(?:\.cmd)?$/);
    expect(args).toEqual(["install", "--prefix", root, "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", languageId === "python" ? "pyright" : "intelephense"]);
    expect(options.cwd).toBe(root);
    expect(JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).private).toBe(true);
  });

  it("refuses arbitrary packages before launching an installer", async () => {
    const run = vi.fn();
    for (const id of ["custom-package", "constructor", "__proto__"]) {
      await expect(installManagedLanguageServer(id, root, { run })).rejects.toThrow();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("reports npm failure and allows a later retry", async () => {
    const run = vi.fn().mockResolvedValueOnce({ code: 1, stderr: "registry unavailable" }).mockResolvedValueOnce({ code: 0 });
    const result = await installManagedLanguageServer("python", root, { run });
    expect(result.installed).toBe(false);
    expect(result.reason).toContain("registry unavailable");
    await expect(installManagedLanguageServer("python", root, { run })).resolves.toEqual({ installed: true });
  });

  it("serializes installations that write the same package directory", async () => {
    let active = 0;
    let maximum = 0;
    const run = vi.fn(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { code: 0 };
    });
    await Promise.all([installManagedLanguageServer("python", root, { run }), installManagedLanguageServer("php", root, { run })]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maximum).toBe(1);
  });

  it("skips installation when skipIfInstalled is true and package is already present", async () => {
    const pkgDir = path.join(root, "node_modules", PACKAGES.typescript);
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: PACKAGES.typescript }));
    const run = vi.fn();
    const res = await installManagedLanguageServer("typescript", root, { run, skipIfInstalled: true });
    expect(res).toEqual({ installed: true, cached: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("installs all managed npm and native toolchain language servers via installAllLanguageServers", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "", output: "" }));
    const summary = await installAllLanguageServers(root, { run });
    expect(summary.total).toBe(9);
    expect(summary.installed).toBe(9);
    expect(summary.results.typescript.installed).toBe(true);
    expect(summary.results.rust.installed).toBe(true);
    expect(summary.results.go.installed).toBe(true);
    expect(summary.results.csharp.installed).toBe(true);
  });
});
