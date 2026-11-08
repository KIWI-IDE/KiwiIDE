import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { WorkspaceService } = require("../electron/services/workspace-service.cjs");
const { ProjectService } = require("../electron/services/project-service.cjs");
const { ModuleService } = require("../electron/services/module-service.cjs");
const { BuildService } = require("../electron/services/build-service.cjs");
const { DebugService } = require("../electron/services/debug-service.cjs");
const { spawnCapture } = require("../electron/services/process-utils.cjs");

const parent = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-debug-types-"));
const settings = { get: () => ({ jdkPath: "" }) };

try {
  const bootstrapGuard = new PathGuard();
  bootstrapGuard.register(parent);
  const bootstrapProjects = new ProjectService(bootstrapGuard, settings, path.join(process.cwd(), "resources", "toolchain"));
  const jdk = await bootstrapProjects.detectJdk(parent);
  assert.equal(jdk.available, true, "JDK unavailable");
  const helperSource = path.join(parent, "helper-src", "dep", "Helper.java");
  const helperClasses = path.join(parent, "helper-classes");
  const helperJar = path.join(parent, "helper.jar");
  await fs.mkdir(path.dirname(helperSource), { recursive: true });
  await fs.mkdir(helperClasses, { recursive: true });
  await fs.writeFile(helperSource, "package dep; public final class Helper { public static String value() { return \"DEPENDENCY_OK\"; } }\n");
  await spawnCapture(jdk.javac, ["-d", helperClasses, helperSource], { rejectOnError: true });
  await spawnCapture(path.join(jdk.path, "bin", process.platform === "win32" ? "jar.exe" : "jar"), ["--create", "--file", helperJar, "-C", helperClasses, "."], { rejectOnError: true });

  const results = [];
  for (const type of ["Maven", "Gradle"]) {
    const root = path.join(parent, type.toLowerCase());
    const sourceFile = path.join(root, "src", "main", "java", "demo", "Main.java");
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.mkdir(path.join(root, "libs"), { recursive: true });
    await fs.copyFile(helperJar, path.join(root, "libs", "helper.jar"));
    await fs.writeFile(sourceFile, `package demo;

import dep.Helper;

public class Main {
    public static void main(String[] args) {
        String value = Helper.value();
        System.out.println(value);
    }
}
`, "utf8");
    if (type === "Maven") {
      await fs.writeFile(path.join(root, "pom.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>debug-repro</artifactId><version>1</version>
  <properties><maven.compiler.release>21</maven.compiler.release></properties>
  <dependencies><dependency><groupId>local</groupId><artifactId>helper</artifactId><version>1</version><scope>system</scope><systemPath>${"${project.basedir}"}/libs/helper.jar</systemPath></dependency></dependencies>
</project>`, "utf8");
    } else {
      await fs.writeFile(path.join(root, "settings.gradle"), "rootProject.name = 'debug-repro'\n", "utf8");
      await fs.writeFile(path.join(root, "build.gradle"), `plugins { id 'java'; id 'application' }
repositories { mavenCentral() }
dependencies { implementation files('libs/helper.jar') }
application { mainClass = 'demo.Main' }
`, "utf8");
    }

    const guard = new PathGuard();
    guard.register(root);
    const events = [];
    const workspace = new WorkspaceService(guard, { trashItem: async () => {} }, () => {});
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const builds = new BuildService(guard, workspace, projects, { list: async () => [] }, () => {});
    const debug = new DebugService(guard, workspace, projects, builds, (channel, payload) => events.push({ channel, payload }));
    try {
      await debug.start({ root, file: sourceFile, breakpoints: [{ type: "line", className: "demo.Main", line: 7 }] });
      await waitFor(() => events.some((event) => event.channel === "debug:state" && event.payload.status === "paused"), 30_000, `${type} breakpoint`, events);
      await debug.command("continue");
      await waitFor(() => events.some((event) => event.channel === "debug:state" && event.payload.status === "stopped"), 30_000, `${type} exit`, events);
      const output = events.filter((event) => event.channel === "debug:output").map((event) => event.payload.text).join("");
      results.push({ type, output, dependencyVisible: output.includes("DEPENDENCY_OK"), classpathFailure: /NoClassDefFoundError|ClassNotFoundException/.test(output) });
    } finally {
      debug.stop();
    }
  }

  // Reproduce the toolbar's "Aktuelle Java-Datei" behaviour when the current
  // class is not itself the application entry point.
  {
    const root = path.join(parent, "plain-wrong-entry");
    const sourceRoot = path.join(root, "src", "demo");
    const mainFile = path.join(sourceRoot, "Main.java");
    const activeFile = path.join(sourceRoot, "Utility.java");
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(mainFile, "package demo; public class Main { public static void main(String[] args) { System.out.println(\"MAIN_OK\"); } }\n");
    await fs.writeFile(activeFile, "package demo; public class Utility { public static int answer() { return 42; } }\n");
    const guard = new PathGuard();
    guard.register(root);
    const events = [];
    const workspace = new WorkspaceService(guard, { trashItem: async () => {} }, () => {});
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const builds = new BuildService(guard, workspace, projects, { list: async () => [] }, () => {});
    const debug = new DebugService(guard, workspace, projects, builds, (channel, payload) => events.push({ channel, payload }));
    try {
      const start = await debug.start({ root, file: activeFile, breakpoints: [] });
      await waitFor(() => events.some((event) => event.channel === "debug:state" && event.payload.status === "stopped"), 30_000, "plain non-main exit", events);
      const output = events.filter((event) => event.channel === "debug:output").map((event) => event.payload.text).join("");
      results.push({ type: "Plain-active-non-main", selectedMain: start.mainClass, output, mainVisible: output.includes("MAIN_OK"), launchFailure: /main method|Main method|Hauptmethode/i.test(output) });
    } finally {
      debug.stop();
    }
  }

  // Multi-module Maven project with the application only in a child module.
  // No moduleId is passed, matching the common toolbar workflow.
  {
    const root = path.join(parent, "maven-multi");
    const moduleRoot = path.join(root, "app");
    const sourceFile = path.join(moduleRoot, "src", "main", "java", "demo", "Main.java");
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(path.join(root, "pom.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>demo</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging>
<modules><module>app</module></modules></project>`, "utf8");
    await fs.writeFile(path.join(moduleRoot, "pom.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<parent><groupId>demo</groupId><artifactId>parent</artifactId><version>1</version></parent>
<artifactId>app</artifactId><properties><maven.compiler.release>21</maven.compiler.release></properties></project>`, "utf8");
    await fs.writeFile(sourceFile, `package demo;

public class Main {
    public static void main(String[] args) {
        String value = "MULTIMODULE_OK";
        System.out.println(value);
    }
}
`, "utf8");
    const guard = new PathGuard();
    guard.register(root);
    const events = [];
    const workspace = new WorkspaceService(guard, { trashItem: async () => {} }, () => {});
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const modules = new ModuleService(guard, projects);
    const detectedModules = await modules.list(root);
    const builds = new BuildService(guard, workspace, projects, modules, () => {});
    const debug = new DebugService(guard, workspace, projects, builds, (channel, payload) => events.push({ channel, payload }));
    try {
      const start = await debug.start({ root, file: sourceFile, breakpoints: [{ type: "line", className: "demo.Main", line: 5 }] });
      const reachedBreakpoint = await waitForEither(
        () => events.some((event) => event.channel === "debug:state" && event.payload.status === "paused"),
        () => events.some((event) => event.channel === "debug:state" && event.payload.status === "stopped"),
        30_000,
        "Maven multi-module breakpoint or exit",
        events,
      );
      if (reachedBreakpoint) {
        await debug.command("stepOver");
        await waitFor(() => events.filter((event) => event.channel === "debug:state" && event.payload.status === "paused").length >= 2, 30_000, "Maven multi-module step", events);
        await debug.command("continue");
        await waitFor(() => events.some((event) => event.channel === "debug:state" && event.payload.status === "stopped"), 30_000, "Maven multi-module exit", events);
      }
      const output = events.filter((event) => event.channel === "debug:output").map((event) => event.payload.text).join("");
      results.push({
        type: "Maven-multi-no-moduleId",
        modules: detectedModules.map((module) => ({ id: module.id, relativePath: module.relativePath })),
        selectedMain: start.mainClass,
        reachedBreakpoint,
        output,
        mainVisible: output.includes("MULTIMODULE_OK"),
        launchFailure: /Could not find or load main class|ClassNotFoundException|Hauptklasse konnte nicht gefunden/i.test(output),
      });
    } finally {
      debug.stop();
    }
  }

  // A failed compile must leave no ghost debug session behind.
  {
    const root = path.join(parent, "plain-compile-error");
    const sourceFile = path.join(root, "src", "demo", "Broken.java");
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, "package demo; public class Broken { public static void main(String[] args) { doesNotCompile( } }\n");
    const guard = new PathGuard();
    guard.register(root);
    const events = [];
    const workspace = new WorkspaceService(guard, { trashItem: async () => {} }, () => {});
    const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
    const builds = new BuildService(guard, workspace, projects, { list: async () => [] }, () => {});
    const debug = new DebugService(guard, workspace, projects, builds, (channel, payload) => events.push({ channel, payload }));
    let error = "";
    try {
      await debug.start({ root, file: sourceFile, breakpoints: [] });
    } catch (failure) {
      error = String(failure?.message || failure);
    }
    results.push({ type: "Plain-compile-error-cleanup", rejected: Boolean(error), error, health: debug.health(), states: events.filter((event) => event.channel === "debug:state").map((event) => event.payload.status) });
    debug.stop();
  }
  const byType = Object.fromEntries(results.map((result) => [result.type, result]));
  for (const type of ["Maven", "Gradle"]) {
    assert.equal(byType[type].dependencyVisible, true, `${type} did not expose its runtime dependency:\n${byType[type].output}`);
    assert.equal(byType[type].classpathFailure, false, `${type} failed with an incomplete runtime classpath.`);
  }
  assert.equal(byType["Plain-active-non-main"].selectedMain, "demo.Main", "A non-main active file hid the project's actual entry point.");
  assert.equal(byType["Plain-active-non-main"].mainVisible, true, byType["Plain-active-non-main"].output);
  assert.equal(byType["Maven-multi-no-moduleId"].reachedBreakpoint, true, byType["Maven-multi-no-moduleId"].output);
  assert.equal(byType["Maven-multi-no-moduleId"].mainVisible, true, byType["Maven-multi-no-moduleId"].output);
  assert.equal(byType["Maven-multi-no-moduleId"].launchFailure, false, byType["Maven-multi-no-moduleId"].output);
  assert.equal(byType["Plain-compile-error-cleanup"].rejected, true, "A broken source unexpectedly started a debug session.");
  assert.equal(byType["Plain-compile-error-cleanup"].health.active, false, "A failed debug start left a ghost session active.");
  assert.equal(byType["Plain-compile-error-cleanup"].health.root, "", "A failed debug start retained its project root.");
  assert.ok(byType["Plain-compile-error-cleanup"].states.includes("stopped"), "A failed debug start did not publish a stopped state.");
  console.log("Debug project smoke passed: Maven/Gradle runtime dependencies, automatic main/module discovery, breakpoint + step and failed-start cleanup.");
} finally {
  await new Promise((resolve) => setTimeout(resolve, 500));
  await removeWithRetry(parent);
}

async function waitFor(predicate, timeout, label, events) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      const output = events.filter((event) => event.channel === "debug:output").map((event) => event.payload.text).join("");
      throw new Error(`Timeout ${label}:\n${output.slice(-4000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForEither(success, failure, timeout, label, events) {
  const start = Date.now();
  while (!success() && !failure()) {
    if (Date.now() - start > timeout) {
      const output = events.filter((event) => event.channel === "debug:output").map((event) => event.payload.text).join("");
      throw new Error(`Timeout ${label}:\n${output.slice(-4000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return success();
}

async function removeWithRetry(target) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
