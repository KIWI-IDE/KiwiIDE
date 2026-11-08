import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const { PolyglotLanguageService, SERVER_CATALOG, findExecutable, incrementalChange, normaliseConfiguration } = require("../electron/services/polyglot-language-service.cjs");
const { serverForLanguage } = require("../electron/services/polyglot-server-catalog.cjs");

const fixture = path.join(process.cwd(), "tests", "fixtures", "polyglot-lsp.cjs");
let root: string;
let guard: InstanceType<typeof PathGuard>;
let services: Array<InstanceType<typeof PolyglotLanguageService>>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-polyglot-lsp-"));
  guard = new PathGuard();
  guard.register(root);
  services = [];
});

afterEach(async () => {
  await Promise.all(services.map((service) => service.stop()));
  fs.rmSync(root, { recursive: true, force: true });
});

function harness(args: string[] = [], extra: Record<string, unknown> = {}) {
  const settings = { languageServers: Object.fromEntries(SERVER_CATALOG.flatMap((entry: { languages: Array<{ id: string }> }) => entry.languages.map(({ id }) => [id, { command: process.execPath, args: [fixture, ...args], enabled: true }]))) };
  const events: Array<{ channel: string; payload: any }> = [];
  const service = new PolyglotLanguageService(guard, () => settings, (channel: string, payload: any) => events.push({ channel, payload }), { initializeTimeoutMs: 2_000, requestTimeoutMs: 1_000, shutdownTimeoutMs: 500, ...extra });
  services.push(service);
  return { service, events, settings };
}

function payload(name = "main.py", languageId = "python", text = "print('hello')") {
  return { root, file: path.join(root, name), languageId, text };
}

async function inspect(service: InstanceType<typeof PolyglotLanguageService>, document = payload()) {
  const resolved = await service.request({ ...document, method: "completionItem/resolve", params: { label: "inspect" } });
  return JSON.parse(resolved.detail);
}

