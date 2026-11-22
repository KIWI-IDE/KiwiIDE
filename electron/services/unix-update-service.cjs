const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnCapture } = require("./process-utils.cjs");

// Runs after the old process exits. Renames stay on the installation's volume.
const HELPER = `#!/bin/sh
set -eu
stage=$1
target=$2
parent=$3
platform=$4
log=$5
exec >> "$log" 2>&1
attempt=0
while kill -0 "$parent" 2>/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 120 ] || exit 1
  sleep 1
done
backup="$stage/previous"
payload="$stage/payload"
mv "$target" "$backup"
if ! mv "$payload" "$target"; then
  mv "$backup" "$target"
  exit 1
fi
if [ "$platform" = darwin ]; then
  if ! /usr/bin/open -n "$target" --args --updated; then
    mv "$target" "$payload"
    mv "$backup" "$target"
    /usr/bin/open -n "$target" --args --update-failed
    exit 1
  fi
else
  unset APPIMAGE APPDIR OWD
  "$target" --updated &
fi
# Keep the previous installation for recovery.
`;

async function digest(file) {
  const handle = await fs.open(file, "r");
  try {
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function prepareUnixUpdate(downloaded, {
  platform = process.platform,
  executable = process.execPath,
  appImage = process.env.APPIMAGE,
  pid = process.pid,
  userData,
} = {}) {
  if (!["linux", "darwin"].includes(platform)) throw new Error("Unsupported update platform.");
  const kind = platform === "darwin" ? "dmg" : "appimage";
  if (downloaded.artifactKind !== kind) throw new Error("The update package does not match this platform.");
  const verified = await digest(downloaded.path);
  if (verified.sha256 !== downloaded.sha256 || verified.bytes !== downloaded.bytes) {
    throw new Error("The downloaded update failed verification.");
  }
  const target = platform === "darwin"
    ? path.resolve(path.dirname(executable), "..", "..")
    : appImage;
  if (!target || !path.isAbsolute(target) || (platform === "darwin" && !target.endsWith(".app"))) {
    throw new Error("Automatic updates require an installed Kiwi app or an AppImage.");
  }
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || (platform === "darwin" ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error("The installation path is not a valid update target.");
  }
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".kiwi-update-"));
  const payload = path.join(stage, "payload");
  let mounted = false;
  try {
    if (platform === "darwin") {
      const mount = path.join(stage, "mount");
      await fs.mkdir(mount);
      await spawnCapture("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, downloaded.path], {
        rejectOnError: true, timeoutMs: 120_000,
      });
      mounted = true;
      try {
        const bundle = path.join(mount, "Kiwi IDE.app");
        if (!(await fs.stat(path.join(bundle, "Contents", "MacOS", "Kiwi IDE"))).isFile()) {
          throw new Error("The release image does not contain Kiwi IDE.");
        }
        await spawnCapture("/usr/bin/ditto", [bundle, payload], { rejectOnError: true, timeoutMs: 120_000 });
      } finally {
        await spawnCapture("/usr/bin/hdiutil", ["detach", mount], { rejectOnError: true, timeoutMs: 30_000 });
        mounted = false;
      }
    } else {
      await fs.copyFile(downloaded.path, payload);
      const copied = await digest(payload);
      if (copied.sha256 !== downloaded.sha256 || copied.bytes !== downloaded.bytes) throw new Error("The staged AppImage failed verification.");
      await fs.chmod(payload, stat.mode & 0o777 | 0o100);
    }
    const helper = path.join(stage, "install.sh");
    await fs.writeFile(helper, HELPER, { mode: 0o700 });
    const updates = path.join(userData, "updates");
    await fs.mkdir(updates, { recursive: true });
    return {
      stage,
      command: "/bin/sh",
      args: [helper, stage, target, String(pid), platform, path.join(updates, "install.log")],
      cwd: path.dirname(target),
    };
  } catch (error) {
    if (!mounted) await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function discardUnixUpdate(prepared) {
  if (prepared?.stage) await fs.rm(prepared.stage, { recursive: true, force: true });
}

module.exports = { prepareUnixUpdate, discardUnixUpdate };
