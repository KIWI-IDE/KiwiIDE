import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const {
  assertPortableTarget,
  failedUpdateRelaunchArguments,
  portableHelperArguments,
  portableRelaunchArguments,
  setupHelperArguments,
  stagePortableUpdate,
} = require("../electron/services/portable-update-service.cjs");
const { validateManifest } = require("../electron/services/update-service.cjs");

const roots: string[] = [];
const stubborn: string[] = [];

/** Removes a temp folder, saying whether Windows let go of it. */
function removeRoot(root: string, retries: number) {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: retries, retryDelay: 100 });
    return true;
  } catch {
    return false;
  }
}

// These tests relaunch a real executable out of their temp folder. The helper
// script starts it detached, so it outlives the spawnSync that began it and
// keeps Windows holding the folder — measured: every one of them is free again
// the moment the test process ends, and none of them before. Waiting longer in
// afterEach only trades a red suite for a slow one, so what cannot go yet is
// carried to the end of the file and removed there.
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!removeRoot(root, 10)) stubborn.push(root);
  }
});

afterAll(() => {
  const leaked = stubborn.splice(0).filter((root) => !removeRoot(root, 50));
  // A folder still locked once every process of this file has gone is a leak
  // worth failing over, not a race worth waiting out.
  if (leaked.length) throw new Error(`Diese Ordner blieben gesperrt: ${leaked.join(", ")}`);
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi portable update "));
  roots.push(root);
  const targetPath = path.join(root, "Kiwi-IDE-1.0.8-portable.exe");
  const sourcePath = path.join(root, "download.exe");
  const content = Buffer.from("MZ Kiwi IDE 1.0.9 portable fixture");
  fs.writeFileSync(targetPath, "MZ Kiwi IDE 1.0.8 portable fixture");
  fs.writeFileSync(sourcePath, content);
  return {
    root,
    targetPath,
    sourcePath,
    content,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function fileVerification(file: string) {
  const content = fs.readFileSync(file);
  return {
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

async function waitForFile(file: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Zeitüberschreitung beim Warten auf ${file}`);
}

/** Wait until a launched Windows helper has released its temporary EXE. */
async function waitForFileUnlock(file: string, timeoutMs = 5_000) {
  const probe = `${file}.kiwi-unlock-probe`;
  const deadline = Date.now() + timeoutMs;
  const retryable = (error: unknown) => Boolean(error)
    && ["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code || "");
  while (Date.now() < deadline) {
    if (fs.existsSync(probe) && !fs.existsSync(file)) {
      try {
        fs.renameSync(probe, file);
      } catch (error) {
        if (!retryable(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
    }
    try {
      fs.renameSync(file, probe);
      fs.renameSync(probe, file);
      return;
    } catch (error) {
      if (!retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Zeitüberschreitung beim Freigeben von ${file}`);
}

function psQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

describe("portable update staging", () => {
  it("selects the portable schema-3 artifact and never falls back to setup", () => {
    const manifest = {
      schemaVersion: 3,
      channel: "stable",
      version: "1.0.9",
      url: "https://updates.example.test/Kiwi-IDE-1.0.9-setup.exe",
      sha256: "a".repeat(64),
      bytes: 123,
      artifacts: {
        setup: {
          filename: "Kiwi-IDE-1.0.9-setup.exe",
          url: "https://updates.example.test/Kiwi-IDE-1.0.9-setup.exe",
          sha256: "a".repeat(64),
          bytes: 123,
        },
        portable: {
          filename: "Kiwi-IDE-1.0.9-portable.exe",
          url: "https://updates.example.test/Kiwi-IDE-1.0.9-portable.exe",
          sha256: "b".repeat(64),
          bytes: 456,
        },
      },
    };
    expect(validateManifest(manifest, "stable", "portable")).toMatchObject({
      artifactKind: "portable",
      filename: "Kiwi-IDE-1.0.9-portable.exe",
      sha256: "b".repeat(64),
      bytes: 456,
    });
    expect(() => validateManifest({ ...manifest, artifacts: { setup: manifest.artifacts.setup } }, "stable", "portable"))
      .toThrow(/kein portables Update-Paket/);
    expect(() => validateManifest({ ...manifest, schemaVersion: 2 }, "stable", "portable"))
      .toThrow(/kein portables Update-Paket/);
  });

  it("stages a verified update beside the launcher and preserves safe relaunch arguments", async () => {
    const item = fixture();
    const staged = await stagePortableUpdate({
      path: item.sourcePath,
      version: "1.0.9",
      bytes: item.content.length,
      sha256: item.sha256,
    }, item.targetPath);

    expect(path.dirname(staged.stagedPath)).toBe(item.root);
    expect(staged.stagedPath).toMatch(/\.pending\.exe$/);
    expect(fs.readFileSync(staged.stagedPath)).toEqual(item.content);
    expect(await assertPortableTarget(item.targetPath)).toBe(item.targetPath);
    expect(portableRelaunchArguments(["ignored", "--user-data-dir", "C:\\Kiwi State", "--unsafe-flag"]))
      .toEqual(["--updated", "--user-data-dir=C:\\Kiwi State"]);
    expect(failedUpdateRelaunchArguments(["ignored", "--user-data-dir=C:\\Kiwi State"]))
      .toEqual(["--update-failed", "--user-data-dir=C:\\Kiwi State"]);

    const setupArgs = setupHelperArguments(
      path.join(item.root, "setup-update.ps1"),
      item.sourcePath,
      item.targetPath,
      path.join(item.root, "setup.log"),
      ["/S", "--updated", "--force-run"],
      { sha256: item.sha256, bytes: item.content.length },
      ["--updated"],
      ["--update-failed"],
    );
    const valueAfter = (flag: string) => setupArgs[setupArgs.indexOf(flag) + 1];
    expect(JSON.parse(Buffer.from(valueAfter("-InstallerArgsBase64"), "base64").toString("utf8")))
      .toEqual(["/S", "--updated", "--force-run"]);
    expect(JSON.parse(Buffer.from(valueAfter("-FailureArgsBase64"), "base64").toString("utf8")))
      .toEqual(["--update-failed"]);
  });

  it.runIf(process.platform === "win32")("atomically replaces the portable launcher through the shipped helper", async () => {
    const item = fixture();
    const staged = await stagePortableUpdate({
      path: item.sourcePath,
      version: "1.0.9",
      bytes: item.content.length,
      sha256: item.sha256,
    }, item.targetPath);
    const helper = path.resolve("resources", "update-helper", "portable-update.ps1");
    const log = path.join(item.root, "update.log");
    const args = [...portableHelperArguments(helper, staged, log, ["--updated"]), "-NoLaunch"];
    const result = spawnSync("powershell.exe", args, { encoding: "utf8", timeout: 15_000, windowsHide: true });

    const helperOutput = [
      result.stderr,
      result.stdout,
      fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "Update-Log wurde nicht erstellt.",
    ].filter(Boolean).join("\n");
    expect(result.status, helperOutput).toBe(0);
    expect(fs.readFileSync(item.targetPath)).toEqual(item.content);
    expect(fs.existsSync(`${item.targetPath}.kiwi-backup`)).toBe(false);
    expect(fs.readFileSync(log, "utf8")).toContain("erfolgreich installiert");
  });

  it.runIf(process.platform === "win32")("preserves spaced and quoted relaunch arguments in both Windows helpers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi helper arguments "));
    roots.push(root);
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const commandPrompt = path.join(systemRoot, "System32", "cmd.exe");
    const captureScript = path.join(root, "capture relaunch arguments.ps1");
    fs.writeFileSync(captureScript, [
      "param([string]$OutputPath, [string]$First, [string]$Second)",
      "[IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -Compress @($First, $Second)), [Text.Encoding]::UTF8)",
    ].join("\r\n"));
    const first = "C:\\Kiwi State\\folder with spaces\\";
    const second = 'Wert mit "Anführungszeichen" und Leerzeichen';
    const relaunchArguments = [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", captureScript,
      "-OutputPath", "", "-First", first, "-Second", second,
    ];

    const portableTarget = path.join(root, "Kiwi IDE portable.exe");
    const portableSource = path.join(root, "downloaded PowerShell.exe");
    const portableOutput = path.join(root, "portable captured arguments.json");
    fs.writeFileSync(portableTarget, "MZ old portable launcher");
    fs.copyFileSync(powershell, portableSource);
    const portableVerification = fileVerification(portableSource);
    const staged = await stagePortableUpdate({
      path: portableSource,
      version: "1.0.9",
      ...portableVerification,
    }, portableTarget);
    const portableArgs = portableHelperArguments(
      path.resolve("resources", "update-helper", "portable-update.ps1"),
      staged,
      path.join(root, "portable update.log"),
      relaunchArguments.map((value) => value === "" ? portableOutput : value),
    );
    const portableResult = spawnSync("powershell.exe", portableArgs, {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    expect(portableResult.status, portableResult.stderr || portableResult.stdout).toBe(0);
    await waitForFile(portableOutput);
    expect(JSON.parse(fs.readFileSync(portableOutput, "utf8").replace(/^\uFEFF/, ""))).toEqual([first, second]);
    await waitForFileUnlock(portableTarget);

    const installer = path.join(root, "setup runner with spaces.exe");
    const fallback = path.join(root, "Kiwi IDE fallback.exe");
    const setupOutput = path.join(root, "setup captured arguments.json");
    fs.copyFileSync(commandPrompt, installer);
    fs.copyFileSync(powershell, fallback);
    const setupVerification = fileVerification(installer);
    const setupArgs = setupHelperArguments(
      path.resolve("resources", "update-helper", "setup-update.ps1"),
      installer,
      fallback,
      path.join(root, "setup update.log"),
      ["/d", "/s", "/c", "exit /b 0"],
      setupVerification,
      relaunchArguments.map((value) => value === "" ? setupOutput : value),
      ["--update-failed"],
    );
    const setupResult = spawnSync("powershell.exe", setupArgs, {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    expect(setupResult.status, setupResult.stderr || setupResult.stdout).toBe(0);
    await waitForFile(setupOutput);
    expect(JSON.parse(fs.readFileSync(setupOutput, "utf8").replace(/^\uFEFF/, ""))).toEqual([first, second]);
    await waitForFileUnlock(fallback);
  }, 30_000);

  it.runIf(process.platform === "win32")("restores the previous launcher through the FAT/exFAT move fallback", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi rollback fallback "));
    roots.push(root);
    const target = path.join(root, "Kiwi IDE portable.exe");
    const backup = `${target}.kiwi-backup`;
    fs.writeFileSync(target, "corrupt replacement");
    fs.writeFileSync(backup, "previous working launcher");
    const helper = path.resolve("resources", "update-helper", "portable-update.ps1");
    const probe = [
      "$tokens = $null; $parseErrors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile(${psQuote(helper)}, [ref]$tokens, [ref]$parseErrors)`,
      "$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Restore-KiwiBackup' }, $true)",
      "if ($null -eq $definition -or $parseErrors.Count -gt 0) { exit 2 }",
      ". ([ScriptBlock]::Create($definition.Extent.Text))",
      `Restore-KiwiBackup -ReplacementPath ${psQuote(target)} -SavedPath ${psQuote(backup)} -ForceMove`,
    ].join("\r\n");
    const encodedProbe = Buffer.from(probe, "utf16le").toString("base64");
    const result = spawnSync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedProbe,
    ], { encoding: "utf8", timeout: 15_000, windowsHide: true });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.readFileSync(target, "utf8")).toBe("previous working launcher");
    expect(fs.existsSync(backup)).toBe(false);
    expect(fs.readdirSync(root).some((name) => name.includes(".kiwi-failed-"))).toBe(false);
  });

  it("refuses directories and a staged checksum mismatch without touching the launcher", async () => {
    const item = fixture();
    await expect(assertPortableTarget(item.root)).rejects.toThrow(/Pfad|Datei/);
    await expect(stagePortableUpdate({
      path: item.sourcePath,
      version: "1.0.9",
      bytes: item.content.length,
      sha256: "0".repeat(64),
    }, item.targetPath)).rejects.toThrow(/Verifikation/);
    expect(fs.readFileSync(item.targetPath, "utf8")).toContain("1.0.8");
    expect(fs.readdirSync(item.root).some((name) => name.endsWith(".pending.exe"))).toBe(false);
  });
});
