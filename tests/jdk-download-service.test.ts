import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  adoptiumPlatform,
  describeJdk,
  downloadArchive,
  findJavaHome,
  installDirectoryName,
  installJdk,
  listAvailableJdks,
  listDownloadedJdks,
  parseAvailableReleases,
  parseBinary,
  createProgressReporter,
  normalizeFeature,
} = require("../electron/services/jdk-download-service.cjs");

let root = "";

/** A fetch that answers from a table, so no test reaches the network. */
function stubFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const key = Object.keys(routes).find((candidate) => String(url).includes(candidate));
    if (!key) return { ok: false, status: 404 };
    const value = routes[key];
    if (Buffer.isBuffer(value)) {
      return { ok: true, status: 200, body: Readable.from([value]) };
    }
    return { ok: true, status: 200, json: async () => value };
  };
}

/** One Adoptium asset answer for a package with the given bytes. */
function assetFor(body: Buffer, overrides: Record<string, unknown> = {}) {
  return [{
    release_name: "jdk-21.0.5+11",
    version: { semver: "21.0.5+11", major: 21 },
    binary: {
      package: {
        link: "https://example.invalid/OpenJDK21.zip",
        checksum: createHash("sha256").update(body).digest("hex"),
        size: body.length,
        name: "OpenJDK21.zip",
        ...(overrides.package || {}),
      },
    },
  }];
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-jdk-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("which build belongs to this machine", () => {
  it("translates the platform into Adoptium's words", () => {
    expect(adoptiumPlatform("win32", "x64")).toEqual({ os: "windows", architecture: "x64" });
    expect(adoptiumPlatform("darwin", "arm64")).toEqual({ os: "mac", architecture: "aarch64" });
  });

  it("refuses a platform Adoptium does not build for, by name", () => {
    // Saying which combination has no package is the difference between a
    // dead button and an answer.
    expect(() => adoptiumPlatform("aix", "ppc64")).toThrow(/aix\/ppc64/);
  });

  it("refuses malformed feature versions before building a network URL", () => {
    expect(normalizeFeature("21")).toBe(21);
    expect(() => normalizeFeature("latest")).toThrow(/ungültig/);
    expect(() => normalizeFeature(7)).toThrow(/ungültig/);
  });
});

describe("reading Adoptium's answers", () => {
  it("sorts the versions newest first and marks the long-term ones", () => {
    const releases = parseAvailableReleases({
      available_releases: [8, 17, 21, 23],
      available_lts_releases: [8, 17, 21],
      most_recent_lts: 21,
    });
    expect(releases.versions).toEqual([
      { version: 23, lts: false },
      { version: 21, lts: true },
      { version: 17, lts: true },
      { version: 8, lts: true },
    ]);
    expect(releases.mostRecentLts).toBe(21);
  });

  it("survives an answer that carries nothing usable", () => {
    expect(parseAvailableReleases(null)).toEqual({ versions: [], mostRecentLts: 0 });
  });

  it("refuses a package that comes without a checksum", () => {
    // An unverified JDK is a program that will be handed every keystroke of
    // source code on this machine, so no checksum means no download.
    expect(parseBinary([{ binary: { package: { link: "https://example.invalid/x.zip" } } }])).toBeNull();
    expect(parseBinary(assetFor(Buffer.from("x")))).toMatchObject({ major: 21, name: "OpenJDK21.zip" });
  });

  it("builds a folder name Windows will accept", () => {
    expect(installDirectoryName({ release: "jdk-21.0.5+11" } as never)).toBe("temurin-21.0.5-11");
    expect(installDirectoryName({ version: "17.0.9" } as never)).toBe("temurin-17.0.9");
  });
});

describe("finding Java inside an unpacked archive", () => {
  it("looks past the folder the distribution wrapped it in", async () => {
    const home = path.join(root, "jdk-21.0.5+11");
    await mkdir(path.join(home, "bin"), { recursive: true });
    await writeFile(path.join(home, "bin", "java.exe"), "");
    await writeFile(path.join(home, "bin", "javac.exe"), "");
    expect(findJavaHome(root, "win32")).toBe(home);
  });

  it("does not mistake a JRE without javac for a development kit", async () => {
    const home = path.join(root, "jre-21");
    await mkdir(path.join(home, "bin"), { recursive: true });
    await writeFile(path.join(home, "bin", "java.exe"), "");
    expect(findJavaHome(root, "win32")).toBe("");
  });

  it("answers with nothing rather than a folder that holds no Java", async () => {
    await mkdir(path.join(root, "docs"), { recursive: true });
    expect(findJavaHome(root, "win32")).toBe("");
  });
});

describe("downloading", () => {
  it("verifies the checksum and throws the file away when it disagrees", async () => {
    const body = Buffer.from("archive contents");
    const target = path.join(root, "download.zip");
    const binary = { link: "https://example.invalid/a.zip", checksum: "deadbeef", size: body.length, name: "a.zip" };
    await expect(downloadArchive(binary, target, { fetch: stubFetch({ "a.zip": body }) }))
      .rejects.toThrow(/Prüfsumme/);
    // A file that failed its check must not be left behind to be used later.
    expect(existsSync(target)).toBe(false);
  });

  it("keeps a download whose checksum matches, and reports progress", async () => {
    const body = Buffer.from("archive contents");
    const target = path.join(root, "download.zip");
    const seen: number[] = [];
    const result = await downloadArchive(
      { link: "https://example.invalid/a.zip", checksum: createHash("sha256").update(body).digest("hex"), size: body.length, name: "a.zip" },
      target,
      { fetch: stubFetch({ "a.zip": body }), onProgress: ({ received }: { received: number }) => seen.push(received) },
    );
    expect(result.bytes).toBe(body.length);
    expect(await readFile(target)).toEqual(body);
    expect(seen.at(-1)).toBe(body.length);
  });

  it("removes a partial archive when the network stream breaks", async () => {
    const target = path.join(root, "interrupted.zip");
    async function* interrupted() {
      yield Buffer.from("partial");
      throw new Error("connection reset");
    }
    await expect(downloadArchive(
      { link: "https://example.invalid/interrupted.zip", checksum: "unused", size: 20, name: "interrupted.zip" },
      target,
      { fetch: async () => ({ ok: true, status: 200, body: Readable.from(interrupted()) }) },
    )).rejects.toThrow(/connection reset/);
    expect(existsSync(target)).toBe(false);
  });

  it("times out a stalled stream and removes its partial archive", async () => {
    const target = path.join(root, "stalled.zip");
    const fetch = async (_url: string, init: { signal: AbortSignal }) => ({
      ok: true,
      status: 200,
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from("partial");
          await new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
          });
        },
      },
    });
    await expect(downloadArchive(
      { link: "https://example.invalid/stalled.zip", checksum: "unused", size: 20, name: "stalled.zip" },
      target,
      { fetch, timeoutMs: 15 },
    )).rejects.toThrow(/zu lange nicht geantwortet/);
    expect(existsSync(target)).toBe(false);
  });
});

