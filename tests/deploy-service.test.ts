/**
 * Deploying, without a server.
 *
 * `scp` and `ssh` are spawned through an injected function, so the arguments
 * Kiwi actually hands them can be read here — which is the part that matters,
 * because a wrong flag reaches a real machine.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { DeployService, describeProblem, destination, normaliseTarget } =
  require("../electron/services/deploy-service.cjs");

/** A child process that can be made to succeed, fail, or say something. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { setEncoding?: () => void };
  stderr = new EventEmitter() as EventEmitter & { setEncoding?: () => void };
  killed = false;

  kill() {
    this.killed = true;
  }
}

/** The guard only has to agree that the path is in the project. */
function guardFor(root: string) {
  return {
    assertWorkspace: (value: string) => value,
    assertAllowed: (candidate: string) => {
      if (!path.resolve(candidate).startsWith(path.resolve(root))) throw new Error("ausserhalb");
      return candidate;
    },
  };
}

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-deploy-"));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A service whose spawns are recorded and answered by the test. */
function harness(target: Record<string, unknown>, outcomes: Array<number | { code: number | null; signal: string }> = [0, 0]) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const children: FakeChild[] = [];
  let index = 0;

  const service = new DeployService(guardFor(root), {
    spawnImpl: (command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new FakeChild();
      children.push(child);
      const code = outcomes[index] ?? 0;
      index += 1;
      // Next tick, so the caller has attached its listeners first.
      setTimeout(() => typeof code === "number"
        ? child.emit("close", code)
        : child.emit("close", code.code, code.signal), 0);
      return child;
    },
  });

  fs.mkdirSync(path.join(root, ".kiwi"), { recursive: true });
  fs.writeFileSync(path.join(root, ".kiwi", "deploy.json"), JSON.stringify(target));
  return { service, calls, children };
}

describe("a deployment target", () => {
  it("fills in the port nobody wants to type", () => {
    expect(normaliseTarget({ host: "cloud.example" }).port).toBe(22);
    expect(normaliseTarget({ port: "2222" }).port).toBe(2222);
    expect(normaliseTarget({ port: "nonsense" }).port).toBe(22);
    expect(normaliseTarget({ port: 70_000 }).port).toBe(22);
  });

  it("says what is missing before anything is started", () => {
    /**
     * Found out before the upload, not during it: a missing host after two
     * minutes of waiting is the worst moment to learn about it.
     */
    expect(describeProblem(normaliseTarget({}))).toContain("kein Server");
    expect(describeProblem(normaliseTarget({ host: "a.example" }))).toContain("keine Datei");
    expect(describeProblem(normaliseTarget({ host: "a", artifact: "x.jar" }))).toContain("Zielverzeichnis");
  });

  it("insists the remote directory is absolute", () => {
    // A relative one lands wherever the login starts, which is rarely where
    // the service reads from — and it looks like it worked.
    const relative = normaliseTarget({ host: "a", artifact: "x.jar", remoteDirectory: "opt/honeymc" });
    expect(describeProblem(relative)).toContain("absoluter Pfad");
    const absolute = normaliseTarget({ host: "a", artifact: "x.jar", remoteDirectory: "/opt/honeymc" });
    expect(describeProblem(absolute)).toBe("");
    expect(describeProblem(normaliseTarget({ ...absolute, remoteDirectory: "~/honeymc" }))).toBe("");
  });

  it("refuses a restart command smuggled across two lines", () => {
    const target = normaliseTarget({
      host: "a", artifact: "x.jar", remoteDirectory: "/opt",
      restartCommand: "systemctl restart honeymc\nrm -rf /",
    });
    expect(describeProblem(target)).toContain("eine Zeile");
  });

  it("leaves the login name out when there is none", () => {
    expect(destination({ host: "cloud.example", user: "" })).toBe("cloud.example");
    expect(destination({ host: "cloud.example", user: "robin" })).toBe("robin@cloud.example");
  });
});

