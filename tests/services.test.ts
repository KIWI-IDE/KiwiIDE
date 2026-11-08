import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const { RunConfigService } = require("../electron/services/run-config-service.cjs");
const { GitService } = require("../electron/services/git-service.cjs");
const { GitHubAuthService, isGitHubRemote, redactSecrets } = require("../electron/services/github-auth-service.cjs");
const { TestService, discoverTestsInSource } = require("../electron/services/test-service.cjs");
const {
  ProjectService,
  javaTypeSource,
  frameworksFromBuildFile,
  CURRENT_PROJECT_SETTINGS_VERSION,
} = require("../electron/services/project-service.cjs");
const { WorkspaceService, describeFileSystemError } = require("../electron/services/workspace-service.cjs");
const {
  ModuleService,
  parseModuleInfo,
  addGradleModule,
  addMavenModule,
  ensureAggregatorPackaging,
  removeGradleModule,
  parseGradleIncludes,
  gradleProjectId,
} = require("../electron/services/module-service.cjs");
const { DropTokenService } = require("../electron/services/drop-token-service.cjs");
const {
  DebugService,
  debugVmArgs,
  normalizeHotReplaceRequest,
  smartHotSwapRequiresRelaunch,
} = require("../electron/services/debug-service.cjs");
const { WorkspaceStateService } = require("../electron/services/workspace-state-service.cjs");
const { WorkflowService } = require("../electron/services/workflow-service.cjs");
const { SettingsService, CURRENT_SETTINGS_VERSION } = require("../electron/services/settings-service.cjs");
const {
  UpdateService,
  compareVersions,
  assertUpdateDownloadUrl,
  nsisUpdateArguments,
  createUpdatePrepareState,
  acknowledgeUpdatePrepare,
  selectArtifactKind,
  updatePrepareComplete,
  validateManifest,
  writeAll,
} = require("../electron/services/update-service.cjs");
const { spawnCapture } = require("../electron/services/process-utils.cjs");
const {
  DependencyService,
  insertMavenDependency,
  insertGradleDependency,
} = require("../electron/services/dependency-service.cjs");
const {
  validateContent,
  validateJson,
  validateXml,
  validateMavenPom,
  validateYaml,
  validateGradle,
} = require("../electron/services/file-validators.cjs");
const {
  BuildService,
  mavenTasks,
  gradleFallbackTasks,
  parseGradleTasks,
  mavenProfiles,
  gradleVariants,
  parseGradleDependencyTree,
  parseMavenDependencyTree,
  splitArgs,
  topologicalSortModules,
} = require("../electron/services/build-service.cjs");
const { discoverJavaProjectModel, inferSourceRoots } = require("../electron/services/java-project-model.cjs");
const {
  LanguageService,
  LanguageSession,
  createJavaSettings,
  isClasspathFile,
  isLombokAgentJar,
  detectLombokAgent,
  countClasspathEntries,
  declaredDependencyCount,
  repairLegacyManagedMetadata,
  prepareLanguageWorkspace,
  rejectAfterTimeout,
  requestTimeoutForMethod,
  LANGUAGE_WORKSPACE_SCHEMA_VERSION,
  JDT_DECORATION_REQUEST_TIMEOUT_MS,
  JDT_INTERACTIVE_REQUEST_TIMEOUT_MS,
  JDT_PROJECT_REQUEST_TIMEOUT_MS,
  JDT_MUTATING_REQUEST_TIMEOUT_MS,
  JDT_TIMEOUT_CODE,
} = require("../electron/services/language-service.cjs");

let fixtureRoot = "";

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Bedingung wurde nicht innerhalb von ${timeoutMs} ms erfüllt.`);
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-services-"));
});

describe("process lifecycle", () => {
  it("terminates timed-out subprocess trees instead of leaving background tools alive", async () => {
    await expect(spawnCapture(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 150, rejectOnError: true },
    )).rejects.toThrow(/150 ms beendet/);
  });

  it("asks every used Gradle launcher to stop its daemons during shutdown", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "gradle-shutdown-"));
    const marker = path.join(root, "stopped.txt");
    const launcher = path.join(root, process.platform === "win32" ? "gradlew.cmd" : "gradlew");
    if (process.platform === "win32") {
      fs.writeFileSync(launcher, `@echo off\r\nif "%~1"=="--stop" echo stopped>"${marker}"\r\n`);
    } else {
      fs.writeFileSync(launcher, `#!/bin/sh\n[ "$1" = "--stop" ] && printf stopped > "${marker}"\n`);
      fs.chmodSync(launcher, 0o755);
    }
    const service = new BuildService({}, {}, {}, {}, () => {});
    service.gradleLaunchers.set(launcher, root);
    await service.shutdown();
    expect(fs.readFileSync(marker, "utf8").trim()).toBe("stopped");
  });
});

afterAll(() => {
  if (fixtureRoot && path.resolve(fixtureRoot).startsWith(path.resolve(os.tmpdir()))) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("IPC path protection", () => {
  it("accepts project files and rejects traversal outside the registered root", () => {
    const guard = new PathGuard();
    const root = fs.mkdtempSync(path.join(fixtureRoot, "guard-"));
    guard.register(root);
    expect(guard.assertAllowed(path.join(root, "src", "Main.java"))).toBe(path.join(root, "src", "Main.java"));
    expect(() => guard.assertAllowed(path.join(root, "..", "secret.txt"), root)).toThrow(/außerhalb/);
  });

  it("reports file-system failures in German instead of Node's syscall text", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "fs-errors-"));
    fs.writeFileSync(path.join(root, "Vorhanden.java"), "class Vorhanden {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {});
    await expect(service.readFile(path.join(root, "Fehlt.java")))
      .rejects.toThrow("„Fehlt.java“ wurde nicht gefunden.");
    await expect(service.readFile(root)).rejects.toThrow(/ist ein Ordner, keine Datei\.$/);
    await expect(service.create(root, "Vorhanden.java", false))
      .rejects.toThrow("„Vorhanden.java“ gibt es bereits.");
    // The Java branch reads the source before it moves anything, so this one
    // fails earlier than the move itself.
    await expect(service.rename(path.join(root, "Fehlt.java"), "Neu.java"))
      .rejects.toThrow("„Fehlt.java“ wurde nicht gefunden.");
  });

  it("keeps an unexplained file-system error instead of inventing a cause", () => {
    const unknown = Object.assign(new Error("boom"), { code: "EWEIRD" });
    expect(describeFileSystemError(unknown, path.join("C:", "x", "y.java"))).toBe(unknown);
    const guessed = Object.assign(new Error("x"), { code: "EACCES" });
    expect(describeFileSystemError(guessed, path.join("C:", "x", "Gesperrt.java")).message)
      .toBe("Kein Zugriff auf „Gesperrt.java“.");
    const named = Object.assign(new Error("x"), { code: "ENOENT", path: path.join("C:", "x", "Fehlt.java") });
    expect(describeFileSystemError(named).message).toBe("„Fehlt.java“ wurde nicht gefunden.");
  });

  it("ignores nested build and cache paths in the workspace watcher", () => {
    const service = new WorkspaceService(
      {},
      {},
      () => {},
      {
        get: () => ({
          explorerHideBuild: true,
          explorerHideGenerated: true,
          explorerExcludedPatterns: ["vendor-cache"],
        }),
      },
    );
    expect(service.isIgnoredWatchPath(path.join("module-a", "build", "classes", "Main.class"))).toBe(true);
    expect(service.isIgnoredWatchPath(path.join("module-b", "target", "surefire-reports", "TEST.xml"))).toBe(true);
    expect(service.isIgnoredWatchPath(path.join("src", "generated-sources", "Generated.java"))).toBe(true);
    expect(service.isIgnoredWatchPath(path.join("tools", "vendor-cache", "index.bin"))).toBe(true);
    expect(service.isIgnoredWatchPath(path.join("src", "main", "java", "Main.java"))).toBe(false);
  });

  it("hides dot-directories but keeps project dot-files visible", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hidden-tree-"));
    fs.mkdirSync(path.join(root, ".cache", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cache", "nested", "index.bin"), "cache");
    fs.writeFileSync(path.join(root, ".gitignore"), "build/\n");
    fs.writeFileSync(path.join(root, ".classpath"), "<classpath />\n");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {}, {
      get: () => ({
        explorerHideBuild: false,
        explorerHideDotDirectories: true,
        explorerHideGenerated: true,
        explorerExcludedPatterns: [],
      }),
    });
    const names = (await service.readTree(root)).map((node: any) => node.name);
    expect(names).toContain(".gitignore");
    expect(names).toContain(".classpath");
    expect(names).toContain("src");
    expect(names).not.toContain(".cache");
    expect(service.isIgnoredWatchPath(path.join(".cache", "nested", "index.bin"), root)).toBe(true);
    expect(service.isIgnoredWatchPath(".classpath", root)).toBe(false);
  });

  it("shows Maven target as build and sorts build outputs before other project entries", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "build-alias-tree-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "target"));
    fs.writeFileSync(path.join(root, "pom.xml"), "<project />\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {}, {
      get: () => ({
        explorerHideBuild: false,
        explorerHideDotDirectories: true,
        explorerHideGenerated: true,
        explorerExcludedPatterns: [],
      }),
    });

    const tree = await service.readTree(root);
    expect(tree[0]).toMatchObject({
      name: "target",
      displayName: "build",
      path: path.join(root, "target"),
      type: "directory",
    });
  });
});

describe("workbench settings", () => {
  it("persists visual, completion, Explorer and run preferences while rejecting unknown fields", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "settings-"));
    const service = new SettingsService(userData);
    await service.load();
    const saved = await service.update({
      theme: "kiwi-light",
      uiScale: 1.25,
      uiDensity: "comfortable",
      completionDelay: 90,
      completionShowSnippets: false,
      explorerView: "packages",
      explorerHideGenerated: false,
      breakOnExceptions: "all",
      hotSwapOnSave: false,
      toolbarActions: ["run", "debug", "stop", "search"],
      backgroundImage: "C:\\Pictures\\kiwi.png",
      backgroundOpacity: 42,
      unsupportedSetting: "ignored",
    });
    expect(saved).toMatchObject({
      theme: "kiwi-light",
      uiScale: 1.25,
      uiDensity: "comfortable",
      completionDelay: 90,
      completionShowSnippets: false,
      explorerView: "packages",
      explorerHideGenerated: false,
      breakOnExceptions: "all",
      hotSwapOnSave: false,
      backgroundImage: "C:\\Pictures\\kiwi.png",
      backgroundOpacity: 42,
    });
    expect(saved).not.toHaveProperty("unsupportedSetting");

    const reloaded = new SettingsService(userData);
    await reloaded.load();
    expect(reloaded.get().toolbarActions).toEqual(["run", "debug", "stop", "search"]);
    expect(reloaded.get().uiScale).toBe(1.25);
    expect(reloaded.get().hotSwapOnSave).toBe(false);
  });

  it("migrates legacy settings, merges keybindings and keeps projects during reset", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "settings-migration-"));
    fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({
      theme: "dark",
      compactMode: false,
      customKeybindings: { commandPalette: "Alt+P" },
      recentProjects: ["C:\\Projects\\Kiwi"],
      lastWorkspace: "C:\\Projects\\Kiwi",
      unknownLegacyValue: true,
    }));
    const service = new SettingsService(userData);
    const migrated = await service.load();
    expect(migrated).toMatchObject({
      schemaVersion: CURRENT_SETTINGS_VERSION,
      theme: "kiwi-new-dark",
      uiDensity: "normal",
      explorerHideBuild: false,
      explorerHideDotDirectories: true,
      workspaceHistoryMigrated: false,
      customKeybindings: {
        commandPalette: "Alt+P",
        searchEverywhere: "Ctrl+P",
      },
    });
    expect(migrated).not.toHaveProperty("unknownLegacyValue");
    const persisted = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8"));
    expect(persisted.schemaVersion).toBe(CURRENT_SETTINGS_VERSION);
    expect(migrated.customKeybindings).toMatchObject({
      commandPalette: "Alt+P",
      quickFix: "Alt+Enter",
      generate: "Alt+Insert",
      explorerCut: "Ctrl+X",
    });
    await service.update({ theme: "kiwi-light", fontSize: 19 });
    const reset = await service.reset();
    expect(reset.theme).toBe("kiwi-new-dark");
    expect(reset.fontSize).toBe(14);
    expect(reset.recentProjects).toEqual(["C:\\Projects\\Kiwi"]);
    expect(reset.lastWorkspace).toBe("C:\\Projects\\Kiwi");
  });

  it("keeps editor colours theme-independent and drops the old theme-scoped keys", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "settings-token-colors-"));
    const service = new SettingsService(userData);
    await service.load();
    const saved = await service.update({
      editorTokenColors: {
        keyword: "#ff8800",
        string: "00FF00",
        "javaKeyword:class": "ff44aa",
        // Written by the version that scoped colours per theme, plus a value
        // Monaco would reject; neither may survive.
        "kiwi-dark.keyword": "112233",
        comment: "not-a-colour",
      },
    });
    expect(saved.editorTokenColors).toEqual({ keyword: "FF8800", string: "00FF00", "javaKeyword:class": "FF44AA" });

    const reloaded = new SettingsService(userData);
    await reloaded.load();
    expect(reloaded.get().editorTokenColors).toEqual({ keyword: "FF8800", string: "00FF00", "javaKeyword:class": "FF44AA" });
  });

  it("sanitizes and persists advanced theme adjustments", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "settings-theme-adjustment-"));
    const service = new SettingsService(userData);
    await service.load();
    const saved = await service.update({
      themeContrast: 99,
      accentIntensity: -5,
      themeColorOverrides: {
        panelBackground: "#123456",
        editorCursor: "abcdef",
        unknownSurface: "FFFFFF",
        danger: "not-a-colour",
      },
    });
    expect(saved.themeContrast).toBe(30);
    expect(saved.accentIntensity).toBe(0);
    expect(saved.themeColorOverrides).toEqual({ panelBackground: "123456", editorCursor: "ABCDEF" });
    const reloaded = new SettingsService(userData);
    await reloaded.load();
    expect(reloaded.get().themeColorOverrides).toEqual(saved.themeColorOverrides);
  });
});

describe("safe update checks", () => {
  it("writes every byte even when the filesystem reports partial writes", async () => {
    const writes: Array<{ offset: number; length: number }> = [];
    const handle = {
      write: async (_buffer: Buffer, offset: number, length: number) => {
        writes.push({ offset, length });
        return { bytesWritten: Math.min(2, length) };
      },
    };
    await expect(writeAll(handle, Buffer.from("abcdef"))).resolves.toEqual(Buffer.from("abcdef"));
    expect(writes).toEqual([
      { offset: 0, length: 6 },
      { offset: 2, length: 4 },
      { offset: 4, length: 2 },
    ]);
    await expect(writeAll({ write: async () => ({ bytesWritten: 0 }) }, Buffer.from("x")))
      .rejects.toThrow(/vollständig/);
  });

  it("uses a silent NSIS update that relaunches Kiwi automatically", () => {
    expect(nsisUpdateArguments("win32")).toEqual(["/S", "--updated", "--force-run"]);
    // A fresh array prevents a caller from mutating the arguments used by a
    // later installation.
    const modified = nsisUpdateArguments("win32");
    modified.pop();
    expect(nsisUpdateArguments("win32")).toEqual(["/S", "--updated", "--force-run"]);
    expect(() => nsisUpdateArguments("linux")).toThrow(/Windows/);
  });

  it("prefers the renderer bundle that fits this exact main process", () => {
    const artifacts = {
      setup: { filename: "Kiwi-IDE-1.1.0-setup.exe", url: "https://d.example.test/setup", sha256: "a".repeat(64), bytes: 10 },
      portable: { filename: "Kiwi-IDE-1.1.0-portable.exe", url: "https://d.example.test/portable", sha256: "b".repeat(64), bytes: 11 },
      renderer: { filename: "Kiwi-IDE-1.1.0-renderer.kiwi", url: "https://d.example.test/renderer", sha256: "c".repeat(64), bytes: 12, mainHash: "d".repeat(64) },
    };
    // The bundle only wins when it was built against the running main process;
    // otherwise the client must take the installer for its own runtime.
    expect(selectArtifactKind(artifacts, "setup", "d".repeat(64))).toBe("renderer");
    expect(selectArtifactKind(artifacts, "portable", "d".repeat(64))).toBe("renderer");
    expect(selectArtifactKind(artifacts, "portable", "e".repeat(64))).toBe("portable");
    expect(selectArtifactKind(artifacts, "setup", "")).toBe("setup");
    expect(selectArtifactKind({ setup: artifacts.setup }, "setup", "d".repeat(64))).toBe("setup");

    const manifest = { schemaVersion: 3, channel: "stable", version: "1.1.0", artifacts };
    expect(validateManifest(manifest, "stable", "setup", "d".repeat(64))).toMatchObject({
      artifactKind: "renderer",
      filename: "Kiwi-IDE-1.1.0-renderer.kiwi",
      mainHash: "d".repeat(64),
      bytes: 12,
    });
    expect(validateManifest(manifest, "stable", "setup", "e".repeat(64))).toMatchObject({
      artifactKind: "setup",
      mainHash: "",
    });
    // A bundle published under a name that is not the release's own must not
    // be downloaded, even when its fingerprint matches.
    const wrongName = { ...manifest, artifacts: { ...artifacts, renderer: { ...artifacts.renderer, filename: "other.kiwi" } } };
    expect(() => validateManifest(wrongName, "stable", "setup", "d".repeat(64))).toThrow(/Renderer-Dateinamen/);
  });

  it("accepts a session flush only from every requested renderer", () => {
    const initial = createUpdatePrepareState([17, 4, 17, -1, Number.NaN], "prepare-1");
    expect(initial).toMatchObject({
      requestId: "prepare-1",
      pending: [17, 4],
      acknowledged: [],
      failures: [],
    });
    expect(updatePrepareComplete(initial)).toBe(false);

    // Wrong request ids and renderers outside the target set are ignored.
    expect(acknowledgeUpdatePrepare(initial, 17, { requestId: "stale", ok: true })).toBe(initial);
    expect(acknowledgeUpdatePrepare(initial, 99, { requestId: "prepare-1", ok: true })).toBe(initial);

    const oneReady = acknowledgeUpdatePrepare(initial, 17, { requestId: "prepare-1", ok: true });
    expect(oneReady.pending).toEqual([4]);
    expect(updatePrepareComplete(oneReady)).toBe(false);
    const completed = acknowledgeUpdatePrepare(oneReady, 4, {
      requestId: "prepare-1",
      ok: false,
      reason: "Entwurf konnte nicht gespeichert werden.",
    });
    expect(updatePrepareComplete(completed)).toBe(true);
    expect(completed.acknowledged).toEqual([17, 4]);
    expect(completed.failures).toEqual([{ id: 4, reason: "Entwurf konnte nicht gespeichert werden." }]);
  });

  it("validates HTTPS manifests and reports newer semantic versions", async () => {
    const settings = {
      get: () => ({
        updateManifestUrl: "https://updates.example.test/kiwi.json",
        updateChannel: "beta",
      }),
    };
    let requested = "";
    const service = new UpdateService(settings, "0.3.0", "", async (url: URL) => {
      requested = url.toString();
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 2,
          channel: "beta",
          version: "0.4.0",
          url: "https://downloads.example.test/Kiwi.exe",
          sha256: "a".repeat(64),
          bytes: 42,
          releaseNotes: "Neue Java-Funktionen",
        }),
      };
    }, { githubReleases: true });
    await expect(service.check()).resolves.toMatchObject({
      configured: true,
      available: true,
      version: "0.4.0",
      sha256: "a".repeat(64),
    });
    expect(requested).toBe("https://updates.example.test/kiwi.json?channel=beta");
    expect(compareVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(() => assertUpdateDownloadUrl("http://downloads.example.test/Kiwi.exe")).toThrow(/HTTPS/);
  });

  it("downloads updates atomically and rejects a mismatching checksum", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "updates-"));
    const bytes = Buffer.from("signed installer fixture");
    const sha256 = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    let manifestHash = sha256;
    const service = new UpdateService({ get: () => ({
      updateManifestUrl: "https://updates.example.test/latest.json",
      updateChannel: "stable",
    }) }, "0.3.0", userData, async (url: URL | string) => new URL(String(url)).pathname.endsWith("latest.json") ? ({
      ok: true,
      json: async () => ({
        schemaVersion: 2,
        channel: "stable",
        version: "0.4.0",
        url: "https://downloads.example.test/Kiwi-IDE-0.4.0-setup.exe",
        sha256: manifestHash,
        bytes: bytes.length,
      }),
    }) : ({
      ok: true,
      arrayBuffer: async () => bytes,
    }));
    const approved = await service.check();
    const downloaded = await service.download(approved);
    expect(fs.readFileSync(downloaded.path)).toEqual(bytes);
    await expect(service.download({ ...approved, downloadUrl: "https://attacker.example.test/Kiwi.exe" }))
      .rejects.toThrow(/verändert/);

    manifestHash = "0".repeat(64);
    const mismatching = await service.check();
    await expect(service.download(mismatching)).rejects.toThrow(/Prüfsumme/);
  });

  it.each([
    ["win32", "x64", "", "setup.exe", "setup"],
    ["win32", "x64", "Kiwi.exe", "portable.exe", "portable"],
    ["linux", "x64", "", "x86_64.AppImage", "appimage"],
    ["linux", "arm64", "", "arm64.AppImage", "appimage"],
    ["darwin", "x64", "", "x64.dmg", "dmg"],
    ["darwin", "arm64", "", "arm64.dmg", "dmg"],
  ])("chooses the verified GitHub package for %s %s (%s)", async (platform, arch, portableExecutableFile, suffix, kind) => {
    const asset = (version: string) => ({
      name: `Kiwi-IDE-${version}-${suffix}`,
      state: "uploaded",
      digest: `sha256:${"a".repeat(64)}`,
      size: 100,
      browser_download_url: "https://untrusted.example.test/update",
    });
    const service = new UpdateService({ get: () => ({ updateChannel: "stable" }) }, "1.0.0", "", async (url: URL) => {
      expect(url.origin + url.pathname).toBe("https://api.github.com/repos/KIWI-IDE/KiwiIDE/releases");
      return {
        ok: true,
        json: async () => [
          { tag_name: "v2.0.0-beta.1", prerelease: true, assets: [asset("2.0.0-beta.1")] },
          { tag_name: "v2.0.0", draft: true, assets: [asset("2.0.0")] },
          { tag_name: "v1.3.0", assets: [{ ...asset("1.3.0"), digest: null }] },
          { tag_name: "v1.1.0", assets: [asset("1.1.0")] },
          { tag_name: "v1.2.0", assets: [asset("1.2.0")] },
        ],
      };
    }, { platform, arch, portableExecutableFile, githubReleases: true, manifestUpdates: false });
    await expect(service.check()).resolves.toMatchObject({
      available: true,
      source: "github",
      version: "1.2.0",
      artifactKind: kind,
      downloadUrl: `https://github.com/KIWI-IDE/KiwiIDE/releases/download/v1.2.0/Kiwi-IDE-1.2.0-${suffix}`,
      sha256: "a".repeat(64),
    });
  });

  it("downloads a GitHub prerelease only when the update channel permits it", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "github-update-"));
    const bytes = Buffer.from("GitHub DMG fixture");
    const sha256 = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    let updateChannel = "stable";
    let finalUrl = "https://release-assets.githubusercontent.com/asset";
    const service = new UpdateService({ get: () => ({ updateChannel }) }, "1.0.0", userData,
      async (url: URL | string) => new URL(String(url)).hostname === "api.github.com" ? ({
        ok: true,
        json: async () => [{
          tag_name: "v1.1.0-beta.1",
          prerelease: true,
          assets: [{
            name: "Kiwi-IDE-1.1.0-beta.1-arm64.dmg",
            state: "uploaded",
            digest: `sha256:${sha256}`,
            size: bytes.length,
          }],
        }],
      }) : ({ ok: true, url: finalUrl, arrayBuffer: async () => bytes }),
      { platform: "darwin", arch: "arm64", githubReleases: true, manifestUpdates: false });
    await expect(service.check()).resolves.toMatchObject({ available: false });
    updateChannel = "beta";
    const approved = await service.check();
    expect(approved).toMatchObject({ available: true, version: "1.1.0-beta.1" });
    await expect(service.download({ ...approved, artifactKind: "setup" })).rejects.toThrow(/verändert/);
    finalUrl = "https://untrusted.example.test/asset";
    await expect(service.download(approved)).rejects.toThrow(/außerhalb von GitHub/);
    finalUrl = "https://release-assets.githubusercontent.com/asset";
    const downloaded = await service.download(approved);
    expect(downloaded.path).toMatch(/\.dmg$/);
    expect(fs.readFileSync(downloaded.path)).toEqual(bytes);
  });
});

