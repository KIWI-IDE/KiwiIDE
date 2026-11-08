import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { currentVersionArtifacts, signAndVerify, signArtifactIfConfigured } = require("../scripts/sign-windows-artifacts.cjs") as {
  currentVersionArtifacts: (root: string, version: string, exists: (file: string) => boolean) => string[];
  signAndVerify: (file: string, config: Record<string, unknown>, execute: () => unknown, wait?: (ms: number) => void) => boolean;
  signArtifactIfConfigured: (file: string, options?: Record<string, unknown>) => { signed: boolean; trusted: boolean };
};
const afterPack = require("../scripts/after-pack.cjs") as (
  context: Record<string, any>,
  dependencies?: Record<string, unknown>,
) => Promise<void>;

describe("Windows release signing", () => {
  it("selects only current-version portable and setup wrappers", () => {
    const root = path.resolve("release");
    const present = new Set([
      path.join(root, "win-unpacked", "Kiwi IDE.exe"),
      path.join(root, "Kiwi-IDE-1.0.3-portable.exe"),
      path.join(root, "Kiwi-IDE-1.0.3-setup.exe"),
      path.join(root, "Kiwi-IDE-1.0.4-portable.exe"),
      path.join(root, "Kiwi-IDE-1.0.4-setup.exe"),
      path.join(root, "Kiwi-IDE-1.0.4-debug.exe"),
    ]);

    const selected = currentVersionArtifacts(root, "1.0.4", (file) => present.has(file));

    expect(selected).toEqual([
      path.join(root, "Kiwi-IDE-1.0.4-portable.exe"),
      path.join(root, "Kiwi-IDE-1.0.4-setup.exe"),
    ]);
    expect(selected.some((file) => file.includes("1.0.3"))).toBe(false);
    expect(selected.some((file) => file.includes("win-unpacked"))).toBe(false);
    expect(selected.some((file) => file.endsWith("-debug.exe"))).toBe(false);
  });

  it("edits and then signs the Windows app executable before packaging", async () => {
    const calls: string[] = [];
    const context = {
      electronPlatformName: "win32",
      appOutDir: path.resolve("release", "win-unpacked"),
      packager: {
        projectDir: path.resolve("."),
        appInfo: { productFilename: "Kiwi IDE", version: "1.0.4" },
      },
    };

    await afterPack(context, {
      rcedit: vi.fn(async () => { calls.push("rcedit"); }),
      signArtifactIfConfigured: vi.fn(async () => { calls.push("sign"); }),
    });

    expect(calls).toEqual(["rcedit", "sign"]);
  });

  it("does nothing for a non-Windows package", async () => {
    const edit = vi.fn();
    const sign = vi.fn();
    await afterPack({ electronPlatformName: "linux" }, {
      rcedit: edit,
      signArtifactIfConfigured: sign,
    });
    expect(edit).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("skips incomplete optional credentials but fails when signing is required", () => {
    const logger = { log: vi.fn() };
    expect(signArtifactIfConfigured("Kiwi IDE.exe", { env: {}, logger })).toEqual({ signed: false, trusted: false });
    expect(logger.log).toHaveBeenCalledOnce();

    expect(() => signArtifactIfConfigured("Kiwi IDE.exe", {
      env: { KIWI_REQUIRE_SIGNING: "1", KIWI_WINDOWS_CERT_PASSWORD: "secret-not-to-log" },
      logger,
    })).toThrow(/erforderlich/);
    expect(logger.log.mock.calls.flat().join(" ")).not.toContain("secret-not-to-log");
  });

  it("sanitizes SignTool failures so the certificate password cannot leak", () => {
    const config = {
      certificate: "kiwi.pfx",
      password: "secret-not-to-leak",
      signTool: "signtool.exe",
      timestampUrl: "https://timestamp.example.test",
      required: true,
    };
    const execute = vi.fn(() => { throw new Error("secret-not-to-leak"); });
    let message = "";
    try {
      signAndVerify("Kiwi IDE.exe", config, execute, () => undefined);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/konnte Kiwi IDE\.exe nach \d+ Versuchen nicht signieren/);
    expect(message).not.toContain(config.password);
  });


  it("waits out a file another process still holds", () => {
    // SignTool opens the artifact for writing, and a 276 MB installer written
    // seconds ago is often still being read by a virus scanner. That failure
    // passes on its own, and it once cost a release build that had already
    // cleared three E2E runs.
    const config = {
      certificate: "kiwi.pfx",
      password: "secret-not-to-leak",
      signTool: "signtool.exe",
      timestampUrl: "https://timestamp.example.test",
      required: true,
    };
    let calls = 0;
    const execute = vi.fn(() => {
      calls += 1;
      if (calls < 3) throw new Error("The file is being used by another process.");
      return "";
    });
    const waited: number[] = [];
    expect(signAndVerify("Kiwi IDE.exe", config, execute, (ms: number) => waited.push(ms))).toBe(true);
    // Two failures, one signature, one verification.
    expect(calls).toBe(4);
    expect(waited).toEqual([3000, 6000]);
  });

  it("gives up eventually rather than retrying a wrong password forever", () => {
    const config = {
      certificate: "kiwi.pfx",
      password: "secret-not-to-leak",
      signTool: "signtool.exe",
      timestampUrl: "https://timestamp.example.test",
      required: true,
      attempts: 2,
    };
    const execute = vi.fn(() => { throw new Error("secret-not-to-leak"); });
    expect(() => signAndVerify("Kiwi IDE.exe", config, execute, () => undefined))
      .toThrow(/nach 2 Versuchen nicht signieren/);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("disables the unused NSIS differential package", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(pkg.build.nsis.differentialPackage).toBe(false);
  });
});
