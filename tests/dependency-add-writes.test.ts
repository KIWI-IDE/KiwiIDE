import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const { DependencyService } = require("../electron/services/dependency-service.cjs");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 })));
});

async function project(kind: "Maven" | "Gradle", files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-dependency-add-"));
  temporaryDirectories.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  const guard = new PathGuard();
  guard.register(root);
  const service = new DependencyService(guard, { detect: async () => ({ type: kind }) });
  return { root, service };
}

const guava = { groupId: "com.google.guava", artifactId: "guava", version: "33.0.0-jre" };

/**
 * Whether the library actually reaches the file.
 *
 * "The search works but nothing is written into the pom or the
 * build.gradle.kts" is a report about the end of the journey, and every part
 * of it was covered on its own: the insertion is a pure function with tests,
 * and so is the choice of file. What was never asked is whether the service
 * that puts the two together writes anything to disk.
 */
describe("adding a dependency writes it into the build file", () => {
  it("writes into build.gradle.kts", async () => {
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": [
        "plugins {",
        '    kotlin("jvm") version "1.9.22"',
        "}",
        "",
        "dependencies {",
        '    implementation("org.jetbrains.kotlin:kotlin-stdlib")',
        "}",
        "",
      ].join("\n"),
    });

    const result = await service.add(root, guava, "implementation");
    expect(result.added).toBe(true);

    const written = await fs.readFile(path.join(root, "build.gradle.kts"), "utf8");
    expect(written).toContain('implementation("com.google.guava:guava:33.0.0-jre")');
  });

  it("writes into pom.xml", async () => {
    const { root, service } = await project("Maven", {
      "pom.xml": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<project xmlns="http://maven.apache.org/POM/4.0.0">',
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>de.test</groupId>",
        "  <artifactId>demo</artifactId>",
        "  <version>1.0</version>",
        "  <dependencies>",
        "  </dependencies>",
        "</project>",
        "",
      ].join("\n"),
    });

    const result = await service.add(root, guava, "compile");
    expect(result.added).toBe(true);

    const written = await fs.readFile(path.join(root, "pom.xml"), "utf8");
    expect(written).toContain("<artifactId>guava</artifactId>");
    expect(written).toContain("<version>33.0.0-jre</version>");
  });

  it("writes into a build file that has no dependencies block yet", async () => {
    // The commonest shape of a fresh project, and the one where an insertion
    // that only knows how to append to an existing block does nothing at all.
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": ["plugins {", '    kotlin("jvm") version "1.9.22"', "}", ""].join("\n"),
    });

    const result = await service.add(root, guava, "implementation");
    expect(result.added).toBe(true);

    const written = await fs.readFile(path.join(root, "build.gradle.kts"), "utf8");
    expect(written).toContain('implementation("com.google.guava:guava:33.0.0-jre")');
  });

  it("writes into the module that was asked for, not the root", async () => {
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\ninclude(":app")\n',
      "build.gradle.kts": "plugins {\n}\n",
      "app/build.gradle.kts": ["dependencies {", "}", ""].join("\n"),
    });
    const moduleFile = path.join(root, "app", "build.gradle.kts");

    const result = await service.add(root, guava, "implementation", { buildFile: moduleFile });
    expect(path.resolve(result.file)).toBe(path.resolve(moduleFile));

    const written = await fs.readFile(moduleFile, "utf8");
    expect(written).toContain('implementation("com.google.guava:guava:33.0.0-jre")');
    // The root governs no source; nothing may land there by accident.
    expect(await fs.readFile(path.join(root, "build.gradle.kts"), "utf8"))
      .not.toContain("guava");
  });

  it("writes into a build file the scan never reached", async () => {
    // The model is a scan taken a moment earlier, and a file asked for by name
    // had to appear in it. A module added since — or one below a directory the
    // scan skips — was refused as "not a build file of this project" while it
    // sat open in the editor.
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": "plugins {\n}\n",
    });
    const late = path.join(root, "build", "extra", "build.gradle.kts");
    await fs.mkdir(path.dirname(late), { recursive: true });
    await fs.writeFile(late, "dependencies {\n}\n", "utf8");

    const result = await service.add(root, guava, "implementation", { buildFile: late });
    expect(result.added).toBe(true);
    expect(await fs.readFile(late, "utf8")).toContain("com.google.guava:guava");
  });

  it("finds the root build file when the project was opened in another case", async () => {
    // Windows hands out both spellings freely, and this was the one comparison
    // in the service still done as plain string equality.
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": "dependencies {\n}\n",
    });
    const shouted = process.platform === "win32" ? root.toUpperCase() : root;

    const result = await service.add(shouted, guava, "implementation");
    expect(result.added).toBe(true);
    expect(await fs.readFile(path.join(root, "build.gradle.kts"), "utf8")).toContain("guava");
  });

  it("refuses a file that carries no dependencies, and says which files do", async () => {
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": "dependencies {\n}\n",
    });

    await expect(service.add(root, guava, "implementation", {
      buildFile: path.join(root, "settings.gradle.kts"),
    })).rejects.toThrow(/build\.gradle/);
  });

  it("says so rather than writing twice", async () => {
    const { root, service } = await project("Gradle", {
      "settings.gradle.kts": 'rootProject.name = "demo"\n',
      "build.gradle.kts": ["dependencies {", "}", ""].join("\n"),
    });

    await service.add(root, guava, "implementation");
    const again = await service.add(root, guava, "implementation");
    expect(again.added).toBe(false);
    expect(again.reason).toBeTruthy();

    const written = await fs.readFile(path.join(root, "build.gradle.kts"), "utf8");
    expect(written.split("com.google.guava:guava").length - 1).toBe(1);
  });
});
