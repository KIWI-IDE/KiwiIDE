import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const { prepareUnixUpdate, discardUnixUpdate } = require("../electron/services/unix-update-service.cjs");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-unix-update-"));
  roots.push(root);
  const installed = path.join(root, "Kiwi IDE.AppImage");
  const file = path.join(root, "download.AppImage");
  const bytes = Buffer.from("#!/bin/sh\nprintf '%s' \"$1\" > \"$KIWI_UPDATE_TEST_RESULT\"\n");
  await fs.writeFile(installed, "old installation", { mode: 0o755 });
  await fs.writeFile(file, bytes);
  return {
    root, installed, bytes,
    downloaded: {
      path: file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      artifactKind: "appimage",
    },
  };
}

describe("Unix update preparation", () => {
  it("stages a verified AppImage beside its installation and leaves the running file intact", async () => {
    const { root, installed, downloaded, bytes } = await fixture();
    const prepared = await prepareUnixUpdate(downloaded, { platform: "linux", appImage: installed, userData: root });
    expect(await fs.readFile(installed, "utf8")).toBe("old installation");
    expect(await fs.readFile(path.join(prepared.stage, "payload"))).toEqual(bytes);
    expect(path.dirname(prepared.stage)).toBe(root);
    await discardUnixUpdate(prepared);
    await expect(fs.stat(prepared.stage)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(installed, "utf8")).toBe("old installation");
  });

  it("rejects changed downloads and unsupported installation formats before staging", async () => {
    const { root, installed, downloaded } = await fixture();
    await expect(prepareUnixUpdate({ ...downloaded, sha256: "0".repeat(64) }, {
      platform: "linux", appImage: installed, userData: root,
    })).rejects.toThrow(/verification/);
    await expect(prepareUnixUpdate(downloaded, {
      platform: "linux", appImage: "", userData: root,
    })).rejects.toThrow(/AppImage/);
    expect((await fs.readdir(root)).filter(entry => entry.startsWith(".kiwi-update-"))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("replaces the stopped AppImage, retains a backup and launches with the update flag", async () => {
    const { root, installed, downloaded, bytes } = await fixture();
    const prepared = await prepareUnixUpdate(downloaded, {
      platform: "linux", appImage: installed, pid: 2147483647, userData: root,
    });
    const marker = path.join(root, "launched");
    const result = spawnSync(prepared.command, prepared.args, {
      env: { ...process.env, KIWI_UPDATE_TEST_RESULT: marker },
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(await fs.readFile(installed)).toEqual(bytes);
    expect(await fs.readFile(path.join(prepared.stage, "previous"), "utf8")).toBe("old installation");
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await fs.stat(marker).catch(() => null)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(await fs.readFile(marker, "utf8")).toBe("--updated");
  });

  it.skipIf(process.platform === "win32")("restores the previous installation when the staged file cannot be moved", async () => {
    const { root, installed, downloaded } = await fixture();
    const prepared = await prepareUnixUpdate(downloaded, {
      platform: "linux", appImage: installed, pid: 2147483647, userData: root,
    });
    await fs.unlink(path.join(prepared.stage, "payload"));
    const result = spawnSync(prepared.command, prepared.args, { timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(await fs.readFile(installed, "utf8")).toBe("old installation");
  });

  it.skipIf(process.platform !== "darwin" || !process.env.KIWI_UPDATE_TEST_DMG)("stages the built macOS release from its DMG", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-dmg-update-"));
    roots.push(root);
    const bundle = path.join(root, "Kiwi IDE.app");
    await fs.mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
    const file = process.env.KIWI_UPDATE_TEST_DMG!;
    const bytes = await fs.readFile(file);
    const prepared = await prepareUnixUpdate({
      path: file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      artifactKind: "dmg",
    }, { platform: "darwin", executable: path.join(bundle, "Contents", "MacOS", "Kiwi IDE"), userData: root });
    expect((await fs.stat(path.join(prepared.stage, "payload", "Contents", "MacOS", "Kiwi IDE"))).isFile()).toBe(true);
    await discardUnixUpdate(prepared);
  });
});
