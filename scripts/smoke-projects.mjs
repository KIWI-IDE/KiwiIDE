import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { ProjectService } = require("../electron/services/project-service.cjs");
const { spawnCapture } = require("../electron/services/process-utils.cjs");

const parent = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-projects-"));
const guard = new PathGuard();
guard.register(parent);
const settings = {
  get: () => ({ jdkPath: "" }),
  rememberWorkspace: async () => {},
};
const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));

try {
  const plain = await projects.create(spec("Java", "plain-app", "demo.plain"));
  await assertStandardDirectories(plain.root);
  await writeLambdaMain(plain.mainFile, "demo.plain");
  const jdk = await projects.detectJdk(plain.root);
  assert.equal(jdk.available, true, "JDK is unavailable.");
  const plainOut = path.join(plain.root, "out");
  await fs.mkdir(plainOut, { recursive: true });
  await spawnCapture(jdk.javac, ["-d", plainOut, plain.mainFile], { cwd: plain.root, rejectOnError: true });
  const plainRun = await spawnCapture(jdk.java, ["-cp", plainOut, "demo.plain.Main"], { cwd: plain.root, rejectOnError: true });
  assert.match(plainRun.stdout, /LAMBDA:42/);

  const maven = await projects.create(spec("Maven", "maven-app", "demo.maven"));
  await assertStandardDirectories(maven.root);
  await writeLambdaMain(maven.mainFile, "demo.maven");
  const mavenTool = projects.toolPath("maven");
  assert.ok(mavenTool, "Bundled Maven is unavailable.");
  await spawnCapture(mavenTool, ["-q", "test"], { cwd: maven.root, rejectOnError: true });
  const mavenRun = await spawnCapture(mavenTool, ["-q", "compile", "exec:java", "-Dexec.mainClass=demo.maven.Main"], {
    cwd: maven.root,
    rejectOnError: true,
  });
  assert.match(mavenRun.stdout, /LAMBDA:42/);

  const gradle = await projects.create(spec("Gradle", "gradle-app", "demo.gradle"));
  await assertStandardDirectories(gradle.root);
  await writeLambdaMain(gradle.mainFile, "demo.gradle");
  const gradleTool = projects.toolPath("gradle");
  assert.ok(gradleTool, "Bundled Gradle is unavailable.");
  const gradleResult = await spawnCapture(
    gradleTool,
    ["test", "run", "--console=plain", "--no-daemon"],
    { cwd: gradle.root, rejectOnError: true },
  );
  assert.match(gradleResult.stdout, /LAMBDA:42/);

  console.log("Project smoke passed: Plain Java, Maven and Gradle compiled lambdas, built, tested and executed.");
} finally {
  await removeWithRetry(parent);
}

async function assertStandardDirectories(root) {
  for (const directory of [
    path.join("src", "main", "java"),
    path.join("src", "test", "java"),
    path.join("src", "main", "resources"),
    path.join("src", "test", "resources"),
  ]) {
    assert.equal((await fs.stat(path.join(root, directory))).isDirectory(), true, `${directory} is missing.`);
  }
}

async function writeLambdaMain(file, packageName) {
  await fs.writeFile(file, `package ${packageName};

import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int total = Arrays.asList(20, 22).stream()
            .mapToInt(value -> value)
            .sum();
        System.out.println("LAMBDA:" + total);
    }
}
`, "utf8");
}

function spec(type, name, packageName) {
  return {
    type,
    name,
    location: parent,
    groupId: "demo",
    artifactId: name,
    packageName,
    jdkPath: "",
  };
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