describe("polyglot language servers over a real stdio connection", () => {
  it("initializes once, synchronizes UTF-16 edits, saves, requests completions and publishes diagnostics", async () => {
    const { service, events } = harness();
    const document = payload("main.py", "python", "name = '🐦'\nprint(name)\n");
    expect(await service.open(document)).toMatchObject({ available: true, status: "ready" });
    await service.change({ ...document, text: "name = '🥝'\nprint(name.upper())\n" });
    await service.save({ root, file: document.file, text: "name = '🥝'\nprint(name.lower())\n" });
    const completion = await service.request({ ...document, method: "textDocument/completion", params: { textDocument: { uri: "file:///outside.py" }, position: { line: 1, character: 5 } } });
    expect(completion.items[0].detail).toContain("name.lower()");
    const state = await inspect(service, document);
    expect(state.initialization.rootUri).toBe(pathToFileURL(root).toString());
    expect(state.initialization.capabilities.general.positionEncodings).toEqual(["utf-16"]);
    expect(state.notifications.filter((entry: { method: string }) => entry.method === "open")).toHaveLength(1);
    expect(state.notifications.find((entry: { method: string }) => entry.method === "change").contentChanges[0]).toHaveProperty("range");
    expect(state.notifications.find((entry: { method: string }) => entry.method === "save").text).toContain("name.lower()");
    expect(state.documents[pathToFileURL(document.file).toString()].version).toBe(3);
    expect(events.some((event) => event.channel === "polyglot:diagnostics" && event.payload.languageId === "python" && event.payload.diagnostics[0]?.message === "fixture diagnostic")).toBe(true);
    await service.close(document);
    expect(await service.request({ ...document, method: "textDocument/completion", params: {} })).toBeNull();
    expect(events.at(-1)).toMatchObject({ channel: "polyglot:diagnostics", payload: { diagnostics: [] } });
  });

  it("shares clangd between C and C++ but isolates unrelated language servers", async () => {
    const { service } = harness();
    const c = payload("main.c", "c", "int value;");
    const cpp = payload("main.cpp", "cpp", "int other;");
    const python = payload();
    await Promise.all([service.open(c), service.open(cpp), service.open(python)]);
    const [stateC, stateCpp, statePython] = await Promise.all([inspect(service, c), inspect(service, cpp), inspect(service, python)]);
    expect(stateC.pid).toBe(stateCpp.pid);
    expect(stateC.pid).not.toBe(statePython.pid);
    expect(Object.keys(stateC.documents)).toHaveLength(2);
  });

  it("keeps the newest edit and never opens a document closed during initialization", async () => {
    const { service } = harness(["--delayed"]);
    const closed = payload("closed.py");
    const kept = payload("kept.py");
    const opening = service.open(closed);
    const keeping = service.open(kept);
    await service.change({ ...kept, text: "latest_content" });
    await service.close(closed);
    expect(await opening).toMatchObject({ available: false, status: "closed" });
    expect(await keeping).toMatchObject({ available: true });
    const state = await inspect(service, kept);
    expect(Object.values(state.documents)).toMatchObject([{ text: "latest_content" }]);
    expect(state.notifications.some((entry: { method: string; uri?: string }) => entry.method === "open" && entry.uri === pathToFileURL(closed.file).toString())).toBe(false);
  });

  it("matches normalized Windows diagnostic URIs to the correct C-family document", async () => {
    const { service, events } = harness(["--normalized-uri"]);
    const c = payload("main.c", "c", "int value;");
    const cpp = payload("main.cpp", "cpp", "int other;");
    await service.open(c);
    await service.open(cpp);
    await inspect(service, cpp);
    expect(events.some((event) => event.channel === "polyglot:diagnostics"
      && event.payload.languageId === "cpp" && event.payload.uri === pathToFileURL(cpp.file).toString())).toBe(true);
  });

  it("does not revive a server stopped during initialization", async () => {
    const { service, events } = harness(["--delayed"]);
    const opening = service.open(payload());
    await new Promise((resolve) => setTimeout(resolve, 25));
    await service.stop(root);
    expect(await opening).toMatchObject({ available: false });
    expect(service.sessions.size).toBe(0);
    expect(events.some((event) => event.channel === "polyglot:status" && event.payload.status === "ready")).toBe(false);
  });

  it("cancels a pending request through LSP cancellation", async () => {
    const { service } = harness();
    const document = payload("main.py", "python", "__CANCEL__");
    await service.open(document);
    const pending = service.request({ ...document, method: "textDocument/completion", params: { textDocument: {} }, requestId: "pending-completion" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(service.cancel("pending-completion")).toBe(true);
    expect(await pending).toMatchObject({ items: [{ label: "cancelled" }] });
    expect(service.cancel("pending-completion")).toBe(false);
  });

  it("times out an unresponsive initialization without leaving a process alive", async () => {
    const { service } = harness(["--hang"], { initializeTimeoutMs: 100 });
    expect(await service.open(payload())).toMatchObject({ available: false, status: "error", reason: expect.stringContaining("initialize") });
    expect([...service.sessions.values()].every((session: { process: unknown }) => !session.process)).toBe(true);
  });

  it("reports a crashed server and rejects its pending request", async () => {
    const { service, events } = harness();
    const document = payload("main.py", "python", "__CRASH__");
    await service.open(document);
    await expect(service.request({ ...document, method: "textDocument/completion", params: { textDocument: {} } })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events.some((event) => event.channel === "polyglot:status" && event.payload.status === "error")).toBe(true);
  });

  it("blocks unregistered roots, paths outside the project and arbitrary server commands", async () => {
    const { service } = harness();
    await expect(service.open({ ...payload(), root: path.dirname(root) })).rejects.toThrow();
    await expect(service.open({ ...payload(), file: path.join(path.dirname(root), "outside.py") })).rejects.toThrow();
    await expect(service.request({ ...payload(), method: "workspace/executeCommand", params: {} })).rejects.toThrow("nicht erlaubt");
  });

  it("launches locally managed Node servers without a system node command", async () => {
    const managedRoot = path.join(root, "managed");
    const packageRoot = path.join(managedRoot, "node_modules", "pyright");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ bin: { "pyright-langserver": "server.js" } }));
    fs.writeFileSync(path.join(packageRoot, "server.js"), `require(${JSON.stringify(fixture)});\n`);
    const service = new PolyglotLanguageService(guard, () => ({}), () => undefined, { managedRoot, env: { ...process.env, PATH: "" }, shutdownTimeoutMs: 500 });
    services.push(service);
    expect((await service.status(root)).find((row: { languageId: string }) => row.languageId === "python")).toMatchObject({ available: true, status: "installed" });
    expect(await service.open(payload())).toMatchObject({ available: true, status: "ready" });
    expect((await inspect(service)).initialization.clientInfo.name).toBe("Kiwi IDE");
  });
});

