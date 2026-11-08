import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PolyglotProjectService, findExecutable } = require("../electron/services/polyglot-project-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");
const work = path.resolve(".kiwi", "smoke");
await fs.mkdir(work, { recursive: true });
const fixture = await fs.mkdtemp(path.join(work, "hybrid-projects-"));
const guard = new PathGuard();
guard.register(fixture);
process.env.DOTNET_CLI_HOME = path.join(fixture, "dotnet-home");
process.env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1";
process.env.DOTNET_CLI_TELEMETRY_OPTOUT = "1";
process.env.DOTNET_NOLOGO = "1";

const output = new Map();
const exits = new Map();
const waiters = new Map();
const service = new PolyglotProjectService(guard, {
  send(channel, payload) {
    if (channel === "polyglot:output") output.set(payload.operationId, (output.get(payload.operationId) || "") + payload.text);
    if (channel === "polyglot:exit") {
      exits.set(payload.operationId, payload.code);
      waiters.get(payload.operationId)?.(payload.code);
      waiters.delete(payload.operationId);
    }
  },
});

function probe(command, args, pattern) {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, shell: false, timeout: 15_000 });
    return result.status === 0 && pattern.test(`${result.stdout || ""}\n${result.stderr || ""}`);
  } catch { return false; }
}

function waitForExit(operationId) {
  if (exits.has(operationId)) return Promise.resolve(exits.get(operationId));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(operationId); reject(new Error("Hybrid build/run did not finish within 120 seconds.")); }, 120_000);
    waiters.set(operationId, (code) => { clearTimeout(timer); resolve(code); });
  });
}

let passed = 0;
let skipped = 0;
try {
  const runtimes = [
    { language: "python", command: findExecutable(process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"]), args: ["--version"], pattern: /Python 3\./ },
    { language: "csharp", command: findExecutable(["dotnet"]), args: ["--list-sdks"], pattern: /(?:^|\n)1[0-9]\.\d+\.\d+/ },
  ];
  for (const runtime of runtimes) {
    if (!probe(runtime.command, runtime.args, runtime.pattern)) {
      process.stdout.write(`SKIP ${runtime.language}: a matching runtime/SDK is not installed.\n`);
      skipped += 1;
      continue;
    }
    const project = await service.create({ location: fixture, language: runtime.language, name: `smoke-${runtime.language}` });
    for (const action of ["build", "run"]) {
      const operation = await service.execute({ root: project.root, action });
      assert.equal(operation.started, true);
      const code = await waitForExit(operation.operationId);
      assert.equal(code, 0, `${runtime.language} ${action} failed:\n${output.get(operation.operationId) || ""}`);
      if (action === "run") assert.match(output.get(operation.operationId) || "", /Hello from (Python|C#)!/);
      process.stdout.write(`PASS ${runtime.language} ${action} through PolyglotProjectService.execute\n`);
      passed += 1;
    }
    if (runtime.language === "python") {
      await fs.writeFile(project.mainFile, "def broken(:\n", "utf8");
      const operation = await service.execute({ root: project.root, action: "build" });
      assert.notEqual(await waitForExit(operation.operationId), 0, "A Python syntax error must fail the build.");
      process.stdout.write("PASS python syntax errors fail the real build\n");
      passed += 1;
    }
  }
  process.stdout.write(`Hybrid project smoke: ${passed} checks passed, ${skipped} runtimes skipped. Fixture: ${fixture}\n`);
} finally {
  await service.stop();
}
