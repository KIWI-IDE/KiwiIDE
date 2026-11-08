import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  applyRendererUpdate,
  createRendererBundle,
  discardRendererUpdate,
  extractRendererBundle,
  mainProcessHash,
  pruneRendererUpdates,
  readCurrentRenderer,
  readRendererBundle,
  resolveRendererRoot,
  writeCurrentRenderer,
} = require("../electron/services/renderer-update-service.cjs");
const { compareVersions } = require("../electron/services/update-service.cjs");

let root = "";

async function writeRendererFiles(directory: string, marker: string) {
  await fs.mkdir(path.join(directory, "assets"), { recursive: true });
  await fs.writeFile(path.join(directory, "index.html"), `<!doctype html><title>${marker}</title>`);
  await fs.writeFile(path.join(directory, "assets", "app-1234.js"), `console.log(${JSON.stringify(marker)});`);
  await fs.writeFile(path.join(directory, "assets", "app-1234.css"), `body { --marker: "${marker}"; }`);
}

/** Builds a bundle by hand, so malformed input can be tested at all. */
function handCraftedBundle(files: Array<{ path: string; content: Buffer }>, header: Record<string, unknown> = {}) {
  const magic = Buffer.from("KIWIRND\0", "ascii");
  const described = files.map((file) => ({
    path: file.path,
    bytes: file.content.length,
    sha256: crypto.createHash("sha256").update(file.content).digest("hex"),
  }));
  const headerBuffer = Buffer.from(JSON.stringify({
    format: 1,
    version: "9.9.9",
    mainHash: "hash",
    files: described,
    ...header,
  }), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(headerBuffer.length, 0);
  const payload = zlib.gzipSync(Buffer.concat(files.map((file) => file.content)));
  return Buffer.concat([magic, length, headerBuffer, payload]);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-renderer-update-"));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("renderer bundles", () => {
  it("packs a built renderer and unpacks it byte for byte", async () => {
    const source = path.join(root, "dist-roundtrip");
    await writeRendererFiles(source, "roundtrip");
    const bundle = await createRendererBundle(source, { version: "1.1.0", mainHash: "abc" });

    const verified = readRendererBundle(bundle);
    expect(verified.version).toBe("1.1.0");
    expect(verified.mainHash).toBe("abc");
    expect(verified.files.map((file: { path: string }) => file.path)).toEqual([
      "assets/app-1234.css",
      "assets/app-1234.js",
      "index.html",
    ]);

    const target = path.join(root, "extracted");
    await extractRendererBundle(bundle, target);
    expect(await fs.readFile(path.join(target, "index.html"), "utf8")).toBe("<!doctype html><title>roundtrip</title>");
    expect(await fs.readFile(path.join(target, "assets", "app-1234.js"), "utf8")).toBe('console.log("roundtrip");');
  });

  it("is smaller than the files it carries", async () => {
    const source = path.join(root, "dist-size");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "index.html"), "<!doctype html>");
    await fs.writeFile(path.join(source, "big.js"), "console.log('kiwi');".repeat(4_000));
    const bundle = await createRendererBundle(source, { version: "1.1.0", mainHash: "abc" });
    expect(bundle.length).toBeLessThan(20 * 1024);
  });

  it("refuses a bundle whose contents were altered after packing", async () => {
    const source = path.join(root, "dist-tampered");
    await writeRendererFiles(source, "tampered");
    const bundle = await createRendererBundle(source, { version: "1.1.0", mainHash: "abc" });
    // Repack the payload with one changed byte but keep the original header:
    // exactly what an intercepted download would look like.
    const headerLength = bundle.readUInt32LE(8);
    const payload = zlib.gunzipSync(bundle.subarray(12 + headerLength));
    payload[0] = payload[0] ^ 0xff;
    const forged = Buffer.concat([bundle.subarray(0, 12 + headerLength), zlib.gzipSync(payload)]);
    expect(() => readRendererBundle(forged)).toThrow(/Prüfsumme/);
  });

  it("refuses a bundle that would write outside its own directory", () => {
    const escaping = handCraftedBundle([
      { path: "index.html", content: Buffer.from("<!doctype html>") },
      { path: "../../evil.js", content: Buffer.from("nope") },
    ]);
    expect(() => readRendererBundle(escaping)).toThrow(/unzulässigen Abschnitt/);

    const absolute = handCraftedBundle([
      { path: "index.html", content: Buffer.from("<!doctype html>") },
      { path: "C:/Windows/System32/evil.js", content: Buffer.from("nope") },
    ]);
    expect(() => readRendererBundle(absolute)).toThrow(/nicht relativ/);
  });

  it("refuses a bundle without an entry point or with trailing data", () => {
    expect(() => readRendererBundle(handCraftedBundle([
      { path: "assets/app.js", content: Buffer.from("x") },
    ]))).toThrow(/index\.html/);
    expect(() => readRendererBundle(Buffer.from("not a bundle"))).toThrow(/Kiwi-Format|unvollständig/);
  });
});