describe("multi-root workspace state", () => {
  it("persists, activates, pins and removes independent project roots", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "workspace-state-"));
    const first = fs.mkdtempSync(path.join(fixtureRoot, "root-a-"));
    const second = fs.mkdtempSync(path.join(fixtureRoot, "root-b-"));
    const remembered: string[] = [];
    const settings = {
      get: () => ({ lastWorkspace: "", recentProjects: [] }),
      rememberWorkspace: async (root: string) => { remembered.push(root); },
    };
    const service = new WorkspaceStateService(userData, settings);
    await service.load();
    await service.add([first, second], true);
    expect(service.snapshot()).toMatchObject({ activeRoot: second });
    await service.activate(first);
    await service.setPinned(first, true);
    expect(service.snapshot().projects.find((project: any) => project.root === first).pinned).toBe(true);
    await service.remove(first);
    expect(service.snapshot()).toMatchObject({ activeRoot: second });
    expect(remembered).toContain(first);
  });

  it("saves and restores named workspaces without losing the profile", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "workspace-profile-"));
    const first = fs.mkdtempSync(path.join(fixtureRoot, "profile-a-"));
    const second = fs.mkdtempSync(path.join(fixtureRoot, "profile-b-"));
    const settings = {
      get: () => ({ lastWorkspace: "", recentProjects: [] }),
      rememberWorkspace: async () => {},
      forgetWorkspace: async () => {},
    };
    const service = new WorkspaceStateService(userData, settings);
    await service.load();
    await service.add([first, second], true);
    const saved = await service.saveProfile("Backend");
    const profile = saved.profiles[0];
    await service.closeAll();
    expect(service.snapshot().projects).toHaveLength(0);
    expect(service.snapshot().resumableProjects).toHaveLength(2);
    await service.setPinned(first, true);
    expect(service.snapshot().resumableProjects.find((project: any) => project.root === first).pinned).toBe(true);
    await service.remove(first);
    expect(service.snapshot().resumableProjects.map((project: any) => project.root)).toEqual([second]);
    const restored = await service.openProfile(profile.id);
    expect(restored.projects.map((project: any) => project.root)).toEqual([first, second]);
    expect(restored.profiles[0].name).toBe("Backend");
  });

  it("recovers legacy renderer projects once without opening one", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "workspace-recovery-"));
    const first = fs.mkdtempSync(path.join(fixtureRoot, "legacy-root-a-"));
    const missing = path.join(fixtureRoot, "legacy-root-missing");
    const settingsState: Record<string, any> = {
      lastWorkspace: "",
      recentProjects: [],
      workspaceHistoryMigrated: false,
    };
    const settings = {
      get: () => structuredClone(settingsState),
      update: async (patch: Record<string, any>) => Object.assign(settingsState, patch),
      rememberWorkspace: async () => {},
      forgetWorkspace: async () => {},
    };
    const service = new WorkspaceStateService(userData, settings);
    await service.load();
    const recovered = await service.recoverRecent([first, missing, first]);
    expect(recovered.activeRoot).toBeNull();
    expect(recovered.projects).toHaveLength(0);
    expect(recovered.resumableProjects.map((project: any) => project.root)).toEqual([first, missing]);
    expect(recovered.resumableProjects.find((project: any) => project.root === first).exists).toBe(true);
    expect(recovered.resumableProjects.find((project: any) => project.root === missing).exists).toBe(false);
    expect(settingsState.workspaceHistoryMigrated).toBe(true);
    expect(settingsState.recentProjects).toEqual([first, missing]);

    const ignored = fs.mkdtempSync(path.join(fixtureRoot, "legacy-root-ignored-"));
    await service.recoverRecent([ignored]);
    expect(service.snapshot().resumableProjects.some((project: any) => project.root === ignored)).toBe(false);
  });
});

describe("workflow state", () => {
  it("persists recents, favorites, bookmarks, terminal tasks and scratch files per project", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "workflow-"));
    const source = path.join(root, "Main.java");
    fs.writeFileSync(source, "class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkflowService(guard);
    await service.rememberFile(root, source);
    await service.update(root, {
      favorites: [source],
      bookmarks: [{ path: source, line: 1, label: "Main" }],
      terminalTasks: [{ name: "Tests", command: "mvn test" }],
    });
    const scratch = await service.createScratch(root, "TryApi");
    const state = await service.get(root);
    expect(state.recentFiles[0]).toBe(scratch);
    expect(state.recentFiles).toContain(source);
    expect(state.favorites).toEqual([source]);
    expect(state.bookmarks[0]).toMatchObject({ path: source, line: 1 });
    expect(state.terminalTasks[0]).toMatchObject({ name: "Tests", command: "mvn test" });
    expect(fs.readFileSync(scratch, "utf8")).toContain("static void main");
  });
});

describe("LSP framing", () => {
  it("round-trips a JSON-RPC message through Content-Length framing", async () => {
    const stream = new PassThrough();
    const reader = new StreamMessageReader(stream);
    const writer = new StreamMessageWriter(stream);
    const received = new Promise<any>((resolve) => reader.listen(resolve));
    await writer.write({ jsonrpc: "2.0", id: 7, method: "initialize", params: { rootUri: "file:///project" } });
    await expect(received).resolves.toMatchObject({ id: 7, method: "initialize" });
    reader.dispose();
    writer.dispose();
  });
});

describe("Java project model and dependency classpath", () => {
  it("infers package source roots and includes local JAR libraries", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "java-model-"));
    const mainRoot = path.join(root, "src", "main", "java");
    const testRoot = path.join(root, "src", "test", "java");
    const packageDirectory = path.join(mainRoot, "dev", "kiwi");
    const testPackageDirectory = path.join(testRoot, "dev", "kiwi");
    const library = path.join(root, "libs", "kiwi-api.jar");
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.mkdirSync(testPackageDirectory, { recursive: true });
    fs.mkdirSync(path.dirname(library), { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, "App.java"), "package dev.kiwi;\nclass App {}\n");
    fs.writeFileSync(path.join(testPackageDirectory, "AppTest.java"), "package dev.kiwi;\nclass AppTest {}\n");
    fs.writeFileSync(library, "test jar fixture");

    expect(await inferSourceRoots(root, [
      path.join(packageDirectory, "App.java"),
      path.join(testPackageDirectory, "AppTest.java"),
    ])).toEqual(expect.arrayContaining([mainRoot, testRoot]));

    const model = await discoverJavaProjectModel(root);
    expect(model).toMatchObject({
      buildSystem: "Java",
      managedByBuildTool: false,
      sourcePaths: expect.arrayContaining(["src/main/java", "src/test/java"]),
      referencedLibraries: ["libs/kiwi-api.jar"],
    });
    expect(model.sourcePaths).not.toContain("src");
  });

  it("lets Maven and Gradle own their source classpath while enabling dependency imports", async () => {
    const projectJdk = { path: "C:\\Java\\jdk-21", major: 21 };
    const plainModel = {
      outputPath: ".kiwi/jdt-out",
      managedByBuildTool: false,
      sourcePaths: ["src/main/java"],
      referencedLibraries: ["libs/local.jar"],
    };
    const plain = createJavaSettings({
      projectSettings: { languageLevel: "17" },
      projectModel: plainModel,
      projectJdk,
      toolchainRoot: path.join(fixtureRoot, "toolchain"),
    });
    expect(plain.project.sourcePaths).toEqual(["src/main/java"]);
    expect(plain.project.referencedLibraries).toEqual(["libs/local.jar"]);
    expect(plain.configuration.runtimes[0].name).toBe("JavaSE-21");
    expect(plain.import.maven.enabled).toBe(true);
    expect(plain.import.gradle.enabled).toBe(true);
    expect(plain.configuration.updateBuildConfiguration).toBe("automatic");

    const managed = createJavaSettings({
      projectSettings: {},
      projectModel: { ...plainModel, managedByBuildTool: true },
      projectJdk,
      toolchainRoot: path.join(fixtureRoot, "toolchain"),
    });
    expect(managed.project).not.toHaveProperty("sourcePaths");
    expect(managed.project).not.toHaveProperty("outputPath");
    expect(managed.project).not.toHaveProperty("referencedLibraries");
    expect(managed.project.resourceFilters).not.toContain("target");
    expect(managed.project.resourceFilters).not.toContain("build");
  });

  it("recognizes every file that can change the Java classpath", () => {
    for (const file of [
      "C:\\project\\pom.xml",
      "C:\\project\\build.gradle.kts",
      "C:\\project\\settings.gradle",
      "C:\\project\\libs\\api.jar",
      "C:\\project\\.kiwi\\modules.json",
    ]) {
      expect(isClasspathFile(file)).toBe(true);
    }
    expect(isClasspathFile("C:\\project\\src\\Main.java")).toBe(false);
  });

  it("stores persistent Java index metadata atomically for faster restarts", async () => {
    const dataPath = fs.mkdtempSync(path.join(fixtureRoot, "jdt-index-"));
    const session = new LanguageSession({}, {}, "", dataPath, () => {});
    session.dataPath = dataPath;
    const index = {
      detail: "12 Java-Dateien · 4 Abhängigkeiten",
      modules: [{ id: "core", indexed: true }],
      persistent: true,
      updatedAt: new Date().toISOString(),
    };
    await session.persistIndex(index);
    expect(JSON.parse(fs.readFileSync(path.join(dataPath, "kiwi-index.json"), "utf8"))).toEqual({
      ...index,
      workspaceSchemaVersion: LANGUAGE_WORKSPACE_SCHEMA_VERSION,
    });
    expect(fs.existsSync(path.join(dataPath, "kiwi-index.json.tmp"))).toBe(false);
  });

  it("rotates an incompatible JDT workspace before starting a new language server", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "jdt-workspace-migration-"));
    const dataPath = path.join(userData, "jdtls-workspaces", "project-hash");
    const backupRoot = path.join(userData, "jdtls-workspace-backups");
    fs.mkdirSync(path.join(dataPath, ".metadata"), { recursive: true });
    fs.writeFileSync(path.join(dataPath, ".metadata", ".log"), "Missing system library");
    fs.writeFileSync(path.join(dataPath, "kiwi-index.json"), JSON.stringify({ workspaceSchemaVersion: 1 }));

    const result = await prepareLanguageWorkspace(dataPath, backupRoot, "project-hash");
    expect(result.migrated).toBe(true);
    expect(result.cachedIndex).toBeNull();
    expect(fs.existsSync(dataPath)).toBe(true);
    expect(fs.existsSync(path.join(dataPath, ".metadata", ".log"))).toBe(false);
    expect(fs.readFileSync(path.join(result.backupPath, ".metadata", ".log"), "utf8")).toContain("Missing system library");
  });

  it("keeps a healthy JDT workspace when only the optional summary index is missing or truncated", async () => {
    for (const summary of [null, "{truncated"]) {
      const userData = fs.mkdtempSync(path.join(fixtureRoot, "jdt-summary-recovery-"));
      const dataPath = path.join(userData, "jdtls-workspaces", "project-hash");
      const backupRoot = path.join(userData, "jdtls-workspace-backups");
      fs.mkdirSync(path.join(dataPath, ".metadata"), { recursive: true });
      fs.writeFileSync(path.join(dataPath, ".metadata", ".log"), "healthy workspace");
      if (summary !== null) fs.writeFileSync(path.join(dataPath, "kiwi-index.json"), summary);

      const result = await prepareLanguageWorkspace(dataPath, backupRoot, "project-hash");
      expect(result.migrated).toBe(false);
      expect(result.cachedIndex).toBeNull();
      expect(fs.readFileSync(path.join(dataPath, ".metadata", ".log"), "utf8")).toContain("healthy workspace");
      expect(fs.existsSync(backupRoot)).toBe(false);
    }
  });

  it("serializes classpath query options for the bundled JDT LS command API", async () => {
    const dataPath = fs.mkdtempSync(path.join(fixtureRoot, "jdt-classpath-command-"));
    const session = new LanguageSession({}, {}, "", dataPath, () => {});
    session.root = fixtureRoot;
    session.projectModel = { javaFiles: [path.join(fixtureRoot, "Main.java")] };
    let request: any;
    session.connection = {
      sendRequest: async (_method: string, params: any) => {
        request = params;
        return { classpaths: [], modulepaths: [] };
      },
    };
    await session.inspectClasspath();
    expect(request.command).toBe("java.project.getClasspaths");
    expect(JSON.parse(request.arguments[1])).toEqual({ scope: "runtime" });
  });

  it("does not send duplicate JDT document changes for identical editor buffers", async () => {
    const notifications: Array<{ method: string; params: any }> = [];
    const session = new LanguageSession(
      { assertAllowed: () => true },
      {},
      "",
      fixtureRoot,
      () => {},
    );
    session.ready = true;
    session.root = fixtureRoot;
    session.connection = {
      sendNotification: (method: string, params: any) => notifications.push({ method, params }),
    };
    const file = path.join(fixtureRoot, "Idempotent.java");
    await session.open(fixtureRoot, file, "class Idempotent {}", "java");
    await session.open(fixtureRoot, file, "class Idempotent {}", "java");
    await session.change(fixtureRoot, file, "class Idempotent {}");
    await session.change(fixtureRoot, file, "class Idempotent { int value; }");

    expect(notifications.map((item) => item.method)).toEqual([
      "textDocument/didOpen",
      "textDocument/didChange",
    ]);
    expect(notifications[1].params.textDocument.version).toBe(2);
  });

  it("ignores a late refresh when the JDT connection was disposed during a settings restart", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-refresh-race-"));
    const file = path.join(root, "Main.java");
    fs.writeFileSync(file, "class Main {}\n");
    const session = new LanguageSession(
      {
        assertWorkspace: (value: string) => value,
        assertAllowed: (value: string) => value,
      },
      {},
      "",
      root,
      () => {},
    );
    session.ready = true;
    session.root = root;
    session.projectModel = { managedByBuildTool: true, javaFiles: [file] };
    session.connection = {
      sendNotification: () => {
        throw new Error("Connection is disposed.");
      },
    };

    await expect(session.refresh(root, file)).resolves.toBe(false);
  });

  it("adds a new Java file below an indexed source root without restarting JDT", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-source-create-"));
    const sourceRoot = path.join(root, "src");
    const existing = path.join(sourceRoot, "Existing.java");
    const created = path.join(sourceRoot, "Created.java");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(existing, "class Existing {}\n");
    fs.writeFileSync(created, "class Created {}\n");
    const notifications: Array<{ method: string; params: any }> = [];
    const session = new LanguageSession(
      {
        assertWorkspace: (value: string) => value,
        assertAllowed: (value: string) => value,
      },
      {},
      "",
      root,
      () => {},
    );
    session.ready = true;
    session.root = root;
    session.projectModel = {
      managedByBuildTool: false,
      sourcePaths: ["src"],
      javaFiles: [existing],
    };
    session.connection = {
      sendNotification: (method: string, params: any) => notifications.push({ method, params }),
    };
    let restarts = 0;
    session.stop = async () => { restarts += 1; };
    session.start = async () => { restarts += 1; return { available: true }; };

    await expect(session.refresh(root, created)).resolves.toBe(true);
    expect(restarts).toBe(0);
    expect(notifications).toEqual([{
      method: "workspace/didChangeWatchedFiles",
      params: {
        changes: [{ uri: expect.stringMatching(/Created\.java$/), type: 1 }],
      },
    }]);
    expect(session.projectModel.javaFiles).toContain(path.resolve(created));
  });

  it("does not restart JDT for a new sibling in a mixed nested source layout", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-mixed-source-create-"));
    const sourceRoot = path.join(root, "src");
    const specificRoot = path.join(sourceRoot, "main", "java");
    const existing = path.join(sourceRoot, "Existing.java");
    const created = path.join(sourceRoot, "Created.java");
    fs.mkdirSync(specificRoot, { recursive: true });
    fs.writeFileSync(existing, "class Existing {}\n");
    fs.writeFileSync(created, "class Created {}\n");
    const notifications: Array<{ method: string; params: any }> = [];
    const session = new LanguageSession(
      {
        assertWorkspace: (value: string) => value,
        assertAllowed: (value: string) => value,
      },
      {},
      "",
      root,
      () => {},
    );
    session.ready = true;
    session.root = root;
    session.projectModel = {
      managedByBuildTool: false,
      // Source-root minimisation keeps the specific nested root, while the
      // trigger-file list still proves that `src` already belongs to JDT.
      sourcePaths: ["src/main/java"],
      javaFiles: [existing],
    };
    session.connection = {
      sendNotification: (method: string, params: any) => notifications.push({ method, params }),
    };
    let restarts = 0;
    session.stop = async () => { restarts += 1; };
    session.start = async () => { restarts += 1; return { available: true }; };

    await expect(session.refresh(root, created)).resolves.toBe(true);
    expect(restarts).toBe(0);
    expect(notifications[0]).toMatchObject({
      method: "workspace/didChangeWatchedFiles",
      params: { changes: [{ type: 1 }] },
    });
  });

  it("coalesces a real new-source-root restart and retries a disposed language request", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-source-root-restart-"));
    const sourceRoot = path.join(root, "src");
    const generated = path.join(root, "generated", "Generated.java");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "Main.java"), "class Main {}\n");
    fs.writeFileSync(generated, "class Generated {}\n");
    const session = new LanguageSession(
      {
        assertWorkspace: (value: string) => value,
        assertAllowed: (value: string) => value,
      },
      {},
      "",
      root,
      () => {},
    );
    session.ready = true;
    session.root = root;
    session.projectModel = {
      managedByBuildTool: false,
      sourcePaths: ["src"],
      javaFiles: [path.join(sourceRoot, "Main.java")],
    };
    let releaseRestart: (available: boolean) => void = () => {};
    let rejectPendingRequest: (error: Error) => void = () => {};
    let stopCalls = 0;
    let startCalls = 0;
    session.stop = async () => {
      stopCalls += 1;
      // Mirrors stopInternal: callers immediately observe an unavailable
      // session even though the process shutdown itself is still pending.
      session.ready = false;
      session.connection = null;
      await new Promise<boolean>((resolve) => { releaseRestart = resolve; });
      return true;
    };
    const replacementConnection = {
      sendRequest: async () => ({ contents: "replayed" }),
    };
    session.start = async () => {
      startCalls += 1;
      session.ready = true;
      session.root = root;
      session.connection = replacementConnection;
      return { available: true };
    };
    session.connection = {
      sendNotification: () => undefined,
      sendRequest: () => new Promise((_resolve, reject) => { rejectPendingRequest = reject; }),
    };

    // Start the request on the old connection first. The restart then disposes
    // that exact in-flight request, just like vscode-jsonrpc does in production.
    const request = session.request(root, "textDocument/hover", {});
    const firstRefresh = session.refresh(root, generated);
    const secondRefresh = session.refresh(root, generated);
    rejectPendingRequest(new Error("Pending response rejected since connection got disposed"));
    releaseRestart(true);

    await expect(Promise.all([firstRefresh, secondRefresh])).resolves.toEqual([true, true]);
    await expect(request).resolves.toEqual({ contents: "replayed" });
    expect(stopCalls).toBe(1);
    expect(startCalls).toBe(1);
  });

  it("does not publish a stale ready state when a classpath import connection is disposed", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-import-disposed-"));
    const file = path.join(root, "src", "Main.java");
    const pom = path.join(root, "pom.xml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "class Main {}\n");
    fs.writeFileSync(pom, "<project><modelVersion>4.0.0</modelVersion></project>\n");
    const events: Array<{ channel: string; payload: any }> = [];
    const session = new LanguageSession(
      {
        assertWorkspace: (value: string) => value,
        assertAllowed: (value: string) => value,
      },
      {
        detectJdk: async () => ({ available: true, major: 21, path: "C:\\jdk" }),
        readProjectSettings: async () => ({}),
      },
      root,
      root,
      (channel: string, payload: any) => events.push({ channel, payload }),
    );
    session.ready = true;
    session.root = root;
    session.toolingJdk = { available: true, major: 21, path: "C:\\jdk" };
    session.projectModel = { managedByBuildTool: false, sourcePaths: ["src"], javaFiles: [file] };
    session.connection = {
      sendNotification: () => undefined,
      sendRequest: async () => { throw new Error("Pending response rejected since connection got disposed"); },
    };

    await expect(session.refresh(root, pom)).resolves.toBe(false);
    expect(events.some((event) => event.channel === "language:status" && event.payload.status === "ready")).toBe(false);
    expect(events.some((event) => event.channel === "language:log" && /disposed/i.test(event.payload.text))).toBe(false);
  });

  it("counts nested Maven and Gradle classpath JARs without relying on JSON formatting", () => {
    expect(countClasspathEntries({
      classpaths: [
        "C:\\Users\\dev\\.m2\\repository\\org\\example\\api\\1.0\\api-1.0.jar",
        "C:\\Users\\dev\\.m2\\repository\\org\\example\\core\\1.0\\core-1.0.jar",
      ],
      modulepaths: [],
      nested: { duplicate: "C:\\Users\\dev\\.m2\\repository\\org\\example\\api\\1.0\\api-1.0.jar" },
    })).toBe(2);
  });

  it("reports declared Maven dependencies while JDT is still importing its classpath", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "maven-index-"));
    fs.writeFileSync(path.join(root, "pom.xml"), `<project><dependencies>
      <dependency><groupId>dev.kiwi</groupId><artifactId>api</artifactId><version>1</version></dependency>
      <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5</version></dependency>
    </dependencies></project>`);
    expect(await declaredDependencyCount(root, { buildSystem: "Maven" })).toBe(2);
  });

  it("repairs only legacy JDT-managed output filters that break Maven import", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-project-filter-"));
    const projectFile = path.join(root, ".project");
    fs.writeFileSync(projectFile, `<projectDescription><filteredResources><filter><arguments>node_modules|\\.git|\\.gradle|target|build|out|custom|__CREATED_BY_JAVA_LANGUAGE_SERVER__</arguments></filter></filteredResources></projectDescription>`);
    expect(await repairLegacyManagedMetadata(root, { managedByBuildTool: true })).toBe(true);
    const repaired = fs.readFileSync(projectFile, "utf8");
    expect(repaired).toContain("node_modules|\\.git|custom|__CREATED_BY_JAVA_LANGUAGE_SERVER__");
    expect(repaired).not.toMatch(/\|(?:target|build|out)\|/);

    fs.writeFileSync(projectFile, `<projectDescription><arguments>target|custom</arguments></projectDescription>`);
    expect(await repairLegacyManagedMetadata(root, { managedByBuildTool: true })).toBe(false);
    expect(fs.readFileSync(projectFile, "utf8")).toContain("target|custom");
  });
});

