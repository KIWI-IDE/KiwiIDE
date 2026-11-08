import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { detectLombokAgent, isLombokAgentJar } = require("../electron/services/language-service.cjs");

/**
 * Which Lombok the language server is started with.
 *
 * JDT LS only sees Lombok's generated members when it runs with the agent, and
 * it has to be an agent new enough for the Java the project compiles against.
 * The wrong one is not an error message — it is every generated getter and
 * builder reported as missing, in a project that builds perfectly.
 */
describe("finding the Lombok agent", () => {
  let home = "";
  let previousHome = "";
  let previousProfile = "";

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "kiwi-lombok-"));
    previousHome = process.env.HOME || "";
    previousProfile = process.env.USERPROFILE || "";
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    if (previousHome) process.env.HOME = previousHome; else delete process.env.HOME;
    if (previousProfile) process.env.USERPROFILE = previousProfile; else delete process.env.USERPROFILE;
  });

  const cacheJar = (version: string, hash: string, jar: string) => {
    const directory = path.join(
      home, ".gradle", "caches", "modules-2", "files-2.1", "org.projectlombok", "lombok", version, hash,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, jar), "", "utf8");
    return path.join(directory, jar);
  };

  it("takes the newest version in the Gradle cache, counting numerically", async () => {
    // Sorted as text "1.18.9" stands above "1.18.30", so the cache handed back
    // an agent years older than the one the project builds with.
    cacheJar("1.18.9", "aaaa", "lombok-1.18.9.jar");
    cacheJar("1.18.30", "bbbb", "lombok-1.18.30.jar");
    cacheJar("1.18.4", "cccc", "lombok-1.18.4.jar");
    const found = await detectLombokAgent(home, { jarFiles: [] }, true);
    expect(path.basename(found)).toBe("lombok-1.18.30.jar");
  });

  it("passes over the sources and javadoc jars", async () => {
    // Handing the JVM a -sources jar as -javaagent aborts the launch outright.
    cacheJar("1.18.30", "aaaa", "lombok-1.18.30-sources.jar");
    cacheJar("1.18.30", "bbbb", "lombok-1.18.30.jar");
    const found = await detectLombokAgent(home, { jarFiles: [] }, true);
    expect(path.basename(found)).toBe("lombok-1.18.30.jar");
  });

  it("prefers a jar the project itself carries", async () => {
    cacheJar("1.18.30", "aaaa", "lombok-1.18.30.jar");
    const own = path.join(home, "libs", "lombok-1.18.32.jar");
    const found = await detectLombokAgent(home, { jarFiles: [own] }, true);
    expect(found).toBe(own);
  });

  it("answers with nothing when Lombok support is switched off", async () => {
    cacheJar("1.18.30", "aaaa", "lombok-1.18.30.jar");
    expect(await detectLombokAgent(home, { jarFiles: [] }, false)).toBe("");
  });

  it("answers with nothing when no cache exists", async () => {
    expect(await detectLombokAgent(home, { jarFiles: [] }, true)).toBe("");
  });

  it("takes the version the pom asks for out of the Maven repository", async () => {
    const repository = path.join(home, ".m2", "repository", "org", "projectlombok", "lombok", "1.18.24");
    mkdirSync(repository, { recursive: true });
    writeFileSync(path.join(repository, "lombok-1.18.24.jar"), "", "utf8");
    const project = mkdtempSync(path.join(tmpdir(), "kiwi-lombok-projekt-"));
    writeFileSync(path.join(project, "pom.xml"), [
      "<project>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.projectlombok</groupId>",
      "      <artifactId>lombok</artifactId>",
      "      <version>1.18.24</version>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
      "",
    ].join("\n"), "utf8");
    cacheJar("1.18.30", "aaaa", "lombok-1.18.30.jar");
    const found = await detectLombokAgent(project, { jarFiles: [] }, true);
    expect(path.basename(found)).toBe("lombok-1.18.24.jar");
  });
});

describe("recognising a Lombok agent jar", () => {
  it("accepts the plain artifact", () => {
    expect(isLombokAgentJar("lombok-1.18.30.jar")).toBe(true);
  });

  it("rejects the ones without the agent manifest", () => {
    expect(isLombokAgentJar("lombok-1.18.30-sources.jar")).toBe(false);
    expect(isLombokAgentJar("lombok-1.18.30-javadoc.jar")).toBe(false);
  });

  it("rejects a jar that only looks similar", () => {
    expect(isLombokAgentJar("lombok-mapstruct-binding-0.2.0.jar")).toBe(false);
  });
});
