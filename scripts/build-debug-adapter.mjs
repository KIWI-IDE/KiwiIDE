import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "resources", "debug-adapter", "src");
const outputRoot = path.join(root, "resources", "debug-adapter", ".classes");
const outputJar = path.join(root, "resources", "debug-adapter", "kiwi-debug-adapter.jar");
const source = path.join(sourceRoot, "dev", "kiwi", "debug", "KiwiDebugAdapter.java");
const javaHome = process.env.JAVA_HOME || "";
const javac = javaHome
  ? path.join(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac")
  : process.platform === "win32" ? "javac.exe" : "javac";
const jar = javaHome
  ? path.join(javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar")
  : process.platform === "win32" ? "jar.exe" : "jar";

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

// -sourcepath so the classes the adapter is built from are compiled with it.
// Naming only the entry point was enough while it was the only file.
run(javac, ["--release", "21", "--add-modules", "jdk.jdi", "-encoding", "UTF-8", "-sourcepath", sourceRoot, "-d", outputRoot, source]);
run(jar, ["--create", "--file", outputJar, "--main-class", "dev.kiwi.debug.KiwiDebugAdapter", "-C", outputRoot, "."]);
console.log(`Built JDI debug adapter: ${path.relative(root, outputJar)}`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    const cause = result.error ? ` (${result.error.code || result.error.message}: ${result.error.message})` : "";
    throw new Error(`${path.basename(command)} failed with exit code ${result.status ?? "unknown"}${cause}.`);
  }
}
