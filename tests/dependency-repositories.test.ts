import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { DependencyService } = require("../electron/services/dependency-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { gradleRepository, mavenRepository } = require("../electron/services/dependency-repository-writer.cjs");
const { repositoryById } = require("../electron/services/dependency-sources.cjs");
const fixtures: string[] = [];
afterEach(async () => { for (const root of fixtures.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function project(type: string, files: Record<string, string>) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-repositories-")));
  fixtures.push(root);
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  const guard = new PathGuard(); guard.register(root);
  return { root, service: new DependencyService(guard, { detect: async () => ({ type }) }) };
}
const paper = { groupId: "io.papermc.paper", artifactId: "paper-api", version: "1.21.9-R0.1-SNAPSHOT" };

describe("repository-aware dependency imports", () => {
  it("adds the dependency and repository to Maven together", async () => {
    const { root, service } = await project("Maven", { "pom.xml": "<project><dependencies/></project>" });
    const result = await service.add(root, paper, "provided", { sourceId: "papermc" });
    expect(result.added).toBe(true);
    const text = await fs.readFile(path.join(root, "pom.xml"), "utf8");
    expect(text).toContain("<artifactId>paper-api</artifactId>");
    expect(text).toContain("https://repo.papermc.io/repository/maven-public/");
    expect(mavenRepository(text, repositoryById("papermc"))).toBe(text);
  });

  it("preserves imports, existing repositories and environment credentials in Kotlin scripts", async () => {
    const text = 'import org.apache.tools.ant.filters.ReplaceTokens\nplugins { id("java") }\nrepositories {\n maven { url = uri("https://private.example/"); credentials { password = System.getenv("TOKEN") } }\n}\ndependencies {}';
    const { root, service } = await project("Gradle", { "build.gradle.kts": text });
    await service.add(root, paper, "compileOnly", { sourceId: "papermc" });
    const result = await fs.readFile(path.join(root, "build.gradle.kts"), "utf8");
    expect(result.startsWith("import org.apache.tools.ant.filters.ReplaceTokens")).toBe(true);
    expect(result).toContain('password = System.getenv("TOKEN")');
    expect(result).toContain('compileOnly("io.papermc.paper:paper-api:1.21.9-R0.1-SNAPSHOT")');
    expect(gradleRepository(result, repositoryById("papermc"))).toBe(result);
  });

  it("uses dependencyResolutionManagement instead of a project repository in strict builds", async () => {
    const settings = 'pluginManagement { repositories { maven { url = uri("https://repo.papermc.io/repository/maven-public/") } } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { mavenCentral() } }';
    const { root, service } = await project("Gradle", { "settings.gradle.kts": settings, "build.gradle.kts": 'plugins { id("java") }\ndependencies {}' });
    const result = await service.add(root, paper, "compileOnly", { sourceId: "papermc" });
    expect(result.files).toHaveLength(2);
    const build = await fs.readFile(path.join(root, "build.gradle.kts"), "utf8");
    const updated = await fs.readFile(path.join(root, "settings.gradle.kts"), "utf8");
    expect(build).not.toContain("repositories");
    expect(updated.match(/https:\/\/repo.papermc.io/g)).toHaveLength(2);
    expect(updated).toContain("FAIL_ON_PROJECT_REPOS");
  });

  it("keeps catalog imports consistent and rolls back on a failed write", async () => {
    const files = { "settings.gradle.kts": "dependencyResolutionManagement { repositories { mavenCentral() } }", "build.gradle.kts": "dependencies {}", "gradle/libs.versions.toml": "[versions]\n\n[libraries]\n" };
    const { root, service } = await project("Gradle", files);
    const write = service.writeChecked.bind(service);
    vi.spyOn(service, "writeChecked").mockImplementation(async (file: string, original: string, updated: string) => {
      if (file.endsWith("build.gradle.kts")) throw new Error("write refused");
      return write(file, original, updated);
    });
    await expect(service.add(root, paper, "compileOnly", { sourceId: "papermc", useVersionCatalog: true, alias: "paperSpigot" })).rejects.toThrow("write refused");
    for (const [name, original] of Object.entries(files)) expect(await fs.readFile(path.join(root, name), "utf8")).toBe(original);
    vi.restoreAllMocks();
    const result = await service.add(root, paper, "compileOnly", { sourceId: "papermc", useVersionCatalog: true, alias: "paperSpigot" });
    expect(result.files).toHaveLength(3);
    expect(await fs.readFile(path.join(root, "build.gradle.kts"), "utf8")).toContain("compileOnly(libs.paperSpigot)");
  });

  it("does not mistake comments or plugin repositories for dependency repositories", () => {
    const paperRepo = repositoryById("papermc");
    const text = 'buildscript { repositories { maven { url = uri("https://repo.papermc.io/repository/maven-public/") } } }\n// repositories { maven { url = uri("https://repo.papermc.io/repository/maven-public/") } }\ndependencies {}';
    const updated = gradleRepository(text, paperRepo);
    expect(updated).toContain('\nrepositories {\n    maven');
    expect(gradleRepository(updated, paperRepo)).toBe(updated);
    expect(() => repositoryById("https://evil.example")).toThrow(/Unbekannte/);
  });
});
