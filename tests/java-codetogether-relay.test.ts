import { spawn, spawnSync, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const { CollabGuest, CollabHost } = require("../electron/services/collab-session.cjs");
const { createInviteCode } = require("../electron/services/collab-service.cjs");

const projectRoot = path.resolve(import.meta.dirname, "..");
const buildScript = path.join(projectRoot, "scripts", "build-codetogether-relay.mjs");
const relayJar = path.join(projectRoot, "resources", "codetogether-relay", "kiwi-codetogether-relay.jar");
const children: ChildProcess[] = [];
const hosts: Array<{ stop: () => Promise<unknown>; state: () => { hosting: boolean } }> = [];
const guests: Array<{ disconnect: () => void }> = [];
const temporaryDirectories: string[] = [];

function javaTool() {
  const javaHome = String(process.env.JAVA_HOME || "").trim();
  return javaHome
    ? path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";
}

async function waitUntil(predicate: () => boolean, message: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

async function startJavaRelay() {
  const child = spawn(javaTool(), [
    "-jar", relayJar,
    "--host", "127.0.0.1",
    "--port", "0",
    "--quiet",
  ], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  let output = "";
  let errors = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { errors += String(chunk); });

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Java-Relay wurde nicht bereit.\nstdout: ${output}\nstderr: ${errors}`));
    }, 15_000);
    const inspect = () => {
      const match = output.match(/Kiwi CodeToGetter-Relay lauscht auf .*:(\d+)\./);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    };
    child.stdout?.on("data", inspect);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Java-Relay endete vor dem Start (${signal || `Code ${code}`}).\n${errors}`));
    });
  });
  return { child, port };
}

beforeAll(() => {
  execFileSync(process.execPath, [buildScript], {
    cwd: projectRoot,
    stdio: "pipe",
  });
});

afterEach(async () => {
  for (const guest of guests.splice(0)) guest.disconnect();
  await Promise.allSettled(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(children.splice(0).map((child) => stopChild(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe("the executable Java CodeToGetter relay", () => {
  it("starts as a jar and carries a real encrypted host/guest editing session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-java-relay-project-"));
    temporaryDirectories.push(root);
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "Main.java"), "class Main {}", "utf8");

    const { port } = await startJavaRelay();
    const host = new CollabHost({
      root,
      projectName: "java-relay-test",
      defaultRole: "bearbeiten",
      hostOnly: true,
    });
    hosts.push(host);
    const session = await host.startViaRelay("127.0.0.1", port);
    expect(session).toMatchObject({
      project: "java-relay-test",
      relay: { host: "127.0.0.1", port },
    });
    expect(session.invite).toContain("relay=1");

    const guest = new CollabGuest({ name: "Java-Relay-Gast", requestTimeoutMs: 5_000 });
    guests.push(guest);
    await expect(guest.connect(session.invite)).resolves.toMatchObject({
      project: "java-relay-test",
      role: "bearbeiten",
      hostOnly: true,
    });

    const opened = await guest.request("open", { path: "src/Main.java" });
    expect(opened).toMatchObject({ text: "class Main {}", version: expect.any(Number) });
    await guest.request("edit", {
      path: "src/Main.java",
      edit: {
        start: opened.text.length,
        end: opened.text.length,
        text: " // über das Java-Relay",
      },
      baseVersion: opened.version,
    });
    await guest.request("save", { path: "src/Main.java" });
    await expect(fs.readFile(path.join(root, "src", "Main.java"), "utf8"))
      .resolves.toBe("class Main {} // über das Java-Relay");
  }, 25_000);

  it("returns the production no-host error instead of leaving a guest hanging", async () => {
    const { port } = await startJavaRelay();
    const guest = new CollabGuest({ name: "Zu früh", requestTimeoutMs: 2_000 });
    guests.push(guest);
    const invite = createInviteCode({
      host: "127.0.0.1",
      port,
      token: "a".repeat(64),
      project: "nicht-gehostet",
      relay: true,
    });

    await expect(guest.connect(invite)).rejects.toThrow(/kein Gastgeber/i);
  });

  it("rejects invalid command-line ports with a failing exit code", () => {
    const result = spawnSync(javaTool(), ["-jar", relayJar, "--port", "70000"], {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    // CLI usage errors deliberately use a distinct non-zero code. The exact
    // value is not part of the relay protocol and may differ from the old
    // Node launcher, but an invalid listener must never look successful.
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Port|gültig/i);
  });

  it("releases its listener and disconnects a host when the jar stops", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-java-relay-stop-"));
    temporaryDirectories.push(root);
    const { child, port } = await startJavaRelay();
    const host = new CollabHost({ root, projectName: "shutdown" });
    hosts.push(host);
    await host.startViaRelay("127.0.0.1", port);
    expect(host.state().hosting).toBe(true);

    await stopChild(child);
    await waitUntil(() => !host.state().hosting, "Der Host blieb nach dem Relay-Shutdown aktiv.");
    await expect(new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
    })).rejects.toBeTruthy();
  });
});