describe("finding the jar", () => {
  it("takes the newest match for a wildcard", async () => {
    /**
     * `build/libs/*-all.jar` is what a shadowJar build produces and the
     * version in the middle changes every release, so the name cannot be
     * written down once.
     */
    const libs = path.join(root, "build", "libs");
    fs.mkdirSync(libs, { recursive: true });
    fs.writeFileSync(path.join(libs, "cloud-1.0-all.jar"), "alt");
    fs.writeFileSync(path.join(libs, "cloud-1.1-all.jar"), "neu");
    fs.utimesSync(path.join(libs, "cloud-1.0-all.jar"), new Date(2020, 0, 1), new Date(2020, 0, 1));

    const { service } = harness({});
    const found = await service.resolveArtifact(root, "build/libs/*-all.jar");
    expect(path.basename(found)).toBe("cloud-1.1-all.jar");
  });

  it("will not be walked out of the project", async () => {
    const { service } = harness({});
    expect(await service.resolveArtifact(root, "../../../Windows/System32/cmd.exe")).toBe("");
  });

  it("answers with nothing rather than guessing when it is not built", async () => {
    const { service } = harness({});
    expect(await service.resolveArtifact(root, "build/libs/cloud.jar")).toBe("");
  });
});

describe("deploying", () => {
  const target = {
    host: "cloud.example",
    user: "robin",
    port: 2222,
    artifact: "build/libs/cloud.jar",
    remoteDirectory: "/opt/honeymc",
    restartCommand: "systemctl --user restart honeymc",
  };

  function withJar() {
    const libs = path.join(root, "build", "libs");
    fs.mkdirSync(libs, { recursive: true });
    fs.writeFileSync(path.join(libs, "cloud.jar"), "inhalt");
  }

  it("copies, then restarts, with the flags each tool actually takes", async () => {
    withJar();
    const rig = harness(target);
    const result = await rig.service.deploy(root, () => {});

    expect(result.ok).toBe(true);
    expect(rig.calls).toHaveLength(2);

    const [copy, restart] = rig.calls;
    expect(copy.command).toBe("scp");
    // scp spells the port with a capital P, ssh with a small one. Swapping
    // them produces a complaint about an unknown option, not about a port.
    expect(copy.args).toContain("-P");
    expect(copy.args).toContain("2222");
    expect(copy.args[copy.args.length - 1]).toBe("robin@cloud.example:/opt/honeymc/");

    expect(restart.command).toBe("ssh");
    expect(restart.args).toContain("-p");
    expect(restart.args[restart.args.length - 1]).toBe("systemctl --user restart honeymc");
  });

  it.each([
    ["/opt/honeymc", "/opt/honeymc/"],
    ["/opt/honeymc/", "/opt/honeymc/"],
    ["/opt/honeymc//", "/opt/honeymc/"],
    ["/", "/"],
    ["~/honeymc", "~/honeymc/"],
    ["~/honeymc/", "~/honeymc/"],
    ["~", "~/"],
    ["~/", "~/"],
  ])("keeps %s a directory without duplicating its trailing slash", async (remoteDirectory, expected) => {
    withJar();
    const rig = harness({ ...target, remoteDirectory, restartCommand: "" });
    expect((await rig.service.deploy(root, () => {})).ok).toBe(true);
    expect(rig.calls[0].args.at(-1)).toBe(`robin@cloud.example:${expected}`);
  });

  it("never lets ssh ask for a password", async () => {
    /**
     * A prompt from ssh would appear on a console nobody can see and the
     * deployment would simply hang. Failing at once with "no key" is an
     * answer somebody can act on.
     */
    withJar();
    const rig = harness(target);
    await rig.service.deploy(root, () => {});
    for (const call of rig.calls) {
      expect(call.args).toContain("BatchMode=yes");
      // And host key checking stays at the person's own setting: turning it
      // off is what makes every deployment after the first unauthenticated.
      expect(call.args.join(" ")).not.toContain("StrictHostKeyChecking=no");
    }
  });

  it("says plainly when the file is up there but the restart failed", async () => {
    // The state on the server is now "new jar, old process", which is the one
    // outcome somebody has to be told about rather than left to assume.
    withJar();
    const rig = harness(target, [0, 1]);
    const result = await rig.service.deploy(root, () => {});
    expect(result.ok).toBe(false);
    expect(result.uploaded).toBe(true);
    expect(result.problem).toContain("Neustart");
  });

  it("does not try to restart when nothing was uploaded", async () => {
    withJar();
    const rig = harness(target, [1]);
    const result = await rig.service.deploy(root, () => {});
    expect(result.ok).toBe(false);
    expect(rig.calls).toHaveLength(1);
  });

  it("never restarts after the upload is interrupted by a signal", async () => {
    withJar();
    const rig = harness(target, [{ code: null, signal: "SIGTERM" }]);
    const result = await rig.service.deploy(root, () => {});
    expect(result.ok).toBe(false);
    expect(result.problem).toContain("Hochladen");
    expect(rig.calls.map((call) => call.command)).toEqual(["scp"]);
  });

  it("fails a timed out step even if it exits with zero while being killed", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    child.kill = () => {
      child.killed = true;
      child.emit("close", 0);
    };
    const service = new DeployService(guardFor(root), { spawnImpl: () => child });
    const lines: string[] = [];
    const step = service.run("scp", [], (line: string) => lines.push(line));

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(await step).toMatchObject({ failed: true });
    expect(child.killed).toBe(true);
    expect(lines.join(" ")).toContain("zu lange");
  });

  it("stops at the check when there is nothing built to send", async () => {
    const lines: string[] = [];
    const rig = harness(target);
    const result = await rig.service.deploy(root, (line: string) => lines.push(line));
    expect(result.ok).toBe(false);
    expect(rig.calls).toHaveLength(0);
    expect(lines.join(" ")).toContain("Erst bauen");
  });

  it("copies without restarting when no command was given", async () => {
    withJar();
    const rig = harness({ ...target, restartCommand: "" });
    const result = await rig.service.deploy(root, () => {});
    expect(result).toMatchObject({ ok: true, restarted: false });
    expect(rig.calls).toHaveLength(1);
  });

  it("reports what the tools say, including on stderr", async () => {
    /**
     * ssh writes everything conversational to stderr, the lines that say it
     * worked included. Treating that channel as failure would turn every
     * successful deployment into a red one.
     */
    withJar();
    const lines: string[] = [];
    const service = new DeployService(guardFor(root), {
      spawnImpl: () => {
        const child = new FakeChild();
        setTimeout(() => {
          child.stderr.emit("data", "Warning: Permanently added the host\n");
          child.stdout.emit("data", "cloud.jar   100%  1024KB\n");
          child.emit("close", 0);
        }, 0);
        return child;
      },
    });
    fs.mkdirSync(path.join(root, ".kiwi"), { recursive: true });
    fs.writeFileSync(path.join(root, ".kiwi", "deploy.json"), JSON.stringify({ ...target, restartCommand: "" }));

    const result = await service.deploy(root, (line: string) => lines.push(line));
    expect(result.ok).toBe(true);
    expect(lines.join(" ")).toContain("Permanently added");
    expect(lines.join(" ")).toContain("100%");
  });

  it("refuses a second deployment while one is running", async () => {
    withJar();
    const rig = harness(target);
    const first = rig.service.deploy(root, () => {});
    const second = await rig.service.deploy(root, () => {});
    expect(second.problem).toContain("bereits");
    await first;
  });

  it("keeps a saved target through a round trip", async () => {
    const { service } = harness({});
    const saved = await service.save(root, { ...target, port: "2222" });
    expect(saved.port).toBe(2222);
    expect(await service.load(root)).toEqual(saved);
  });
});