describe("installing", () => {
  const body = Buffer.from("zip payload");

  /** Stands in for the real unpacker, which is not what these tests are about. */
  async function fakeExtract(_archive: string, destination: string) {
    const home = path.join(destination, "jdk-21.0.5+11");
    await mkdir(path.join(home, "bin"), { recursive: true });
    await writeFile(path.join(home, "bin", "java.exe"), "");
    await writeFile(path.join(home, "bin", "javac.exe"), "");
  }

  it("puts the Java home where the IDE will look for it", async () => {
    const result = await installJdk(21, root, {
      fetch: stubFetch({ "assets/latest/21": assetFor(body), "OpenJDK21.zip": body }),
      extract: fakeExtract,
      platform: "win32",
    });
    expect(result.installed).toBe(true);
    expect(result.path).toBe(path.join(root, "temurin-21.0.5-11"));
    expect(existsSync(path.join(result.path, "bin", "java.exe"))).toBe(true);
    // The archive and the staging folder do not outlive the install.
    expect(existsSync(path.join(root, ".temurin-21.0.5-11.partial"))).toBe(false);
  });

  it("does not download a version that is already there", async () => {
    let calls = 0;
    const counting = (url: string) => {
      calls += 1;
      return stubFetch({ "assets/latest/21": assetFor(body), "OpenJDK21.zip": body })(url);
    };
    await installJdk(21, root, { fetch: counting, extract: fakeExtract, platform: "win32" });
    const before = calls;
    const second = await installJdk(21, root, { fetch: counting, extract: fakeExtract, platform: "win32" });
    expect(second).toMatchObject({ installed: false, reason: "already-present" });
    // The version is asked for once more; the package itself is not fetched.
    expect(calls - before).toBe(1);
  });

  it("leaves nothing behind when the download fails", async () => {
    await expect(installJdk(21, root, {
      fetch: stubFetch({ "assets/latest/21": assetFor(body) }),
      extract: fakeExtract,
      platform: "win32",
    })).rejects.toThrow();
    expect(existsSync(path.join(root, ".temurin-21.0.5-11.partial"))).toBe(false);
    expect(listDownloadedJdks(root, "win32")).toEqual([]);
  });

  it("repairs an incomplete destination left by an interrupted install", async () => {
    const brokenHome = path.join(root, "temurin-21.0.5-11");
    await mkdir(path.join(brokenHome, "bin"), { recursive: true });
    await writeFile(path.join(brokenHome, "broken.txt"), "old partial installation");
    const result = await installJdk(21, root, {
      fetch: stubFetch({ "assets/latest/21": assetFor(body), "OpenJDK21.zip": body }),
      extract: fakeExtract,
      platform: "win32",
    });
    expect(result.installed).toBe(true);
    expect(existsSync(path.join(result.path, "broken.txt"))).toBe(false);
    expect(existsSync(path.join(result.path, "bin", "javac.exe"))).toBe(true);
  });

  it("coalesces simultaneous requests for the same managed JDK", async () => {
    let archiveDownloads = 0;
    const fetch = async (url: string) => {
      if (url.includes("OpenJDK21.zip")) archiveDownloads += 1;
      return stubFetch({ "assets/latest/21": assetFor(body), "OpenJDK21.zip": body })(url);
    };
    const [left, right] = await Promise.all([
      installJdk(21, root, { fetch, extract: fakeExtract, platform: "win32" }),
      installJdk(21, root, { fetch, extract: fakeExtract, platform: "win32" }),
    ]);
    expect(left.path).toBe(right.path);
    expect(archiveDownloads).toBe(1);
  });

  it("refuses packages that are not supported JDK archives", async () => {
    const binary = parseBinary(assetFor(body, { package: { name: "payload.exe" } }));
    await expect(installJdk(21, root, { binary, extract: fakeExtract, platform: "win32" }))
      .rejects.toThrow(/Archivnamen/);
  });
});

