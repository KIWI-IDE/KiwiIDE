import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  BuildTaskCache,
  buildFilesFor,
  cacheKeyFor,
  stampFiles,
  stampsMatch,
} = require("../electron/services/build-task-cache.cjs");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-task-cache-"));
  roots.push(root);
  return root;
}

/** Timestamps have a resolution, so a rewrite has to be given a new one. */
function rewrite(file: string, text: string) {
  fs.writeFileSync(file, text);
  const later = new Date(Date.now() + 4_000);
  fs.utimesSync(file, later, later);
}

describe("which files a task list depends on", () => {
  it("covers the Gradle files that decide what tasks exist", () => {
    const files = buildFilesFor("C:/bau", "Gradle").map((file: string) => path.basename(file));
    expect(files).toContain("settings.gradle.kts");
    expect(files).toContain("build.gradle.kts");
    expect(files).toContain("build.gradle");
    expect(files).toContain("gradle.properties");
    expect(files).toContain("libs.versions.toml");
  });

  it("includes each subproject's own build file", () => {
    const files = buildFilesFor("C:/bau", "Gradle", ["leafcloud-api", "dienste:web"]);
    expect(files).toContain(path.join("C:/bau", "leafcloud-api", "build.gradle.kts"));
    expect(files).toContain(path.join("C:/bau", "dienste", "web", "build.gradle.kts"));
  });

  it("refuses a subproject path that leaves the project", () => {
    // A settings file can name anything at all, and statting outside the
    // workspace is not this cache's business.
    const files = buildFilesFor("C:/bau", "Gradle", ["../woanders"]);
    expect(files.every((file: string) => !file.includes("woanders"))).toBe(true);
  });

  it("covers the wrapper, which decides which Gradle answers", () => {
    // A wrapper upgrade changes the version of Gradle that runs and with it
    // the tasks it reports, while every build file stays byte for byte the
    // same. Without this the stored answer outlives the build it described.
    const files = buildFilesFor("C:/bau", "Gradle").map((file: string) => file.split(path.sep).join("/"));
    expect(files).toContain("C:/bau/gradle/wrapper/gradle-wrapper.properties");
  });

  it("covers the Maven wrapper the same way", () => {
    const files = buildFilesFor("C:/bau", "Maven").map((file: string) => file.split(path.sep).join("/"));
    expect(files).toContain("C:/bau/.mvn/wrapper/maven-wrapper.properties");
  });

  it("asks for the poms of a Maven reactor", () => {
    const files = buildFilesFor("C:/bau", "Maven", ["kern"]);
    expect(files).toContain(path.join("C:/bau", "pom.xml"));
    expect(files).toContain(path.join("C:/bau", "kern", "pom.xml"));
  });
});

describe("noticing that a build file changed", () => {
  it("records a missing file rather than leaving it out", async () => {
    const root = project();
    const stamps = await stampFiles([path.join(root, "build.gradle.kts")]);
    expect(Object.values(stamps)).toEqual([0]);

    // Creating it is a change, which it would not be if absence meant absent
    // from the list.
    fs.writeFileSync(path.join(root, "build.gradle.kts"), "plugins { java }");
    expect(await stampsMatch(stamps)).toBe(false);
  });

  it("holds while nothing is written", async () => {
    const root = project();
    const file = path.join(root, "build.gradle.kts");
    fs.writeFileSync(file, "plugins { java }");
    const stamps = await stampFiles([file]);
    expect(await stampsMatch(stamps)).toBe(true);
  });
});

