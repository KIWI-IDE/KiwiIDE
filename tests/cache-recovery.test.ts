import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  CacheRecoveryService,
  buildToolFromCommand,
  looksLikeCacheCorruption,
  retryArgsForBuild,
} = require("../electron/services/cache-recovery-service.cjs");
const { BuildService } = require("../electron/services/build-service.cjs");

const roots: string[] = [];

function temporary(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kiwi-${name}-`));
  roots.push(root);
  return root;
}

/**
 * Shared-cache locations that point at a temp folder, never at the real ones.
 *
 * A recovery moves files. Without this, running the suite would quarantine
 * artifacts out of the developer's own Maven and Gradle caches and then delete
 * them along with the temp directory.
 */
function isolatedCaches() {
  return { home: temporary("caches"), env: {} };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("automatic cache recovery", () => {
  it("recognizes damaged Maven and Gradle artifacts without treating compiler errors as cache damage", () => {
    expect(looksLikeCacheCorruption("invalid LOC header (bad signature) in guava.jar")).toBe(true);
    expect(looksLikeCacheCorruption("Gradle cache metadata is corrupt and unreadable")).toBe(true);
    expect(looksLikeCacheCorruption("cannot find symbol: method getName()")) .toBe(false);
    expect(buildToolFromCommand("C:\\tools\\mvn.cmd")).toBe("Maven");
    expect(buildToolFromCommand("/project/gradlew")).toBe("Gradle");
  });

  it("adds a single refresh flag while respecting offline builds", () => {
    expect(retryArgsForBuild("Maven", ["package"])).toEqual(["-U", "package"]);
    expect(retryArgsForBuild("Maven", ["-U", "package"])).toEqual(["-U", "package"]);
    expect(retryArgsForBuild("Maven", ["-o", "package"])).toEqual(["-o", "package"]);
    expect(retryArgsForBuild("Gradle", ["build"])).toEqual(["build", "--refresh-dependencies"]);
    expect(retryArgsForBuild("Gradle", ["build", "--offline"])).toEqual(["build", "--offline"]);
  });

  it("quarantines only project-local Gradle and Kiwi caches and preserves source files", async () => {
    const userData = temporary("userdata");
    const project = temporary("project");
    fs.mkdirSync(path.join(project, ".gradle", "8.10"), { recursive: true });
    fs.mkdirSync(path.join(project, ".kiwi", "cache"), { recursive: true });
    fs.mkdirSync(path.join(project, "src", "main", "java"), { recursive: true });
    fs.writeFileSync(path.join(project, ".gradle", "8.10", "metadata.bin"), "broken");
    fs.writeFileSync(path.join(project, ".kiwi", "cache", "model.json"), "broken");
    fs.writeFileSync(path.join(project, "src", "main", "java", "Main.java"), "class Main {}\n");

    const events: Array<{ channel: string; payload: unknown }> = [];
    const service = new CacheRecoveryService(userData, (channel: string, payload: unknown) => events.push({ channel, payload }), isolatedCaches());
    const result = await service.recoverBuild(project, "Gradle", "cache metadata is corrupt");

    expect(result.recovered).toBe(true);
    expect(fs.existsSync(path.join(project, ".gradle"))).toBe(false);
    expect(fs.existsSync(path.join(project, ".kiwi", "cache"))).toBe(false);
    expect(fs.readFileSync(path.join(project, "src", "main", "java", "Main.java"), "utf8")).toContain("class Main");
    expect(fs.existsSync(path.join(result.backupRoot, "recovery.json"))).toBe(true);
    expect(events.some((event) => event.channel === "cache:recovered")).toBe(true);
  });

  it("allows only one recovery for the same project and tool at a time", async () => {
    const userData = temporary("parallel-userdata");
    const project = temporary("parallel-project");
    fs.mkdirSync(path.join(project, ".gradle"), { recursive: true });
    fs.writeFileSync(path.join(project, ".gradle", "metadata.bin"), "broken");
    const service = new CacheRecoveryService(userData, undefined, isolatedCaches());

    const results = await Promise.all([
      service.recoverBuild(project, "Gradle", "cache metadata is corrupt"),
      service.recoverBuild(project, "Gradle", "cache metadata is corrupt"),
    ]);

    expect(results.filter((result) => result.recovered)).toHaveLength(1);
    expect(results.find((result) => !result.recovered)?.reason).toMatch(/in-progress|cooldown/);
    const backup = results.find((result) => result.recovered)?.backupRoot;
    expect(fs.readFileSync(path.join(backup, "project-cache", ".gradle", "metadata.bin"), "utf8")).toBe("broken");
  });

  it("backs up and recreates a broken JDT workspace", async () => {
    const userData = temporary("jdt-userdata");
    const project = temporary("jdt-project");
    const hash = require("node:crypto").createHash("sha256").update(path.resolve(project)).digest("hex").slice(0, 20);
    const workspace = path.join(userData, "jdtls-workspaces", hash);
    fs.mkdirSync(path.join(workspace, ".metadata"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".metadata", ".log"), "workspace metadata is corrupt");

    const service = new CacheRecoveryService(userData, undefined, isolatedCaches());
    const result = await service.recoverJdt(project, workspace, new Error("JDT exited"));

    expect(result.recovered).toBe(true);
    expect(fs.existsSync(workspace)).toBe(true);
    expect(fs.readdirSync(workspace)).toHaveLength(0);
    expect(fs.existsSync(path.join(result.backupRoot, "workspace", ".metadata", ".log"))).toBe(true);
  });

  it("classifies a timed-out JDT workspace for one safe recovery attempt", async () => {
    const userData = temporary("jdt-timeout-userdata");
    const project = temporary("jdt-timeout-project");
    const workspace = path.join(userData, "jdtls-workspaces", "timeout-workspace");
    fs.mkdirSync(path.join(workspace, ".metadata"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".metadata", ".log"), "No explicit corruption marker");
    const timeout = Object.assign(new Error("JDT-LS-Initialisierung antwortet nicht"), {
      code: "KIWI_JDT_TIMEOUT",
    });
    const service = new CacheRecoveryService(userData, undefined, isolatedCaches());

    expect(await service.jdtFailureLooksRecoverable(workspace, timeout)).toBe(true);
    expect(await service.jdtFailureLooksRecoverable(path.join(userData, "missing"), timeout)).toBe(false);
  });

  it("retries a failed build-tool synchronization exactly once after recovery", async () => {
    const project = temporary("build-retry");
    const recoverBuild = vi.fn(async (_root: string, tool: string, output: string) => ({
      recovered: tool === "Gradle" && output.includes("invalid LOC header"),
    }));
    const output: string[] = [];
    const service = new BuildService(
      {}, {}, {}, {},
      (_channel: string, payload: { text?: string }) => output.push(payload.text || ""),
      { recoverBuild },
    );
    const script = "if (process.argv.includes('--refresh-dependencies')) process.exit(0); console.error('invalid LOC header'); process.exit(1);";
    const result = await service.captureBuildTool(project, "Gradle", process.execPath, ["-e", script, "--"], { cwd: project });

    expect(result.code).toBe(0);
    expect(recoverBuild).toHaveBeenCalledTimes(1);
    expect(output.join("\n")).toContain("Projektsynchronisierung");
  });

  it("never lets an old recovery retry replace a newer build", async () => {
    const project = temporary("build-generation");
    const launcher = path.join(project, process.platform === "win32" ? "gradle.cmd" : "gradle");
    fs.writeFileSync(launcher, process.platform === "win32"
      ? "@echo off\r\necho cache metadata is corrupt 1>&2\r\nexit /b 1\r\n"
      : "#!/bin/sh\necho 'cache metadata is corrupt' >&2\nexit 1\n");
    if (process.platform !== "win32") fs.chmodSync(launcher, 0o755);

    let releaseRecovery!: (value: { recovered: boolean }) => void;
    let recoveryStarted!: () => void;
    const started = new Promise<void>((resolve) => { recoveryStarted = resolve; });
    const pendingRecovery = new Promise<{ recovered: boolean }>((resolve) => { releaseRecovery = resolve; });
    const messages: string[] = [];
    const service = new BuildService(
      {}, {}, {}, {},
      (_channel: string, payload: { text?: string }) => messages.push(payload.text || ""),
      { recoverBuild: vi.fn(() => { recoveryStarted(); return pendingRecovery; }) },
    );

    service.start(project, launcher, [], project, process.env, "OLD_ATTEMPT");
    await started;
    service.start(project, process.execPath, ["-e", "setTimeout(() => {}, 5000)"], project, process.env, "NEW_BUILD");
    const newProcess = service.active.get(project);
    releaseRecovery({ recovered: true });
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(service.active.get(project)).toBe(newProcess);
    expect(messages.join("\n")).not.toContain("startet den Build einmal neu");
    const closed = new Promise<void>((resolve) => {
      if (!newProcess || newProcess.exitCode !== null) resolve();
      else newProcess.once("close", () => resolve());
    });
    service.stop(project);
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  });
});