describe("main process fingerprint", () => {
  it("changes with the main process code and with the Electron version", async () => {
    const app = path.join(root, "app");
    await fs.mkdir(path.join(app, "electron", "services"), { recursive: true });
    await fs.writeFile(path.join(app, "package.json"), JSON.stringify({ dependencies: { "node-pty": "^1.1.0" } }));
    await fs.writeFile(path.join(app, "electron", "main.cjs"), "module.exports = 1;");
    await fs.writeFile(path.join(app, "electron", "services", "a.cjs"), "module.exports = 2;");
    // A renderer asset next to the main process must not influence the hash.
    await fs.writeFile(path.join(app, "electron", "notes.txt"), "ignored");

    const base = mainProcessHash(app, { electronVersion: "33.0.0" });
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    expect(mainProcessHash(app, { electronVersion: "33.0.0" })).toBe(base);
    expect(mainProcessHash(app, { electronVersion: "34.0.0" })).not.toBe(base);
    expect(mainProcessHash(app, { electronVersion: "33.0.0", dependencies: { "node-pty": "^1.2.0" } })).not.toBe(base);

    await fs.writeFile(path.join(app, "electron", "services", "a.cjs"), "module.exports = 3;");
    expect(mainProcessHash(app, { electronVersion: "33.0.0" })).not.toBe(base);

    await fs.writeFile(path.join(app, "electron", "notes.txt"), "still ignored, differently");
    await fs.writeFile(path.join(app, "electron", "services", "a.cjs"), "module.exports = 2;");
    expect(mainProcessHash(app, { electronVersion: "33.0.0" })).toBe(base);
  });

  it("matches the fingerprint of Kiwi's own main process", () => {
    const hash = mainProcessHash(path.join(__dirname, ".."), { electronVersion: process.versions.electron || "0" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("applying a renderer update without restarting", () => {
  it("installs a bundle and reports it as the renderer to load", async () => {
    const userData = path.join(root, "userdata-apply");
    const bundled = path.join(root, "packaged-dist");
    await writeRendererFiles(bundled, "packaged");
    const source = path.join(root, "dist-1.2.0");
    await writeRendererFiles(source, "updated");
    const bundleFile = path.join(root, "Kiwi-IDE-1.2.0-renderer.kiwi");
    await fs.writeFile(bundleFile, await createRendererBundle(source, { version: "1.2.0", mainHash: "main-1" }));

    const applied = await applyRendererUpdate({
      bundlePath: bundleFile,
      userDataPath: userData,
      mainHash: "main-1",
      version: "1.2.0",
    });
    expect(applied.version).toBe("1.2.0");
    expect(readCurrentRenderer(userData)?.version).toBe("1.2.0");

    const resolved = resolveRendererRoot(userData, bundled, { mainHash: "main-1", appVersion: "1.1.0", compareVersions });
    expect(resolved.hot).toBe(true);
    expect(await fs.readFile(path.join(resolved.directory, "index.html"), "utf8")).toContain("updated");

    // A full installer later brings the packaged renderer up to the same
    // version; the applied copy must stop winning at that point.
    const caughtUp = resolveRendererRoot(userData, bundled, { mainHash: "main-1", appVersion: "1.2.0", compareVersions });
    expect(caughtUp.hot).toBe(false);
    expect(caughtUp.directory).toBe(path.resolve(bundled));
  });

  it("never applies a bundle built against a different main process", async () => {
    const userData = path.join(root, "userdata-mismatch");
    const bundled = path.join(root, "packaged-dist");
    const source = path.join(root, "dist-foreign");
    await writeRendererFiles(source, "foreign");
    const bundleFile = path.join(root, "foreign-renderer.kiwi");
    await fs.writeFile(bundleFile, await createRendererBundle(source, { version: "2.0.0", mainHash: "other-main" }));

    await expect(applyRendererUpdate({
      bundlePath: bundleFile,
      userDataPath: userData,
      mainHash: "main-1",
      version: "2.0.0",
    })).rejects.toThrow(/andere/);
    expect(readCurrentRenderer(userData)).toBeNull();

    // The same guard protects a Kiwi that was updated by installer afterwards:
    // an applied bundle stops being used as soon as the main process changed.
    await writeCurrentRenderer(userData, {
      version: "2.0.0",
      mainHash: "other-main",
      directory: "2.0.0-abc",
      appliedAt: new Date().toISOString(),
    });
    const resolved = resolveRendererRoot(userData, bundled, { mainHash: "main-1", appVersion: "1.1.0", compareVersions });
    expect(resolved.hot).toBe(false);
    expect(resolved.stale).toBe(true);
  });

  it("falls back to the packaged renderer when the applied one is unusable", async () => {
    const userData = path.join(root, "userdata-broken");
    const bundled = path.join(root, "packaged-dist");
    await writeCurrentRenderer(userData, {
      version: "3.0.0",
      mainHash: "main-1",
      directory: "3.0.0-missing",
      appliedAt: new Date().toISOString(),
    });
    const resolved = resolveRendererRoot(userData, bundled, { mainHash: "main-1", appVersion: "1.1.0", compareVersions });
    expect(resolved).toMatchObject({ hot: false, stale: true, directory: path.resolve(bundled) });

    // A directory pointing outside the renderer folder is not honoured either.
    await writeCurrentRenderer(userData, {
      version: "3.0.0",
      mainHash: "main-1",
      directory: "../../elsewhere",
      appliedAt: new Date().toISOString(),
    });
    expect(resolveRendererRoot(userData, bundled, { mainHash: "main-1", appVersion: "1.1.0", compareVersions }).hot).toBe(false);
  });

  it("discards an applied renderer and cleans up old ones", async () => {
    const userData = path.join(root, "userdata-prune");
    const bundled = path.join(root, "packaged-dist");
    const source = path.join(root, "dist-prune");
    await writeRendererFiles(source, "prune");
    const bundleFile = path.join(root, "prune-renderer.kiwi");
    await fs.writeFile(bundleFile, await createRendererBundle(source, { version: "1.3.0", mainHash: "main-1" }));
    await applyRendererUpdate({ bundlePath: bundleFile, userDataPath: userData, mainHash: "main-1", version: "1.3.0" });
    const current = readCurrentRenderer(userData);

    await fs.mkdir(path.join(userData, "renderer", "1.0.0-old"), { recursive: true });
    expect(await pruneRendererUpdates(userData, current.directory)).toBe(1);
    expect(await fs.readdir(path.join(userData, "renderer"))).toEqual(
      expect.arrayContaining(["current.json", current.directory]),
    );

    await discardRendererUpdate(userData);
    expect(readCurrentRenderer(userData)).toBeNull();
    expect(resolveRendererRoot(userData, bundled, { mainHash: "main-1", appVersion: "1.1.0", compareVersions }).hot).toBe(false);
  });
});