describe("Maven aggregator packaging", () => {
  const generatedPom = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>de.rauchigesetwas</groupId>",
    "  <artifactId>testcode</artifactId>",
    "  <version>1.0-SNAPSHOT</version>",
    "  <dependencies></dependencies>",
    "</project>",
    "",
  ].join("\n");

  it("switches the parent to pom packaging when the first module is added", () => {
    // Without this Maven refuses the build:
    //   'packaging' with value 'jar' is invalid. Aggregator projects require 'pom'.
    const result = addMavenModule(generatedPom, "tes22");
    expect(result).toContain("<packaging>pom</packaging>");
    expect(result).toContain("<module>tes22</module>");
    expect(result.indexOf("<packaging>")).toBeGreaterThan(result.indexOf("<version>"));
  });

  it("corrects an explicit jar packaging", () => {
    const withJar = generatedPom.replace("  <version>1.0-SNAPSHOT</version>",
      "  <version>1.0-SNAPSHOT</version>\n  <packaging>jar</packaging>");
    const result = addMavenModule(withJar, "core");
    expect(result).toContain("<packaging>pom</packaging>");
    expect(result).not.toContain("<packaging>jar</packaging>");
  });

  it("leaves an already valid aggregator untouched apart from the module", () => {
    const aggregator = generatedPom.replace("  <version>1.0-SNAPSHOT</version>",
      "  <version>1.0-SNAPSHOT</version>\n  <packaging>pom</packaging>");
    const result = addMavenModule(aggregator, "core");
    expect(result.match(/<packaging>/g)).toHaveLength(1);
    expect(result).toContain("<module>core</module>");
  });

  it("repairs packaging even when the module entry already exists", () => {
    const broken = addMavenModule(generatedPom, "tes22").replace("<packaging>pom</packaging>", "<packaging>jar</packaging>");
    expect(ensureAggregatorPackaging(broken)).toContain("<packaging>pom</packaging>");
    expect(addMavenModule(broken, "tes22")).toContain("<packaging>pom</packaging>");
  });

  it("adds a second module without duplicating the packaging element", () => {
    const once = addMavenModule(generatedPom, "core");
    const twice = addMavenModule(once, "api");
    expect(twice.match(/<packaging>/g)).toHaveLength(1);
    expect(twice).toContain("<module>core</module>");
    expect(twice).toContain("<module>api</module>");
  });
});

describe("adopting project sources into a module", () => {
  function projectWithSources() {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "adopt-"));
    fs.mkdirSync(path.join(root, "src", "main", "java", "de", "demo"), { recursive: true });
    fs.writeFileSync(path.join(root, "pom.xml"), [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      "<modelVersion>4.0.0</modelVersion>",
      "<groupId>de.demo</groupId><artifactId>app</artifactId><version>1.0</version>",
      "</project>",
    ].join("\n"));
    fs.writeFileSync(path.join(root, "src", "main", "java", "de", "demo", "Core.java"),
      "package de.demo;\npublic class Core {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const projects = new ProjectService(guard, { get: () => ({}) }, path.join(process.cwd(), "resources", "toolchain"));
    return { root, modules: new ModuleService(guard, projects) };
  }

  it("moves src into the module and drops the placeholder class", async () => {
    const { root, modules } = projectWithSources();
    const plan = await modules.previewCreate(root, { name: "core", adoptRootSources: true });
    expect(plan.moves).toHaveLength(1);
    expect(plan.files.some((file: any) => file.path.endsWith("ModuleApi.java"))).toBe(false);

    await modules.applyPlan(root, plan.id);
    expect(fs.existsSync(path.join(root, "src"))).toBe(false);
    expect(fs.existsSync(path.join(root, "core", "src", "main", "java", "de", "demo", "Core.java"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "pom.xml"), "utf8")).toContain("<packaging>pom</packaging>");
  });

  it("scaffolds a placeholder when sources are not adopted", async () => {
    const { root, modules } = projectWithSources();
    const plan = await modules.previewCreate(root, { name: "core" });
    expect(plan.moves).toEqual([]);
    expect(plan.files.some((file: any) => file.path.endsWith("ModuleApi.java"))).toBe(true);
    // The project keeps sources the aggregator will no longer build, so say so.
    expect(plan.warnings.join(" ")).toMatch(/nicht mehr mitgebaut/);
  });

  it("refuses to overwrite an existing target directory", async () => {
    const { root, modules } = projectWithSources();
    const plan = await modules.previewCreate(root, { name: "core", adoptRootSources: true });
    fs.mkdirSync(path.join(root, "core", "src"), { recursive: true });
    await expect(modules.applyPlan(root, plan.id)).rejects.toThrow(/existiert bereits/);
    // The sources must still be where they were.
    expect(fs.existsSync(path.join(root, "src", "main", "java", "de", "demo", "Core.java"))).toBe(true);
  });
});

describe("GitHub sign-in", () => {
  /** safeStorage double: reversible, so the test can assert nothing is stored in clear. */
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
  };
  const okResponse = (login = "octocat") => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === "x-oauth-scopes" ? "repo, read:org" : null) },
    json: async () => ({ login, name: "The Octocat" }),
  });

  function service(fetchImpl: any) {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "gh-auth-"));
    return { userData, auth: new GitHubAuthService(userData, safeStorage, fetchImpl) };
  }

  it("stores a verified token encrypted and never in clear text", async () => {
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ";
    const { userData, auth } = service(async () => okResponse());
    const status = await auth.signIn(token);
    expect(status).toMatchObject({ signedIn: true, login: "octocat", scopes: ["repo", "read:org"] });

    const stored = fs.readFileSync(path.join(userData, "github-auth.json"), "utf8");
    expect(stored).not.toContain(token);
    // The stored value only becomes the token again after decryption.
    const encrypted = Buffer.from(JSON.parse(stored).token, "base64");
    expect(safeStorage.decryptString(encrypted)).toBe(token);
  });

  it("restores a session from disk", async () => {
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ";
    const { userData, auth } = service(async () => okResponse());
    await auth.signIn(token);
    const restored = new GitHubAuthService(userData, safeStorage, async () => okResponse());
    expect((await restored.load()).login).toBe("octocat");
    expect(restored.authArgs("https://github.com/octocat/demo.git")).toHaveLength(4);
  });

  it("rejects a token GitHub does not accept and stores nothing", async () => {
    const { userData, auth } = service(async () => ({ ok: false, status: 401 }));
    await expect(auth.signIn("ghp_0123456789abcdefghijABCDEFGHIJ")).rejects.toThrow(/abgelehnt/);
    expect(fs.existsSync(path.join(userData, "github-auth.json"))).toBe(false);
    expect(auth.status().signedIn).toBe(false);
  });

  it("only attaches credentials to GitHub remotes", async () => {
    const { auth } = service(async () => okResponse());
    await auth.signIn("ghp_0123456789abcdefghijABCDEFGHIJ");
    expect(auth.authArgs("https://github.com/octocat/demo.git").join(" ")).toContain("http.extraheader");
    expect(auth.authArgs("git@github.com:octocat/demo.git")).toHaveLength(4);
    // A lookalike host must never receive the token.
    expect(auth.authArgs("https://github.com.evil.example/x.git")).toEqual([]);
    expect(auth.authArgs("https://gitlab.com/octocat/demo.git")).toEqual([]);
    expect(auth.authArgs("")).toEqual([]);
  });

  it("drops the session on sign-out", async () => {
    const { userData, auth } = service(async () => okResponse());
    await auth.signIn("ghp_0123456789abcdefghijABCDEFGHIJ");
    expect((await auth.signOut()).signedIn).toBe(false);
    expect(fs.existsSync(path.join(userData, "github-auth.json"))).toBe(false);
    expect(auth.authArgs("https://github.com/octocat/demo.git")).toEqual([]);
  });

  it("redacts tokens from anything shown to the user", () => {
    expect(redactSecrets("remote: https://user:ghp_secret000000000000@github.com/x.git"))
      .not.toContain("ghp_secret");
    expect(redactSecrets("AUTHORIZATION: basic eHktdG9rZW4=")).toBe("AUTHORIZATION: basic ***");
    expect(redactSecrets("fatal: ghp_abcdefghijklmnop1234 rejected")).toContain("***");
  });

  it("recognises GitHub remotes in every common form", () => {
    expect(isGitHubRemote("https://github.com/a/b.git")).toBe(true);
    expect(isGitHubRemote("git@github.com:a/b.git")).toBe(true);
    expect(isGitHubRemote("ssh://git@github.com/a/b.git")).toBe(true);
    expect(isGitHubRemote("https://github.com.attacker.test/a/b")).toBe(false);
    expect(isGitHubRemote("https://notgithub.com/a/b")).toBe(false);
  });
});

describe("Maven command construction", () => {
  /** Multi-module aggregator whose only main class lives in a submodule. */
  function multiModuleProject() {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "mvn-multi-"));
    fs.writeFileSync(path.join(root, "pom.xml"), [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      "<modelVersion>4.0.0</modelVersion>",
      "<groupId>dev.demo</groupId><artifactId>parent</artifactId><version>1.0</version>",
      "<packaging>pom</packaging><modules><module>core</module></modules></project>",
    ].join("\n"));
    const moduleSources = path.join(root, "core", "src", "main", "java", "dev", "demo");
    fs.mkdirSync(moduleSources, { recursive: true });
    fs.writeFileSync(path.join(root, "core", "pom.xml"), [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      "<modelVersion>4.0.0</modelVersion>",
      "<parent><groupId>dev.demo</groupId><artifactId>parent</artifactId><version>1.0</version></parent>",
      "<artifactId>core</artifactId></project>",
    ].join("\n"));
    fs.writeFileSync(path.join(moduleSources, "Main.java"),
      "package dev.demo;\npublic class Main { public static void main(String[] a) {} }\n");

    const guard = new PathGuard();
    guard.register(root);
    const settings = { get: () => ({ jdkPath: "" }) };
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const workspace = new WorkspaceService(guard, {}, () => {});
    const modules = new ModuleService(guard, projects);
    const builds = new BuildService(guard, workspace, projects, modules, () => {});
    // Never actually spawn Maven; the command line is what is under test.
    builds.start = () => ({ pid: 1 });
    return { root, builds };
  }

  it("runs exec:java in the module owning the main class, not the aggregator", async () => {
    const { root, builds } = multiModuleProject();
    const result = await builds.execute({ root, action: "run", configuration: { name: "Run", type: "java" } });
    expect(result.command).toContain("-pl core");
    expect(result.command).toContain("exec:java");
    // -am would put the aggregator in the reactor, where the CLI goal runs
    // first and fails because it has no classes.
    expect(result.command).not.toContain("-am");
  });

  it("keeps also-make for module builds so dependencies are built first", async () => {
    const { root, builds } = multiModuleProject();
    const core = (await builds.modules.list(root)).find((module: any) => module.relativePath === "core");
    const result = await builds.execute({
      root,
      action: "build",
      configuration: { name: "Modul bauen", type: "maven", target: "package", moduleId: core.id },
    });
    expect(result.command).toContain("-pl core");
    expect(result.command).toContain("-am");
  });

  it("builds the whole reactor when no module is selected", async () => {
    const { root, builds } = multiModuleProject();
    const result = await builds.execute({ root, action: "build", configuration: { name: "Projekt bauen", type: "maven" } });
    expect(result.command).toContain("package");
    expect(result.command).not.toContain("-pl");
  });
});

describe("framework detection from the build file", () => {
  const names = (source: string, moduleInfo = "") =>
    frameworksFromBuildFile(source, moduleInfo).map((entry: any) => entry.name);

  it("recognises Spring Boot before a single bean exists", () => {
    // Detection used to depend on annotations, so a fresh project reported
    // nothing at all until someone had written one.
    expect(names("<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>"))
      .toEqual(["Spring Boot"]);
    expect(names('plugins { id("org.springframework.boot") version "3.2.0" }')).toEqual(["Spring Boot"]);
    expect(names('<dependency><artifactId>spring-boot-starter-web</artifactId></dependency>')).toEqual(["Spring Boot"]);
  });

  it("tells plain Spring apart from Spring Boot", () => {
    expect(names("<groupId>org.springframework</groupId><artifactId>spring-context</artifactId>")).toEqual(["Spring"]);
    // Boot already covers it, so the project is not listed twice.
    expect(names("<artifactId>spring-boot-starter</artifactId><groupId>org.springframework</groupId>")).toEqual(["Spring Boot"]);
  });

  it("recognises JavaFX from the plugin and from module-info", () => {
    expect(names("<plugin><artifactId>javafx-maven-plugin</artifactId></plugin>")).toEqual(["JavaFX"]);
    expect(names('<groupId>org.openjfx</groupId>')).toEqual(["JavaFX"]);
    expect(names('id("org.openjfx.javafxplugin")')).toEqual(["JavaFX"]);
    // A JavaFX project without any FXML file was invisible before.
    expect(names("plugins { id 'java' }", "module demo { requires javafx.controls; }")).toEqual(["JavaFX"]);
  });

  it("keeps Jakarta and the javax packages apart", () => {
    expect(names("<groupId>jakarta.persistence</groupId><artifactId>jakarta.persistence-api</artifactId>"))
      .toEqual(["Jakarta EE", "Jakarta Persistence"]);
    expect(names("<groupId>javax.servlet</groupId>")).toEqual(["Java EE (javax)"]);
    // A project mid-migration carries both, and that is worth seeing.
    expect(names("<groupId>jakarta.ws.rs</groupId><groupId>javax.annotation</groupId>"))
      .toEqual(["Jakarta EE", "Java EE (javax)"]);
  });

  it("names the evidence it decided on", () => {
    expect(frameworksFromBuildFile("<artifactId>spring-boot-maven-plugin</artifactId>")[0])
      .toEqual({ name: "Spring Boot", evidence: "spring-boot-maven-plugin" });
  });

  it("stays silent for a project without frameworks", () => {
    expect(names("<project><modelVersion>4.0.0</modelVersion></project>")).toEqual([]);
    expect(names("")).toEqual([]);
  });
});

describe("Maven profiles and Gradle variants", () => {
  const pom = [
    "<project>",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>de.demo</groupId><artifactId>app</artifactId><version>1.0</version>",
    "  <profiles>",
    "    <profile>",
    "      <id>dev</id>",
    "      <activation><activeByDefault>true</activeByDefault></activation>",
    "      <properties><env>dev</env></properties>",
    "    </profile>",
    "    <profile>",
    "      <id>integration-tests</id>",
    "    </profile>",
    "    <profile>",
    "      <id>release</id>",
    "      <modules><module>dist</module></modules>",
    "    </profile>",
    "  </profiles>",
    "</project>",
  ].join("\n");

  it("reads the declared profiles and marks the default one", () => {
    expect(mavenProfiles(pom)).toEqual([
      { id: "dev", active: true, description: "setzt Properties" },
      { id: "integration-tests", active: false, description: "" },
      { id: "release", active: false, description: "aktiviert Module" },
    ]);
  });

  it("stays empty for a POM without profiles", () => {
    expect(mavenProfiles("<project><modelVersion>4.0.0</modelVersion></project>")).toEqual([]);
    expect(mavenProfiles("")).toEqual([]);
  });

  it("reads the project properties a Gradle script branches on", () => {
    const script = [
      "if (project.hasProperty('release')) { version = '1.0' }",
      "def flag = findProperty(\"integrationTests\")",
      "def other = project.properties['nightly']",
    ].join("\n");
    expect(gradleVariants(script).map((entry: any) => entry.id))
      .toEqual(["integrationTests", "nightly", "release"]);
  });

  function project(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "profiles-"));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
    const guard = new PathGuard();
    guard.register(root);
    const settings = { get: () => ({ jdkPath: "" }) };
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const workspace = new WorkspaceService(guard, {}, () => {});
    const modules = new ModuleService(guard, projects);
    const builds = new BuildService(guard, workspace, projects, modules, () => {});
    builds.start = () => ({ pid: 1 });
    return { root, builds, projects };
  }

  it("offers the profiles alongside the tasks", async () => {
    const { root, builds } = project({ "pom.xml": pom });
    const listed = await builds.listTasks(root);
    expect(listed.profiles.map((entry: any) => entry.id)).toEqual(["dev", "integration-tests", "release"]);
  });

  it("passes the selected profiles to Maven", async () => {
    const { root, builds } = project({ "pom.xml": pom });
    const result = await builds.execute({
      root,
      action: "build",
      configuration: { name: "Bauen", type: "maven", target: "package", profiles: ["release", "integration-tests"] },
    });
    expect(result.command).toContain("-Prelease,integration-tests");
  });

  it("falls back to the profiles stored for the project", async () => {
    const { root, builds, projects } = project({ "pom.xml": pom });
    await projects.updateProjectSettings(root, { buildProfiles: ["release"] });
    const result = await builds.execute({ root, action: "build", configuration: { name: "Bauen", type: "maven" } });
    expect(result.command).toContain("-Prelease");
  });

  it("turns a Gradle variant into the project property the script reads", async () => {
    const { root, builds } = project({ "build.gradle": "plugins { id 'java' }\n" });
    const result = await builds.execute({
      root,
      action: "build",
      configuration: { name: "Bauen", type: "gradle", target: "build", profiles: ["release"] },
    });
    expect(result.command).toContain("-Prelease=true");
  });

  it("refuses anything that is not a plain profile name", async () => {
    const { root, builds } = project({ "pom.xml": pom });
    const result = await builds.execute({
      root,
      action: "build",
      configuration: { name: "Bauen", type: "maven", target: "package", profiles: ["ok", "&& shutdown", "x y"] },
    });
    // Only the harmless name may reach the command line.
    expect(result.command).toContain("-Pok");
    expect(result.command).not.toContain("shutdown");
  });
});

describe("adding a dependency", () => {
  const guava = { groupId: "com.google.guava", artifactId: "guava", version: "33.0.0-jre" };

  const pomWith = (body: string) => [
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>de.demo</groupId><artifactId>app</artifactId><version>1.0</version>",
    body,
    "</project>",
    "",
  ].join("\n");

  it("appends to the existing dependencies block", () => {
    const pom = pomWith([
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>junit</groupId><artifactId>junit</artifactId><version>4.13</version>",
      "    </dependency>",
      "  </dependencies>",
    ].join("\n"));
    const updated = insertMavenDependency(pom, guava);
    expect(updated).toContain("<artifactId>guava</artifactId>");
    expect(updated).toContain("<artifactId>junit</artifactId>");
    expect(updated.indexOf("guava")).toBeGreaterThan(updated.indexOf("junit"));
    // Still one block, not a second one appended after it.
    expect(updated.match(/<dependencies>/g)).toHaveLength(1);
  });

  it("creates the block when the POM has none", () => {
    const updated = insertMavenDependency(pomWith("  <packaging>jar</packaging>"), guava);
    expect(updated).toMatch(/<dependencies>[\s\S]*<artifactId>guava<\/artifactId>[\s\S]*<\/dependencies>/);
    expect(updated.trimEnd().endsWith("</project>")).toBe(true);
  });

  it("does not write into dependencyManagement", () => {
    const pom = pomWith([
      "  <dependencyManagement>",
      "    <dependencies>",
      "      <dependency>",
      "        <groupId>org.other</groupId><artifactId>bom</artifactId><version>1.0</version>",
      "      </dependency>",
      "    </dependencies>",
      "  </dependencyManagement>",
      "  <dependencies>",
      "  </dependencies>",
    ].join("\n"));
    const updated = insertMavenDependency(pom, guava);
    const managed = updated.slice(updated.indexOf("<dependencyManagement>"), updated.indexOf("</dependencyManagement>"));
    expect(managed).not.toContain("guava");
    expect(updated).toContain("guava");
  });

  it("adds the scope only when it is not the default", () => {
    expect(insertMavenDependency(pomWith("  <dependencies></dependencies>"), guava, "test")).toContain("<scope>test</scope>");
    expect(insertMavenDependency(pomWith("  <dependencies></dependencies>"), guava, "compile")).not.toContain("<scope>");
  });

  it("leaves the POM alone when the artifact is already declared", () => {
    const pom = pomWith([
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>32.0.0-jre</version>",
      "    </dependency>",
      "  </dependencies>",
    ].join("\n"));
    // Adding it twice must not produce a duplicate Maven then complains about.
    expect(insertMavenDependency(pom, guava)).toBe(pom);
  });

  it("refuses coordinates that are not coordinates", () => {
    const pom = pomWith("  <dependencies></dependencies>");
    expect(() => insertMavenDependency(pom, { ...guava, version: "1.0</version><scope>system" })).toThrow();
    expect(() => insertMavenDependency(pom, { ...guava, groupId: "../../etc" })).toThrow();
  });

  it("inserts into the Gradle dependencies block", () => {
    const script = [
      "plugins { id 'java' }",
      "",
      "dependencies {",
      "    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'",
      "}",
      "",
    ].join("\n");
    const updated = insertGradleDependency(script, guava);
    expect(updated).toContain('implementation "com.google.guava:guava:33.0.0-jre"');
    expect(updated.indexOf("guava")).toBeGreaterThan(updated.indexOf("junit-jupiter"));
    expect(updated.match(/dependencies \{/g)).toHaveLength(1);
  });

  it("is not confused by a nested block inside dependencies", () => {
    const script = [
      "dependencies {",
      "    implementation('a:b:1') {",
      "        exclude group: 'c'",
      "    }",
      "}",
      "",
    ].join("\n");
    const updated = insertGradleDependency(script, guava);
    // The line has to land before the final brace, not after the nested one.
    expect(updated.indexOf("guava")).toBeGreaterThan(updated.indexOf("exclude"));
    expect(updated.trimEnd().endsWith("}")).toBe(true);
  });

  it("writes Kotlin syntax for a .kts script", () => {
    expect(insertGradleDependency("dependencies {\n}\n", guava, "api", true))
      .toContain('api("com.google.guava:guava:33.0.0-jre")');
  });

  it("creates a dependencies block when the script has none", () => {
    expect(insertGradleDependency("plugins { id 'java' }\n", guava)).toMatch(/dependencies \{\n\s+implementation/);
  });

  it("writes the coordinates into the project's build file", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "dependency-add-"));
    fs.writeFileSync(path.join(root, "pom.xml"), pomWith("  <dependencies></dependencies>"));
    const guard = new PathGuard();
    guard.register(root);
    const settings = { get: () => ({ jdkPath: "" }) };
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const service = new DependencyService(guard, projects);

    const result = await service.add(root, guava, "test");
    expect(result.added).toBe(true);
    const written = fs.readFileSync(path.join(root, "pom.xml"), "utf8");
    expect(written).toContain("<artifactId>guava</artifactId>");
    expect(written).toContain("<scope>test</scope>");

    // A second attempt reports the duplicate instead of writing again.
    const repeat = await service.add(root, guava, "test");
    expect(repeat.added).toBe(false);
    expect(fs.readFileSync(path.join(root, "pom.xml"), "utf8")).toBe(written);
  });

  it("queries Maven Central over HTTPS and never lets the query steer the host", async () => {
    const calls: URL[] = [];
    const service = new DependencyService(new PathGuard(), {}, async (url: URL) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ response: { docs: [
          { g: "com.google.guava", a: "guava", latestVersion: "33.0.0-jre", p: "bundle", timestamp: 1 },
          { g: "", a: "broken", latestVersion: "1" },
        ] } }),
      };
    });

    const found = await service.search("guava");
    expect(found).toEqual([
      { groupId: "com.google.guava", artifactId: "guava", version: "33.0.0-jre", packaging: "bundle", updatedAt: 1 },
    ]);
    expect(calls[0].protocol).toBe("https:");
    expect(calls[0].host).toBe("search.maven.org");

    await service.search("https://evil.example/?x=");
    expect(calls[1].host).toBe("search.maven.org");
  });

  it("reports an unreachable registry instead of failing silently", async () => {
    const service = new DependencyService(new PathGuard(), {}, async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    await expect(service.search("guava")).rejects.toThrow(/nicht erreichbar/);
    expect(await service.search("   ")).toEqual([]);
  });
});

