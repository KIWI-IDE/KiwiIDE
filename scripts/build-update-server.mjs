import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(projectRoot, "resources", "update-server");
const sourceRoot = path.join(serverRoot, "src");
const classesRoot = path.join(serverRoot, "build", "classes");
const targetJar = path.join(serverRoot, "kiwi-update-server.jar");

function javaTool(name) {
  const javaHome = String(process.env.JAVA_HOME || "").trim();
  return javaHome ? path.join(javaHome, "bin", process.platform === "win32" ? `${name}.exe` : name) : name;
}

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

async function collectJavaSources(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectJavaSources(target));
    else if (entry.isFile() && entry.name.endsWith(".java")) result.push(target);
  }
  return result.sort();
}

const sources = await collectJavaSources(sourceRoot);
if (!sources.length) throw new Error("Keine Java-Quellen für den Update-Server gefunden.");
// Compiled into a directory of its own and moved into place at the end: two
// builds at once — which is exactly what two test files asking for the server
// do — used to delete each other's classes half way through.
const stagingRoot = path.join(serverRoot, "build", `classes-${process.pid}-${Date.now()}`);
const stagingJar = `${targetJar}.${process.pid}.tmp`;
await fs.mkdir(stagingRoot, { recursive: true });

try {
  await run(javaTool("javac"), ["--release", "21", "-encoding", "UTF-8", "-d", stagingRoot, ...sources]);
  await fs.rm(stagingJar, { force: true });
  await run(javaTool("jar"), [
    "--create",
    "--file", stagingJar,
    "--main-class", "dev.kiwi.update.KiwiUpdateServer",
    "-C", stagingRoot,
    ".",
  ]);
  await renameWithRetry(stagingJar, targetJar);
  await fs.rm(classesRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.rename(stagingRoot, classesRoot).catch(() => undefined);
} finally {
  await fs.rm(stagingJar, { force: true }).catch(() => undefined);
  await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
}

const stat = await fs.stat(targetJar);
console.log(`Java-Update-Server: ${path.relative(projectRoot, targetJar)} (${Math.round(stat.size / 1024)} KiB)`);

/**
 * Renames over a file Windows may still be holding.
 *
 * The jar is written and immediately renamed over the previous one. On Windows
 * something else often still has that file open for a moment — a virus scanner
 * reading what was just written is the usual one — and the rename fails with
 * EPERM. It was rare enough to look like a flaky test and frequent enough to
 * fail a build for no reason, roughly one run in four here.
 *
 * Waiting and trying again is the whole fix: whatever holds the file lets go.
 */
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
