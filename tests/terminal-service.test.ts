import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const { TerminalService } = require("../electron/services/terminal-service.cjs");

const temporaryDirectories: string[] = [];
const terminalServices: Array<{ stop(root?: string, sessionId?: string): boolean; drain?(ms?: number): Promise<boolean> }> = [];

async function waitFor(check: () => boolean, timeoutMs = 8_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("Terminalausgabe wurde nicht rechtzeitig empfangen.");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

afterEach(async () => {
  for (const service of terminalServices.splice(0)) service.stop();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    // PowerShell may still hold its cwd for a few milliseconds after `exit`.
    fs.rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 })));
});

describe("TerminalService shared sessions", () => {
  it("buffers output per project/session and keeps snapshots isolated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-service-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);
    const events: Array<{ channel: string; payload: any }> = [];
    const service = new TerminalService(guard, (channel: string, payload: any) => events.push({ channel, payload }));
    terminalServices.push(service);
    const markerOne = `KIWI_SESSION_ONE_${Date.now()}`;
    const markerTwo = `KIWI_SESSION_TWO_${Date.now()}`;

    service.start(root, "1");
    service.start(root, "2");
    service.execute(root, process.platform === "win32" ? `Write-Output '${markerOne}'` : `printf '${markerOne}\\n'`, "1");
    service.execute(root, process.platform === "win32" ? `Write-Output '${markerTwo}'` : `printf '${markerTwo}\\n'`, "2");

    await waitFor(() => service.snapshot(root, "1").output.includes(markerOne)
      && service.snapshot(root, "2").output.includes(markerTwo));
    const first = service.snapshot(root, "1");
    const second = service.snapshot(root, "2");
    expect(first.running).toBe(true);
    expect(second.running).toBe(true);
    expect(first.output).toContain(markerOne);
    expect(first.output).not.toContain(markerTwo);
    expect(second.output).toContain(markerTwo);
    expect(second.output).not.toContain(markerOne);
    expect(events.some((event) => event.channel === "terminal:output"
      && event.payload.sessionId === "1" && event.payload.stream === "pty")).toBe(true);

    service.stop(root);
  }, 15_000);

  it("returns an existing session from start without replacing its buffer", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-rejoin-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);
    const service = new TerminalService(guard, () => undefined);
    terminalServices.push(service);
    service.start(root, "reused");
    service.execute(root, "echo buffered", "reused");
    const before = service.snapshot(root, "reused");

    const joined = service.start(root, "reused");
    const after = service.snapshot(root, "reused");
    expect(joined.sessionId).toBe("reused");
    expect(after.output).toBe(before.output);
    expect(after.running).toBe(true);

    service.stop(root);
  });

  it("passes raw keys and dimensions to the PTY without line-runner rewriting", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-pty-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);
    const writes: string[] = [];
    const resizes: Array<[number, number]> = [];
    let dataListener = (_data: string) => undefined;
    let exitListener = (_event: { exitCode: number }) => undefined;
    const terminalProcess = {
      pid: 42,
      write: (data: string) => writes.push(data),
      resize: (columns: number, rows: number) => resizes.push([columns, rows]),
      kill: () => exitListener({ exitCode: 0 }),
      onData: (listener: typeof dataListener) => {
        dataListener = listener;
        return { dispose: () => undefined };
      },
      onExit: (listener: typeof exitListener) => {
        exitListener = listener;
        return { dispose: () => undefined };
      },
    };
    const starts: any[] = [];
    const service = new TerminalService(guard, () => undefined, {
      spawn: (shell: string, args: string[], options: unknown) => {
        starts.push({ shell, args, options });
        return terminalProcess;
      },
    });
    terminalServices.push(service);

    service.start(root, "raw", { columns: 120, rows: 36 });
    service.input(root, "\u0003", "raw");
    service.execute(root, "echo Kiwi", "raw");
    service.resize(root, 132, 44, "raw");
    dataListener(`\u001b[32mKiwi\u001b[0m\r\nPS ${root}> `);

    expect(starts).toHaveLength(1);
    expect(starts[0].options).toMatchObject({ name: "xterm-256color", cols: 120, rows: 36, cwd: root });
    expect(writes).toEqual(["\u0003", "echo Kiwi\r"]);
    expect(resizes).toEqual([[132, 44]]);
    expect(service.snapshot(root, "raw")).toMatchObject({
      cwd: root,
      columns: 132,
      rows: 44,
      output: expect.stringContaining("\u001b[32mKiwi"),
    });
    // Workspace teardown may clear the path guard immediately before React's
    // terminal cleanup runs. Cleanup operations stay idempotent in that race.
    guard.unregister(root);
    expect(service.resize(root, 140, 48, "raw")).toBe(true);
    expect(service.stop(root, "raw")).toBe(true);
    expect(service.list(root)).toEqual([]);
    expect(service.snapshot(root, "raw")).toMatchObject({
      projectRoot: root,
      sessionId: "raw",
      running: false,
      output: "",
    });
  });

  it("keeps scrollback after a natural exit until the tab is explicitly closed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-exit-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);
    const exits: Array<(event: { exitCode: number }) => void> = [];
    const dataListeners: Array<(data: string) => void> = [];
    let starts = 0;
    const service = new TerminalService(guard, () => undefined, {
      spawn: () => {
        starts += 1;
        return {
          pid: 100 + starts,
          write: () => undefined,
          resize: () => undefined,
          kill: () => exits.at(-1)?.({ exitCode: 0 }),
          onData: (listener: (data: string) => void) => {
            dataListeners.push(listener);
            return { dispose: () => undefined };
          },
          onExit: (listener: (event: { exitCode: number }) => void) => {
            exits.push(listener);
            return { dispose: () => undefined };
          },
        };
      },
    });
    terminalServices.push(service);

    service.start(root, "history");
    dataListeners[0]("first command\r\n");
    exits[0]({ exitCode: 7 });

    expect(service.list(root)).toEqual(["history"]);
    expect(service.snapshot(root, "history")).toMatchObject({
      running: false,
      output: "first command\r\n",
    });

    service.start(root, "history");
    expect(starts).toBe(2);
    expect(service.snapshot(root, "history")).toMatchObject({
      running: true,
      output: "first command\r\n",
    });
    expect(service.stop(root, "history")).toBe(true);
    expect(service.list(root)).toEqual([]);
  });

  it("does not leave a terminal tab behind when ConPTY creation fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-failed-start-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);
    const service = new TerminalService(guard, () => undefined, {
      spawn: () => { throw new Error("ConPTY unavailable"); },
    });
    terminalServices.push(service);

    expect(() => service.start(root, "broken")).toThrow(/ConPTY unavailable/);
    expect(service.list(root)).toEqual([]);
  });
});

