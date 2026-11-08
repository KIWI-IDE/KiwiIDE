import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  describeDamage,
  gradleModulesPath,
  looksLikeArchive,
  mavenRepositoryPath,
  repairSharedCaches,
  scanArtifactCache,
} = require("../electron/services/artifact-cache-service.cjs");

const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

let home = "";

/** Writes one artifact into a Maven-shaped repository and returns its path. */
async function artifact(repository: string, name: string, content: Buffer | string) {
  const file = path.join(repository, "org", "example", "lib", "1.0", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "kiwi-artifact-cache-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true }).catch(() => undefined);
});

describe("where the shared caches live", () => {
  it("follows the environment when a developer moved a cache", () => {
    // Repairing the default path would repair nothing for anyone who moved
    // their repository, and they are exactly the people who notice.
    expect(mavenRepositoryPath({ M2_REPO: "D:\\repo" }, "C:\\Users\\dev"))
      .toBe(path.resolve("D:\\repo"));
    expect(gradleModulesPath({ GRADLE_USER_HOME: "D:\\gradle" }, "C:\\Users\\dev"))
      .toBe(path.join(path.resolve("D:\\gradle"), "caches", "modules-2", "files-2.1"));
  });

  it("falls back to the usual places", () => {
    expect(mavenRepositoryPath({}, path.join("C:", "Users", "dev")))
      .toBe(path.join("C:", "Users", "dev", ".m2", "repository"));
    expect(gradleModulesPath({}, path.join("C:", "Users", "dev")))
      .toBe(path.join("C:", "Users", "dev", ".gradle", "caches", "modules-2", "files-2.1"));
  });
});

