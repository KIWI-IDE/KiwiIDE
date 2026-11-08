/**
 * Everything the update server needs on its own machine, in one folder.
 *
 * Setting it up used to mean building a JAR here, remembering which of a dozen
 * environment variables were mandatory, and typing them again on every start.
 * What comes out of this is a directory to copy across: the JAR, one installer
 * per platform and the note that says what to do with them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(projectRoot, "resources", "update-server");
const target = path.join(projectRoot, "release", "kiwi-update-server");

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} wurde mit ${signal || `Code ${code}`} beendet.`));
    });
  });
}

await run(process.execPath, [path.join(projectRoot, "scripts", "build-update-server.mjs")]);

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });

const files = ["kiwi-update-server.jar", "install.ps1", "install.sh"];
for (const name of files) {
  await fs.copyFile(path.join(serverRoot, name), path.join(target, name));
}

await fs.writeFile(path.join(target, "LIESMICH.txt"), [
  "Kiwi Update Server",
  "==================",
  "",
  "Voraussetzung: Java 21 oder neuer auf dem Zielrechner. Sonst nichts.",
  "",
  "Windows",
  "-------",
  "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir C:\KiwiUpdateServer",
  "  Autostart zusaetzlich:  -RegisterService",
  "",
  "Linux",
  "-----",
  "  sudo ./install.sh --install-dir /opt/kiwi-update-server --systemd",
  "",
  "Ohne Installer",
  "--------------",
  "  java -jar kiwi-update-server.jar --init     erzeugt kiwi-update-server.properties",
  "  java -jar kiwi-update-server.jar            startet den Server",
  "",
  "Der Installer erzeugt kiwi-update-server.properties mit einem frisch",
  "gewuerfelten Publishing-Token. Einzutragen bleiben die oeffentliche Adresse",
  "und das TLS-Zertifikat. Diese Datei enthaelt ein Geheimnis: sie gehoert",
  "weder in ein Repository noch in eine Sicherung ohne Verschluesselung.",
  "",
  "Der Server startet absichtlich nicht ohne HTTPS. Entweder TLS direkt",
  "konfigurieren oder KIWI_UPDATE_BEHIND_HTTPS_PROXY=1 setzen und einen",
  "Reverse-Proxy davorstellen, der HTTPS terminiert.",
  "",
].join("\n"), "utf8");

const sizes = await Promise.all(files.map(async (name) => {
  const stat = await fs.stat(path.join(target, name));
  return `${name} (${Math.max(1, Math.round(stat.size / 1024))} KiB)`;
}));
console.log(`Update-Server-Paket: ${path.relative(projectRoot, target)}`);
for (const line of sizes) console.log(`  ${line}`);
