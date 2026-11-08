const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const WINDOWS_EXE = /\.exe$/i;

function sameWindowsPath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return process.platform === "win32" ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

async function hashFile(file) {
  const handle = await fs.open(file, "r");
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream()) {
      bytes += chunk.length;
      hash.update(chunk);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function assertPortableTarget(value) {
  const supplied = String(value || "").trim();
  if (!supplied || !path.isAbsolute(supplied) || !WINDOWS_EXE.test(supplied)) {
    throw new Error("Der Pfad der portablen Kiwi-EXE ist ungültig.");
  }
  const target = path.resolve(supplied);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Die portable Kiwi-EXE ist keine reguläre Datei.");
  }
  const realTarget = await fs.realpath(target);
  if (!sameWindowsPath(realTarget, target)) {
    throw new Error("Die portable Kiwi-EXE darf kein Link oder Reparse-Ziel sein.");
  }
  const realDirectory = await fs.realpath(path.dirname(target));
  if (!sameWindowsPath(realDirectory, path.dirname(target))) {
    throw new Error("Der Ordner der portablen Kiwi-EXE darf kein Link oder Reparse-Ziel sein.");
  }
  return target;
}

/**
 * Copies the verified download next to the running portable launcher.
 * Keeping both files on the same volume is what makes File.Replace atomic.
 * This happens while Kiwi is still open: missing write permission or disk
 * space therefore aborts the update before any renderer is asked to close.
 */
async function stagePortableUpdate(downloaded, targetValue) {
  const targetPath = await assertPortableTarget(targetValue);
  const sourcePath = path.resolve(String(downloaded?.path || ""));
  if (sameWindowsPath(sourcePath, targetPath)) throw new Error("Update-Quelle und portable Kiwi-EXE sind identisch.");
  const version = String(downloaded?.version || "update").replace(/[^0-9A-Za-z.+-]/g, "-");
  const stem = path.basename(targetPath, path.extname(targetPath)).replace(/[^0-9A-Za-z._-]/g, "-");
  const stagedPath = path.join(path.dirname(targetPath), `.${stem}.${version}.${crypto.randomBytes(8).toString("hex")}.pending.exe`);
  try {
    await fs.copyFile(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
    const handle = await fs.open(stagedPath, "r+");
    await handle.sync().finally(() => handle.close());
    const actual = await hashFile(stagedPath);
    if (actual.bytes !== Number(downloaded.bytes) || actual.sha256 !== String(downloaded.sha256 || "").toLowerCase()) {
      throw new Error("Die bereitgestellte portable Update-Datei hat die Verifikation nicht bestanden.");
    }
    return {
      kind: "portable",
      targetPath,
      stagedPath,
      version: String(downloaded.version),
      bytes: actual.bytes,
      sha256: actual.sha256,
    };
  } catch (error) {
    await fs.unlink(stagedPath).catch(() => undefined);
    throw error;
  }
}

function portableRelaunchArguments(argv = process.argv.slice(1)) {
  const result = ["--updated"];
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value.startsWith("--user-data-dir=")) {
      result.push(value);
    } else if (value === "--user-data-dir" && argv[index + 1]) {
      result.push(`--user-data-dir=${String(argv[index + 1])}`);
      index += 1;
    }
  }
  return result;
}

function failedUpdateRelaunchArguments(argv = process.argv.slice(1)) {
  return portableRelaunchArguments(argv).map((value) => value === "--updated" ? "--update-failed" : value);
}

function encodedArguments(values) {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64");
}

function portableHelperArguments(helperPath, update, logPath, relaunchArgs = portableRelaunchArguments()) {
  const argsBase64 = encodedArguments(relaunchArgs);
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", path.resolve(helperPath),
    "-StagedPath", path.resolve(update.stagedPath),
    "-TargetPath", path.resolve(update.targetPath),
    "-ExpectedSha256", String(update.sha256),
    "-ExpectedBytes", String(update.bytes),
    "-RelaunchArgsBase64", argsBase64,
    "-LogPath", path.resolve(logPath),
  ];
}

function setupHelperArguments(
  helperPath,
  installerPath,
  fallbackExecutablePath,
  logPath,
  installerArgs,
  verification,
  successArgs = portableRelaunchArguments(),
  failureArgs = failedUpdateRelaunchArguments(),
) {
  const expectedSha256 = String(verification?.sha256 || "").toLowerCase();
  const expectedBytes = Number(verification?.bytes);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error("Die Setup-Update-Verifikation ist ungültig.");
  }
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", path.resolve(helperPath),
    "-InstallerPath", path.resolve(installerPath),
    "-FallbackExecutablePath", path.resolve(fallbackExecutablePath),
    "-ExpectedSha256", expectedSha256,
    "-ExpectedBytes", String(expectedBytes),
    "-InstallerArgsBase64", encodedArguments(installerArgs || []),
    "-SuccessArgsBase64", encodedArguments(successArgs),
    "-FailureArgsBase64", encodedArguments(failureArgs),
    "-LogPath", path.resolve(logPath),
  ];
}

async function discardPortableStage(update) {
  if (update?.stagedPath) await fs.unlink(update.stagedPath).catch(() => undefined);
}

module.exports = {
  assertPortableTarget,
  discardPortableStage,
  failedUpdateRelaunchArguments,
  hashFile,
  portableHelperArguments,
  portableRelaunchArguments,
  sameWindowsPath,
  setupHelperArguments,
  stagePortableUpdate,
};
