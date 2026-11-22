import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { DependencyCompatibilityService, javaTarget } = require("../electron/services/dependency-compatibility.cjs");
const { DependencyService } = require("../electron/services/dependency-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function harness(source: string, versions: string[], java: Record<string, number | null>, extra: Record<string, string> = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-compatibility-"))); roots.push(root);
  await fs.writeFile(path.join(root, "build.gradle.kts"), source);
  for (const [name, value] of Object.entries(extra)) await fs.writeFile(path.join(root, name), value);
  const guard = new PathGuard(); guard.register(root);
  const projects = { detect: async () => ({ type: "Gradle", languageLevel: "17" }) };
  const fetcher = async (url: URL) => {
    if (url.pathname.endsWith("maven-metadata.xml")) return new Response(`<metadata><versioning><versions>${versions.map(version => `<version>${version}</version>`).join("")}</versions></versioning></metadata>`);
    if (url.pathname.endsWith(".module")) {
      const version = decodeURIComponent(url.pathname.split("/").at(-2)!);
      if (java[version] == null) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ variants: [{ attributes: { "org.gradle.usage": "java-api", "org.gradle.jvm.version": java[version] } }] }));
    }
    return new Response("", { status: 404 });
  };
  const dependencies = new DependencyService(guard, projects, fetcher);
  return { root, service: new DependencyCompatibilityService(guard, projects, dependencies), dependencies };
}
describe("project-aware dependency advice", () => {
  it("reads the Java target from the reported Kotlin build pattern", () => {
    expect(javaTarget('var sourceCompilerVersion = 25\ntasks.withType<JavaCompile>().configureEach { options.release = sourceCompilerVersion }')).toBe(25);
    expect(javaTarget('options.release.set(17)\n// options.release.set(25)')).toBe(17);
    expect(javaTarget('val text = "options.release = 25"\noptions.release.set(17)')).toBe(17);
  });
  it("recommends a Java-compatible release within the current major version", async () => {
    const { root, service } = await harness('java { toolchain.languageVersion.set(JavaLanguageVersion.of(17)) }\ndependencies {\n implementation("com.example:library:1.0")\n}', ["1.0", "1.4", "1.5", "2.0"], { "1.0": 8, "1.4": 17, "1.5": 21, "2.0": 25 });
    const advice = await service.advise(root, "com.example", "library");
    expect(advice.javaTarget).toBe(17);
    expect(advice.recommendedVersion).toBe("1.4");
    expect(advice.versions.find((entry: any) => entry.version === "1.5").status).toBe("incompatible");
    expect(advice.versions.find((entry: any) => entry.version === "2.0").reasons.join(" ")).toContain("Java 25");
  });
  it("preserves the Minecraft target even when newer API versions exist", async () => {
    const old = "1.21.9-R0.1-SNAPSHOT"; const next = "1.21.10-R0.1-SNAPSHOT";
    const { root, service } = await harness(`val jdk = 21\njava { toolchain.languageVersion.set(JavaLanguageVersion.of(jdk)) }\ndependencies {\n compileOnly("io.papermc.paper:paper-api:${old}")\n}`, [old, next], { [old]: 21, [next]: 21 });
    const advice = await service.advise(root, "io.papermc.paper", "paper-api");
    expect(advice.minecraftTarget).toBe("1.21.9"); expect(advice.recommendedVersion).toBe(old);
    expect(advice.versions.find((entry: any) => entry.version === next).status).toBe("incompatible");
  });
  it("does not present missing metadata or an unresolved target as verified compatibility", async () => {
    const { root, service } = await harness('java { toolchain.languageVersion.set(JavaLanguageVersion.of(providerValue)) }\ndependencies {}', ["1.0"], { "1.0": null });
    const advice = await service.advise(root, "com.example", "library");
    expect(advice.javaTarget).toBeNull(); expect(advice.recommendedVersion).toBeNull();
    expect(advice.versions[0].status).toBe("unknown");
  });
  it("flags related modules that need a coordinated update", async () => {
    const { root, service } = await harness('java { toolchain.languageVersion.set(JavaLanguageVersion.of(17)) }\ndependencies {\n implementation("io.netty:netty-buffer:1.0")\n}', ["1.1"], { "1.1": 8 });
    const advice = await service.advise(root, "io.netty", "netty-common");
    expect(advice.recommendedVersion).toBeNull(); expect(advice.versions[0].notes.join(" ")).toContain("gemeinsam");
  });
  it("inherits the Java target from parent POM properties", async () => {
    const { service, dependencies } = await harness('plugins { java }', ["1.0"], {});
    vi.spyOn(dependencies.sources, "request").mockImplementation(async (url: any) => String(url).includes("/parent/")
      ? '<project><properties><jdk>21</jdk><maven.compiler.release>${jdk}</maven.compiler.release></properties></project>'
      : '<project><parent><groupId>example</groupId><artifactId>parent</artifactId><version>1</version></parent></project>');
    const pom = await service.pom({ id: "test", url: "https://example.invalid/" }, "example", "library", "1.0");
    expect(pom.requiredJava).toBe(21);
  });
  it("does not deadlock when concurrently inspected POMs have cyclic parents", async () => {
    const { service, dependencies } = await harness('plugins { java }', ["1.0"], {});
    vi.spyOn(dependencies.sources, "request").mockImplementation(async (url: any) => `<project><parent><groupId>example</groupId><artifactId>${String(url).includes('/first/') ? 'second' : 'first'}</artifactId><version>1</version></parent></project>`);
    const source = { id: "test", url: "https://example.invalid/" };
    const values = await Promise.all([service.pom(source, "example", "first", "1"), service.pom(source, "example", "second", "1")]);
    expect(values.every(value => value.requiredJava === null)).toBe(true);
  });
  it("marks unavailable compatibility metadata as unknown", async () => {
    const { root, service, dependencies } = await harness('plugins { java }', ["1.0"], {});
    vi.spyOn(dependencies.sources, "request").mockImplementation(async (url: any) => {
      if (String(url).endsWith(".module") || String(url).endsWith(".pom")) throw new Error("offline");
      return '<metadata><versioning><versions><version>1.0</version></versions></versioning></metadata>';
    });
    const advice = await service.advise(root, "example", "library");
    expect(advice.recommendedVersion).toBeNull();
    expect(advice.versions[0]).toMatchObject({ status: "unknown", evidence: "unavailable" });
  });
});