describe("a task list kept per project", () => {
  it("hands the same answer back", async () => {
    const root = project();
    const file = path.join(root, "build.gradle.kts");
    fs.writeFileSync(file, "plugins { java }");
    const cache = new BuildTaskCache();
    await cache.set(root, { tasks: [{ name: "build" }] }, [file]);
    expect(await cache.get(root)).toEqual({ tasks: [{ name: "build" }] });
  });

  it("drops it once the build file is written again", async () => {
    const root = project();
    const file = path.join(root, "build.gradle.kts");
    fs.writeFileSync(file, "plugins { java }");
    const cache = new BuildTaskCache();
    await cache.set(root, { tasks: [] }, [file]);

    rewrite(file, "plugins { java }\ntasks.register(\"neu\") {}");
    expect(await cache.get(root)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("answers however the path is spelled", async () => {
    // Callers spell the same project differently — the startup preload uses
    // the workspace state's path, the renderer its own — and on Windows those
    // differ in slashes and in case. Every entry used to be written under one
    // spelling and looked up under another, so the cache never answered.
    const root = project();
    const cache = new BuildTaskCache();
    await cache.set(root, { tasks: [] }, []);
    expect(await cache.get(root.replace(/\\/g, "/"))).toEqual({ tasks: [] });
    expect(await cache.get(root.toUpperCase())).toEqual({ tasks: [] });
    expect(cache.size).toBe(1);
  });

  it("files a path under one key however it arrives", () => {
    expect(cacheKeyFor("C:/bau/../bau/projekt")).toBe(cacheKeyFor("C:\\bau\\projekt"));
  });

  it("knows nothing about a project it was never told about", async () => {
    expect(await new BuildTaskCache().get("C:/nie-gesehen")).toBeNull();
  });

  it("can be emptied for one project or for all of them", async () => {
    const root = project();
    const other = project();
    const cache = new BuildTaskCache();
    await cache.set(root, { tasks: [] }, []);
    await cache.set(other, { tasks: [] }, []);
    cache.clear(root);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("a task list that survives a restart", () => {
  /** A fresh cache over the same directory is what a second start looks like. */
  function reopen(directory: string, fingerprint = "kiwi-1|toolchain") {
    return new BuildTaskCache({ directory, fingerprint });
  }

  it("answers a later start without asking the build tool again", async () => {
    const root = project();
    const file = path.join(root, "build.gradle.kts");
    fs.writeFileSync(file, "plugins { java }");
    const store = project();

    await reopen(store).set(root, { tasks: [{ name: "build" }] }, [file]);
    // Nothing in memory: this is a new process reading what the last one left.
    expect(await reopen(store).get(root)).toEqual({ tasks: [{ name: "build" }] });
  });

  it("drops what was stored when a build file changed in between", async () => {
    const root = project();
    const file = path.join(root, "build.gradle.kts");
    fs.writeFileSync(file, "plugins { java }");
    const store = project();
    await reopen(store).set(root, { tasks: [] }, [file]);

    // Edited while Kiwi was closed, which the timestamps still catch.
    rewrite(file, 'plugins { java }' + String.fromCharCode(10) + 'tasks.register("neu") {}');
    const later = reopen(store);
    expect(await later.get(root)).toBeNull();
    // And the file is gone, rather than left to be re-read and rejected again.
    expect(fs.existsSync(later.fileFor(root))).toBe(false);
  });

  it("ignores what a different Kiwi or toolchain wrote", async () => {
    // Timestamps cannot see the tool change underneath an unchanged build:
    // another bundled Gradle reports other tasks from the same build file.
    const root = project();
    const file = path.join(root, "build.gradle.kts");
    fs.writeFileSync(file, "plugins { java }");
    const store = project();
    await reopen(store, "kiwi-1|toolchain-a").set(root, { tasks: [{ name: "alt" }] }, [file]);
    expect(await reopen(store, "kiwi-2|toolchain-a").get(root)).toBeNull();
    expect(await reopen(store, "kiwi-1|toolchain-b").get(root)).toBeNull();
    expect(await reopen(store, "kiwi-1|toolchain-a").get(root)).toEqual({ tasks: [{ name: "alt" }] });
  });

  it("treats a damaged file as nothing stored", async () => {
    const root = project();
    const store = project();
    const cache = reopen(store);
    await cache.set(root, { tasks: [] }, []);
    fs.writeFileSync(cache.fileFor(root), "{ das ist kein JSON");
    expect(await reopen(store).get(root)).toBeNull();
  });

  it("forgets a project on disk as well as in memory", async () => {
    const root = project();
    const store = project();
    const cache = reopen(store);
    await cache.set(root, { tasks: [] }, []);
    const file = cache.fileFor(root);
    expect(fs.existsSync(file)).toBe(true);
    cache.clear(root);
    // clear() does not wait for the disk; the removal follows right after.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fs.existsSync(file)).toBe(false);
  });

  it("stores nothing at all without a directory", async () => {
    const root = project();
    const cache = new BuildTaskCache();
    expect(cache.fileFor(root)).toBe("");
    await cache.set(root, { tasks: [] }, []);
    expect(await cache.get(root)).toEqual({ tasks: [] });
  });

  it("gives two projects files of their own", () => {
    const store = project();
    const cache = reopen(store);
    expect(cache.fileFor("C:/bau/eins")).not.toBe(cache.fileFor("C:/bau/zwei"));
    // The same project spelled differently is still one file.
    expect(cache.fileFor("C:/bau/eins")).toBe(cache.fileFor("C:\\bau\\eins"));
  });
});