describe("dependency editor", () => {
  const createService = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "dependency-editor-"));
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const guard = new PathGuard();
    guard.register(root);
    const projects = new ProjectService(guard, { get: () => ({ jdkPath: "" }) }, path.join(process.cwd(), "resources", "toolchain"));
    return { root, guard, service: new DependencyService(guard, projects) };
  };

  const managedPom = [
    "<project>",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>dev.kiwi</groupId><artifactId>parent</artifactId><version>1</version>",
    "  <properties><guava.version>32.1.0-jre</guava.version></properties>",
    "  <dependencyManagement>",
    "    <dependencies>",
    "      <dependency>",
    "        <groupId>com.google.guava</groupId><artifactId>guava</artifactId>",
    "        <version>${guava.version}</version>",
    "      </dependency>",
    "    </dependencies>",
    "  </dependencyManagement>",
    "  <dependencies>",
    "    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId></dependency>",
    "    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency>",
    "  </dependencies>",
    "</project>",
    "",
  ].join("\n");

  it("lists Maven direct and managed entries with their effective version source", async () => {
    const { root, service } = createService({ "pom.xml": managedPom });
    const model = await service.list(root);
    expect(model.type).toBe("Maven");
    const managed = model.dependencies.find((entry: any) => entry.managed && entry.artifactId === "guava");
    const direct = model.dependencies.find((entry: any) => !entry.managed && entry.artifactId === "guava");
    expect(managed).toMatchObject({ version: "32.1.0-jre", versionSource: "property", versionKey: "guava.version", editableVersion: true });
    expect(direct).toMatchObject({ version: "32.1.0-jre", versionSource: "management", managedBy: managed.id, direct: true });
    expect(direct.sourceFile).toBe(path.join(root, "pom.xml"));
  });

  it("marks an unresolved Maven property as non-editable instead of overwriting the expression", async () => {
    const { root, service } = createService({
      "pom.xml": "<project><dependencies><dependency><groupId>a</groupId><artifactId>b</artifactId><version>${missing.version}</version></dependency></dependencies></project>",
    });
    const dependency = (await service.list(root)).dependencies[0];
    expect(dependency).toMatchObject({ versionSource: "missing", versionKey: "missing.version", editableVersion: false });
  });

  it("updates the property that supplies a dependencyManagement version", async () => {
    const { root, service } = createService({ "pom.xml": managedPom });
    const before = await service.list(root);
    const direct = before.dependencies.find((entry: any) => !entry.managed && entry.artifactId === "guava")!;
    const result = await service.update(root, { id: direct.id }, "33.4.0-jre");
    expect(result).toMatchObject({ updated: true, changed: true, versionKey: "guava.version" });
    const pom = fs.readFileSync(path.join(root, "pom.xml"), "utf8");
    expect(pom).toContain("<guava.version>33.4.0-jre</guava.version>");
    const after = await service.list(root);
    expect(after.dependencies.find((entry: any) => !entry.managed && entry.artifactId === "guava")).toMatchObject({
      version: "33.4.0-jre", declaredVersion: "", versionSource: "management",
    });
  });

  it("omits a direct Maven version when dependencyManagement already owns it", async () => {
    const source = managedPom.replace(
      "    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId></dependency>\n",
      "",
    );
    const { root, service } = createService({ "pom.xml": source });
    const result = await service.add(root, { groupId: "com.google.guava", artifactId: "guava", version: "99" });
    expect(result).toMatchObject({ added: true, managed: true });
    const model = await service.list(root);
    const direct = model.dependencies.find((entry: any) => !entry.managed && entry.artifactId === "guava");
    expect(direct).toMatchObject({ declaredVersion: "", version: "32.1.0-jre", versionSource: "management" });
  });

  it("removes only the selected Maven declaration and updates literal versions", async () => {
    const { root, service } = createService({ "pom.xml": managedPom });
    let model = await service.list(root);
    const junit = model.dependencies.find((entry: any) => entry.artifactId === "junit-jupiter")!;
    await service.update(root, { id: junit.id }, "5.11.0");
    model = await service.list(root);
    expect(model.dependencies.find((entry: any) => entry.artifactId === "junit-jupiter")?.version).toBe("5.11.0");
    await service.remove(root, { id: model.dependencies.find((entry: any) => !entry.managed && entry.artifactId === "guava")!.id });
    model = await service.list(root);
    expect(model.dependencies.some((entry: any) => !entry.managed && entry.artifactId === "guava")).toBe(false);
    expect(model.dependencies.some((entry: any) => entry.managed && entry.artifactId === "guava")).toBe(true);
  });

  it("resolves inherited Maven management properties for module dependencies", async () => {
    const parent = managedPom.replace("  </dependencies>\n</project>", "  </dependencies>\n  <modules><module>app</module></modules>\n</project>");
    const child = [
      "<project>",
      "  <parent><groupId>dev.kiwi</groupId><artifactId>parent</artifactId><version>1</version></parent>",
      "  <artifactId>app</artifactId>",
      "  <dependencies><dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId></dependency></dependencies>",
      "</project>",
    ].join("\n");
    const { root, service } = createService({ "pom.xml": parent, "app/pom.xml": child });
    const model = await service.list(root);
    const moduleDependency = model.dependencies.find((entry: any) => entry.buildFile.endsWith(path.join("app", "pom.xml")) && !entry.managed)!;
    expect(moduleDependency).toMatchObject({ version: "32.1.0-jre", versionSource: "management" });
    await service.update(root, { id: moduleDependency.id }, "33.6.0-jre");
    expect(fs.readFileSync(path.join(root, "pom.xml"), "utf8")).toContain("<guava.version>33.6.0-jre</guava.version>");
    expect(fs.readFileSync(path.join(root, "app", "pom.xml"), "utf8")).not.toContain("33.6.0-jre");
  });

  it("preserves compact Maven siblings while removing one declaration", async () => {
    const compact = "<project><modelVersion>4.0.0</modelVersion><dependencies><dependency><groupId>a</groupId><artifactId>one</artifactId><version>1</version></dependency><dependency><groupId>b</groupId><artifactId>two</artifactId><version>2</version></dependency></dependencies></project>";
    const { root, service } = createService({ "pom.xml": compact });
    const first = (await service.list(root)).dependencies.find((entry: any) => entry.artifactId === "one")!;
    await service.remove(root, { id: first.id });
    const written = fs.readFileSync(path.join(root, "pom.xml"), "utf8");
    expect(written).not.toContain("<artifactId>one</artifactId>");
    expect(written).toContain("<artifactId>two</artifactId>");
    expect(written).toContain("</project>");
  });

  it("lists, updates, and removes Groovy and Kotlin Gradle declarations", async () => {
    const { root, service } = createService({
      "settings.gradle.kts": 'rootProject.name = "demo"\ninclude("lib")\n',
      "build.gradle.kts": 'plugins { java }\ndependencies {\n    implementation("com.google.guava:guava:32.0.0-jre")\n}\n',
      "lib/build.gradle": "plugins { id 'java-library' }\ndependencies {\n    api 'org.slf4j:slf4j-api:2.0.12'\n}\n",
    });
    let model = await service.list(root);
    expect(model.buildFiles).toHaveLength(2);
    expect(model.dependencies.map((entry: any) => `${entry.configuration}:${entry.coordinate}:${entry.version}`)).toEqual(expect.arrayContaining([
      "implementation:com.google.guava:guava:32.0.0-jre",
      "api:org.slf4j:slf4j-api:2.0.12",
    ]));
    const slf4j = model.dependencies.find((entry: any) => entry.artifactId === "slf4j-api")!;
    await service.update(root, { id: slf4j.id }, "2.0.16");
    expect(fs.readFileSync(path.join(root, "lib", "build.gradle"), "utf8")).toContain("slf4j-api:2.0.16");
    model = await service.list(root);
    await service.remove(root, { id: model.dependencies.find((entry: any) => entry.artifactId === "guava")!.id });
    expect(fs.readFileSync(path.join(root, "build.gradle.kts"), "utf8")).not.toContain("guava");
  });

  it("reads and edits Gradle version catalogs and exposes aliases and keys", async () => {
    const catalog = [
      "[versions]",
      'guava = "32.1.3-jre"',
      "",
      "[libraries]",
      'guava-core = { module = "com.google.guava:guava", version.ref = "guava" }',
      'slf4j = "org.slf4j:slf4j-api:2.0.12"',
      "",
    ].join("\n");
    const { root, service } = createService({
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": "plugins { java }\ndependencies {\n    implementation(libs.guava.core)\n    api(libs.slf4j)\n}\n",
      "gradle/libs.versions.toml": catalog,
    });
    let model = await service.list(root);
    expect(model.catalogs[0].versions).toContainEqual({ key: "guava", version: "32.1.3-jre", editable: true });
    expect(model.dependencies.find((entry: any) => entry.catalogAlias === "guava-core")).toMatchObject({
      version: "32.1.3-jre", versionKey: "guava", versionSource: "catalog", managed: true,
    });
    const guava = model.dependencies.find((entry: any) => entry.catalogAlias === "guava-core")!;
    await service.update(root, { id: guava.id }, "33.4.0-jre");
    expect(fs.readFileSync(path.join(root, "gradle", "libs.versions.toml"), "utf8")).toContain('guava = "33.4.0-jre"');

    await service.updateCatalog(root, path.join(root, "gradle", "libs.versions.toml"), "guava", "33.5.0-jre");
    model = await service.list(root);
    expect(model.dependencies.find((entry: any) => entry.catalogAlias === "guava-core")?.version).toBe("33.5.0-jre");

    const slf4j = model.dependencies.find((entry: any) => entry.catalogAlias === "slf4j")!;
    await service.update(root, { id: slf4j.id }, "2.0.17");
    expect(fs.readFileSync(path.join(root, "gradle", "libs.versions.toml"), "utf8")).toContain("org.slf4j:slf4j-api:2.0.17");
  });

  it("adds a Gradle Catalog alias and can remove its use and declaration", async () => {
    const { root, service } = createService({
      "settings.gradle": "rootProject.name = 'demo'\n",
      "build.gradle": "plugins { id 'java' }\ndependencies {\n}\n",
      "gradle/libs.versions.toml": "[versions]\n\n[libraries]\n",
    });
    const result = await service.add(
      root,
      { groupId: "com.google.guava", artifactId: "guava", version: "33.4.0-jre" },
      "implementation",
      { useVersionCatalog: true, alias: "guava-core", versionKey: "guava", catalogPath: path.join(root, "gradle", "libs.versions.toml") },
    );
    expect(result.files).toHaveLength(2);
    expect(fs.readFileSync(path.join(root, "build.gradle"), "utf8")).toContain("implementation libs.guava.core");
    expect(fs.readFileSync(path.join(root, "gradle", "libs.versions.toml"), "utf8")).toContain('guava-core = { module = "com.google.guava:guava", version.ref = "guava" }');
    const dependency = (await service.list(root)).dependencies.find((entry: any) => entry.catalogAlias === "guava-core")!;
    await service.remove(root, { id: dependency.id, removeCatalogEntry: true });
    expect(fs.readFileSync(path.join(root, "build.gradle"), "utf8")).not.toContain("libs.guava.core");
    expect(fs.readFileSync(path.join(root, "gradle", "libs.versions.toml"), "utf8")).not.toContain("guava-core");
  });

  it("recognizes named Gradle version catalogs and their accessors", async () => {
    const { root, service } = createService({
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": "dependencies {\n    implementation(tools.logging)\n}\n",
      "gradle/tools.versions.toml": '[libraries]\nlogging = "org.slf4j:slf4j-api:2.0.16"\n',
    });
    const model = await service.list(root);
    expect(model.catalogs[0].name).toBe("tools");
    expect(model.dependencies[0]).toMatchObject({ catalogName: "tools", catalogAlias: "logging", version: "2.0.16" });
  });

  it("preserves rich Gradle Catalog version constraints while editing them", async () => {
    const { root, service } = createService({
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": "dependencies {\n    implementation(libs.strict)\n    implementation(libs.inline)\n}\n",
      "gradle/libs.versions.toml": [
        "[versions]",
        'strict = { strictly = "1.2.0" }',
        "[libraries]",
        'strict = { module = "dev.kiwi:strict", version.ref = "strict" }',
        'inline = { module = "dev.kiwi:inline", version = { require = "2.0.0" } }',
      ].join("\n"),
    });
    let model = await service.list(root);
    expect(model.catalogs[0].versions[0]).toMatchObject({ key: "strict", version: "1.2.0", editable: true });
    await service.updateCatalog(root, model.catalogs[0].path, "strict", "1.3.0");
    model = await service.list(root);
    const inline = model.dependencies.find((entry: any) => entry.catalogAlias === "inline")!;
    expect(inline.version).toBe("2.0.0");
    await service.update(root, { id: inline.id }, "2.1.0");
    const written = fs.readFileSync(path.join(root, "gradle", "libs.versions.toml"), "utf8");
    expect(written).toContain('strictly = "1.3.0"');
    expect(written).toContain('require = "2.1.0"');
  });

  it("blocks unregistered roots, outside build files, outside catalogs, and unsafe versions", async () => {
    const { root, service } = createService({ "pom.xml": managedPom });
    const outside = path.join(path.dirname(root), "outside-pom.xml");
    fs.writeFileSync(outside, managedPom);
    await expect(service.list(path.dirname(root))).rejects.toThrow(/nicht registriert/);
    await expect(service.add(root, { groupId: "a", artifactId: "b", version: "1" }, "compile", { buildFile: outside })).rejects.toThrow(/außerhalb/);
    const direct = (await service.list(root)).dependencies.find((entry: any) => !entry.managed)!;
    await expect(service.update(root, { id: direct.id }, "1</version><scope>system")).rejects.toThrow(/Ungültige Version/);

    const gradle = createService({
      "build.gradle": "plugins { id 'java' }\n",
      "gradle/libs.versions.toml": "[versions]\nx = \"1\"\n[libraries]\n",
    });
    await expect(gradle.service.updateCatalog(gradle.root, outside, "x", "2")).rejects.toThrow(/außerhalb/);
  });
});

describe("configuration file validation", () => {
  const messages = (found: any[]) => found.map((item) => item.message);

  it("accepts valid files of every supported kind", () => {
    expect(validateJson('{"name": "demo", "list": [1, 2, {"a": null}]}')).toEqual([]);
    expect(validateXml("<a><b attr=\"x > y\"/><c>text</c><!-- <d> --></a>")).toEqual([]);
    expect(validateYaml([
      "name: demo",
      "on:",
      "  push:",
      "    branches: [main]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: |",
      "          echo not:valid:yaml:in:here",
      "          echo\tstill fine",
    ].join("\n"))).toEqual([]);
    expect(validateGradle([
      "plugins { id 'java' }",
      "repositories { mavenCentral() }",
      "dependencies {",
      "  implementation 'org.example:lib:1.0' // trailing } in a comment",
      "  testImplementation \"a:b:$version\"",
      "}",
    ].join("\n"))).toEqual([]);
  });

  it("points at the exact spot of a JSON syntax error", () => {
    const broken = ['{', '  "name": "demo",', '  "deps": {', '    "a": 1,', '  }', '}'].join("\n");
    const [found] = validateJson(broken);
    expect(found.line).toBe(5);
    expect(found.severity).toBe("error");
    expect(found.message).toContain("Ungültiges JSON");
  });

  it("finds unclosed and crossed XML tags", () => {
    expect(messages(validateXml("<project><groupId>g</project>"))[0]).toContain("schließt <groupId>");
    expect(messages(validateXml("<a><b></b>"))[0]).toContain("<a> wird nie geschlossen");
    expect(messages(validateXml("<a></b></a>"))[0]).toContain("schließt <a>");
    expect(messages(validateXml("<a>AT&T</a>"))[0]).toContain("&amp;");
    // Entities and numeric references are legitimate.
    expect(validateXml("<a>AT&amp;T &#233; &#x41;</a>")).toEqual([]);
  });

  it("reports the aggregator packaging Maven refuses to build", () => {
    const pom = [
      "<project>",
      "  <modelVersion>4.0.0</modelVersion>",
      "  <groupId>de.demo</groupId>",
      "  <artifactId>parent</artifactId>",
      "  <version>1.0</version>",
      "  <modules><module>core</module></modules>",
      "</project>",
    ].join("\n");
    const [found] = validateMavenPom(pom);
    // This is the failure that produced no build output at all and a message
    // that never named the file to edit.
    expect(found.message).toContain("<packaging>pom</packaging>");
    expect(found.severity).toBe("error");

    const fixed = pom.replace("<modules>", "<packaging>pom</packaging><modules>");
    expect(validateMavenPom(fixed)).toEqual([]);
  });

  it("checks the Maven coordinates and flags unstable versions", () => {
    expect(messages(validateMavenPom("<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version></project>"))[0])
      .toContain("<modelVersion>");
    // A child POM inherits groupId and version, so only artifactId is required.
    expect(validateMavenPom([
      "<project><modelVersion>4.0.0</modelVersion>",
      "<parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version></parent>",
      "<artifactId>child</artifactId></project>",
    ].join("\n"))).toEqual([]);

    const latest = validateMavenPom([
      "<project><modelVersion>4.0.0</modelVersion><groupId>g</groupId><artifactId>a</artifactId>",
      "<version>1</version><dependencies><dependency><version>LATEST</version></dependency></dependencies></project>",
    ].join("\n"));
    expect(latest.map((item: any) => item.severity)).toEqual(["warning"]);
  });

  it("catches the YAML mistakes that are unambiguous", () => {
    expect(messages(validateYaml("name: demo\n\tvalue: 1\n"))[0]).toContain("Tabs");
    expect(messages(validateYaml("name:demo\n"))[0]).toContain("Leerzeichen");
    const duplicate = validateYaml("name: a\nname: b\n");
    expect(duplicate[0].severity).toBe("warning");
    expect(duplicate[0].line).toBe(2);
    // The same key under different parents is normal and must stay silent.
    expect(validateYaml("a:\n  name: x\nb:\n  name: y\n")).toEqual([]);
    // A URL in a value is not a missing space.
    expect(validateYaml("url: https://example.org\n")).toEqual([]);
  });

  it("catches unbalanced structure in a Gradle script", () => {
    expect(messages(validateGradle("dependencies {\n  implementation 'a:b:1'\n"))[0]).toContain("nie geschlossen");
    expect(messages(validateGradle("plugins { id 'java' }\n}\n"))[0]).toContain("nie geöffnet");
    expect(messages(validateGradle("def name = 'unterminated\n"))[0]).toContain("Zeichenkette");
  });

  it("routes each file to the right validator and ignores the rest", () => {
    expect(validateContent("C:\\ws\\pom.xml", "<project><modules><module>a</module></modules></project>")
      .some((item: any) => item.source === "Maven" && item.message.includes("packaging"))).toBe(true);
    expect(validateContent("C:\\ws\\data.json", "{")[0]).toMatchObject({ source: "JSON" });
    expect(validateContent("C:\\ws\\build.gradle", "a {")[0]).toMatchObject({ source: "Gradle" });
    expect(validateContent("C:\\ws\\config.yml", "a:\n\tb: 1")[0]).toMatchObject({ source: "YAML" });
    // Java is the language server's job, plain text has no rules at all.
    expect(validateContent("C:\\ws\\Main.java", "class A {")).toEqual([]);
    expect(validateContent("C:\\ws\\notes.txt", "{{{")).toEqual([]);
  });

  it("validates a whole project and skips build output", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "validate-project-"));
    fs.writeFileSync(path.join(root, "pom.xml"), [
      "<project>",
      "  <modelVersion>4.0.0</modelVersion>",
      "  <groupId>de.demo</groupId><artifactId>a</artifactId><version>1</version>",
      "  <modules><module>core</module></modules>",
      "</project>",
    ].join("\n"));
    fs.writeFileSync(path.join(root, "settings.json"), "{ \"a\": }");
    fs.mkdirSync(path.join(root, "target"), { recursive: true });
    fs.writeFileSync(path.join(root, "target", "generated.json"), "{ broken");

    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {});
    const found = await workspace.validateProject(root);

    expect(found.map((item: any) => `${path.basename(item.path)}:${item.source}`).sort())
      .toEqual(["pom.xml:Maven", "settings.json:JSON"]);
  });

  it("validates an unsaved buffer without touching the disk", () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "validate-buffer-"));
    const file = path.join(root, "pom.xml");
    fs.writeFileSync(file, "<project></project>");
    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {});

    const found = workspace.validateBuffer(root, file, "<project><modules><module>a</module></modules></project>");
    expect(found.some((item: any) => item.message.includes("packaging"))).toBe(true);
    // The file on disk is untouched and still valid on its own.
    expect(fs.readFileSync(file, "utf8")).toBe("<project></project>");
  });

  it("refuses a file outside the workspace", () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "validate-guard-"));
    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {});
    expect(() => workspace.validateBuffer(root, "C:\\Windows\\win.ini", "[a]")).toThrow();
  });
});

describe("project-wide TODO scan", () => {
  it("collects markers across files and skips build output", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "todo-scan-"));
    const sources = path.join(root, "src", "main", "java", "de", "demo");
    fs.mkdirSync(sources, { recursive: true });
    fs.writeFileSync(path.join(sources, "Alpha.java"), [
      "package de.demo;",
      "public class Alpha {",
      "    // TODO: split this method",
      "    void run() {}",
      "}",
    ].join("\n"));
    fs.writeFileSync(path.join(sources, "Beta.java"), [
      "package de.demo;",
      "/** FIXME: leaks a handle */",
      "public class Beta {}",
    ].join("\n"));
    // Compiled output and dependencies must never show up as open work.
    fs.mkdirSync(path.join(root, "target", "classes"), { recursive: true });
    fs.writeFileSync(path.join(root, "target", "classes", "Generated.java"), "// TODO: generated\n");
    fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "dep", "index.js"), "// TODO: not ours\n");

    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {});
    const found = await workspace.taskComments(root);

    expect(found.map((task: any) => `${task.name}:${task.kind}`).sort())
      .toEqual(["Alpha.java:TODO", "Beta.java:FIXME"]);
    expect(found.every((task: any) => path.isAbsolute(task.path))).toBe(true);
    expect(found.find((task: any) => task.name === "Alpha.java")).toMatchObject({
      line: 3, text: "split this method",
    });
  });

  it("refuses a root outside the workspace", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "todo-guard-"));
    const guard = new PathGuard();
    const workspace = new WorkspaceService(guard, {}, () => {});
    await expect(workspace.taskComments(root)).rejects.toThrow();
  });
});

