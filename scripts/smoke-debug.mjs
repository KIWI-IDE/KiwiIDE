import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { WorkspaceService } = require("../electron/services/workspace-service.cjs");
const { ProjectService } = require("../electron/services/project-service.cjs");
const { BuildService } = require("../electron/services/build-service.cjs");
const { DebugService } = require("../electron/services/debug-service.cjs");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-debug-"));
const sourceDirectory = path.join(root, "src", "demo");
const sourceFile = path.join(sourceDirectory, "Main.java");
const source = `package demo;

public class Main {
    static class Box { int number = 7; }

    public static void main(String[] args) {
        int value = 40;
        Box box = new Box();
        int[] numbers = {1, 2, 3};
        java.util.List<String> names = java.util.List.of("kiwi", "ide");
        value++;
        value++;
        value++;
        System.out.println(value + box.number + numbers.length + names.size());
    }
}
`;

const events = [];
const guard = new PathGuard();
guard.register(root);
const settings = { get: () => ({ jdkPath: "" }) };
const workspace = new WorkspaceService(guard, { trashItem: async () => {} }, () => {});
const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
const builds = new BuildService(guard, workspace, projects, () => {});
const debug = new DebugService(guard, workspace, projects, builds, (channel, payload) => {
  events.push({ channel, payload });
});

