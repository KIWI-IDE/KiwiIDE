import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Setting the server up, rather than running it.
 *
 * Everything here goes through the real JAR: the point of this change is that
 * an operator can copy one folder onto a machine and start it, so a test that
 * mocked the configuration away would prove nothing about that.
 */
const projectRoot = path.resolve(import.meta.dirname, "..");
const serverJar = path.join(projectRoot, "resources", "update-server", "kiwi-update-server.jar");
const directories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];

function javaTool(name: string) {
  const javaHome = String(process.env.JAVA_HOME || "").trim();
  return javaHome ? path.join(javaHome, "bin", process.platform === "win32" ? `${name}.exe` : name) : name;
}

function cleanEnvironment(extra: Record<string, string> = {}) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => !name.startsWith("KIWI_UPDATE_") && value !== undefined),
  ) as Record<string, string>;
  return { ...environment, ...extra };
}

/** A directory holding its own copy of the JAR, the way a server has one. */
function installation() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-setup-"));
  directories.push(directory);
  fs.copyFileSync(serverJar, path.join(directory, "kiwi-update-server.jar"));
  return directory;
}

function runJar(directory: string, args: string[], environment: Record<string, string> = {}) {
  return execFileSync(javaTool("java"), ["-jar", "kiwi-update-server.jar", ...args], {
    cwd: directory,
    env: cleanEnvironment(environment),
    encoding: "utf8",
    stdio: "pipe",
  });
}

function configOf(directory: string) {
  return fs.readFileSync(path.join(directory, "kiwi-update-server.properties"), "utf8");
}

/** Starts the server and resolves once it has printed the port it listens on. */
async function start(directory: string, environment: Record<string, string> = {}) {
  const child = spawn(javaTool("java"), ["-jar", "kiwi-update-server.jar"], {
    cwd: directory,
    env: cleanEnvironment(environment),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  processes.push(child);
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server wurde nicht bereit: ${output}\n${errors}`)), 20_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/KIWI_UPDATE_READY=(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server endete mit Code ${code}: ${errors}`));
    });
  });
  return { port, output };
}

/** Turns the starter configuration into one that can bind a throwaway port. */
function makeLocal(directory: string) {
  const file = path.join(directory, "kiwi-update-server.properties");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8")
    .replace("https://updates.example.org", "http://127.0.0.1")
    .replace("KIWI_UPDATE_HOST=0.0.0.0", "KIWI_UPDATE_HOST=127.0.0.1")
    .replace("KIWI_UPDATE_PORT=443", "KIWI_UPDATE_PORT=0\nKIWI_UPDATE_ALLOW_HTTP=1"), "utf8");
}

beforeAll(() => {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-update-server.mjs")], {
    cwd: projectRoot,
    stdio: "pipe",
  });
}, 180_000);

afterEach(async () => {
  await Promise.all(processes.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timeout = setTimeout(resolve, 3_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill();
  })));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("setting the update server up", () => {
  it("writes a configuration with a token nobody had to invent", () => {
    const directory = installation();
    runJar(directory, ["--init"]);
    const token = configOf(directory).match(/^KIWI_UPDATE_PUBLISH_TOKEN=(.+)$/m)?.[1] || "";
    // The server refuses anything shorter, and a token an operator types by
    // hand is the one that ends up being the project name and a year.
    expect(Buffer.byteLength(token, "utf8")).toBeGreaterThanOrEqual(32);
    expect(configOf(directory)).toContain("KIWI_UPDATE_PUBLIC_BASE_URL=");
  }, 60_000);

  it("gives every installation its own token", () => {
    const tokenOf = (directory: string) => {
      runJar(directory, ["--init"]);
      return configOf(directory).match(/^KIWI_UPDATE_PUBLISH_TOKEN=(.+)$/m)?.[1];
    };
    expect(tokenOf(installation())).not.toBe(tokenOf(installation()));
  }, 60_000);

  it("refuses to overwrite a configuration that already exists", () => {
    // The file holds the publishing token. Re-running the installer after an
    // update must not be the thing that invalidates it.
    const directory = installation();
    runJar(directory, ["--init"]);
    const before = configOf(directory);
    expect(() => runJar(directory, ["--init"])).toThrow();
    expect(configOf(directory)).toBe(before);
    runJar(directory, ["--init", "--force"]);
    expect(configOf(directory)).not.toBe(before);
  }, 90_000);

  it("writes an absolute storage path, so a service keeps its files", () => {
    // A relative path follows whichever directory the service was started
    // from, and the published releases quietly move with it.
    const directory = installation();
    runJar(directory, ["--init"]);
    const storage = (configOf(directory).match(/^KIWI_UPDATE_STORAGE_DIR=(.+)$/m)?.[1] || "").replace(/\\\\/g, "\\");
    expect(path.isAbsolute(storage)).toBe(true);
    expect(path.dirname(storage)).toBe(fs.realpathSync(directory));
  }, 60_000);

  it("starts from the file alone, with nothing in the environment", async () => {
    // This is the whole promise: copy the folder, edit one file, start. Not a
    // block of environment variables retyped on every start.
    const directory = installation();
    runJar(directory, ["--init"]);
    makeLocal(directory);
    await expect(start(directory)).resolves.toMatchObject({ port: expect.any(Number) });
  }, 60_000);

  it("does not let an empty variable blank out a value from the file", async () => {
    const directory = installation();
    runJar(directory, ["--init"]);
    makeLocal(directory);
    const { output } = await start(directory, { KIWI_UPDATE_PUBLISH_TOKEN: "" });
    expect(output).toContain("Publishing-API: aktiv");
  }, 60_000);

  it("lets the environment win over the file where it says something", async () => {
    const directory = installation();
    runJar(directory, ["--init"]);
    makeLocal(directory);
    const elsewhere = path.join(directory, "woanders");
    const { output } = await start(directory, { KIWI_UPDATE_STORAGE_DIR: elsewhere });
    expect(output).toContain(elsewhere);
  }, 60_000);

  it("says which storage the running server actually uses", async () => {
    const directory = installation();
    runJar(directory, ["--init"]);
    makeLocal(directory);
    const { output } = await start(directory);
    expect(output).toContain("Speicherort:");
    expect(output).toContain("update-storage");
  }, 60_000);

  it("still refuses to run without HTTPS once it is configured from a file", async () => {
    // The configuration file must not become the way around the rule that a
    // production server terminates TLS.
    const directory = installation();
    fs.writeFileSync(path.join(directory, "kiwi-update-server.properties"), [
      "KIWI_UPDATE_PUBLIC_BASE_URL=https://updates.example.org",
      "KIWI_UPDATE_HOST=0.0.0.0",
      "KIWI_UPDATE_PORT=0",
    ].join("\n"), "utf8");
    await expect(start(directory)).rejects.toThrow(/HTTPS/i);
  }, 60_000);

  it("explains itself when asked", () => {
    const help = runJar(installation(), ["--help"]);
    expect(help).toContain("--init");
    expect(help).toContain("kiwi-update-server.properties");
  }, 60_000);
});