describe("Java language server startup robustness", () => {
  it("rejects stalled JDT requests with a classified timeout", async () => {
    const started = Date.now();
    const error = await rejectAfterTimeout(new Promise(() => {}), 20, "JDT-Testphase")
      .then(() => null, (reason: Error & { code?: string; stage?: string }) => reason);

    expect(error).toMatchObject({ code: JDT_TIMEOUT_CODE, stage: "JDT-Testphase" });
    expect(error?.message).toContain("20 ms");
    expect(Date.now() - started).toBeLessThan(500);
    await expect(rejectAfterTimeout(Promise.resolve("ready"), 100, "JDT-Testphase"))
      .resolves.toBe("ready");
  });

  it("uses short decoration timeouts without cutting off project refactorings", () => {
    expect(requestTimeoutForMethod("textDocument/inlayHint")).toBe(JDT_DECORATION_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutForMethod("textDocument/completion")).toBe(JDT_INTERACTIVE_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutForMethod("textDocument/references")).toBe(JDT_PROJECT_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutForMethod("textDocument/rename")).toBe(JDT_MUTATING_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutForMethod("workspace/executeCommand")).toBe(JDT_MUTATING_REQUEST_TIMEOUT_MS);
    expect(JDT_MUTATING_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("times out and cancels a stalled inlay-hint request without stopping JDT", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdt-request-timeout-"));
    const events: Array<{ channel: string; payload: any }> = [];
    let cancellationToken: { isCancellationRequested: boolean } | undefined;
    let requests = 0;
    const connection = {
      sendRequest: (_method: string, _params: any, token: { isCancellationRequested: boolean }) => {
        requests += 1;
        cancellationToken = token;
        return new Promise(() => {});
      },
    };
    const session = new LanguageSession(
      { assertWorkspace: (value: string) => value },
      {},
      "",
      root,
      (channel: string, payload: any) => events.push({ channel, payload }),
      null,
      () => 20,
    );
    session.ready = true;
    session.root = root;
    session.connection = connection;

    const error = await session.request(root, "textDocument/inlayHint", {})
      .then(() => null, (reason: Error & { code?: string; stage?: string; method?: string; timeoutMs?: number }) => reason);

    expect(error).toMatchObject({
      code: JDT_TIMEOUT_CODE,
      stage: "JDT-LS-Anfrage textDocument/inlayHint",
      method: "textDocument/inlayHint",
      timeoutMs: 20,
    });
    expect(cancellationToken?.isCancellationRequested).toBe(true);
    expect(requests).toBe(1);
    expect(session.ready).toBe(true);
    expect(session.connection).toBe(connection);
    expect(events.some((event) => event.channel === "language:log"
      && event.payload.text.includes("Sprachserver bleibt verfügbar"))).toBe(true);
  });

  it("evicts the least recently used JDT session before a fourth JVM starts", async () => {
    const events: string[] = [];
    const service = new LanguageService(
      { assertWorkspace: (root: string) => root },
      {},
      "",
      "",
      () => {},
      3,
    );
    const fakeSession = (name: string) => ({
      documents: new Map(),
      stop: async () => { events.push(`stop:${name}`); },
      start: async () => {
        events.push(`start:${name}:sessions=${service.sessions.size}`);
        return { available: true, status: "ready" };
      },
    });
    for (const [index, root] of ["alpha", "beta", "gamma", "delta"].entries()) {
      service.sessions.set(root, fakeSession(root));
      service.lastUsed.set(root, index + 1);
    }

    const result = await service.start("delta");

    expect(result.available).toBe(true);
    expect(events).toEqual(["stop:alpha", "start:delta:sessions=3"]);
    expect([...service.sessions.keys()].sort()).toEqual(["beta", "delta", "gamma"]);
  });

  it("never passes a sources or javadoc jar to -javaagent", () => {
    expect(isLombokAgentJar("lombok-1.18.42.jar")).toBe(true);
    expect(isLombokAgentJar("lombok.jar")).toBe(true);
    // A sources jar has no Premain-Class, so the JVM aborts the launch and the
    // language server dies with exit code 1 before writing a single message.
    expect(isLombokAgentJar("lombok-1.18.42-sources.jar")).toBe(false);
    expect(isLombokAgentJar("lombok-1.18.42-javadoc.jar")).toBe(false);
    expect(isLombokAgentJar("lombok-mapstruct-binding-0.2.0.jar")).toBe(false);
  });

  it("prefers the plain artifact when a Gradle cache entry also holds sources", async () => {
    const home = fs.mkdtempSync(path.join(fixtureRoot, "lombok-home-"));
    const cache = path.join(home, ".gradle", "caches", "modules-2", "files-2.1", "org.projectlombok", "lombok", "1.18.42", "abc123");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "lombok-1.18.42-sources.jar"), "");
    fs.writeFileSync(path.join(cache, "lombok-1.18.42.jar"), "");
    const originalHome = os.homedir;
    (os as any).homedir = () => home;
    try {
      const agent = await detectLombokAgent(fixtureRoot, { jarFiles: [] }, true);
      expect(path.basename(agent)).toBe("lombok-1.18.42.jar");
    } finally {
      (os as any).homedir = originalHome;
    }
  });

  it("reports a crashed language server instead of waiting for it forever", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "lsp-crash-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "Main.java"), "public class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const settings = { get: () => ({ jdkPath: "" }) };
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const session = new LanguageSession(guard, projects, path.join(process.cwd(), "resources", "toolchain"),
      fs.mkdtempSync(path.join(fixtureRoot, "lsp-crash-data-")), () => {});
    // Stand in for the JVM refusing to start: without the exit being turned
    // into a rejection, the pending "initialize" request never settles.
    const originalDetect = projects.detectJdk.bind(projects);
    projects.detectJdk = async (target: string) => ({ ...(await originalDetect(target)), java: "kiwi-java-does-not-exist" });
    const started = Date.now();
    const result = await session.start(root);
    expect(result.available).toBe(false);
    expect(result.status).toBe("error");
    expect(String(result.reason)).toMatch(/Sprachserver/);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);
});

describe("IntelliJ-style build task listing", () => {
  it("offers the Maven lifecycle in order and only goals of declared plugins", () => {
    const plain = mavenTasks("<project><artifactId>demo</artifactId></project>");
    const names = plain.map((task: any) => task.name);
    expect(names.slice(0, 3)).toEqual(["clean package", "clean install", "test-compile"]);
    // The lifecycle has to keep its real order; "deploy" before "package" is
    // what made the old flat list unusable.
    const lifecycle = plain.filter((task: any) => task.group === "Lifecycle").map((task: any) => task.name);
    expect(lifecycle).toEqual([
      "clean", "validate", "compile", "test", "package", "verify", "install", "site", "deploy",
    ]);
    expect(names).not.toContain("spring-boot:run");

    const boot = mavenTasks([
      "<project><build><plugins><plugin>",
      "<artifactId>spring-boot-maven-plugin</artifactId>",
      "</plugin></plugins></build></project>",
    ].join(""));
    expect(boot.map((task: any) => task.name)).toContain("spring-boot:run");
  });

  it("parses Gradle's task report into groups and falls back when Gradle is unreachable", () => {
    const parsed = parseGradleTasks([
      "Build tasks",
      "----------",
      "assemble - Assembles the outputs of this project.",
      "build - Assembles and tests this project.",
      "",
      "Help tasks",
      "----------",
      "projects - Displays the sub-projects.",
    ].join("\n"));
    expect(parsed).toEqual([
      { name: "assemble", description: "Assembles the outputs of this project.", group: "Build" },
      { name: "build", description: "Assembles and tests this project.", group: "Build" },
      { name: "projects", description: "Displays the sub-projects.", group: "Help" },
    ]);

    const fallback = gradleFallbackTasks();
    expect(fallback.some((task: any) => task.name === "build")).toBe(true);
    expect(fallback.every((task: any) => task.description && task.group)).toBe(true);
  });

  it("lists Gradle shortcuts only for tasks the build actually reports", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "gradle-tasks-"));
    fs.writeFileSync(path.join(root, "build.gradle"), "plugins { id 'java' }\n");
    const guard = new PathGuard();
    guard.register(root);
    const settings = { get: () => ({ jdkPath: "" }) };
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const workspace = new WorkspaceService(guard, {}, () => {});
    const modules = new ModuleService(guard, projects);
    const builds = new BuildService(guard, workspace, projects, modules, () => {});
    // Stand in for a machine without Gradle instead of waiting on a real
    // distribution download: the fallback list is the contract here, and it
    // must never come back empty.
    builds.resolveBuildTool = () => "kiwi-gradle-does-not-exist";
    const listed = await builds.listTasks(root);
    expect(listed.type).toBe("Gradle");
    expect(listed.tasks.length).toBeGreaterThan(0);
    expect(listed.tasks.some((task: any) => task.group === "Häufig verwendet")).toBe(true);
  });
});

describe("run configurations and command parsing", () => {
  it("creates a visible Plain-Java build/classes output and copies resources", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "plain-build-output-"));
    fs.mkdirSync(path.join(root, "src", "main", "java"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main", "java", "Main.java"), "public class Main {}\n");
    fs.writeFileSync(path.join(root, "src", "main", "resources", "application.properties"), "name=kiwi\n");
    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {}, {
      get: () => ({
        explorerHideBuild: false,
        explorerHideDotDirectories: true,
        explorerHideGenerated: true,
        explorerExcludedPatterns: [],
      }),
    });
    const service = new BuildService(guard, workspace, {
      detect: async () => ({ type: "Java", languageLevel: "21", encoding: "UTF-8" }),
      detectJdk: async () => ({
        available: true,
        major: 25,
        path: "C:\\Java\\jdk-25",
        java: "java",
        javac: "javac",
      }),
    }, { list: async () => [] }, () => {});
    let invocation: any[] = [];
    service.start = (...args: any[]) => {
      invocation = args;
      return {};
    };
    await service.execute({ root, action: "build", configuration: { type: "java" } });
    const output = path.join(root, "build", "classes");
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.readFileSync(path.join(output, "application.properties"), "utf8")).toBe("name=kiwi\n");
    expect(invocation[2]).toEqual(expect.arrayContaining(["-d", output]));
  });

  it("cleans stale Maven test output before compiling tests", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "maven-clean-test-"));
    const guard = new PathGuard();
    guard.register(root);
    let invocation: any[] = [];
    const projects = {
      detect: async () => ({
        type: "Maven",
        languageLevel: "22",
        cleanBeforeTest: true,
        preferWrapper: false,
      }),
      detectJdk: async () => ({
        available: true,
        major: 25,
        path: "C:\\Java\\jdk-25",
        java: "java",
        javac: "javac",
      }),
      toolPath: () => "mvn",
    };
    const service = new BuildService(guard, {}, projects, { list: async () => [] }, () => {});
    service.resolveBuildTool = () => "mvn";
    service.start = (...args: any[]) => {
      invocation = args;
      return {};
    };
    await service.execute({ root, action: "test", configuration: {} });
    expect(invocation[2]).toEqual(expect.arrayContaining([
      "clean",
      "test",
      "-Dmaven.compiler.release=22",
      "-Dmaven.compiler.proc=full",
    ]));
    expect(invocation[2].indexOf("clean")).toBeLessThan(invocation[2].indexOf("test"));
  });

  it("blocks a build when the selected Project SDK is older than the language level", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "jdk-mismatch-"));
    const guard = new PathGuard();
    guard.register(root);
    const service = new BuildService(guard, {}, {
      detect: async () => ({ type: "Maven", languageLevel: "25" }),
      detectJdk: async () => ({ available: true, major: 21, path: "C:\\Java\\jdk-21" }),
      toolPath: () => "mvn",
    }, { list: async () => [] }, () => {});
    await expect(service.execute({ root, action: "build", configuration: {} }))
      .rejects.toThrow(/Java 25.*Java 21/);
  });

  it("persists normalized run configurations under .kiwi", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "run-"));
    const guard = new PathGuard();
    guard.register(root);
    const service = new RunConfigService(guard);
    const saved = await service.save(root, {
      name: "  Main  ",
      type: "java",
      mainClass: "dev.kiwi.Main",
      vmArgs: '-Xmx1G "-Dprofile=local dev"',
      env: { PORT: 8080 },
    });
    expect(saved).toMatchObject({ name: "Main", type: "java", mainClass: "dev.kiwi.Main" });
    expect(await service.list(root)).toEqual([saved]);
    expect(fs.existsSync(path.join(root, ".kiwi", "run-configurations.json"))).toBe(true);
    const compose = await service.save(root, { name: "Compose", type: "compose", target: "up --build" });
    expect(compose).toMatchObject({ type: "compose", target: "up --build" });
  });

  it("keeps quoted VM and program arguments together", () => {
    expect(splitArgs('--name "Kiwi IDE" -Dmode=test')).toEqual(["--name", "Kiwi IDE", "-Dmode=test"]);
  });
});

describe("project SDK settings and Explorer source elements", () => {
  it("migrates legacy project settings without carrying unknown keys forward", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "project-settings-migration-"));
    fs.mkdirSync(path.join(root, ".kiwi"), { recursive: true });
    fs.writeFileSync(path.join(root, ".kiwi", "project.json"), JSON.stringify({
      version: 1,
      languageLevel: 17,
      encoding: "UTF-8",
      excludedPaths: ["legacy"],
      removedOption: true,
    }));
    const guard = new PathGuard();
    guard.register(root);
    const service = new ProjectService(guard, { get: () => ({ jdkPath: "" }) }, "");
    const migrated = await service.readProjectSettings(root);
    expect(migrated).toMatchObject({ languageLevel: "17", excludedPaths: ["legacy"] });
    expect(migrated).not.toHaveProperty("removedOption");
    const persisted = JSON.parse(fs.readFileSync(path.join(root, ".kiwi", "project.json"), "utf8"));
    expect(persisted.version).toBe(CURRENT_PROJECT_SETTINGS_VERSION);
  });

  it("creates ready-to-build CLI, REST, Jakarta and JavaFX project templates", async () => {
    const parent = fs.mkdtempSync(path.join(fixtureRoot, "project-templates-"));
    const guard = new PathGuard();
    guard.register(parent);
    const service = new ProjectService(guard, {
      get: () => ({ jdkPath: "" }),
      rememberWorkspace: async () => {},
    }, "");
    for (const [template, expected] of [
      ["cli", "info.picocli:picocli"],
      ["spring", "org.springframework.boot"],
      ["rest", "org.springframework.boot"],
      ["jakarta", "jakarta.persistence"],
      ["javafx", "org.openjfx.javafxplugin"],
    ]) {
      const created = await service.create({
        location: parent,
        name: `${template}-app`,
        type: "Gradle",
        groupId: "dev.kiwi",
        artifactId: `${template}-app`,
        packageName: `dev.kiwi.${template}`,
        languageLevel: "21",
        template,
      });
      expect(fs.readFileSync(path.join(created.root, "build.gradle.kts"), "utf8")).toContain(expected);
      expect(fs.readFileSync(created.mainFile, "utf8")).toContain("class Main");
      expect(fs.existsSync(path.join(created.root, "src", "test", "java"))).toBe(true);
      expect(fs.existsSync(path.join(created.root, "src", "main", "resources"))).toBe(true);
      expect(fs.existsSync(path.join(created.root, "src", "test", "resources"))).toBe(true);
    }
    const modular = await service.create({
      location: parent,
      name: "modular-app",
      type: "Java",
      groupId: "dev.kiwi",
      artifactId: "modular-app",
      packageName: "dev.kiwi.modular",
      languageLevel: "21",
      template: "modular",
    });
    expect(fs.readFileSync(path.join(modular.root, "src", "main", "java", "module-info.java"), "utf8"))
      .toContain("module dev.kiwi.modular.app");
    const docker = await service.create({
      location: parent,
      name: "docker-app",
      type: "Gradle",
      groupId: "dev.kiwi",
      artifactId: "docker-app",
      packageName: "dev.kiwi.docker",
      languageLevel: "21",
      template: "docker",
    });
    expect(fs.existsSync(path.join(docker.root, "Dockerfile"))).toBe(true);
    expect(fs.existsSync(path.join(docker.root, "compose.yaml"))).toBe(true);
    const javafxInfo = await service.frameworkInfo(path.join(parent, "javafx-app"));
    expect(javafxInfo.symbols).toContainEqual(expect.objectContaining({
      kind: "fxml",
      name: "main.fxml",
      targetPath: expect.stringContaining("MainController.java"),
    }));
    const restInfo = await service.frameworkInfo(path.join(parent, "rest-app"));
    expect(restInfo.symbols).toContainEqual(expect.objectContaining({ kind: "endpoint", name: "GET /api/hello" }));
    const plain = await service.create({
      location: parent,
      name: "plain-app",
      type: "Java",
      groupId: "dev.kiwi",
      artifactId: "plain-app",
      packageName: "dev.kiwi.plain",
      languageLevel: "21",
      template: "standard",
    });
    expect(plain.mainFile).toContain(path.join("src", "main", "java"));
    expect(fs.existsSync(path.join(plain.root, "src", "test", "java"))).toBe(true);
    expect(fs.existsSync(path.join(plain.root, "src", "main", "resources"))).toBe(true);
    expect(fs.existsSync(path.join(plain.root, "src", "test", "resources"))).toBe(true);
  });

  it("persists a project language level and creates Java types in the selected package", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "project-settings-"));
    const packageDir = path.join(root, "src", "main", "java", "dev", "kiwi");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(root, "pom.xml"), "<project />");
    const guard = new PathGuard();
    guard.register(root);
    const service = new ProjectService(guard, { get: () => ({ jdkPath: "" }) }, "");
    service.detect = async () => ({ type: "Maven" });

    const settings = await service.updateProjectSettings(root, {
      languageLevel: "17",
      encoding: "UTF-8",
      compilerArgs: "-parameters",
    });
    expect(settings).toMatchObject({ languageLevel: "17", compilerArgs: "-parameters" });

    const created = await service.createSourceElement(root, packageDir, "record", "UserId");
    expect(created.path).toBe(path.join(packageDir, "UserId.java"));
    expect(fs.readFileSync(created.path, "utf8")).toContain("package dev.kiwi;");
    expect(fs.readFileSync(created.path, "utf8")).toContain("public record UserId()");
  });

  it("lists installed JDKs for project-specific SDK selection", async () => {
    const guard = new PathGuard();
    const service = new ProjectService(guard, { get: () => ({ jdkPath: process.env.JAVA_HOME || "" }) }, "");
    const jdks = await service.listJdks();
    expect(jdks.length).toBeGreaterThan(0);
    expect(jdks[0]).toMatchObject({ available: true });
    expect(jdks[0].major).toBeGreaterThanOrEqual(8);
    expect(jdks[0].path).toBeTruthy();
  });

  it("copies and duplicates Explorer entries without leaving the registered workspace", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "explorer-actions-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target-folder");
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(targetDir);
    const source = path.join(sourceDir, "Main.java");
    fs.writeFileSync(source, "class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});

    const copied = await service.transfer(source, targetDir, false);
    const duplicated = await service.duplicate(source);
    expect(fs.readFileSync(copied, "utf8")).toContain("class Main");
    expect(path.basename(duplicated)).toBe("Main Copy.java");
  });

  it("imports files and folders dropped from Windows without overwriting existing project files", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "external-drop-project-"));
    const sourceRoot = fs.mkdtempSync(path.join(fixtureRoot, "external-drop-source-"));
    const targetDir = path.join(root, "src", "main", "resources");
    fs.mkdirSync(targetDir, { recursive: true });
    const externalFile = path.join(sourceRoot, "config.yml");
    const externalFolder = path.join(sourceRoot, "templates");
    fs.writeFileSync(externalFile, "enabled: true\n");
    fs.mkdirSync(externalFolder);
    fs.writeFileSync(path.join(externalFolder, "welcome.txt"), "Hallo Kiwi\n");
    fs.writeFileSync(path.join(targetDir, "config.yml"), "existing: true\n");
    const changes: any[] = [];
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, (channel: string, payload: any) => {
      if (channel === "workspace:changed") changes.push(payload);
    });

    const imported = await service.importExternal([externalFile, externalFolder], targetDir);
    expect(imported).toEqual([
      path.join(targetDir, "config (2).yml"),
      path.join(targetDir, "templates"),
    ]);
    expect(fs.readFileSync(imported[0], "utf8")).toContain("enabled: true");
    expect(fs.readFileSync(path.join(imported[1], "welcome.txt"), "utf8")).toContain("Hallo Kiwi");
    expect(fs.readFileSync(path.join(targetDir, "config.yml"), "utf8")).toContain("existing: true");
    expect(fs.existsSync(externalFile)).toBe(true);
    expect(changes.at(-1)).toMatchObject({ root, kind: "import", paths: imported });
  });

  it("extends an existing package without duplicating its full path", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "package-extension-"));
    const existing = path.join(root, "src", "main", "java", "de", "game");
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(root, "pom.xml"), "<project />");
    const guard = new PathGuard();
    guard.register(root);
    const service = new ProjectService(guard, { get: () => ({ jdkPath: "" }) }, "");
    service.detect = async () => ({ type: "Maven" });

    const created = await service.createSourceElement(root, existing, "package", "de.game.me");
    expect(created.path).toBe(path.join(existing, "me"));
    expect(fs.existsSync(path.join(existing, "de", "game", "me"))).toBe(false);
  });

  it("creates configurable classes with a base class and interfaces", () => {
    const source = javaTypeSource("class", "Worker", "dev.kiwi", {
      isPublic: true,
      modifier: "abstract",
      extendsType: "BaseWorker",
      interfaces: ["Runnable", "java.io.Serializable"],
    });
    expect(source).toContain(
      "public abstract class Worker extends BaseWorker implements Runnable, java.io.Serializable",
    );
  });

  it("creates a useful checked-exception template", () => {
    const source = javaTypeSource("exception", "CloudException", "dev.kiwi");
    expect(source).toContain("public class CloudException extends Exception");
    expect(source).toContain("public CloudException(String message)");
    expect(source).toContain("super(message);");
  });

  it("renames Java files together with their public type and constructors", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "java-rename-"));
    const sourceFile = path.join(root, "Boot.java");
    fs.writeFileSync(sourceFile, "public class Boot {\n    public Boot() {}\n}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});
    const target = await service.rename(sourceFile, "Launcher.java");
    const renamed = fs.readFileSync(target, "utf8");
    expect(target).toBe(path.join(root, "Launcher.java"));
    expect(renamed).toContain("public class Launcher");
    expect(renamed).toContain("public Launcher()");
    expect(fs.existsSync(sourceFile)).toBe(false);
  });

  it("moves Java classes safely, updates packages and can undo the whole operation", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "java-move-"));
    const oldDir = path.join(root, "src", "main", "java", "dev", "kiwi", "old");
    const newDir = path.join(root, "src", "main", "java", "dev", "kiwi", "api");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    const serviceFile = path.join(oldDir, "GreetingService.java");
    const callerFile = path.join(oldDir, "Caller.java");
    fs.writeFileSync(serviceFile, "package dev.kiwi.old;\npublic class GreetingService {}\n");
    fs.writeFileSync(callerFile, "package dev.kiwi.old;\nclass Caller { GreetingService service; }\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});

    const moved = await service.transfer(serviceFile, newDir, true);
    expect(fs.readFileSync(moved, "utf8")).toContain("package dev.kiwi.api;");
    expect(fs.readFileSync(callerFile, "utf8")).toContain("import dev.kiwi.api.GreetingService;");
    const history = await service.history(root);
    expect(history[0].label).toContain("Verschieben");

    await service.undo(root);
    expect(fs.existsSync(serviceFile)).toBe(true);
    expect(fs.existsSync(moved)).toBe(false);
    expect(fs.readFileSync(callerFile, "utf8")).not.toContain("import dev.kiwi.api.GreetingService;");
  });

  it("moves complete Java package folders and updates package declarations and imports", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "java-package-drop-"));
    const oldPackageDir = path.join(root, "src", "main", "java", "dev", "old");
    const targetParent = path.join(root, "src", "main", "java", "dev", "api");
    const callerDir = path.join(root, "src", "main", "java", "dev", "client");
    fs.mkdirSync(oldPackageDir, { recursive: true });
    fs.mkdirSync(targetParent, { recursive: true });
    fs.mkdirSync(callerDir, { recursive: true });
    fs.writeFileSync(path.join(oldPackageDir, "Service.java"), "package dev.old;\npublic class Service {}\n");
    fs.writeFileSync(path.join(oldPackageDir, "internal.java"), "package dev.old;\nclass internal { Service value; }\n");
    const caller = path.join(callerDir, "Caller.java");
    fs.writeFileSync(caller, "package dev.client;\nimport dev.old.Service;\nclass Caller { Service value; }\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {});

    const movedDirectory = await service.transfer(oldPackageDir, targetParent, true);
    expect(movedDirectory).toBe(path.join(targetParent, "old"));
    expect(fs.existsSync(oldPackageDir)).toBe(false);
    expect(fs.readFileSync(path.join(movedDirectory, "Service.java"), "utf8")).toContain("package dev.api.old;");
    expect(fs.readFileSync(path.join(movedDirectory, "internal.java"), "utf8")).toContain("package dev.api.old;");
    expect(fs.readFileSync(caller, "utf8")).toContain("import dev.api.old.Service;");
  });

  it("invalidates the cached project tree after file operations", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "tree-cache-"));
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});
    expect(await service.readTree(root)).toEqual([]);
    await service.create(root, "Main.java", false);
    expect((await service.readTree(root)).map((node: any) => node.name)).toContain("Main.java");
  });

  it("loads deep Explorer directories lazily for large projects", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "lazy-tree-"));
    const packageDirectory = path.join(root, "src", "dev", "kiwi");
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, "Main.java"), "class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});
    const tree = await service.readTree(root);
    const source = tree.find((node: any) => node.name === "src");
    const dev = source.children.find((node: any) => node.name === "dev");
    expect(source.childrenLoaded).toBe(true);
    expect(dev).toMatchObject({ childrenLoaded: false, children: [] });
    expect((await service.readChildren(root, dev.path))[0].name).toBe("kiwi");
  });

  it("detects Java declaration kinds for distinct Explorer icons", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "java-explorer-icons-"));
    fs.writeFileSync(path.join(root, "Main.java"), "public class Main {}\n");
    fs.writeFileSync(path.join(root, "Worker.java"), "public interface Worker {}\n");
    fs.writeFileSync(path.join(root, "Mode.java"), "public enum Mode { FAST }\n");
    fs.writeFileSync(path.join(root, "Point.java"), "public record Point(int x, int y) {}\n");
    fs.writeFileSync(path.join(root, "Managed.java"), "public @interface Managed {}\n");
    fs.writeFileSync(path.join(root, "LoadException.java"), "public class LoadException extends RuntimeException {}\n");
    fs.writeFileSync(path.join(root, "MainTest.java"), "import org.junit.jupiter.api.Test;\nclass MainTest { @Test void works() {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {});
    const tree = await service.readTree(root);
    expect(Object.fromEntries(tree.map((node: any) => [node.name, node.javaKind]))).toMatchObject({
      "Main.java": "class",
      "Worker.java": "interface",
      "Mode.java": "enum",
      "Point.java": "record",
      "Managed.java": "annotation",
      "LoadException.java": "exception",
      "MainTest.java": "junit",
    });
  });

  it("groups a multi-file refactoring into one project-wide undo checkpoint", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "refactor-undo-"));
    const first = path.join(root, "First.java");
    const second = path.join(root, "Second.java");
    fs.writeFileSync(first, "class First {}\n");
    fs.writeFileSync(second, "class Second {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});
    await service.beginOperation(root, "Typ umbenennen", [first, second]);
    await service.writeFile(first, "class Renamed {}\n");
    await service.writeFile(second, "class Second { Renamed value; }\n");
    service.endOperation(root);
    expect(await service.history(root)).toHaveLength(1);
    const restartedService = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});
    await restartedService.undo(root);
    expect(fs.readFileSync(first, "utf8")).toBe("class First {}\n");
    expect(fs.readFileSync(second, "utf8")).toBe("class Second {}\n");
    expect((await restartedService.history(root))[0].undone).toBe(true);
    await expect(restartedService.undo(root)).rejects.toThrow(/Keine Dateioperation/);
  });

  it("removes deleted entries from the cached tree and emits an immediate change event", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "explorer-delete-"));
    const target = path.join(root, "src", "main", "java", "dev", "kiwi", "OldType.java");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "package dev.kiwi;\nclass OldType {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const events: any[] = [];
    const service = new WorkspaceService(guard, {
      trashItem: async (file: string) => fs.rmSync(file, { recursive: true, force: true }),
      showItemInFolder: () => {},
    }, (channel: string, payload: any) => events.push({ channel, payload }));
    await service.readTree(root);
    await service.delete(target);
    expect(fs.existsSync(target)).toBe(false);
    expect(events).toContainEqual({
      channel: "workspace:changed",
      payload: { root, path: target, paths: [target], kind: "delete" },
    });
    expect(JSON.stringify(await service.readTree(root))).not.toContain("OldType.java");
  });

  it("tracks files created and deleted outside Kiwi and refreshes the cached tree", async () => {
    if (process.platform !== "win32") return;
    const root = fs.mkdtempSync(path.join(fixtureRoot, "external-watch-"));
    const guard = new PathGuard();
    guard.register(root);
    const events: any[] = [];
    const service = new WorkspaceService(guard, {}, (channel: string, payload: any) => {
      if (channel === "workspace:changed") events.push(payload);
    }, {
      get: () => ({
        explorerHideBuild: false,
        explorerHideDotDirectories: true,
        explorerHideGenerated: true,
        explorerExcludedPatterns: [],
      }),
    });
    expect(await service.readTree(root)).toEqual([]);
    expect(service.watch(root)).toBe(true);
    try {
      const target = path.join(root, "External.java");
      fs.writeFileSync(target, "class External {}\n");
      await waitUntil(() => events.some((event) => event.paths?.includes(target)));
      expect(events.find((event) => event.paths?.includes(target))?.kind).toBe("rename");
      expect((await service.readTree(root)).map((node: any) => node.name)).toContain("External.java");

      const count = events.length;
      fs.rmSync(target);
      await waitUntil(() => events.length > count);
      expect((await service.readTree(root)).map((node: any) => node.name)).not.toContain("External.java");
    } finally {
      service.dispose();
    }
  });
});

