import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sha256File } from "./update-core.mjs";

/**
 * Packs the built renderer into the artifact that updates Kiwi without a
 * restart.
 *
 * The bundle is stamped with the fingerprint of the main process it belongs
 * to, computed by the very module the application uses at runtime — the two
 * sides can therefore never disagree about whether an installer is required.
 */
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createRendererBundle, mainProcessHash } = require(path.join(projectRoot, "electron", "services", "renderer-update-service.cjs"));

const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const electronPkg = JSON.parse(await fs.readFile(path.join(projectRoot, "node_modules", "electron", "package.json"), "utf8"));
const distRoot = path.join(projectRoot, "dist");
const releaseRoot = path.join(projectRoot, "release");

if (!await fs.stat(path.join(distRoot, "index.html")).then(() => true).catch(() => false)) {
  throw new Error("dist/index.html fehlt; zuerst `npm run build:compile` ausführen.");
}

const mainHash = mainProcessHash(projectRoot, {
  electronVersion: electronPkg.version,
  dependencies: pkg.dependencies,
});
const bundle = await createRendererBundle(distRoot, { version: pkg.version, mainHash });
const target = path.join(releaseRoot, `Kiwi-IDE-${pkg.version}-renderer.kiwi`);
await fs.mkdir(releaseRoot, { recursive: true });
await fs.writeFile(target, bundle);
const digest = await sha256File(target);

console.log(`Renderer-Bundle: release/${path.basename(target)}`);
console.log(`  Größe        : ${(digest.bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  SHA-256      : ${digest.sha256}`);
console.log(`  Hauptprozess : ${mainHash}`);
