import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relayRoot = path.join(projectRoot, "resources", "codetogether-relay");
const targetRoot = path.join(projectRoot, "release", "kiwi-codetogether-relay");
const jarName = "kiwi-codetogether-relay.jar";

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} wurde mit ${signal || `Code ${code}`} beendet.`));
    });
  });
}

await run(process.execPath, [path.join(projectRoot, "scripts", "build-codetogether-relay.mjs")]);

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(targetRoot, { recursive: true });
await fs.copyFile(path.join(relayRoot, jarName), path.join(targetRoot, jarName));
await fs.writeFile(path.join(targetRoot, "LIESMICH.txt"), [
  "Kiwi CodeToGetter Relay",
  "========================",
  "",
  "Voraussetzung: Java 21 oder neuer. Node.js und npm werden nicht gebraucht.",
  "",
  "Start:",
  `  java -jar ${jarName} --host 0.0.0.0 --port 8787`,
  "",
  "Der gewählte TCP-Port muss in der Server-Firewall freigegeben sein.",
  "In Kiwi wird anschließend server.example.org:8787 als Relay eingetragen.",
  "Das Relay speichert keine Projekte oder Sitzungen auf der Festplatte.",
  "",
].join("\n"), "utf8");

const stat = await fs.stat(path.join(targetRoot, jarName));
console.log(`Relay-Paket: ${path.relative(projectRoot, targetRoot)}`);
console.log(`  ${jarName} (${Math.max(1, Math.round(stat.size / 1024))} KiB)`);
console.log("  LIESMICH.txt");