describe("dependency inspection", () => {
  it("keeps Gradle tasks in their declared groups", () => {
    const tasks = parseGradleTasks(`Build tasks
-----------
assemble - Assembles this project.
build - Assembles and tests this project.

Verification tasks
------------------
test - Runs the test suite.

Other tasks
-----------
compileJava - Compiles main Java source.`);
    expect(tasks).toEqual([
      { name: "assemble", description: "Assembles this project.", group: "Build" },
      { name: "build", description: "Assembles and tests this project.", group: "Build" },
      { name: "test", description: "Runs the test suite.", group: "Verification" },
      { name: "compileJava", description: "Compiles main Java source.", group: "Other" },
    ]);
  });

  it("finds Maven dependency risks without requiring a network connection", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "dependency-audit-"));
    fs.writeFileSync(path.join(root, "pom.xml"), `<project><dependencies>
      <dependency><groupId>dev.kiwi</groupId><artifactId>stable</artifactId><version>1.0.0</version></dependency>
      <dependency><groupId>dev.kiwi</groupId><artifactId>changing</artifactId><version>2.0-SNAPSHOT</version></dependency>
    </dependencies></project>`);
    const guard = new PathGuard();
    guard.register(root);
    const service = new BuildService(guard, {}, {
      detect: async () => ({ type: "Maven" }),
      toolPath: () => "",
    }, () => {});
    const audit = await service.auditDependencies(root);
    expect(audit.dependencies).toHaveLength(2);
    expect(audit.warnings[0]).toMatchObject({ coordinate: "dev.kiwi:changing" });
    expect(audit.securityTask).toContain("dependency-check");
  });
});

describe("module plans and graph validation", () => {
  it("creates a plain module through a hash-checked plan without deleting sources", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "plain-modules-"));
    const guard = new PathGuard();
    guard.register(root);
    const projects = {
      detect: async () => ({ type: "Java", languageLevel: "17" }),
    };
    const service = new ModuleService(guard, projects);
    const plan = await service.previewCreate(root, {
      name: "core",
      packageName: "dev.kiwi.core",
      languageLevel: "17",
      jpms: { name: "dev.kiwi.core", exports: ["dev.kiwi.core"] },
    });
    expect(plan.files.some((file: any) => file.path.endsWith("module-info.java"))).toBe(true);
    const applied = await service.applyPlan(root, plan.id);
    expect(applied.applied).toBe(true);
    expect(fs.readFileSync(path.join(root, ".kiwi", "modules.json"), "utf8")).toContain("\"core\"");
    expect(fs.existsSync(path.join(root, "core", "src", "main", "resources"))).toBe(true);
    expect(fs.existsSync(path.join(root, "core", "src", "test", "resources"))).toBe(true);

    const detach = await service.previewRemove(root, "core");
    expect(detach.files.some((file: any) => file.path.includes(`${path.sep}core${path.sep}src`))).toBe(false);
    expect(fs.existsSync(path.join(root, "core", "src", "main", "java"))).toBe(true);
  });

  it("accepts module display names containing numbers, spaces and special characters", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "special-module-name-"));
    const guard = new PathGuard();
    guard.register(root);
    const service = new ModuleService(guard, { detect: async () => ({ type: "Java", languageLevel: "21" }) });
    const plan = await service.previewCreate(root, {
      name: "2D Core + API @ 2026",
      packageName: "dev.kiwi.core2",
      jpms: { name: "2D Core + API @ 2026" },
    });
    expect(plan.module.name).toBe("2D Core + API @ 2026");
    expect(plan.module.id).toMatch(/^2D_Core_API_2026-/);
    expect(plan.module.root).toContain(`2D Core + API @ 2026`);
    await service.applyPlan(root, plan.id);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, ".kiwi", "modules.json"), "utf8"));
    expect(metadata.modules[0].name).toBe("2D Core + API @ 2026");
    expect(fs.readFileSync(path.join(plan.module.root, "src", "main", "java", "module-info.java"), "utf8"))
      .toContain("module _2d.core.api._2026");
  });

  it("rejects stale plans and reports dependency cycles", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "stale-module-plan-"));
    const guard = new PathGuard();
    guard.register(root);
    const service = new ModuleService(guard, { detect: async () => ({ type: "Java", languageLevel: "21" }) });
    const plan = await service.previewCreate(root, { name: "api", packageName: "dev.kiwi.api", jpms: false });
    const metadata = plan.files.find((file: any) => file.path.endsWith("modules.json"));
    fs.mkdirSync(path.dirname(metadata.path), { recursive: true });
    fs.writeFileSync(metadata.path, "{\"changed\":true}\n");
    await expect(service.applyPlan(root, plan.id)).rejects.toThrow(/während der Vorbereitung geändert/);

    expect(() => topologicalSortModules([
      { id: "a", dependencies: ["b"] },
      { id: "b", dependencies: ["a"] },
    ])).toThrow(/Zyklische Modulabhängigkeit/);
  });

  it("parses all supported JPMS directives", () => {
    expect(parseModuleInfo(`module dev.kiwi.app {
      requires java.sql;
      requires transitive dev.kiwi.api;
      exports dev.kiwi.app;
      opens dev.kiwi.internal;
      uses dev.kiwi.Service;
      provides dev.kiwi.Service with dev.kiwi.ServiceImpl;
    }`)).toMatchObject({
      name: "dev.kiwi.app",
      requires: ["java.sql"],
      requiresTransitive: ["dev.kiwi.api"],
      exports: ["dev.kiwi.app"],
      opens: ["dev.kiwi.internal"],
      uses: ["dev.kiwi.Service"],
    });
  });
});

describe("Git workflow", () => {
  it("parses staged, unstaged and branch state from a real repository", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "git-"));
    const guard = new PathGuard();
    guard.register(root);
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    fs.writeFileSync(path.join(root, "Main.java"), "class Main {}\n");
    const service = new GitService(guard);
    let status = await service.status(root);
    expect(status).toMatchObject({ available: true, branch: "main" });
    expect(status.files[0]).toMatchObject({ path: "Main.java", staged: false });
    status = await service.stage(root, [path.join(root, "Main.java")]);
    expect(status.files[0].staged).toBe(true);
    await service.commit(root, "Initial commit");
    await service.createBranch(root, "feature/ide", true);
    expect((await service.status(root)).branch).toBe("feature/ide");
    fs.writeFileSync(path.join(root, "Main.java"), "class Main { int feature; }\n");
    await service.stage(root, [path.join(root, "Main.java")]);
    await service.commit(root, "Feature commit");
    const comparison = await service.compare(root, "main", "feature/ide");
    expect(comparison).toMatchObject({ base: "main", head: "feature/ide", leftOnly: 0, rightOnly: 1 });
    expect(comparison.commits[0]).toContain("Feature commit");
    expect(comparison.patch).toContain("int feature");
  });

  it("stages a single diff hunk while leaving other changes unstaged", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "git-hunk-"));
    const guard = new PathGuard();
    guard.register(root);
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    const file = path.join(root, "Main.java");
    const initial = Array.from({ length: 24 }, (_, index) => `// line ${index + 1}`);
    fs.writeFileSync(file, `${initial.join("\n")}\n`);
    execFileSync("git", ["add", "Main.java"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    const changed = [...initial];
    changed[1] = "// first changed";
    changed[21] = "// second changed";
    fs.writeFileSync(file, `${changed.join("\n")}\n`);
    const service = new GitService(guard);
    expect(await service.hunks(root, file)).toHaveLength(2);
    const result = await service.applyHunk(root, file, 0);
    expect(result.status.files[0]).toMatchObject({ staged: true, workingTree: "M" });
    expect(await service.diff(root, file, true)).toContain("first changed");
    expect(await service.diff(root, file, true)).not.toContain("second changed");
  });

  it("stages selected changed lines from one diff hunk", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "git-lines-"));
    const guard = new PathGuard();
    guard.register(root);
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    const file = path.join(root, "Main.java");
    const initial = Array.from({ length: 10 }, (_, index) => `// line ${index + 1}`);
    fs.writeFileSync(file, `${initial.join("\n")}\n`);
    execFileSync("git", ["add", "Main.java"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    const changed = [...initial];
    changed[1] = "// selected line";
    changed[3] = "// untouched line";
    fs.writeFileSync(file, `${changed.join("\n")}\n`);
    const service = new GitService(guard);
    const [hunk] = await service.hunks(root, file);
    expect(hunk.changes).toHaveLength(2);
    const result = await service.applyLines(root, file, 0, [hunk.changes[0].id]);
    expect(result.status.files[0]).toMatchObject({ staged: true, workingTree: "M" });
    expect(await service.diff(root, file, true)).toContain("selected line");
    expect(await service.diff(root, file, true)).not.toContain("untouched line");
  });
});

describe("committing in one step", () => {
  function repository() {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "commit-"));
    const file = path.join(root, "Main.java");
    fs.writeFileSync(file, "class Main {}\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    execFileSync("git", ["add", "Main.java"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    const guard = new PathGuard();
    guard.register(root);
    return { root, file, git: new GitService(guard) };
  }

  const subjects = (root: string) =>
    execFileSync("git", ["log", "--pretty=%s"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/);

  it("stages everything and commits in one action", async () => {
    const { root, file, git } = repository();
    fs.writeFileSync(file, "class Main { int value; }\n");
    fs.writeFileSync(path.join(root, "Extra.java"), "class Extra {}\n");

    // Staging used to be a separate step before the message could be sent.
    const result = await git.commit(root, "alles auf einmal", { stageAll: true });
    expect(result.status.files.filter((entry: any) => !entry.ignored)).toEqual([]);
    expect(subjects(root)[0]).toBe("alles auf einmal");
  });

  it("still refuses a commit with nothing staged", async () => {
    const { root, git } = repository();
    await expect(git.commit(root, "leer")).rejects.toThrow(/keine Änderungen gestagt/i);
  });

  it("still refuses an empty message", async () => {
    const { root, file, git } = repository();
    fs.writeFileSync(file, "class Main { int a; }\n");
    await expect(git.commit(root, "   ", { stageAll: true })).rejects.toThrow(/Commit-Nachricht/i);
  });

  it("amends the previous commit instead of adding another", async () => {
    const { root, file, git } = repository();
    fs.writeFileSync(file, "class Main { int value; }\n");
    await git.commit(root, "erster Wurf", { stageAll: true });
    expect(subjects(root)).toHaveLength(2);

    fs.writeFileSync(file, "class Main { int value = 1; }\n");
    await git.commit(root, "nachgebessert", { stageAll: true, amend: true });
    // The follow-up correction belongs to the same commit, not a new one.
    expect(subjects(root)).toHaveLength(2);
    expect(subjects(root)[0]).toBe("nachgebessert");
  });

  it("keeps the old message when amending without a new one", async () => {
    const { root, file, git } = repository();
    fs.writeFileSync(file, "class Main { int value; }\n");
    await git.commit(root, "behalte mich", { stageAll: true });
    fs.writeFileSync(file, "class Main { int value = 2; }\n");
    await git.commit(root, "", { stageAll: true, amend: true });
    expect(subjects(root)[0]).toBe("behalte mich");
    expect(subjects(root)).toHaveLength(2);
  });
});

describe("extended Git workflow", () => {
  it("persists, lists and reapplies a stash", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "stash-"));
    const file = path.join(root, "Main.java");
    fs.writeFileSync(file, "class Main {}\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    execFileSync("git", ["add", "Main.java"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    fs.writeFileSync(file, "class Main { int value; }\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new GitService(guard);
    const saved = await service.stashSave(root, "work", true);
    expect(saved.stashes[0].message).toContain("work");
    expect(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe("class Main {}\n");
    const restored = await service.stashApply(root, saved.stashes[0].ref, true);
    expect(restored.stashes).toHaveLength(0);
    expect(fs.readFileSync(file, "utf8")).toContain("int value");
  });
});

describe("JUnit report parsing", () => {
  it("discovers nested, parameterized and dynamic JUnit tests", () => {
    const suites = discoverTestsInSource(`package dev.kiwi;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
class ExampleTest {
  @Test void regular() {}
  @ParameterizedTest void withValues(String value) {}
  @TestFactory Object dynamicTests() { return null; }
  @Nested class Inner {
    @DisplayName("lesbarer Name")
    @RepeatedTest(3) void repeated() {}
  }
}
`, "ExampleTest.java");
    expect(suites.map((suite: any) => suite.id)).toEqual(["dev.kiwi.ExampleTest", "dev.kiwi.ExampleTest$Inner"]);
    expect(suites[0].methods.map((method: any) => method.kind)).toEqual(["test", "parameterized", "dynamic"]);
    expect(suites[1]).toMatchObject({ nested: true, methods: [{ displayName: "lesbarer Name", kind: "repeated" }] });
  });

  it("parses Maven and Gradle dependency trees with version conflicts", () => {
    const maven = parseMavenDependencyTree(`[INFO] +- org.slf4j:slf4j-api:jar:2.0.16:compile
[INFO] |  \\- org.example:core:jar:1.0:compile
[INFO] \\- org.slf4j:slf4j-api:jar:1.7.36:compile (omitted for conflict with 2.0.16)`);
    expect(maven.configurations[0].nodes[0].children[0].coordinate).toBe("org.example:core");
    expect(maven.conflicts[0]).toMatchObject({ coordinate: "org.slf4j:slf4j-api", requested: "1.7.36", selected: "2.0.16" });

    const gradle = parseGradleDependencyTree(`runtimeClasspath - Runtime classpath.
+--- org.slf4j:slf4j-api:1.7.36 -> 2.0.16
\\--- org.example:core:1.0`);
    expect(gradle.configurations[0].nodes[0]).toMatchObject({ version: "2.0.16", requestedVersion: "1.7.36", conflict: true });
  });

  it("lists the projects a subproject depends on", () => {
    // In a multi-project build these are the commonest dependencies there are,
    // and the parser dropped every one of them: it only ever matched a
    // group:artifact:version triple, so a Dependencies branch in the build tool
    // window came back empty for a module that plainly had some.
    const gradle = parseGradleDependencyTree(`compileClasspath - Compile classpath for source set 'main'.
\\--- project ':leafcloud-module'

testRuntimeClasspath - Runtime classpath of source set 'test'.
+--- project ':leafcloud-module'
\\--- project ':leafcloud-driver'
     \\--- org.example:core:1.0`);
    expect(gradle.configurations.map((entry) => entry.name))
      .toEqual(["compileClasspath", "testRuntimeClasspath"]);
    expect(gradle.configurations[0].nodes).toHaveLength(1);
    expect(gradle.configurations[0].nodes[0]).toMatchObject({
      artifact: "leafcloud-module",
      group: "Projekt",
      version: "",
      coordinate: "project :leafcloud-module",
    });
    expect(gradle.configurations[1].nodes.map((node) => node.artifact))
      .toEqual(["leafcloud-module", "leafcloud-driver"]);
    // A library underneath a project dependency still belongs to it.
    expect(gradle.configurations[1].nodes[1].children[0]).toMatchObject({ artifact: "core", version: "1.0" });
  });

  it("reads a task list once and answers from it after that", async () => {
    // Asking Gradle costs a configuration phase, so the second question must
    // not reach it at all.
    const root = fs.mkdtempSync(path.join(fixtureRoot, "tasks-cache-"));
    fs.writeFileSync(path.join(root, "settings.gradle.kts"), 'rootProject.name = "demo"');
    fs.writeFileSync(path.join(root, "build.gradle.kts"), "plugins { java }");
    const guard = new PathGuard();
    guard.register(root);
    const projects = new ProjectService(guard, { get: () => ({}) }, path.join(process.cwd(), "resources", "toolchain"));
    const builds = new BuildService(guard, {}, projects, { list: async () => [] }, () => {});

    let readings = 0;
    builds.readTasks = async () => {
      readings += 1;
      return { type: "Gradle", tasks: [{ name: "build", description: "", group: "Build" }], modules: [], subprojects: [], profiles: [] };
    };

    expect((await builds.listTasks(root)).tasks).toHaveLength(1);
    expect((await builds.listTasks(root)).tasks).toHaveLength(1);
    expect(readings).toBe(1);

    // The same project spelled the way another caller would spell it. The
    // preload asks with the workspace state's path and the renderer with its
    // own, and on Windows those differ in slashes and in case — so every entry
    // was written under one key and looked up under another.
    expect((await builds.listTasks(root.replace(/\\/g, "/"))).tasks).toHaveLength(1);
    expect((await builds.listTasks(root.toUpperCase())).tasks).toHaveLength(1);
    expect(readings).toBe(1);

    // Refresh is the reload button, and it has to reach Gradle.
    await builds.listTasks(root, { refresh: true });
    expect(readings).toBe(2);

    // And a build file written again invalidates what was stored.
    const later = new Date(Date.now() + 4_000);
    fs.writeFileSync(path.join(root, "build.gradle.kts"), 'plugins { java }' + String.fromCharCode(10) + 'tasks.register("neu") {}');
    fs.utimesSync(path.join(root, "build.gradle.kts"), later, later);
    await builds.listTasks(root);
    expect(readings).toBe(3);
  });

  it("never stores a task list that came with a reason", async () => {
    // A fallback list means Gradle could not answer. Remembering it would hide
    // the fix when it arrives.
    const root = fs.mkdtempSync(path.join(fixtureRoot, "tasks-reason-"));
    fs.writeFileSync(path.join(root, "build.gradle.kts"), "plugins { java }");
    const guard = new PathGuard();
    guard.register(root);
    const projects = new ProjectService(guard, { get: () => ({}) }, path.join(process.cwd(), "resources", "toolchain"));
    const builds = new BuildService(guard, {}, projects, { list: async () => [] }, () => {});

    let readings = 0;
    builds.readTasks = async () => {
      readings += 1;
      return { type: "Gradle", tasks: [], modules: [], profiles: [], reason: "Gradle konnte nicht konfigurieren." };
    };
    await builds.listTasks(root);
    await builds.listTasks(root);
    expect(readings).toBe(2);
  });

  it("keeps a project dependency Gradle has not resolved", () => {
    const gradle = parseGradleDependencyTree(`implementation - Implementation dependencies. (n)
\\--- project leafcloud-module (n)`);
    expect(gradle.configurations[0].nodes[0]).toMatchObject({ artifact: "leafcloud-module", group: "Projekt" });
  });

  it("reads Surefire pass, failure and duration data", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "reports-"));
    const reportDir = path.join(root, "target", "surefire-reports");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "TEST-dev.kiwi.MainTest.xml"), `<?xml version="1.0"?>
<testsuite name="dev.kiwi.MainTest" tests="2" failures="1" errors="0" skipped="0" time="0.42">
  <testcase name="works" classname="dev.kiwi.MainTest" time="0.1"/>
  <testcase name="fails" classname="dev.kiwi.MainTest" time="0.32"><failure message="expected true">stack</failure></testcase>
</testsuite>`);
    const guard = new PathGuard();
    guard.register(root);
    const service = new TestService(guard, {}, {}, {});
    const reports = await service.results(root);
    expect(reports[0]).toMatchObject({ tests: 2, failures: 1, time: 0.42 });
    expect(reports[0].cases.map((item: any) => item.status)).toEqual(["passed", "failed"]);

    fs.writeFileSync(path.join(reportDir, "TEST-dev.kiwi.MainTest.xml"), `<?xml version="1.0"?>
<testsuite name="dev.kiwi.MainTest" tests="2" failures="0" errors="0" skipped="0" time="0.21">
  <testcase name="works" classname="dev.kiwi.MainTest" time="0.1"/>
  <testcase name="fails" classname="dev.kiwi.MainTest" time="0.11"/>
</testsuite>`);
    await service.results(root);
    const history = await service.history(root);
    expect(history.runs).toHaveLength(2);
    expect(history.flaky).toMatchObject([{
      id: "dev.kiwi.MainTest#fails",
      passes: 1,
      failures: 1,
      lastStatus: "passed",
    }]);
  });

  it("maps JaCoCo line coverage back to Java source files", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "coverage-"));
    const source = path.join(root, "src", "main", "java", "dev", "kiwi", "Main.java");
    const report = path.join(root, "target", "site", "jacoco", "jacoco.xml");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(source, "package dev.kiwi;\nclass Main {}\n");
    fs.writeFileSync(report, `<report name="Kiwi"><package name="dev/kiwi"><sourcefile name="Main.java">
      <line nr="1" mi="0" ci="3"/><line nr="2" mi="4" ci="0"/>
    </sourcefile></package></report>`);
    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});
    const service = new TestService(guard, workspace, {}, {});
    const coverage = await service.coverageResults(root);
    expect(coverage[0]).toMatchObject({
      path: source,
      lines: [
        { line: 1, covered: true, coveredInstructions: 3 },
        { line: 2, covered: false, missedInstructions: 4 },
      ],
      summary: { packageName: "dev.kiwi", coveredLines: 1, missedLines: 1 },
    });
  });
});

