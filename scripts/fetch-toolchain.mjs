import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import extractZip from "extract-zip";
import * as tar from "tar";

const root = process.cwd();
const toolchainRoot = path.join(root, "resources", "toolchain");
const downloadRoot = path.join(toolchainRoot, ".downloads");
const manifestPath = path.join(toolchainRoot, "toolchain-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

async function exists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function checksumFromSidecar(tool) {
  const response = await fetch(tool.checksumUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Checksum download failed (${response.status}): ${tool.checksumUrl}`);
  const text = await response.text();
  const length = tool.checksumAlgorithm === "sha512" ? 128 : 64;
  const match = text.match(new RegExp(`[a-fA-F0-9]{${length}}`));
  if (!match) throw new Error(`No ${tool.checksumAlgorithm} checksum found for ${tool.id}.`);
  return match[0].toLowerCase();
}

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

async function extract(tool, archive) {
  const destination = path.join(toolchainRoot, tool.id);
  const staging = path.join(downloadRoot, `${tool.id}-extract`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });

  if (tool.archive.endsWith(".zip")) {
    await extractZip(archive, { dir: staging });
  } else {
    await tar.x({ file: archive, cwd: staging });
  }

  const entries = await fs.readdir(staging, { withFileTypes: true });
  const singleDirectory = entries.length === 1 && entries[0].isDirectory()
    ? path.join(staging, entries[0].name)
    : staging;
  await fs.rm(destination, { recursive: true, force: true });
  if (singleDirectory === staging) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of entries) {
      await fs.rename(path.join(staging, entry.name), path.join(destination, entry.name));
    }
  } else {
    await fs.rename(singleDirectory, destination);
  }
}

async function ensureLicense(tool) {
  if (!tool.licenseUrl) return;
  const license = path.join(toolchainRoot, tool.id, tool.licenseFile || "LICENSE");
  if (!(await exists(license))) await download(tool.licenseUrl, license);
}

async function ensureBuildToolExecutable(tool) {
  if (process.platform === "win32" || !["maven", "gradle"].includes(tool.id)) return;
  const script = path.join(toolchainRoot, tool.id, "bin", tool.id === "maven" ? "mvn" : "gradle");
  const { mode } = await fs.stat(script);
  await fs.chmod(script, mode | 0o111);
}

await fs.mkdir(downloadRoot, { recursive: true });
for (const tool of manifest.tools) {
  const readyMarker = path.join(toolchainRoot, tool.id, ".kiwi-tool-version");
  if (await exists(readyMarker) && (await fs.readFile(readyMarker, "utf8")).trim() === tool.version) {
    await ensureLicense(tool);
    await ensureBuildToolExecutable(tool);
    console.log(`${tool.id} ${tool.version} already available.`);
    continue;
  }

  const archive = path.join(downloadRoot, tool.archive);
  if (!(await exists(archive))) {
    console.log(`Downloading ${tool.id} ${tool.version}…`);
    await download(tool.url, archive);
  }
  const expected = (tool.checksum || await checksumFromSidecar(tool)).toLowerCase();
  const actual = await hashFile(archive, tool.checksumAlgorithm);
  if (actual !== expected) {
    await fs.rm(archive, { force: true });
    throw new Error(`Checksum mismatch for ${tool.id}: expected ${expected}, received ${actual}`);
  }
  console.log(`Verified ${tool.id}: ${actual}`);
  await extract(tool, archive);
  await ensureLicense(tool);
  await ensureBuildToolExecutable(tool);
  await fs.writeFile(readyMarker, `${tool.version}\n`, "utf8");
}

console.log("Bundled toolchain is ready.");