try {
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(sourceFile, source, "utf8");
  await debug.start({
    root,
    file: sourceFile,
    breakpoints: [
      { type: "line", className: "demo.Main", line: 11, condition: "value > 100" },
      { type: "line", className: "demo.Main", line: 11, hitCondition: "1", logMessage: "value before increment = {value}" },
      { type: "line", className: "demo.Main", line: 12, condition: "value == 41" },
    ],
  });
  await waitFor(() => pausedEvents().length >= 1, 15_000, "breakpoint");
  assert.equal(pausedEvents().at(-1).payload.line, 12, "Conditional breakpoint stopped on the wrong line.");
  await waitFor(() => output().includes("value before increment = 40"), 10_000, "logpoint");
  await waitFor(() => localVariables().some((item) => item.name === "box" && item.hasChildren), 10_000, "object variable");
  const box = localVariables().find((item) => item.name === "box");
  debug.command("variables", String(box.referenceId));
  await waitFor(() => events.some((event) =>
    event.channel === "debug:variables"
    && event.payload.scope === String(box.referenceId)
    && event.payload.variables.some((item) => item.name === "number"),
  ), 10_000, "object expansion");
  const names = localVariables().find((item) => item.name === "names");
  assert.ok(names?.hasChildren, "Collection variable is not expandable.");
  debug.command("variables", String(names.referenceId));
  await waitFor(() => events.some((event) =>
    event.channel === "debug:variables"
    && event.payload.scope === String(names.referenceId)
    && event.payload.variables.some((item) => item.name === "[0]" && item.value === "\"kiwi\""),
  ), 10_000, "logical collection expansion");
  debug.command("evaluate", "box.number");
  await waitFor(() => events.some((event) => event.channel === "debug:watch" && event.payload.value === "7"), 10_000, "watch");

  await debug.command("runToCursor", JSON.stringify({ className: "demo.Main", line: 13 }));
  await waitFor(() => pausedEvents().length >= 2 && pausedEvents().at(-1).payload.reason === "runToCursor", 15_000, "run to cursor");
  const updatedSource = source.replace("names.size()", "names.size() + 0");
  await fs.writeFile(sourceFile, updatedSource, "utf8");
  await debug.command("hotReplace", sourceFile);
  await waitFor(() => events.some((event) => event.channel === "debug:hotReplace" && event.payload.success), 10_000, "hot code replace");

  await debug.command("stepOver");
  await waitFor(() => pausedEvents().length >= 3, 15_000, "step over");
  await debug.command("stack");
  await debug.command("locals");
  await waitFor(() => output().includes("value ="), 10_000, "local variables");
  assert.ok(output().includes("demo.Main.main"), "Call stack did not contain demo.Main.main.");

  debug.stop();
  const runningSource = `package demo;
public class Main {
    static final class Message {
        static String text() { return "HOTSWAP_BEFORE"; }
    }
    public static void main(String[] args) throws Exception {
        for (int index = 0; index < 120; index++) {
            System.out.println(Message.text());
            Thread.sleep(75L);
        }
    }
}
`;
  await fs.writeFile(sourceFile, runningSource, "utf8");
  await debug.start({ root, file: sourceFile, breakpoints: [] });
  await waitFor(() => output().includes("HOTSWAP_BEFORE"), 10_000, "running debuggee output before HotSwap");
  const pausesBeforeRunningHotSwap = pausedEvents().length;
  const replacementsBeforeRunningHotSwap = hotReplaceEvents().length;
  await fs.writeFile(sourceFile, runningSource.replace("HOTSWAP_BEFORE", "HOTSWAP_AFTER"), "utf8");
  await debug.command("hotReplace", sourceFile);
  await waitFor(
    () => hotReplaceEvents().length > replacementsBeforeRunningHotSwap
      && hotReplaceEvents().at(-1).payload.success,
    10_000,
    "HotSwap while running",
  );
  await waitFor(() => output().includes("HOTSWAP_AFTER"), 10_000, "updated output without pause");
  assert.equal(
    pausedEvents().length,
    pausesBeforeRunningHotSwap,
    "HotSwap paused a running debuggee.",
  );
  assert.equal(
    stateEvents().at(-1)?.payload.status,
    "running",
    "The debugger did not remain running after HotSwap.",
  );

  debug.stop();
  const smartReloadSource = `package demo;
public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println("SMART_RELOAD_BEFORE");
        Thread.sleep(20000L);
    }
}
`;
  await fs.writeFile(sourceFile, smartReloadSource, "utf8");
  await debug.start({
    root,
    file: sourceFile,
    breakpoints: [{ type: "line", className: "demo.Main", line: 99, condition: "false" }],
  });
  await waitFor(() => output().includes("SMART_RELOAD_BEFORE"), 10_000, "application output before Smart HotSwap");
  const smartEventsBefore = hotReplaceEvents().length;
  const stoppedBeforeSmartReload = stateEvents().filter((event) => event.payload.status === "stopped").length;
  await fs.writeFile(sourceFile, smartReloadSource.replace("SMART_RELOAD_BEFORE", "SMART_RELOAD_AFTER"), "utf8");
  await debug.command("hotReplace", { file: sourceFile, mode: "smart" });
  await waitFor(
    () => hotReplaceEvents().length > smartEventsBefore
      && hotReplaceEvents().at(-1).payload.success
      && hotReplaceEvents().at(-1).payload.restarted,
    15_000,
    "automatic Smart HotSwap relaunch",
  );
  await waitFor(() => output().includes("SMART_RELOAD_AFTER"), 10_000, "updated startup output after automatic relaunch");
  assert.equal(
    stateEvents().filter((event) => event.payload.status === "stopped").length,
    stoppedBeforeSmartReload,
    "Smart HotSwap exposed an intermediate stopped session to the UI.",
  );
  assert.ok(stateEvents().some((event) => event.payload.status === "restarting"), "Smart HotSwap did not report its reload state.");
  assert.equal(stateEvents().at(-1)?.payload.status, "running", "Smart HotSwap did not leave the replacement JVM running.");

  debug.stop();
  const exceptionSource = `package demo;
public class Main {
    public static void main(String[] args) {
        throw new IllegalStateException("boom");
    }
}
`;
  await fs.writeFile(sourceFile, exceptionSource, "utf8");
  const previousPauses = pausedEvents().length;
  await debug.start({
    root,
    file: sourceFile,
    breakpoints: [{ type: "exception", className: "java.lang.IllegalStateException", line: 0, caught: true, uncaught: true }],
  });
  await waitFor(() => pausedEvents().length > previousPauses && pausedEvents().at(-1).payload.reason === "exception", 15_000, "exception breakpoint");

  // A field breakpoint answers what no line breakpoint can: who wrote that
  // value. The write here is in a method nobody would think to look in, which
  // is the whole point, and the value it is about to take is the answer.
  const memberSource = `package demo;
public class Main {
    static int zaehler = 0;

    static void erhoehe() {
        zaehler = zaehler + 5;
    }

    public static void main(String[] args) throws Exception {
        erhoehe();
        Thread.sleep(30_000);
    }
}
`;
  await fs.writeFile(sourceFile, memberSource, "utf8");
  const beforeField = pausedEvents().length;
  await debug.start({
    root,
    file: sourceFile,
    breakpoints: [{ type: "field", className: "demo.Main", line: 0, fieldName: "zaehler", onWrite: true }],
  });
  await waitFor(() => pausedEvents().length > beforeField && pausedEvents().at(-1).payload.reason === "fieldWrite", 20_000, "field breakpoint");
  // The first write is the field's own initializer, before main runs at all.
  // That is right, and worth pinning down: somebody watching a field expects
  // to see every write to it, including the one the class makes to itself.
  const first = fieldHits().at(-1);
  assert.equal(first?.fieldName, "zaehler", "The field breakpoint did not report which field was written.");
  assert.equal(first?.newValue, "0", `The initializer write reported the wrong value: ${JSON.stringify(first)}`);
  await debug.command("continue");
  await waitFor(() => fieldHits().length > 1, 20_000, "second field write");
  const hit = fieldHits().at(-1);
  assert.equal(hit?.value, "0", `The field breakpoint did not report the value it held: ${JSON.stringify(hit)}`);
  assert.equal(hit?.newValue, "5", `The field breakpoint did not report the value about to be written: ${JSON.stringify(hit)}`);
  debug.stop();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // A method breakpoint stops wherever the call comes from, which is the
  // question when a method is reached through an interface or a framework.
  const beforeMethod = pausedEvents().length;
  await debug.start({
    root,
    file: sourceFile,
    breakpoints: [{ type: "method", className: "demo.Main", line: 0, methodName: "erhoehe", onEntry: true }],
  });
  await waitFor(() => pausedEvents().length > beforeMethod && pausedEvents().at(-1).payload.reason === "methodEntry", 20_000, "method breakpoint");

  console.log("Debugger smoke passed: JDI/JDWP, conditional/hit/log/exception breakpoints, object/collection trees, live watches, instant method HotSwap, automatic startup-code relaunch, run-to-cursor, field and method breakpoints, step and stack.");
} finally {
  debug.stop();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await removeWithRetry(root);
}

function fieldHits() {
  return events.filter((event) => event.channel === "debug:fieldHit").map((event) => event.payload);
}

function pausedEvents() {
  return events.filter((event) => event.channel === "debug:state" && event.payload.status === "paused");
}

function stateEvents() {
  return events.filter((event) => event.channel === "debug:state");
}

function hotReplaceEvents() {
  return events.filter((event) => event.channel === "debug:hotReplace");
}

function output() {
  return events.filter((event) => event.channel === "debug:output").map((event) => event.payload.text).join("");
}

function localVariables() {
  return events
    .filter((event) => event.channel === "debug:variables" && event.payload.scope === "locals")
    .at(-1)?.payload.variables || [];
}

async function waitFor(predicate, timeout, label) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}.\n${output().slice(-4000)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function removeWithRetry(target) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}