describe("icon export", () => {
  it("creates transparent PNG and multi-resolution ICO assets", async () => {
    const png = fs.readFileSync(path.join(process.cwd(), "assets", "icons", "kiwi-256.png"));
    const ico = fs.readFileSync(path.join(process.cwd(), "assets", "icons", "kiwi.ico"));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(4);
    const mark = fs.readFileSync(path.join(process.cwd(), "assets", "branding", "kiwi-logo-mark.png"));
    expect([...mark.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const { data, info } = await sharp(mark).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = false;
    let opaque = false;
    for (let index = 3; index < data.length; index += info.channels) {
      transparent ||= data[index] === 0;
      opaque ||= data[index] === 255;
      if (transparent && opaque) break;
    }
    expect(transparent).toBe(true);
    expect(opaque).toBe(true);
  });
});

describe("Explorer drop authorization", () => {
  it("keeps every token of a multi-file drop from the same window valid", () => {
    const service = new DropTokenService();
    const first = service.issue("C:/tmp/a.txt", 7);
    const second = service.issue("C:/tmp/b.txt", 7);
    const third = service.issue("C:/tmp/c.txt", 7);
    expect(new Set([first, second, third]).size).toBe(3);
    expect(service.consume([first, second, third], 7)).toEqual([
      "C:/tmp/a.txt",
      "C:/tmp/b.txt",
      "C:/tmp/c.txt",
    ]);
    expect(service.size).toBe(0);
  });

  it("rejects tokens of another window, replays and expired authorizations", () => {
    let clock = 1_000;
    const service = new DropTokenService({ ttlMs: 500, now: () => clock });
    const mine = service.issue("C:/tmp/mine.txt", 1);
    const other = service.issue("C:/tmp/other.txt", 2);
    expect(service.consume([mine, other], 1)).toEqual(["C:/tmp/mine.txt"]);
    expect(service.consume([mine], 1)).toEqual([]);

    const stale = service.issue("C:/tmp/stale.txt", 1);
    clock += 501;
    expect(service.consume([stale], 1)).toEqual([]);
    expect(service.size).toBe(0);
  });

  it("bounds the number of outstanding tokens per window", () => {
    const service = new DropTokenService({ maxPerWindow: 3 });
    const tokens = ["a", "b", "c", "d"].map((name) => service.issue(`C:/tmp/${name}`, 5));
    expect(service.size).toBe(3);
    expect(service.consume(tokens, 5)).toEqual(["C:/tmp/b", "C:/tmp/c", "C:/tmp/d"]);
  });
});

describe("file transfer safety", () => {
  it("never overwrites an existing target when copying or importing", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "copy-guard-"));
    const outside = fs.mkdtempSync(path.join(fixtureRoot, "copy-external-"));
    const targetDirectory = path.join(root, "target-dir");
    fs.mkdirSync(targetDirectory, { recursive: true });
    fs.writeFileSync(path.join(root, "Note.txt"), "SOURCE");
    fs.writeFileSync(path.join(targetDirectory, "Note.txt"), "EXISTING");
    fs.writeFileSync(path.join(outside, "Note.txt"), "EXTERNAL");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {});

    await expect(service.transfer(path.join(root, "Note.txt"), targetDirectory, false))
      .rejects.toThrow(/existiert bereits/);
    expect(fs.readFileSync(path.join(targetDirectory, "Note.txt"), "utf8")).toBe("EXISTING");

    const imported = await service.importExternal([path.join(outside, "Note.txt")], targetDirectory);
    expect(imported).toEqual([path.join(targetDirectory, "Note (2).txt")]);
    expect(fs.readFileSync(path.join(targetDirectory, "Note.txt"), "utf8")).toBe("EXISTING");
    expect(fs.readFileSync(imported[0], "utf8")).toBe("EXTERNAL");
  });

  it("invalidates the tree cache for differently normalized project roots", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "cache-normalize-"));
    fs.writeFileSync(path.join(root, "First.java"), "class First {}\n");
    const guard = new PathGuard();
    const registered = guard.register(root);
    const service = new WorkspaceService(guard, {}, () => {});
    const variant = process.platform === "win32" ? registered.toUpperCase() : `${registered}${path.sep}.`;
    expect((await service.readTree(variant)).map((node: any) => node.name)).toEqual(["First.java"]);

    fs.writeFileSync(path.join(root, "Second.java"), "class Second {}\n");
    service.invalidate(registered);
    expect((await service.readTree(variant)).map((node: any) => node.name)).toEqual([
      "First.java",
      "Second.java",
    ]);
  });
});

describe("debug session lifecycle", () => {
  it("selects a real main class instead of the active utility source", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "debug-main-selection-"));
    const sourceRoot = path.join(root, "src", "demo");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const utility = path.join(sourceRoot, "Utility.java");
    const main = path.join(sourceRoot, "Launcher.java");
    fs.writeFileSync(utility, "package demo; public class Utility { static int value() { return 1; } }\n");
    fs.writeFileSync(main, "package demo; public class Launcher { public static void main(String[] args) {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {});
    const builds = new BuildService(guard, workspace, {}, { list: async () => [] }, () => {});

    await expect(builds.mainClass(utility, root)).resolves.toMatchObject({
      entry: main,
      qualifiedName: "demo.Launcher",
    });
    await expect(builds.mainClass(utility, root, "demo.Launcher")).resolves.toMatchObject({
      entry: main,
      qualifiedName: "demo.Launcher",
    });
  });

  it("explains how libraries and server plugins have to be debugged", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "debug-no-main-"));
    const source = path.join(root, "Plugin.java");
    fs.writeFileSync(source, "public class Plugin { void enable() {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const workspace = new WorkspaceService(guard, {}, () => {});
    const builds = new BuildService(guard, workspace, {}, { list: async () => [] }, () => {});

    await expect(builds.mainClass(source, root)).rejects.toThrow(/Server-Plugins.*JDWP.*andocken/s);
  });

  it("enables preview features in the launched debug VM", () => {
    const args = debugVmArgs(
      { vmArgs: "-Xmx256m", programArgs: "one two" },
      { previewFeatures: true },
      5005,
      "C:/demo/classes",
      "demo.Main",
    );
    expect(args).toEqual([
      "-Xmx256m",
      "--enable-preview",
      "-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:5005",
      "-cp",
      "C:/demo/classes",
      "demo.Main",
      "one",
      "two",
    ]);
  });

  it("cleans up a session when compilation fails before the VM starts", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "debug-start-cleanup-"));
    const source = path.join(root, "Main.java");
    fs.writeFileSync(source, "public class Main { public static void main(String[] args) {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const events: any[] = [];
    const projects = {
      detect: async () => ({ type: "Java", languageLevel: "21", encoding: "UTF-8", compilerArgs: "", previewFeatures: false }),
      detectJdk: async () => ({
        available: true,
        major: 21,
        path: root,
        javac: path.join(root, "missing-javac.exe"),
        java: path.join(root, "missing-java.exe"),
      }),
    };
    const builds = {
      modules: { list: async () => [] },
      mainClass: async () => ({ entry: source, qualifiedName: "Main", sources: [source] }),
      moduleOwning: async () => null,
    };
    const service = new DebugService(guard, {}, projects, builds, (channel: string, payload: any) => {
      events.push({ channel, payload });
    });

    await expect(service.start({ root, file: source })).rejects.toThrow();
    expect(service.health()).toMatchObject({ active: false, root: "", adapterPid: 0, vmPid: 0 });
    expect(events.some((event) => event.channel === "debug:state" && event.payload.status === "stopped")).toBe(true);
  });

  it("serializes HotSwap and coalesces repeated saves of the same source", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-queue-"));
    const source = path.join(root, "Main.java");
    const otherSource = path.join(root, "Other.java");
    fs.writeFileSync(source, "class Main {}\n");
    fs.writeFileSync(otherSource, "class Other {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.sessionEpoch = 1;
    service.waitForHotReplaceReady = async () => {};

    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let startedFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve; });
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    service.hotReplace = async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) {
        startedFirst();
        await firstBlocked;
      }
      active -= 1;
      return { queued: true };
    };

    const first = service.enqueueHotReplace(source);
    await firstStarted;
    const second = service.enqueueHotReplace(source);
    const third = service.enqueueHotReplace(source);
    const other = service.enqueueHotReplace(otherSource);
    releaseFirst();
    await Promise.all([first, second, third, other]);

    expect(calls).toBe(3);
    expect(maximumActive).toBe(1);
    expect(service.hotReplacePending.size).toBe(0);
    expect(service.hotReplaceVersions.size).toBe(0);
  });

  it("commits a HotSwap baseline only after the adapter confirms it", () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-adapter-baseline-"));
    const source = path.join(root, "Main.java");
    const before = "class Main { int value() { return 1; } }";
    const rejected = "class Main { int value() { return 2; } }";
    const accepted = "class Main { int value() { return 3; } }";
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.hotReplaceSources.set(path.normalize(source), before);
    const encoded = (value: string) => Buffer.from(value, "utf8").toString("base64");

    service.hotReplaceRevisions.set("rejected", { file: path.normalize(source), source: rejected });
    service.consumeAdapter(`KIWI\tHOT_REPLACE\terror\t${encoded("rejected")}\t${encoded("schema change")}\n`);
    expect(service.hotReplaceSources.get(path.normalize(source))).toBe(before);
    expect(service.hotReplaceRevisions.has("rejected")).toBe(false);

    service.hotReplaceRevisions.set("accepted", { file: path.normalize(source), source: accepted });
    service.consumeAdapter(`KIWI\tHOT_REPLACE\tok\t${encoded("accepted")}\t${encoded("updated")}\n`);
    expect(service.hotReplaceSources.get(path.normalize(source))).toBe(accepted);
    expect(service.hotReplaceRevisions.has("accepted")).toBe(false);
  });

  it("uses the exact renderer baseline when no confirmed source snapshot exists", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-exact-baseline-"));
    const source = path.join(root, "Main.java");
    const before = "class Main { public static void main(String[] args) { color = RED; } }";
    const after = before.replace("RED", "GREEN");
    fs.writeFileSync(source, after);
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.sessionEpoch = 4;
    service.adapter = { stdin: { writable: true, write: () => true } };
    service.targetJdk = {};
    service.launchRequest = { root, file: source, configuration: {}, breakpoints: [] };
    let relaunched = false;
    service.relaunchForHotReplace = async () => {
      relaunched = true;
      return { restarted: true };
    };

    await service.hotReplace(source, 4, "smart", before);

    expect(relaunched).toBe(true);
  });

  it("preserves the earliest baseline when synchronous saves are coalesced", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-coalesced-baseline-"));
    const source = path.join(root, "Main.java");
    fs.writeFileSync(source, "class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.sessionEpoch = 6;
    service.waitForHotReplaceReady = async () => {};
    const baselines: string[] = [];
    service.hotReplace = async (_file: string, _epoch: number, _mode: string, previousSource?: string) => {
      baselines.push(previousSource || "");
      return { queued: true };
    };

    // Both enqueues happen before the queue's first microtask. The second
    // request is the source to compile, but v0 remains the VM comparison base.
    const first = service.enqueueHotReplace({ file: source, mode: "smart", previousSource: "v0-main-red" });
    const second = service.enqueueHotReplace({ file: source, mode: "smart", previousSource: "v1-main-green" });
    await Promise.all([first, second]);

    expect(baselines).toEqual(["v0-main-red"]);
  });

  it("does not trust a rejected renderer revision as the next VM baseline", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-rejected-sequence-"));
    const source = path.join(root, "Main.java");
    const v0 = "class Main { public static void main(String[] args) { color = RED; } static int helper() { return 1; } }";
    const rejectedV1 = v0.replace("RED", "GREEN");
    const v2 = rejectedV1.replace("return 1", "return 2");
    fs.writeFileSync(source, v2);
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.sessionEpoch = 7;
    service.adapter = { stdin: { writable: true, write: () => true } };
    service.targetJdk = {};
    service.launchRequest = { root, file: source, configuration: {}, breakpoints: [] };
    service.hotReplaceSources.set(path.normalize(source), v0);
    const encoded = (value: string) => Buffer.from(value, "utf8").toString("base64");
    service.hotReplaceRevisions.set("v1", { file: path.normalize(source), source: rejectedV1 });
    service.consumeAdapter(`KIWI\tHOT_REPLACE\terror\t${encoded("v1")}\t${encoded("rejected")}\n`);
    let relaunched = false;
    service.relaunchForHotReplace = async () => {
      relaunched = true;
      return { restarted: true };
    };

    // v1→v2 only changes a normal helper and would use redefine. The actual
    // VM is still v0, so v0→v2 includes already-run main() and must relaunch.
    await service.hotReplace(source, 7, "smart", rejectedV1);

    expect(service.hotReplaceSources.get(path.normalize(source))).toBe(v0);
    expect(relaunched).toBe(true);
  });

  it("keeps the newest save queued while Smart HotSwap relaunches the VM", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-save-during-relaunch-"));
    const source = path.join(root, "Main.java");
    fs.writeFileSync(source, "class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.sessionEpoch = 8;
    service.waitForHotReplaceReady = async () => {};
    const seen: Array<{ epoch: number; previousSource?: string }> = [];
    let releaseRelaunch!: () => void;
    const relaunchBlocked = new Promise<void>((resolve) => { releaseRelaunch = resolve; });
    let firstStarted!: () => void;
    const firstWasStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
    service.hotReplace = async (_file: string, epoch: number, _mode: string, previousSource?: string) => {
      seen.push({ epoch, previousSource });
      if (seen.length === 1) {
        firstStarted();
        // An internal relaunch changes sessionEpoch but intentionally does not
        // cancel the versioned HotSwap queue.
        service.sessionEpoch += 1;
        await relaunchBlocked;
      }
      return { queued: true };
    };

    const first = service.enqueueHotReplace({ file: source, mode: "smart", previousSource: "revision-0" });
    await firstWasStarted;
    const duringRelaunch = service.enqueueHotReplace({ file: source, mode: "smart", previousSource: "revision-1" });
    releaseRelaunch();
    await Promise.all([first, duringRelaunch]);

    expect(seen).toEqual([
      { epoch: 8, previousSource: "revision-0" },
      { epoch: 9, previousSource: "revision-0" },
    ]);
    expect(service.hotReplacePending.size).toBe(0);
    expect(service.hotReplaceRequests.size).toBe(0);
  });

  it("continues with a queued newer revision after the active revision fails", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "hot-swap-newer-after-failure-"));
    const source = path.join(root, "Main.java");
    fs.writeFileSync(source, "class Main {}\n");
    const guard = new PathGuard();
    guard.register(root);
    const service = new DebugService(guard, {}, {}, {}, () => {});
    service.root = root;
    service.sessionEpoch = 10;
    service.waitForHotReplaceReady = async () => {};
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const firstWasStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
    const processed: string[] = [];
    service.hotReplace = async (_file: string, _epoch: number, _mode: string, previousSource?: string) => {
      processed.push(previousSource || "");
      if (processed.length === 1) {
        firstStarted();
        await firstBlocked;
        throw new Error("revision 1 compile failed");
      }
      return { queued: true, revision: 2 };
    };

    const first = service.enqueueHotReplace({ file: source, mode: "smart", previousSource: "v0" });
    await firstWasStarted;
    const second = service.enqueueHotReplace({ file: source, mode: "smart", previousSource: "v1" });
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { queued: true, revision: 2 },
      { queued: true, revision: 2 },
    ]);

    expect(processed).toEqual(["v0", "v0"]);
    expect(service.hotReplacePending.size).toBe(0);
    expect(service.hotReplaceVersions.size).toBe(0);
    expect(service.hotReplaceRequests.size).toBe(0);
  });

  it("relaunches smart HotSwap only for already executed startup state", () => {
    const startup = [
      "public class Main {",
      "  public static void main(String[] args) {",
      "    panel.setBackground(Color.RED);",
      "  }",
      "}",
    ].join("\n");
    expect(smartHotSwapRequiresRelaunch(
      startup,
      startup.replace("Color.RED", "Color.GREEN"),
      "Main",
    )).toBe(true);

    const repeatedlyCalled = [
      "public class Main {",
      "  static String text() { return \"BEFORE\"; }",
      "  public static void main(String[] args) {",
      "    while (true) System.out.println(text());",
      "  }",
      "}",
    ].join("\n");
    expect(smartHotSwapRequiresRelaunch(
      repeatedlyCalled,
      repeatedlyCalled.replace("BEFORE", "AFTER"),
      "Main",
    )).toBe(false);

    const constructor = "class View { View() { color = RED; } void refresh() { color = RED; } }";
    expect(smartHotSwapRequiresRelaunch(
      constructor,
      constructor.replace("View() { color = RED", "View() { color = GREEN"),
      "View",
    )).toBe(true);
    expect(smartHotSwapRequiresRelaunch(
      constructor,
      constructor.replace("void refresh() { color = RED", "void refresh() { color = GREEN"),
      "View",
    )).toBe(false);

    const changedSignature = "class View { void refresh(String color) { paint(color); } }";
    expect(smartHotSwapRequiresRelaunch(
      changedSignature,
      changedSignature.replace("String color", "Object color"),
      "View",
    )).toBe(true);

    // Formatting and comments do not restart a desktop application.
    expect(smartHotSwapRequiresRelaunch(
      repeatedlyCalled,
      repeatedlyCalled.replace("return \"BEFORE\";", "return  \"BEFORE\"; // same code"),
      "Main",
    )).toBe(false);
  });

  it("keeps launch arguments and breakpoints during an automatic smart reload", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "smart-hot-swap-relaunch-"));
    const source = path.join(root, "Main.java");
    fs.writeFileSync(source, "class Main { static void main(String[] args) {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const events: any[] = [];
    const service = new DebugService(guard, {}, {}, {}, (channel: string, payload: any) => {
      events.push({ channel, payload });
    });
    const breakpoints = [{ type: "line", className: "Main", line: 1, condition: "ready" }];
    service.root = root;
    service.sessionEpoch = 3;
    service.adapter = { stdin: { writable: true, write: () => true } };
    service.launchRequest = {
      root,
      file: source,
      configuration: { name: "Desktop", type: "java", vmArgs: "-Xmx256m", programArgs: "one" },
      breakpoints,
    };
    service.breakpoints = breakpoints;
    let relaunchedWith: any = null;
    service.start = async (payload: any) => {
      relaunchedWith = payload;
      return { started: true, port: 5005, mainClass: "Main" };
    };

    const result = await service.relaunchForHotReplace(source, fs.readFileSync(source, "utf8"), 3);

    expect(result).toMatchObject({ restarted: true, mainClass: "Main" });
    expect(relaunchedWith).toMatchObject({
      root,
      file: source,
      configuration: { vmArgs: "-Xmx256m", programArgs: "one" },
      breakpoints,
    });
    expect(relaunchedWith.breakpoints).not.toBe(breakpoints);
    expect(events.some((event) => event.channel === "debug:hotReplace"
      && event.payload.success
      && event.payload.restarted)).toBe(true);
  });

  it("supports explicit smart, redefine and relaunch HotSwap modes", () => {
    expect(normalizeHotReplaceRequest("C:/demo/Main.java")).toEqual({
      file: "C:/demo/Main.java",
      mode: "smart",
    });
    expect(normalizeHotReplaceRequest({ file: "C:/demo/Main.java", mode: "redefine" })).toEqual({
      file: "C:/demo/Main.java",
      mode: "redefine",
    });
    expect(normalizeHotReplaceRequest({ file: "C:/demo/Main.java", mode: "relaunch" })).toEqual({
      file: "C:/demo/Main.java",
      mode: "relaunch",
    });
    expect(normalizeHotReplaceRequest({
      file: "C:/demo/Main.java",
      mode: "smart",
      previousSource: "class Main {}",
    })).toEqual({
      file: "C:/demo/Main.java",
      mode: "smart",
      previousSource: "class Main {}",
    });
  });

  it("reports the debugger as inactive once the session was stopped", () => {
    const states: any[] = [];
    const service = new DebugService(new PathGuard(), {}, {}, {}, (channel: string, payload: any) => {
      states.push({ channel, ...payload });
    });
    service.root = "C:/projects/demo";
    service.moduleId = "app";
    service.mainClass = "dev.kiwi.Main";
    service.classpath = "C:/projects/demo/out";
    expect(service.health()).toMatchObject({ active: true, root: "C:/projects/demo" });

    service.stop();
    expect(states.at(-1)).toMatchObject({ channel: "debug:state", status: "stopped" });
    expect(service.health()).toMatchObject({ active: false, root: "", adapterPid: 0, vmPid: 0 });
    expect(service.mainClass).toBe("");

    // A second stop must stay quiet instead of announcing another session end.
    const before = states.length;
    service.stop();
    expect(states).toHaveLength(before);
  });
});

describe("Gradle settings edits", () => {
  it("builds project ids from both path separators", () => {
    expect(gradleProjectId("core")).toBe(":core");
    expect(gradleProjectId("libs\\core")).toBe(":libs:core");
    expect(gradleProjectId("libs/core")).toBe(":libs:core");
  });

  it("adds and removes a nested include exactly once", () => {
    const settings = 'rootProject.name = "demo"\n';
    const added = addGradleModule(settings, path.join("libs", "core"));
    expect(added).toContain('include(":libs:core")');
    expect(addGradleModule(added, path.join("libs", "core"))).toBe(added);
    expect(removeGradleModule(added, path.join("libs", "core"))).not.toContain("libs:core");
  });

  it("round-trips an added include through the settings parser", () => {
    const added = addGradleModule("", path.join("libs", "core"));
    expect(parseGradleIncludes(added)).toEqual([path.join("libs", "core")]);
  });
});

describe("workspace profile robustness", () => {
  it("restores a stored profile that never recorded an active project", async () => {
    const userData = fs.mkdtempSync(path.join(fixtureRoot, "profile-null-active-"));
    const first = fs.mkdtempSync(path.join(fixtureRoot, "null-active-a-"));
    const second = fs.mkdtempSync(path.join(fixtureRoot, "null-active-b-"));
    fs.writeFileSync(path.join(userData, "workspace-state.json"), JSON.stringify({
      version: 3,
      projects: [],
      resumableProjects: [],
      activeRoot: null,
      profiles: [{ id: "legacy", name: "Legacy", roots: [first, second], activeRoot: null }],
    }));
    const settings = {
      get: () => ({ lastWorkspace: "", recentProjects: [] }),
      rememberWorkspace: async () => {},
      forgetWorkspace: async () => {},
    };
    const service = new WorkspaceStateService(userData, settings);
    await service.load();
    const restored = await service.openProfile("legacy");
    expect(restored.projects.map((project: any) => project.root)).toEqual([first, second]);
    expect(restored.activeRoot).toBe(first);
  });
});