describe("TerminalService process identity", () => {
  function countingFactory() {
    const spawned: Array<{ pid: number; killed: boolean; cols: number; rows: number; written: string[] }> = [];
    return {
      spawned,
      spawn: (_shell: string, _args: string[], options: any) => {
        const terminal = {
          pid: 900 + spawned.length,
          killed: false,
          cols: options.cols,
          rows: options.rows,
          written: [] as string[],
          write: (data: string) => { terminal.written.push(data); },
          resize: (columns: number, rows: number) => {
            terminal.cols = columns;
            terminal.rows = rows;
          },
          kill: () => { terminal.killed = true; },
          onData: () => ({ dispose: () => undefined }),
          onExit: () => ({ dispose: () => undefined }),
        };
        spawned.push(terminal);
        return terminal;
      },
    };
  }

  /**
   * A service whose grace periods are milliseconds rather than seconds, and
   * whose way of ending a shell can be watched.
   *
   * The real one runs taskkill against a process id after three and a half
   * seconds, which a unit test can neither do nor wait for.
   */
  function impatientService(guard: unknown, factory: unknown) {
    const ended: number[] = [];
    const service = new TerminalService(guard, () => undefined, factory, {
      killProcessTree: (terminalProcess: { pid: number }) => { ended.push(terminalProcess.pid); },
      exitGraceMs: 20,
      killGraceMs: 20,
    });
    terminalServices.push(service);
    return { service, ended };
  }

  it("starts one process per tab however often start is called", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-once-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);
    const factory = countingFactory();
    const { service, ended } = impatientService(guard, factory);

    // Mounting the panel, reopening the tab and restoring a session all call
    // start for a terminal that may already be running. Each extra call must
    // rejoin the live process rather than leave an orphan behind it.
    const first = service.start(root, "1");
    const second = service.start(root, "1");
    service.start(root, "1");
    expect(factory.spawned).toHaveLength(1);
    expect(second).toMatchObject({ started: true, sessionId: first.sessionId });
    expect(service.list(root)).toEqual(["1"]);

    // Rejoining with a new size resizes the running process instead of
    // replacing it, so the panel can adopt the window it is mounted in.
    service.start(root, "1", { columns: 140, rows: 50 });
    expect(factory.spawned).toHaveLength(1);
    expect(factory.spawned[0]).toMatchObject({ cols: 140, rows: 50 });

    service.stop(root, "1");
    // Asked first: a shell that exits on its own lets ConPTY unwind the way it
    // was designed to, which is not what happens when it is killed under it.
    expect(factory.spawned[0].written).toContain("exit\r");
    // This fake never exits, so insisting is what eventually happens — as an
    // operating-system process, never through node-pty's kill. That call is
    // what closes the pseudoconsole under ConPTY, and it is what was killing
    // the whole application with an access violation.
    await service.drain();
    expect(ended).toEqual([factory.spawned[0].pid]);
    expect(factory.spawned[0].killed).toBe(false);
  });

  it("keeps the same tab number in two projects on separate processes", async () => {
    const first = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-project-a-"));
    const second = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-project-b-"));
    temporaryDirectories.push(first, second);
    const guard = new PathGuard();
    guard.register(first);
    guard.register(second);
    const factory = countingFactory();
    const { service, ended } = impatientService(guard, factory);

    service.start(first, "1");
    service.start(second, "1");
    expect(factory.spawned).toHaveLength(2);
    expect(service.list(first)).toEqual(["1"]);
    expect(service.list(second)).toEqual(["1"]);

    // Closing one project's terminals leaves the other project running.
    service.stop(first);
    expect(service.list(first)).toEqual([]);
    expect(service.list(second)).toEqual(["1"]);
    await service.drain();
    expect(ended).toEqual([factory.spawned[0].pid]);
    // The other project's terminal was never asked to go anywhere.
    expect(factory.spawned[1].killed).toBe(false);
    expect(factory.spawned[1].written).not.toContain("exit\r");
  });

  it("lets a shell that leaves on its own go without ending anything", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-terminal-polite-"));
    temporaryDirectories.push(root);
    const guard = new PathGuard();
    guard.register(root);

    // A shell that takes the hint, which is what PowerShell does — it just
    // takes about two and a half seconds to report it, and the old grace
    // period of 700 ms meant the polite ask never once won that race.
    const exits: Array<() => void> = [];
    const factory = {
      spawn: () => {
        const terminal = {
          pid: 4242,
          killed: false,
          written: [] as string[],
          write: (data: string) => {
            terminal.written.push(data);
            if (data.includes("exit")) setTimeout(() => exits.forEach((listener) => listener()), 5);
          },
          resize: () => undefined,
          kill: () => { terminal.killed = true; },
          onData: () => ({ dispose: () => undefined }),
          onExit: (listener: () => void) => {
            exits.push(listener);
            return { dispose: () => undefined };
          },
        };
        return terminal;
      },
    };
    const { service, ended } = impatientService(guard, factory);

    service.start(root, "1");
    service.stop(root, "1");
    expect(await service.drain(1_000)).toBe(true);
    expect(ended).toEqual([]);
  });
});
