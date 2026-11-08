import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const {
  JavaRefactorService,
  applyOffsetEdits,
  parseInvocationAt,
  splitTopLevel,
} = require("../electron/services/java-refactor-service.cjs");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-refactor-"));
  roots.push(root);
  const guard = new PathGuard();
  guard.register(root);
  return { root, guard };
}

function write(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, "utf8");
  return file;
}

function position(source: string, needle: string, occurrence = 0) {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(needle, offset + 1);
  if (offset < 0) throw new Error(`Missing test token: ${needle}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.replace(/\r$/, "").length };
}

function location(file: string, source: string, needle: string, occurrence = 0) {
  const start = position(source, needle, occurrence);
  return {
    uri: pathToFileURL(file).toString(),
    range: { start, end: { line: start.line, character: start.character + needle.length } },
  };
}

function moduleInfo(projectRoot: string, name: string) {
  const root = path.join(projectRoot, name);
  return {
    id: name,
    name,
    root,
    projectRoot,
    relativePath: name,
    buildSystem: "Maven",
    sourceRoots: [path.join(root, "src", "main", "java")],
    testRoots: [path.join(root, "src", "test", "java")],
    resourceRoots: [path.join(root, "src", "main", "resources")],
    testResourceRoots: [path.join(root, "src", "test", "resources")],
    outputPath: path.join(root, "build", "classes"),
    dependencies: [],
    jdkPath: "",
    languageLevel: "21",
    descriptorPath: null,
    jpms: null,
  };
}

function harness(root: string, guard: any, moduleList: any[], request: (method: string, params: any) => any) {
  const events: any[] = [];
  const workspace = {
    beginOperation: async (_root: string, label: string, paths: string[]) => { events.push({ kind: "begin", label, paths }); return "history-1"; },
    endOperation: () => { events.push({ kind: "end" }); return true; },
    invalidate: () => events.push({ kind: "invalidate" }),
    send: (channel: string, payload: any) => events.push({ kind: "event", channel, payload }),
  };
  const language = {
    start: async () => ({ available: true }),
    open: async () => ({ available: true }),
    refresh: async () => true,
    request: async (_root: string, method: string, params: any) => request(method, params),
  };
  const service = new JavaRefactorService(guard, workspace, { list: async () => moduleList }, language);
  return { service, events };
}

describe("JavaRefactorService", () => {
  it("moves a class between Maven modules, updates packages/usages/build model and applies one transaction", async () => {
    const { root, guard } = fixture();
    const core = moduleInfo(root, "core");
    const api = moduleInfo(root, "api");
    const serviceSource = `package dev.old;\n\npublic class Service {\n}\n`;
    const userSource = `package dev.old;\n\npublic class User {\n    private final Service service = new Service();\n}\n`;
    const serviceFile = write(path.join(core.sourceRoots[0], "dev", "old", "Service.java"), serviceSource);
    const userFile = write(path.join(core.sourceRoots[0], "dev", "old", "User.java"), userSource);
    write(path.join(core.root, "pom.xml"), `<project><modelVersion>4.0.0</modelVersion><groupId>dev.kiwi</groupId><artifactId>core</artifactId><version>1</version></project>\n`);
    write(path.join(api.root, "pom.xml"), `<project><modelVersion>4.0.0</modelVersion><groupId>dev.kiwi</groupId><artifactId>api</artifactId><version>1</version></project>\n`);
    const references = [
      location(serviceFile, serviceSource, "Service"),
      location(userFile, userSource, "Service", 0),
      location(userFile, userSource, "Service", 1),
    ];
    const { service, events } = harness(root, guard, [core, api], (method) => {
      if (method === "textDocument/references") return references;
      throw new Error(`Unexpected language request: ${method}`);
    });

    const plan = await service.previewMove(root, {
      sourcePath: serviceFile,
      targetModuleId: "api",
      targetPackage: "dev.api",
    });

    expect(plan.blocked).toBe(false);
    expect(plan.targetPath).toBe(path.join(api.sourceRoots[0], "dev", "api", "Service.java"));
    expect(plan.buildModelChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ moduleId: "core", targetModuleId: "api", scope: "compile" }),
    ]));
    expect(plan.files.find((file: any) => file.path === userFile)?.after).toContain("import dev.api.Service;");
    expect(plan.files.find((file: any) => file.path.endsWith("core\\pom.xml") || file.path.endsWith("core/pom.xml"))?.after)
      .toContain("<artifactId>api</artifactId>");

    const result = await service.applyPlan(root, plan.id);
    expect(result.applied).toBe(true);
    expect(fs.existsSync(serviceFile)).toBe(false);
    expect(fs.readFileSync(plan.targetPath, "utf8")).toContain("package dev.api;");
    expect(fs.readFileSync(userFile, "utf8")).toContain("import dev.api.Service;");
    expect(events.filter((event) => event.kind === "begin")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "end")).toHaveLength(1);
  });

  it("rejects a stale move preview before touching files", async () => {
    const { root, guard } = fixture();
    const core = moduleInfo(root, "core");
    const api = moduleInfo(root, "api");
    const source = `package demo;\npublic class Service {}\n`;
    const file = write(path.join(core.sourceRoots[0], "demo", "Service.java"), source);
    write(path.join(core.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>core</artifactId></project>`);
    write(path.join(api.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>api</artifactId></project>`);
    const { service } = harness(root, guard, [core, api], (method) => method === "textDocument/references" ? [location(file, source, "Service")] : []);
    const plan = await service.previewMove(root, { sourcePath: file, targetModuleId: "api" });
    fs.appendFileSync(file, "// edited after preview\n");
    await expect(service.applyPlan(root, plan.id)).rejects.toThrow(/seit der Vorschau geändert/);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(plan.targetPath)).toBe(false);
  });

  it("blocks a cross-module move when the required build dependency would create a cycle", async () => {
    const { root, guard } = fixture();
    const core = moduleInfo(root, "core");
    const api = moduleInfo(root, "api");
    const serviceSource = `package demo;\npublic class Service {}\n`;
    const userSource = `package demo;\nclass User { Service value; }\n`;
    const serviceFile = write(path.join(core.sourceRoots[0], "demo", "Service.java"), serviceSource);
    const userFile = write(path.join(core.sourceRoots[0], "demo", "User.java"), userSource);
    write(path.join(core.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>core</artifactId></project>`);
    write(path.join(api.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>api</artifactId><dependencies><dependency><groupId>dev</groupId><artifactId>core</artifactId></dependency></dependencies></project>`);
    const refs = [location(serviceFile, serviceSource, "Service"), location(userFile, userSource, "Service")];
    const { service } = harness(root, guard, [core, api], (method) => method === "textDocument/references" ? refs : []);
    const plan = await service.previewMove(root, { sourcePath: serviceFile, targetModuleId: "api" });
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReasons.join(" ")).toMatch(/Modulschleife/);
    await expect(service.applyPlan(root, plan.id)).rejects.toThrow(/blockiert/);
  });

  it("updates JPMS exports/requires and protects against split packages", async () => {
    const { root, guard } = fixture();
    const core = moduleInfo(root, "core");
    const api = moduleInfo(root, "api");
    core.descriptorPath = write(path.join(core.sourceRoots[0], "module-info.java"), "module dev.core {\n    exports demo;\n}\n");
    core.jpms = { name: "dev.core", requires: [], requiresTransitive: [], exports: ["demo"], opens: [], uses: [], provides: [] };
    api.descriptorPath = write(path.join(api.sourceRoots[0], "module-info.java"), "module dev.api {\n}\n");
    api.jpms = { name: "dev.api", requires: [], requiresTransitive: [], exports: [], opens: [], uses: [], provides: [] };
    const serviceSource = `package demo;\npublic class Service {}\n`;
    const userSource = `package demo;\nclass User { Service value; }\n`;
    const serviceFile = write(path.join(core.sourceRoots[0], "demo", "Service.java"), serviceSource);
    const userFile = write(path.join(core.sourceRoots[0], "demo", "User.java"), userSource);
    write(path.join(core.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>core</artifactId></project>`);
    write(path.join(api.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>api</artifactId></project>`);
    const refs = [location(serviceFile, serviceSource, "Service"), location(userFile, userSource, "Service")];
    const { service } = harness(root, guard, [core, api], (method) => method === "textDocument/references" ? refs : []);

    const splitPackage = await service.previewMove(root, { sourcePath: serviceFile, targetModuleId: "api" });
    expect(splitPackage.blockedReasons.join(" ")).toMatch(/Split-Package/);

    const safeMove = await service.previewMove(root, {
      sourcePath: serviceFile,
      targetModuleId: "api",
      targetPackage: "dev.api.service",
    });
    expect(safeMove.blocked).toBe(false);
    expect(safeMove.files.find((file: any) => file.path === core.descriptorPath)?.after).toContain("requires dev.api;");
    expect(safeMove.files.find((file: any) => file.path === api.descriptorPath)?.after).toContain("exports dev.api.service;");
  });

  it("creates a Change Signature WorkspaceEdit for declaration and overload-safe JDT references", async () => {
    const { root, guard } = fixture();
    const module = moduleInfo(root, "app");
    const serviceSource = `package demo;\n\npublic class Service {\n    public String greet(String first, int count) {\n        return first.repeat(count);\n    }\n}\n`;
    const userSource = `package demo;\n\nclass User {\n    String run(Service service) {\n        return service.greet("Kiwi", 2);\n    }\n}\n`;
    const serviceFile = write(path.join(module.sourceRoots[0], "demo", "Service.java"), serviceSource);
    const userFile = write(path.join(module.sourceRoots[0], "demo", "User.java"), userSource);
    write(path.join(module.root, "pom.xml"), `<project><groupId>dev</groupId><artifactId>app</artifactId></project>`);
    const methodStart = position(serviceSource, "public String greet");
    const methodName = position(serviceSource, "greet");
    const symbol = {
      name: "greet(String, int) : String",
      kind: 6,
      range: { start: methodStart, end: position(serviceSource, "    }", 0) },
      selectionRange: { start: methodName, end: { ...methodName, character: methodName.character + 5 } },
    };
    const references = [
      location(serviceFile, serviceSource, "greet"),
      {
        ...location(userFile, userSource, "greet"),
        // JDT LS commonly returns the complete invocation as the reference
        // range, not just the identifier.
        range: {
          start: position(userSource, "greet"),
          end: {
            ...position(userSource, "greet"),
            character: position(userSource, "greet").character + 'greet("Kiwi", 2)'.length,
          },
        },
      },
    ];
    const { service } = harness(root, guard, [module], (method, params) => {
      if (method === "textDocument/documentSymbol") return params.textDocument.uri === pathToFileURL(serviceFile).toString() ? [symbol] : [];
      if (method === "textDocument/references") return references;
      if (method === "textDocument/codeAction") return [{ title: "Change signature for 'greet'", kind: "refactor.change.signature" }];
      throw new Error(`Unexpected language request: ${method}`);
    });

    const prepared = await service.prepareChangeSignature(root, serviceFile, methodName);
    expect(prepared.available).toBe(true);
    expect(prepared.signature.parameters.map((parameter: any) => parameter.name)).toEqual(["first", "count"]);

    const plan = await service.previewChangeSignature(root, {
      file: serviceFile,
      position: methodName,
      newName: "welcome",
      parameters: [
        { sourceIndex: 1, type: "int", name: "count" },
        { sourceIndex: 0, type: "String", name: "first" },
        { sourceIndex: null, type: "boolean", name: "excited", defaultValue: "true" },
      ],
    });
    expect(plan.blockedReasons).toEqual([]);
    expect(plan.files.find((file: any) => file.path === serviceFile)?.after)
      .toContain("public String welcome(int count, String first, boolean excited) {");
    expect(plan.files.find((file: any) => file.path === userFile)?.after)
      .toContain('service.welcome(2, "Kiwi", true)');
    expect(plan.affectedCallSites).toEqual([
      expect.objectContaining({ path: userFile, line: 5 }),
    ]);

    await service.applyPlan(root, plan.id);
    expect(fs.readFileSync(userFile, "utf8")).toContain('service.welcome(2, "Kiwi", true)');
  });

  it("blocks parameter changes when a semantic reference is a method reference", async () => {
    const { root, guard } = fixture();
    const module = moduleInfo(root, "app");
    const source = `package demo;\nclass Service {\n    private String greet(String value) { return value; }\n    java.util.function.Function<String, String> fn = this::greet;\n}\n`;
    const file = write(path.join(module.sourceRoots[0], "demo", "Service.java"), source);
    write(path.join(module.root, "pom.xml"), `<project><artifactId>app</artifactId></project>`);
    const methodStart = position(source, "private String greet");
    const methodName = position(source, "greet");
    const symbol = {
      name: "greet(String) : String",
      kind: 6,
      range: { start: methodStart, end: position(source, "}", 0) },
      selectionRange: { start: methodName, end: { ...methodName, character: methodName.character + 5 } },
    };
    const refs = [location(file, source, "greet", 0), location(file, source, "greet", 1)];
    const { service } = harness(root, guard, [module], (method) => method === "textDocument/documentSymbol" ? [symbol] : refs);
    const plan = await service.previewChangeSignature(root, {
      file,
      position: methodName,
      parameters: [
        { sourceIndex: 0, type: "String", name: "value" },
        { sourceIndex: null, type: "int", name: "times", defaultValue: "1" },
      ],
    });
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReasons.join(" ")).toMatch(/Methodenreferenz/);
    await expect(service.applyPlan(root, plan.id)).rejects.toThrow(/blockiert/);
  });

  it("rejects a JDT WorkspaceEdit that escapes the registered project", async () => {
    const { root, guard } = fixture();
    const module = moduleInfo(root, "app");
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.java`);
    write(outside, "class Outside {}\n");
    try {
      const { service } = harness(root, guard, [module], () => []);
      await expect(service.previewWorkspaceEdit(root, "Unsafe", {
        changes: {
          [pathToFileURL(outside).toString()]: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            newText: "public",
          }],
        },
      })).rejects.toThrow(/außerhalb|nicht erlaubt|Projekt/i);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("finds dead private fields, methods and nested classes semantically and caches unchanged scans", async () => {
    const { root, guard } = fixture();
    const module = moduleInfo(root, "app");
    const source = `package demo;\nclass Sample {\n    private int unusedField;\n    @Deprecated\n    private int reflectiveMaybe;\n    private void used() {}\n    private void unusedMethod() {}\n    private static class UnusedNested {}\n    void run() { used(); }\n}\n`;
    const file = write(path.join(module.sourceRoots[0], "demo", "Sample.java"), source);
    write(path.join(module.root, "pom.xml"), `<project><artifactId>app</artifactId></project>`);
    const makeSymbol = (name: string, kind: number, startNeedle: string) => {
      const start = position(source, startNeedle);
      const selection = position(source, name);
      return {
        name,
        kind,
        range: { start, end: { line: start.line, character: source.split("\n")[start.line].length } },
        selectionRange: { start: selection, end: { line: selection.line, character: selection.character + name.length } },
      };
    };
    const symbols = [{
      name: "Sample",
      kind: 5,
      range: { start: position(source, "class Sample"), end: position(source, "}\n") },
      selectionRange: { start: position(source, "Sample"), end: { ...position(source, "Sample"), character: position(source, "Sample").character + 6 } },
      children: [
        makeSymbol("unusedField", 8, "private int unusedField"),
        makeSymbol("reflectiveMaybe", 8, "private int reflectiveMaybe"),
        makeSymbol("used", 6, "private void used"),
        makeSymbol("unusedMethod", 6, "private void unusedMethod"),
        makeSymbol("UnusedNested", 5, "private static class UnusedNested"),
      ],
    }];
    let referenceRequests = 0;
    const { service } = harness(root, guard, [module], (method, params) => {
      if (method === "textDocument/documentSymbol") return symbols;
      if (method === "textDocument/references") {
        referenceRequests += 1;
        const line = params.position.line;
        if (line === position(source, "private void used").line) return [location(file, source, "used", 3)];
        return [];
      }
      return [];
    });

    const result = await service.analyzeUnusedPrivate(root);
    expect(result.findings.map((finding: any) => finding.name)).toEqual([
      "unusedField", "reflectiveMaybe", "unusedMethod", "UnusedNested",
    ]);
    expect(result.findings.find((finding: any) => finding.name === "reflectiveMaybe")).toMatchObject({ confidence: "low", safeDelete: false });
    expect(result.findings.find((finding: any) => finding.name === "unusedMethod")).toMatchObject({ confidence: "high", safeDelete: true });
    const requestsAfterFirstRun = referenceRequests;
    const cached = await service.analyzeUnusedPrivate(root);
    expect(cached.cached).toBe(true);
    expect(referenceRequests).toBe(requestsAfterFirstRun);
  });
});

describe("Java refactoring parsers", () => {
  it("splits generic arguments and nested calls only at top-level commas", () => {
    expect(splitTopLevel('Map<String, List<Integer>> values, call("a,b", next(1, 2)), int count')).toEqual([
      "Map<String, List<Integer>> values",
      'call("a,b", next(1, 2))',
      "int count",
    ]);
  });

  it("parses invocation arguments and rejects overlapping text edits", () => {
    const source = 'service.call(first(1, 2), "x,y")';
    const invocation = parseInvocationAt(source, source.indexOf("call") + 4);
    expect(invocation.arguments).toEqual(["first(1, 2)", '"x,y"']);
    expect(() => applyOffsetEdits("abcdef", [
      { start: 1, end: 4, text: "x" },
      { start: 3, end: 5, text: "y" },
    ])).toThrow(/überlappende/);
  });
});