describe("server discovery and configuration", () => {
  it("has a real server integration and official setup link for every requested language", async () => {
    const service = new PolyglotLanguageService(guard, () => ({ languageServers: { lua: { enabled: false } } }), () => undefined, { findExecutable: async () => "" });
    services.push(service);
    const rows = await service.status(root);
    expect(rows.map((row: { languageId: string }) => row.languageId).sort()).toEqual([
      "assembly", "autohotkey", "c", "cpp", "csharp", "dart", "elixir", "gdscript", "go", "javascript", "javascriptreact", "kotlin", "lua", "objective-c", "objective-cpp", "odin", "perl", "php", "powershell", "python", "ruby", "rust", "scala", "shell", "sql", "swift", "terraform", "typescript", "typescriptreact", "zig",
    ]);
    expect(rows.every((row: { docsUrl: string; installHint: string }) => row.docsUrl.startsWith("https://") && row.installHint)).toBe(true);
    expect(rows.find((row: { languageId: string }) => row.languageId === "lua")).toMatchObject({ available: false, status: "disabled" });
    expect(await service.open(payload())).toMatchObject({ available: false, status: "missing" });
  });

  it("resolves executable names from additional directories and Windows PATHEXT", async () => {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "pyright-langserver.cmd"), "@echo fixture");
    expect(await findExecutable("pyright-langserver", { platform: "win32", env: { PATH: "", PATHEXT: ".EXE;.CMD" }, searchPaths: [bin] })).toBe(path.join(bin, "pyright-langserver.cmd"));
    expect(await findExecutable("not-installed", { env: { PATH: "" } })).toBe("");
  });

  it("finds Kiwi CMake compilation databases without replacing an explicit clangd override", async () => {
    const compileDirectory = path.join(root, ".kiwi", "build", "cmake");
    fs.mkdirSync(compileDirectory, { recursive: true });
    fs.writeFileSync(path.join(compileDirectory, "compile_commands.json"), "[]");
    const settings: { languageServers?: Record<string, { args: string[] }> } = {};
    const service = new PolyglotLanguageService(guard, () => settings, () => undefined, { findExecutable: async () => "clangd" });
    services.push(service);
    expect((await service.resolveLaunch(service.configuration("cpp"), root)).args).toContain(`--compile-commands-dir=${compileDirectory}`);
    settings.languageServers = { cpp: { args: ["--compile-commands-dir=custom-build"] } };
    expect((await service.resolveLaunch(service.configuration("cpp"), root)).args).toEqual(["--compile-commands-dir=custom-build"]);
  });

  it("computes incremental edits for insertion, deletion and multiline replacement", () => {
    expect(incrementalChange("a\nbc", "a\nb🥝c")).toEqual({ range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }, rangeLength: 0, text: "🥝" });
    expect(incrementalChange("a\nbc", "ac")).toEqual({ range: { start: { line: 0, character: 1 }, end: { line: 1, character: 1 } }, rangeLength: 2, text: "" });
  });

  it("normalises server configurations and looks up servers by language id", () => {
    const pyServer = serverForLanguage("python");
    expect(pyServer?.id).toBe("python");
    const cfg = normaliseConfiguration({ languageServers: { python: { enabled: true, command: "pyright-langserver", args: ["--stdio"] } } }, "python");
    expect(cfg?.command).toBe("pyright-langserver");
    expect(cfg?.args).toEqual(["--stdio"]);
  });
});