describe("what was downloaded before", () => {
  it("lists the Java homes and ignores an interrupted install", async () => {
    const home = path.join(root, "temurin-21", "jdk-21");
    await mkdir(path.join(home, "bin"), { recursive: true });
    await writeFile(path.join(home, "bin", "java.exe"), "");
    await writeFile(path.join(home, "bin", "javac.exe"), "");
    await mkdir(path.join(root, ".temurin-17.partial", "bin"), { recursive: true });
    await writeFile(path.join(root, ".temurin-17.partial", "bin", "java.exe"), "");
    await writeFile(path.join(root, ".temurin-17.partial", "bin", "javac.exe"), "");
    expect(listDownloadedJdks(root, "win32")).toEqual([home]);
  });
});

describe("progress sent back to the settings window", () => {
  it("deduplicates byte chunks but preserves install phases", () => {
    const events: Array<{ phase: string; percent: number; done?: boolean }> = [];
    const progress = createProgressReporter(21, (event: { phase: string; percent: number; done?: boolean }) => events.push(event));
    progress.preparing();
    progress.downloading({ received: 5, total: 10 });
    progress.downloading({ received: 5, total: 10 });
    progress.verifying();
    progress.extracting();
    progress.installing();
    progress.complete();
    expect(events.map((event) => [event.phase, event.percent, Boolean(event.done)])).toEqual([
      ["preparing", 0, false],
      ["downloading", 50, false],
      ["verifying", 50, false],
      ["extracting", 50, false],
      ["installing", 50, false],
      ["done", 100, true],
    ]);
  });
});

describe("asking Adoptium", () => {
  it("says what the server answered rather than failing silently", async () => {
    await expect(listAvailableJdks({ fetch: async () => ({ ok: false, status: 503 }) }))
      .rejects.toThrow(/503/);
    await expect(describeJdk(21, { fetch: async () => ({ ok: false, status: 500 }), platform: "win32", arch: "x64" }))
      .rejects.toThrow(/500/);
  });

  it("bounds a metadata request that never answers", async () => {
    const fetch = (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
    await expect(listAvailableJdks({ fetch, timeoutMs: 15 }))
      .rejects.toThrow(/zu lange nicht geantwortet/);
  });
});
