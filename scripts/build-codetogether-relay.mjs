import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relayRoot = path.join(projectRoot, "resources", "codetogether-relay");
const sourceRoot = path.join(relayRoot, "src");
const classesRoot = path.join(relayRoot, "build", "classes");
const targetJar = path.join(relayRoot, "kiwi-codetogether-relay.jar");
const mainClass = "dev.kiwi.relay.KiwiRelayServer";
const reproducibleDate = "2000-01-01T00:00:00Z";

function javaTool(name) {
  const javaHome = String(process.env.JAVA_HOME || "").trim();
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  return javaHome ? path.join(javaHome, "bin", executable) : executable;
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error(
          `${path.basename(command)} wurde nicht gefunden. Installiere ein JDK 21 oder neuer `
          + "und setze JAVA_HOME beziehungsweise ergänze dessen bin-Ordner in PATH.",
        ));
      } else {
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} wurde mit ${signal || `Code ${code}`} beendet.`));
    });
  });
}

async function collectFiles(directory, predicate) {
  const result = [];
  const visit = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && predicate(entry.name)) result.push(target);
    }
  };
  await visit(directory);
  return result;
}

async function renameWithRetry(from, to, attempts = 12) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const retryable = error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES";
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
    }
  }
}

let sources;
try {
  sources = await collectFiles(sourceRoot, (name) => name.endsWith(".java"));
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error(`Die Relay-Quellen fehlen unter ${path.relative(projectRoot, sourceRoot)}.`);
  }
  throw error;
}
if (!sources.length) throw new Error("Keine Java-Quellen für das CodeToGetter-Relay gefunden.");

const stagingRoot = path.join(relayRoot, "build", `classes-${process.pid}-${Date.now()}`);
const stagingJar = `${targetJar}.${process.pid}.${Date.now()}.tmp`;
await fs.mkdir(stagingRoot, { recursive: true });

try {
  await run(javaTool("javac"), [
    "--release", "21",
    "-encoding", "UTF-8",
    "-g:none",
    "-d", stagingRoot,
    ...sources,
  ]);

  const classFiles = await collectFiles(stagingRoot, (name) => name.endsWith(".class"));
  if (!classFiles.length) throw new Error("Der Java-Compiler hat keine Relay-Klassen erzeugt.");

  const jarArgs = [
    "--create",
    "--file", stagingJar,
    "--main-class", mainClass,
    `--date=${reproducibleDate}`,
  ];
  for (const classFile of classFiles) {
    jarArgs.push("-C", stagingRoot, path.relative(stagingRoot, classFile).split(path.sep).join("/"));
  }
  await run(javaTool("jar"), jarArgs);
  await renameWithRetry(stagingJar, targetJar);

  await fs.rm(classesRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.rename(stagingRoot, classesRoot).catch(() => undefined);
} finally {
  await fs.rm(stagingJar, { force: true }).catch(() => undefined);
  await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
}

const stat = await fs.stat(targetJar);
console.log(`CodeToGetter-Relay: ${path.relative(projectRoot, targetJar)} (${Math.max(1, Math.round(stat.size / 1024))} KiB)`);
console.log(`Start: java -jar ${path.relative(projectRoot, targetJar)} --port 8787`);