describe("project-wide search", () => {
  function fixture() {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "search-"));
    fs.writeFileSync(path.join(root, "Main.java"), [
      "public class Main {",
      "    private int count = 0;",
      "    private int counter = 1;",
      "    // TODO: rename COUNT",
      "}",
    ].join("\n"));
    const guard = new PathGuard();
    guard.register(root);
    return { root, service: new WorkspaceService(guard, {}, () => {}) };
  }

  it("matches literally and case-insensitively by default", async () => {
    const { root, service } = fixture();
    const matches = await service.search(root, "count");
    expect(matches.map((match: any) => match.line)).toEqual([2, 3, 4]);
  });

  it("honours case sensitivity and whole-word matching", async () => {
    const { root, service } = fixture();
    expect(await service.search(root, "COUNT", { caseSensitive: true })).toHaveLength(1);
    // `counter` is skipped, but COUNT still matches while case is ignored.
    expect((await service.search(root, "count", { wholeWord: true })).map((match: any) => match.line))
      .toEqual([2, 4]);
    expect((await service.search(root, "count", { wholeWord: true, caseSensitive: true }))
      .map((match: any) => match.line)).toEqual([2]);
  });

  it("treats the query as a regular expression when asked", async () => {
    const { root, service } = fixture();
    const matches = await service.search(root, String.raw`count(?:er)?\s*=`, { regex: true });
    expect(matches.map((match: any) => match.line)).toEqual([2, 3]);
  });

  it("does not treat regex metacharacters as syntax in a plain search", async () => {
    const { root, service } = fixture();
    expect(await service.search(root, "count(")).toEqual([]);
  });

  it("reports an invalid expression instead of silently finding nothing", async () => {
    const { root, service } = fixture();
    await expect(service.search(root, "count(", { regex: true }))
      .rejects.toThrow(/Ungültiger regulärer Ausdruck/);
  });

  it("terminates on a pattern that can match the empty string", async () => {
    const { root, service } = fixture();
    const matches = await service.search(root, "x*", { regex: true });
    expect(matches.length).toBeGreaterThan(0);
  });

  it("keeps group references usable when replacing with a regex", async () => {
    const { root, service } = fixture();
    const result = await service.replaceAll(root, String.raw`private int (\w+)`, "public long $1", null, { regex: true });
    expect(result.replacements).toBe(2);
    expect(fs.readFileSync(path.join(root, "Main.java"), "utf8")).toContain("public long counter");
  });
});

describe("attaching to a running JVM", () => {
  function service() {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "attach-"));
    const guard = new PathGuard();
    guard.register(root);
    const settings = { get: () => ({ jdkPath: "" }) };
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const workspace = new WorkspaceService(guard, {}, () => {});
    const modules = new ModuleService(guard, projects);
    const builds = new BuildService(guard, workspace, projects, modules, () => {});
    const events: any[] = [];
    const debugService = new DebugService(guard, workspace, projects, builds, (channel: string, payload: any) =>
      events.push({ channel, ...payload }));
    return { root, debugService, events };
  }

  it("refuses an address that cannot be a debug target", async () => {
    const { root, debugService } = service();
    await expect(debugService.attach({ root, port: 0 })).rejects.toThrow(/1 und 65535/);
    await expect(debugService.attach({ root, port: 70_000 })).rejects.toThrow(/1 und 65535/);
    await expect(debugService.attach({ root, host: "a b;rm", port: 5005 })).rejects.toThrow(/Host/);
  });

  it("names the JDWP flag when nothing is listening", async () => {
    const { root, debugService } = service();
    // Nothing accepts on this port, so the adapter cannot connect. The message
    // has to say what the target JVM was missing rather than just fail.
    await expect(debugService.attach({ root, host: "127.0.0.1", port: 65_501 }))
      .rejects.toThrow(/agentlib:jdwp/);
    expect(debugService.health().active).toBe(false);
  }, 30_000);

  it("leaves a JVM it did not start alone when detaching", () => {
    const { debugService } = service();
    let terminated = false;
    debugService.attached = true;
    debugService.vm = { pid: 4242, kill: () => { terminated = true; } };
    debugService.stop();
    // Killing someone else's server on disconnect would be a nasty surprise.
    expect(terminated).toBe(false);
    expect(debugService.attached).toBe(false);
  });

  it("keeps the project JDK for attached HotSwap while the adapter uses Java 21+", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "attach-project-jdk-"));
    const guard = new PathGuard();
    guard.register(root);
    const projectJdk = {
      available: true,
      major: 17,
      path: path.join(root, "jdk-17"),
      java: path.join(root, "jdk-17", "bin", "java.exe"),
      javac: path.join(root, "jdk-17", "bin", "javac.exe"),
    };
    const adapterJdk = {
      available: true,
      major: 21,
      path: path.join(root, "jdk-21"),
      java: path.join(root, "jdk-21", "bin", "java.exe"),
      javac: path.join(root, "jdk-21", "bin", "javac.exe"),
    };
    const projects = {
      detectJdk: async (requestedRoot: string) => requestedRoot ? projectJdk : adapterJdk,
      detect: async () => ({
        type: "Java",
        languageLevel: "17",
        encoding: "UTF-8",
        compilerArgs: "",
        previewFeatures: false,
        excludedLibraries: [],
      }),
      listJdks: async () => [adapterJdk],
    };
    const builds = { modules: { list: async () => [] } };
    const service = new DebugService(guard, {}, projects, builds, () => {});
    let adapterRuntime: any;
    service.startAdapter = async (_root: string, _host: string, _port: number, jdk: any) => {
      adapterRuntime = jdk;
      service.adapter = { stdin: { writable: true, write: () => true } };
    };

    await service.attach({ root, host: "127.0.0.1", port: 5005 });

    expect(adapterRuntime).toBe(adapterJdk);
    expect(service.targetJdk).toBe(projectJdk);
    expect(service.hotReplaceCompilerArgs).toContain("17");
    expect(service.classpath).toContain(path.join(root, "build", "classes"));
    service.stop();
  });
});

describe("sending HTTP requests", () => {
  const { HttpClientService, redactHeaders, formatBody } =
    require("../electron/services/http-client-service.cjs");

  const response = (body: string, init: any = {}) => ({
    ok: (init.status || 200) < 400,
    status: init.status || 200,
    statusText: init.statusText || "OK",
    url: init.url || "https://api.test/orders",
    headers: {
      get: (name: string) => (init.headers || {})[name.toLowerCase()] || "",
      forEach: (visit: (value: string, name: string) => void) =>
        Object.entries(init.headers || {}).forEach(([name, value]) => visit(String(value), name)),
    },
    text: async () => body,
  });

  it("reports status, timing and a formatted body", async () => {
    const service = new HttpClientService(async () =>
      response('{"id":1,"name":"Kiwi"}', { headers: { "content-type": "application/json" } }));
    const result = await service.send({ method: "get", url: "https://api.test/orders" });
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    // JSON is indented so a response is readable without another tool.
    expect(result.body).toBe('{\n  "id": 1,\n  "name": "Kiwi"\n}');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("treats an error status as a result, not a failure", async () => {
    const service = new HttpClientService(async () => response("nope", { status: 500, statusText: "Server Error" }));
    const result = await service.send({ method: "GET", url: "https://api.test/boom" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("sends a body only where one belongs", async () => {
    const seen: any[] = [];
    const service = new HttpClientService(async (_url: URL, init: any) => {
      seen.push(init);
      return response("{}");
    });
    await service.send({ method: "POST", url: "https://api.test/orders", body: '{"a":1}' });
    await service.send({ method: "GET", url: "https://api.test/orders", body: "ignored" });
    expect(seen[0].body).toBe('{"a":1}');
    // A GET with a body is rejected by many servers, so it is never built.
    expect(seen[1].body).toBeUndefined();
  });

  it("refuses schemes that are not web requests", async () => {
    const service = new HttpClientService(async () => response("{}"));
    await expect(service.send({ method: "GET", url: "file:///C:/Windows/win.ini" })).rejects.toThrow(/Schema/);
    await expect(service.send({ method: "GET", url: "/relative" })).rejects.toThrow(/vollständige URL/);
  });

  it("keeps credentials out of the result", async () => {
    const service = new HttpClientService(async () =>
      response("{}", { headers: { "set-cookie": "session=abcdef" } }));
    const result = await service.send({
      method: "GET",
      url: "https://api.test/me",
      headers: [{ name: "Authorization", value: "Bearer supersecret" }],
    });
    // The response lands in a tool window and may end up in a screenshot.
    expect(JSON.stringify(result)).not.toContain("supersecret");
    expect(JSON.stringify(result)).not.toContain("abcdef");
    expect(result.request.headers[0].value).toMatch(/verborgen/);
  });

  it("drops a header name that is not a header name", async () => {
    const seen: any[] = [];
    const service = new HttpClientService(async (_url: URL, init: any) => {
      seen.push(init.headers);
      return response("{}");
    });
    await service.send({
      method: "GET",
      url: "https://api.test/x",
      headers: [{ name: "X-Ok", value: "1" }, { name: "Bad Header\r\nInjected", value: "2" }],
    });
    expect(Object.keys(seen[0])).toEqual(["X-Ok"]);
  });

  it("reports a timeout as such", async () => {
    const service = new HttpClientService((_url: URL, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await expect(service.send({ method: "GET", url: "https://api.test/slow" }, { timeoutMs: 30 }))
      .rejects.toThrow(/Zeitüberschreitung/);
  });

  it("leaves a non-JSON body untouched", () => {
    expect(formatBody("<html></html>", "text/html")).toBe("<html></html>");
    expect(formatBody("not json", "application/json")).toBe("not json");
    expect(redactHeaders({ Accept: "application/json" })).toEqual([{ name: "Accept", value: "application/json" }]);
  });
});

describe("concurrent Git operations", () => {
  const repository = () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "git-lock-"));
    const guard = new PathGuard();
    guard.register(root);
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    // unstage resolves paths against HEAD, so the repository needs a commit.
    fs.writeFileSync(path.join(root, "README.md"), "Kiwi\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    for (let index = 0; index < 12; index += 1) {
      fs.writeFileSync(path.join(root, `File${index}.java`), `class File${index} {}\n`);
    }
    return { root, service: new GitService(guard) };
  };

  it("does not let two index writes collide over index.lock", async () => {
    const { root, service } = repository();
    const files = Array.from({ length: 12 }, (_, index) => `File${index}.java`);
    // Kiwi refreshes from a file watcher, so a stage and an unstage overlapping
    // needs no unusual clicking. Unserialized this fails with
    // "Unable to create '.git/index.lock': File exists".
    const results = await Promise.allSettled([
      ...files.map((file) => service.stage(root, [file])),
      ...files.map((file) => service.unstage(root, [file])),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => String(result.reason?.message || result.reason));
    expect(failures).toEqual([]);
  });

  it("keeps reads working while a write is queued", async () => {
    const { root, service } = repository();
    const [, ...statuses] = await Promise.all([
      service.stage(root, ["File0.java"]),
      service.status(root),
      service.status(root),
      service.diff(root, "File1.java", false),
    ]);
    // A read carries --no-optional-locks, so it never waits for the queue and
    // never takes the lock itself.
    expect(statuses[0]).toMatchObject({ available: true, branch: "main" });
    expect(statuses[1]).toMatchObject({ available: true });
  });

  it("runs a later write even after an earlier one failed", async () => {
    const { root, service } = repository();
    const results = await Promise.allSettled([
      // "reset" against a repository without a commit cannot succeed; the queue
      // must not stall on it.
      service.run(root, ["reset", "--hard", "does-not-exist"], true),
      service.stage(root, ["File0.java"]),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect((await service.status(root)).files.find((file) => file.path === "File0.java")?.staged).toBe(true);
  });
});

describe("extended Git operations", () => {
  const repository = (name: string) => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, name));
    const guard = new PathGuard();
    guard.register(root);
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Kiwi Test"], { cwd: root });
    fs.writeFileSync(path.join(root, "App.java"), "class App { int value = 1; }\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    return { root, service: new GitService(guard) };
  };

  it("lists a remote branch that has no local counterpart", async () => {
    const { root: origin } = repository("git-origin-");
    execFileSync("git", ["switch", "-c", "feature/remote-only"], { cwd: origin });
    fs.writeFileSync(path.join(origin, "Remote.java"), "class Remote {}\n");
    execFileSync("git", ["add", "-A"], { cwd: origin });
    execFileSync("git", ["commit", "-m", "remote work"], { cwd: origin });
    execFileSync("git", ["switch", "main"], { cwd: origin });

    const clone = fs.mkdtempSync(path.join(fixtureRoot, "git-clone-"));
    execFileSync("git", ["clone", origin, clone]);
    const guard = new PathGuard();
    guard.register(clone);
    const service = new GitService(guard);

    const branches = await service.branches(clone);
    const remoteOnly = branches.find((branch: any) => branch.name === "feature/remote-only");
    // Without this the branch is invisible and checkout refuses it, so a fresh
    // clone cannot reach any of the work that already exists.
    expect(remoteOnly).toMatchObject({ current: false, remote: "origin/feature/remote-only" });
    // "origin/HEAD -> origin/main" is a symbolic ref and must not appear.
    expect(branches.some((branch: any) => branch.name.includes("->"))).toBe(false);
    expect(branches.filter((branch: any) => branch.name === "main")).toHaveLength(1);

    await service.checkout(clone, "feature/remote-only");
    expect((await service.status(clone)).branch).toBe("feature/remote-only");
  });

  it("merges a branch and reports a conflict as a state to work in", async () => {
    const { root, service } = repository("git-merge-");
    execFileSync("git", ["switch", "-c", "other"], { cwd: root });
    fs.writeFileSync(path.join(root, "App.java"), "class App { int value = 2; }\n");
    execFileSync("git", ["commit", "-am", "other"], { cwd: root });
    execFileSync("git", ["switch", "main"], { cwd: root });
    fs.writeFileSync(path.join(root, "App.java"), "class App { int value = 3; }\n");
    execFileSync("git", ["commit", "-am", "main"], { cwd: root });

    const merged = await service.merge(root, "other");
    // A conflict is not an error: the merge editor is what happens next.
    expect(merged.conflicted).toBe(true);
    expect(merged.status.files.some((file: any) => file.conflict)).toBe(true);

    await service.mergeAbort(root);
    expect((await service.status(root)).files).toEqual([]);
  });

  it("discards tracked changes and deletes untracked files", async () => {
    const { root, service } = repository("git-discard-");
    fs.writeFileSync(path.join(root, "App.java"), "class App { int value = 99; }\n");
    fs.writeFileSync(path.join(root, "Scratch.java"), "class Scratch {}\n");

    const result = await service.discard(root, ["App.java", "Scratch.java"]);
    expect(result).toMatchObject({ discarded: 1, removed: 1 });
    // The tracked file goes back to its committed content, the unversioned one
    // has no earlier content to return to and is removed instead.
    expect(fs.readFileSync(path.join(root, "App.java"), "utf8")).toContain("value = 1");
    expect(fs.existsSync(path.join(root, "Scratch.java"))).toBe(false);
    expect(result.status.files).toEqual([]);
  });

  it("refuses to delete the branch that is checked out", async () => {
    const { root, service } = repository("git-branch-");
    await expect(service.deleteBranch(root, "main")).rejects.toThrow(/aktuelle Branch/);

    await service.createBranch(root, "spike", false);
    const renamed = await service.renameBranch(root, "spike", "spike-2");
    expect(renamed.branches.some((branch: any) => branch.name === "spike-2")).toBe(true);
    const deleted = await service.deleteBranch(root, "spike-2");
    expect(deleted.branches.some((branch: any) => branch.name === "spike-2")).toBe(false);
  });

  it("reverts a commit without rewriting history", async () => {
    const { root, service } = repository("git-revert-");
    fs.writeFileSync(path.join(root, "App.java"), "class App { int value = 42; }\n");
    execFileSync("git", ["commit", "-am", "change value"], { cwd: root });

    await service.revertCommit(root, "HEAD");
    expect(fs.readFileSync(path.join(root, "App.java"), "utf8")).toContain("value = 1");
    // Three commits: the original, the change and the revert on top of it.
    expect(await service.log(root, 10)).toHaveLength(3);
  });

  it("moves the branch with reset and keeps the mode explicit", async () => {
    const { root, service } = repository("git-reset-");
    fs.writeFileSync(path.join(root, "App.java"), "class App { int value = 7; }\n");
    execFileSync("git", ["commit", "-am", "second"], { cwd: root });

    await service.resetTo(root, "HEAD~1", "soft");
    expect(await service.log(root, 10)).toHaveLength(1);
    // soft keeps the change staged rather than throwing it away.
    expect((await service.status(root)).files.some((file: any) => file.staged)).toBe(true);
    await expect(service.resetTo(root, "HEAD", "obliterate")).rejects.toThrow(/Reset-Modus/);
  });

  it("creates, lists and deletes tags", async () => {
    const { root, service } = repository("git-tag-");
    await service.createTag(root, "v1.0.0", { message: "Erste Fassung" });
    const tags = await service.tags(root);
    expect(tags[0]).toMatchObject({ name: "v1.0.0", subject: "Erste Fassung" });
    expect(tags[0].hash).toMatch(/^[0-9a-f]+$/);
    const afterDelete = await service.deleteTag(root, "v1.0.0");
    expect(afterDelete.tags).toEqual([]);
    await expect(service.createTag(root, "--force")).rejects.toThrow(/Referenz/);
  });

  it("cherry-picks a single commit onto another branch", async () => {
    const { root, service } = repository("git-cherry-");
    execFileSync("git", ["switch", "-c", "source"], { cwd: root });
    fs.writeFileSync(path.join(root, "Extra.java"), "class Extra {}\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-m", "add extra"], { cwd: root });
    const [head] = await service.log(root, 1);
    execFileSync("git", ["switch", "main"], { cwd: root });

    await service.cherryPick(root, head.hash);
    expect(fs.existsSync(path.join(root, "Extra.java"))).toBe(true);
  });
});

describe("running a class without rebuilding the project", () => {
  const { moduleOutputIsCurrent } = require("../electron/services/build-service.cjs");

  it("treats output newer than every source as current", () => {
    expect(moduleOutputIsCurrent([100, 200], [300, 400])).toBe(true);
    // One source touched after the last compile is enough to rebuild.
    expect(moduleOutputIsCurrent([100, 500], [300, 400])).toBe(false);
  });

  it("rebuilds when nothing has been compiled yet", () => {
    expect(moduleOutputIsCurrent([100], [])).toBe(false);
  });

  it("rebuilds when there are fewer classes than sources", () => {
    // A new source file, or a build that stopped halfway: the output cannot be
    // complete even if every class present is newer than every source.
    expect(moduleOutputIsCurrent([100, 110, 120], [300, 400])).toBe(false);
  });

  it("has nothing to do for a module without sources", () => {
    expect(moduleOutputIsCurrent([], [])).toBe(true);
  });

  it("counts equal timestamps as current", () => {
    // A compile within the same millisecond must not loop forever rebuilding.
    expect(moduleOutputIsCurrent([500], [500])).toBe(true);
  });
});

describe("run command lines stay off the full lifecycle", () => {
  const mavenProject = () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "run-maven-"));
    fs.mkdirSync(path.join(root, "src", "main", "java", "dev", "demo"), { recursive: true });
    fs.writeFileSync(path.join(root, "pom.xml"), [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      "<modelVersion>4.0.0</modelVersion>",
      "<groupId>dev.demo</groupId><artifactId>app</artifactId><version>1.0</version>",
      "</project>",
    ].join("\n"));
    fs.writeFileSync(path.join(root, "src", "main", "java", "dev", "demo", "Main.java"),
      "package dev.demo;\npublic class Main { public static void main(String[] a) {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const projects = new ProjectService(guard, { get: () => ({ jdkPath: "" }) }, path.join(process.cwd(), "resources", "toolchain"));
    const workspace = new WorkspaceService(guard, {}, () => {});
    const builds = new BuildService(guard, workspace, projects, new ModuleService(guard, projects), () => {});
    builds.start = () => ({ pid: 1 });
    return { root, builds };
  };

  it("compiles but never packages or tests when running a class", async () => {
    const { root, builds } = mavenProject();
    const result = await builds.execute({ root, action: "run", configuration: { name: "Run", type: "java" } });
    expect(result.command).toContain("compile");
    expect(result.command).toContain("exec:java");
    // Running one class must not drag the rest of the lifecycle along.
    expect(result.command).not.toContain("package");
    expect(result.command).toContain("-Dmaven.test.skip=true");
  });

  it("still packages when a build is what was asked for", async () => {
    const { root, builds } = mavenProject();
    const result = await builds.execute({ root, action: "build", configuration: { name: "Bauen", type: "java" } });
    expect(result.command).toContain("package");
    expect(result.command).not.toContain("-Dmaven.test.skip=true");
  });

  it("keeps the Gradle run task off the test sources", async () => {
    const root = fs.mkdtempSync(path.join(fixtureRoot, "run-gradle-"));
    fs.mkdirSync(path.join(root, "src", "main", "java"), { recursive: true });
    fs.writeFileSync(path.join(root, "build.gradle"), "plugins { id 'application' }\n");
    fs.writeFileSync(path.join(root, "src", "main", "java", "Main.java"),
      "public class Main { public static void main(String[] a) {} }\n");
    const guard = new PathGuard();
    guard.register(root);
    const projects = new ProjectService(guard, { get: () => ({ jdkPath: "" }) }, path.join(process.cwd(), "resources", "toolchain"));
    const workspace = new WorkspaceService(guard, {}, () => {});
    const builds = new BuildService(guard, workspace, projects, new ModuleService(guard, projects), () => {});
    builds.start = () => ({ pid: 1 });

    const run = await builds.execute({ root, action: "run", configuration: { name: "Run", type: "java" } });
    expect(run.command).toContain("run");
    expect(run.command).toContain("-x test");

    // An explicit build is a different request and keeps everything.
    const build = await builds.execute({ root, action: "build", configuration: { name: "Bauen", type: "java" } });
    expect(build.command).not.toContain("-x test");
  });
});

describe("start-up behaviour", () => {
  const { startupWindowKind } = require("../electron/services/settings-service.cjs");

  it("restores the last project by default", () => {
    expect(startupWindowKind(true, { startupBehavior: "restore" })).toBe("editor");
    // The setting was stored but never read, so "hub" had no effect at all.
    expect(startupWindowKind(true, { startupBehavior: "hub" })).toBe("welcome");
  });

  it("shows the project list when there is nothing to restore", () => {
    expect(startupWindowKind(false, { startupBehavior: "restore" })).toBe("welcome");
    expect(startupWindowKind(false, { startupBehavior: "hub" })).toBe("welcome");
  });

  it("falls back to restoring when the setting is missing or unknown", () => {
    expect(startupWindowKind(true, {})).toBe("editor");
    expect(startupWindowKind(true, { startupBehavior: "nonsense" })).toBe("editor");
  });
});

describe("creating without a sample class", () => {
  const scaffold = () => {
    const location = fs.mkdtempSync(path.join(fixtureRoot, "scaffold-"));
    const guard = new PathGuard();
    guard.register(location);
    const settings = { get: () => ({ jdkPath: "" }), rememberWorkspace: async () => undefined };
    return { location, projects: new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain")) };
  };

  it("writes Main.java by default", async () => {
    const { location, projects } = scaffold();
    const result = await projects.create({
      type: "Java", location, name: "withclass", groupId: "dev.demo",
      artifactId: "withclass", packageName: "dev.demo",
    });
    expect(fs.existsSync(result.mainFile)).toBe(true);
  });

  it("leaves the source folders empty when the sample class is declined", async () => {
    const { location, projects } = scaffold();
    const result = await projects.create({
      type: "Java", location, name: "noclass", groupId: "dev.demo",
      artifactId: "noclass", packageName: "dev.demo", sampleClass: false,
    });
    // The package directory is still created — only the class Kiwi invented is
    // left out, so there is nothing to delete before the real code arrives.
    expect(fs.existsSync(path.join(result.root, "src", "main", "java", "dev", "demo"))).toBe(true);
    expect(fs.existsSync(path.join(result.root, "src", "main", "java", "dev", "demo", "Main.java"))).toBe(false);
    expect(result.mainFile).toBe("");
  });
});