describe("telling a damaged artifact from a healthy one", () => {
  it("reads a zip header rather than trusting the extension", () => {
    expect(looksLikeArchive(ZIP_HEAD)).toBe(true);
    expect(looksLikeArchive(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(looksLikeArchive(Buffer.from("<!DOCTYPE"))).toBe(false);
    expect(looksLikeArchive(Buffer.alloc(0))).toBe(false);
  });

  it("names the fault instead of only reporting one", async () => {
    const repository = path.join(home, "repository");
    // A proxy that answers a download with an error page leaves a file that is
    // the right size and the wrong thing entirely.
    expect(await describeDamage(await artifact(repository, "lib-1.0.jar", "<html>404</html>")))
      .toBe("kein gültiges Archiv");
    expect(await describeDamage(await artifact(repository, "empty-1.0.jar", "")))
      .toBe("leere Datei");
    expect(await describeDamage(await artifact(repository, "lib-1.0.jar.lastUpdated", "state")))
      .toBe("abgebrochener Download (Maven-Marker)");
    expect(await describeDamage(await artifact(repository, "lib-1.0.pom", "<project><art")))
      .toBe("abgeschnittene POM");
  });

  it("leaves a healthy artifact alone", async () => {
    const repository = path.join(home, "repository");
    const jar = await artifact(repository, "good-1.0.jar", Buffer.concat([ZIP_HEAD, Buffer.from("payload")]));
    expect(await describeDamage(jar)).toBe("");
    const pom = await artifact(repository, "good-1.0.pom", "<project><artifactId>good</artifactId></project>");
    expect(await describeDamage(pom)).toBe("");
  });

  it("checks a checksum only when asked, because it costs a full read", async () => {
    const repository = path.join(home, "repository");
    const body = Buffer.concat([ZIP_HEAD, Buffer.from("payload")]);
    const jar = await artifact(repository, "sum-1.0.jar", body);
    await writeFile(`${jar}.sha1`, "0000000000000000000000000000000000000000");
    expect(await describeDamage(jar)).toBe("");
    expect(await describeDamage(jar, { verifyChecksums: true })).toBe("Prüfsumme stimmt nicht (sha1)");
    // And the artifact that matches survives the same check.
    await writeFile(`${jar}.sha1`, createHash("sha1").update(body).digest("hex"));
    expect(await describeDamage(jar, { verifyChecksums: true })).toBe("");
  });
});

describe("scanning a cache", () => {
  it("reports a missing cache as missing rather than as clean", async () => {
    // "Nothing was damaged" and "there is nothing there" send the search to
    // very different places.
    const scan = await scanArtifactCache(path.join(home, "never-created"));
    expect(scan.missing).toBe(true);
    expect(scan.damaged).toEqual([]);
  });

  it("stops at its limit and says the scan is incomplete", async () => {
    const repository = path.join(home, "repository");
    await mkdir(repository, { recursive: true });
    for (let index = 0; index < 12; index += 1) {
      await writeFile(path.join(repository, `file-${index}.txt`), "x");
    }
    const scan = await scanArtifactCache(repository, { maxFiles: 5 });
    expect(scan.scanned).toBe(5);
    expect(scan.complete).toBe(false);
  });

  it("skips the lock directory, which is not a cache of artifacts", async () => {
    const repository = path.join(home, "repository");
    await mkdir(path.join(repository, ".locks"), { recursive: true });
    await writeFile(path.join(repository, ".locks", "artifact.lock"), "");
    const scan = await scanArtifactCache(repository);
    expect(scan.scanned).toBe(0);
    expect(scan.damaged).toEqual([]);
  });
});

describe("repairing both caches", () => {
  it("moves only what is damaged, and keeps it", async () => {
    const repository = path.join(home, ".m2", "repository");
    const good = await artifact(repository, "good-1.0.jar", Buffer.concat([ZIP_HEAD, Buffer.from("ok")]));
    const broken = await artifact(repository, "broken-1.0.jar", "<html>error</html>");
    const marker = await artifact(repository, "broken-1.0.jar.lastUpdated", "failed");

    const report = await repairSharedCaches({ env: {}, home, tool: "Maven" });

    expect(report.removed).toBe(2);
    expect(existsSync(good)).toBe(true);
    expect(existsSync(broken)).toBe(false);
    expect(existsSync(marker)).toBe(false);
    // Nothing is deleted: a wrong guess is one move away from being undone.
    const quarantined = path.join(
      report.quarantineRoot, "maven", "org", "example", "lib", "1.0", "broken-1.0.jar");
    expect(await readFile(quarantined, "utf8")).toBe("<html>error</html>");
  });

  it("reports a clean cache without moving anything", async () => {
    const repository = path.join(home, ".m2", "repository");
    await artifact(repository, "good-1.0.jar", Buffer.concat([ZIP_HEAD, Buffer.from("ok")]));
    const report = await repairSharedCaches({ env: {}, home, tool: "Maven" });
    expect(report.removed).toBe(0);
    expect(report.quarantineRoot).toBe("");
    expect(report.caches[0].damaged).toEqual([]);
    expect(report.caches[0].missing).toBe(false);
  });

  it("finds what is wrong without touching it when only asked to look", async () => {
    const repository = path.join(home, ".m2", "repository");
    const broken = await artifact(repository, "broken-1.0.jar", "not a zip");
    const report = await repairSharedCaches({ env: {}, home, tool: "Maven", dryRun: true });
    expect(report.removed).toBe(0);
    expect(report.caches[0].damaged).toEqual([{ path: broken, reason: "kein gültiges Archiv" }]);
    expect(existsSync(broken)).toBe(true);
  });

  it("covers both tools in one pass", async () => {
    const maven = path.join(home, ".m2", "repository");
    await artifact(maven, "broken-1.0.jar", "no");
    const gradle = path.join(home, ".gradle", "caches", "modules-2", "files-2.1", "org.example", "lib", "1.0", "hash");
    await mkdir(gradle, { recursive: true });
    await writeFile(path.join(gradle, "lib-1.0.jar"), "");

    const report = await repairSharedCaches({ env: {}, home });

    expect(report.caches.map((cache: { tool: string }) => cache.tool)).toEqual(["Maven", "Gradle"]);
    expect(report.removed).toBe(2);
    expect(await readdir(path.join(report.quarantineRoot))).toEqual(["gradle", "maven"]);
  });
});
