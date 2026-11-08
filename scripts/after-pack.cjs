const { execFile } = require("node:child_process");
const { chmodSync, existsSync } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const rcedit = require("rcedit");
const { signArtifactIfConfigured } = require("./sign-windows-artifacts.cjs");

async function afterPack(context, dependencies = {}) {
  if (context.electronPlatformName === "darwin" && process.platform === "darwin") {
    const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    const ptyRoot = path.join(bundle, "Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty");
    // node-pty 1.1.0 ships its macOS helpers without executable permissions.
    const helpers = ["build/Release", "build/Debug", "prebuilds/darwin-x64", "prebuilds/darwin-arm64"]
      .map((directory) => path.join(ptyRoot, directory, "spawn-helper"))
      .filter((helper) => existsSync(helper));
    if (helpers.length === 0) throw new Error("The packaged macOS terminal spawn-helper is missing.");
    for (const helper of helpers) chmodSync(helper, 0o755);

    if (!process.env.CSC_LINK && !process.env.CSC_NAME && !context.packager.platformSpecificBuildOptions.identity) {
      // Apple Silicon requires a code signature even for local and CI builds.
      await promisify(execFile)("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
    }
    return;
  }
  if (context.electronPlatformName !== "win32") return;
  const editExecutable = dependencies.rcedit || rcedit;
  const signExecutable = dependencies.signArtifactIfConfigured || signArtifactIfConfigured;
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, "assets", "icons", "kiwi.ico");
  await editExecutable(executable, {
    icon,
    "version-string": {
      ProductName: "Kiwi IDE",
      FileDescription: "Kiwi IDE – Java development, with less noise.",
      CompanyName: "Kiwi IDE",
      LegalCopyright: "Copyright © 2026 Kiwi IDE",
    },
    "file-version": context.packager.appInfo.version,
    "product-version": context.packager.appInfo.version,
  });
  // NSIS and the portable target package appOutDir immediately after this
  // hook, so the inner application must be signed here, after rcedit.
  await signExecutable(executable);
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
