import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PolyglotProjectService, PROJECT_LANGUAGES, detectPolyglotProject, languageForFile, projectFiles } = require("../electron/services/polyglot-project-service.cjs");
const { ProjectService } = require("../electron/services/project-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");

let parent: string;
let guard: InstanceType<typeof PathGuard>;
let service: InstanceType<typeof PolyglotProjectService>;
const settings = { get: () => ({}), rememberWorkspace: vi.fn(async () => undefined) };

beforeEach(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-polyglot-project-"));
  guard = new PathGuard();
  guard.register(parent);
  settings.rememberWorkspace.mockClear();
  service = new PolyglotProjectService(guard, { settings });
});

afterEach(async () => {
  await service.stop();
  fs.rmSync(parent, { recursive: true, force: true });
});

const create = (language: string, extras: Record<string, unknown> = {}) => service.create({ location: parent, language, name: `hello-${language}`, ...extras });

describe("hybrid project starters", () => {
  it.each(Object.keys(PROJECT_LANGUAGES))("creates, detects, and plans an executable %s starter", async (language) => {
    const project = await create(language);
    expect(fs.statSync(project.mainFile).isFile()).toBe(true);
    expect(fs.existsSync(path.join(project.root, "src", "main", "java"))).toBe(false);
    expect(service.detect(project.root)).toMatchObject({ language, type: PROJECT_LANGUAGES[language].name });
    const plan = await service.plan({ root: project.root, action: "run" });
    expect(plan.language).toBe(language);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.every((step: { cwd: string; args: unknown }) => step.cwd === project.root && Array.isArray(step.args))).toBe(true);
  });

  it("does not probe a JDK when opening a Python project", async () => {
    const project = await create("python");
    const projects = new ProjectService(guard, settings, "");
    const detectJdk = vi.spyOn(projects, "detectJdk");
    expect(await projects.detect(project.root)).toMatchObject({ type: "Python", language: "python", jdkMajor: 0 });
    expect(detectJdk).not.toHaveBeenCalled();
  });

  it("creates non-Java projects through the existing project API", async () => {
    const projects = new ProjectService(guard, settings, "");
    const project = await projects.create({ location: parent, language: "go", name: "api-go", type: "Go" });
    expect(project.language).toBe("go");
    expect(fs.readFileSync(path.join(project.root, "go.mod"), "utf8")).toContain("module example.com/api-go");
    expect(settings.rememberWorkspace).toHaveBeenCalledWith(project.root);
  });

  it("does not overwrite an existing project or accept relative traversal names", async () => {
    const project = await create("python");
    const original = fs.readFileSync(project.mainFile, "utf8");
    await expect(create("python")).rejects.toThrow();
    expect(fs.readFileSync(project.mainFile, "utf8")).toBe(original);
    for (const name of [".", "..", "../outside", "a/b"]) await expect(create("python", { name })).rejects.toThrow();
  });

  it("respects the empty-source option without silently compiling Python's sys.path", async () => {
    const project = await create("python", { sampleClass: false });
    expect(project.mainFile).toBe("");
    expect(fs.existsSync(path.join(project.root, "main.py"))).toBe(false);
    // No source files at all must fail rather than compile Python's sys.path.
    fs.unlinkSync(path.join(project.root, "tests", "__init__.py"));
    await expect(service.plan({ root: project.root, action: "build" })).rejects.toThrow(/Python-Quelldatei/);
  });

  it("uses literal CMake variables and a predictable executable directory", async () => {
    const project = await create("cpp");
    const cmake = fs.readFileSync(path.join(project.root, "CMakeLists.txt"), "utf8");
    expect(cmake).toContain('${CMAKE_BINARY_DIR}/bin');
    expect(cmake).toContain('CMAKE_RUNTIME_OUTPUT_DIRECTORY_${config}');
    expect(cmake).toContain("add_executable(kiwi_app src/main.cpp)");
  });
});

describe("importing existing projects", () => {
  it.each([
    ["Cargo.toml", "rust"], ["go.mod", "go"], ["composer.json", "php"], ["pyproject.toml", "python"], ["sample.csproj", "csharp"],
    ["pubspec.yaml", "dart"], ["build.zig", "zig"], ["Package.swift", "swift"], ["Gemfile", "ruby"], ["mix.exs", "elixir"], ["build.sbt", "scala"],
    ["cpanfile", "perl"], ["project.godot", "gdscript"], ["main.tf", "terraform"], ["ols.json", "odin"],
  ])("recognises %s without Kiwi metadata", (manifest, language) => {
    fs.writeFileSync(path.join(parent, manifest), "");
    expect(detectPolyglotProject(parent)?.language).toBe(language);
  });

  it("keeps Java Maven, Java Gradle and plain Java projects on the Java path", () => {
    fs.writeFileSync(path.join(parent, "pom.xml"), "<project />");
    expect(detectPolyglotProject(parent)).toBeNull();
    fs.unlinkSync(path.join(parent, "pom.xml"));
    fs.writeFileSync(path.join(parent, "build.gradle.kts"), "plugins { java }");
    expect(detectPolyglotProject(parent)).toBeNull();
    fs.unlinkSync(path.join(parent, "build.gradle.kts"));
    fs.mkdirSync(path.join(parent, "src"));
    fs.writeFileSync(path.join(parent, "src", "Main.java"), "class Main {}");
    fs.writeFileSync(path.join(parent, "helper.py"), "print('helper')");
    expect(detectPolyglotProject(parent)).toBeNull();
  });

  it("recognises Kotlin-only Gradle and honours the active language in a mixed repository", () => {
    fs.writeFileSync(path.join(parent, "build.gradle.kts"), 'plugins { kotlin("jvm") version "2.4.21" }');
    expect(detectPolyglotProject(parent)?.language).toBe("kotlin");
    const python = path.join(parent, "helper.py");
    fs.writeFileSync(python, "print('helper')");
    expect(service.detect(parent, python)?.language).toBe("python");
  });
});

describe("language-aware command plans", () => {
  it("starts PHP web development only on loopback and serves the public directory", async () => {
    const project = await create("php");
    const plan = await service.plan({ root: project.root, action: "run" });
    expect(plan.url).toBe("http://127.0.0.1:8000");
    expect(plan.steps[0].args).toEqual(["-S", "127.0.0.1:8000", "-t", path.join(project.root, "public")]);
  });

  it("uses the project's Python virtual environment and isolated bytecode output", async () => {
    const project = await create("python");
    const python = path.join(project.root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    fs.mkdirSync(path.dirname(python), { recursive: true });
    fs.writeFileSync(python, "");
    const plan = await service.plan({ root: project.root, action: "build" });
    expect(plan.steps[0].command).toBe(python);
    expect(plan.steps[0].env.PYTHONPYCACHEPREFIX).toBe(path.join(project.root, ".kiwi", "build", "python-cache"));
    expect(plan.steps[0].args.slice(0, 4)).toEqual(["-m", "compileall", "-f", "-q"]);
    expect(plan.steps[0].args).toContain(project.mainFile);
    expect(Object.keys(plan.steps[0].env).sort()).toEqual(["PYTHONPYCACHEPREFIX", "PYTHONUNBUFFERED"]);
  });

  it("uses Cargo and Go package commands instead of treating each file as standalone", async () => {
    const rust = await create("rust");
    const go = await create("go");
    expect((await service.plan({ root: rust.root, action: "test" })).steps[0].args).toEqual(["test"]);
    expect((await service.plan({ root: go.root, action: "build" })).steps[0].args).toEqual(["build", "./..."]);
  });

  it("runs the project's entry point when a README is the active editor", async () => {
    const project = await create("python");
    const plan = await service.plan({ root: project.root, file: path.join(project.root, "README.md"), action: "run", language: "python" });
    expect(plan.steps[0].args).toEqual([project.mainFile]);
  });

  it("does not execute a Kotlin script when Build was requested", async () => {
    const file = path.join(parent, "example.kts");
    fs.writeFileSync(file, "println(42)");
    await expect(service.plan({ root: parent, file, action: "build" })).rejects.toThrow(/Kotlin-Skripte/);
    expect((await service.plan({ root: parent, file, action: "run" })).steps[0].args).toEqual(["-script", file]);
  });

  it("builds standalone Go files without requiring a nonexistent module", async () => {
    const file = path.join(parent, "main.go");
    fs.writeFileSync(file, "package main\nfunc main() {}\n");
    const plan = await service.plan({ root: parent, file, action: "build" });
    expect(plan.steps[0].args).toContain(file);
    expect(plan.steps[0].args).not.toContain("./...");
    expect(plan.steps[0].args.slice(0, 2)).toEqual(["build", "-o"]);
  });

  it("keeps source filenames with spaces as one compiler argument", async () => {
    const file = path.join(parent, "my source.c");
    fs.writeFileSync(file, "int main(void) { return 0; }");
    const plan = await service.plan({ root: parent, file, action: "build" });
    expect(plan.steps[0].args[0]).toBe(file);
    expect(plan.steps[0].args).toHaveLength(3);
    await expect(service.plan({ root: parent, file: path.join(parent, "..", "outside.py"), action: "run" })).rejects.toThrow();
  });
});

class Child extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { end: vi.fn() };
  pid = 1234;
  exitCode = null;
}

describe("polyglot process lifecycle", () => {
  it("streams output and does not execute a second step after a signalled compiler exit", async () => {
    const project = await create("kotlin");
    const children: Child[] = [];
    const events: Array<{ channel: string; payload: { code?: number; text?: string } }> = [];
    service = new PolyglotProjectService(guard, {
      spawnImpl: () => { const child = new Child(); children.push(child); return child; },
      send: (channel: string, payload: { code?: number; text?: string }) => events.push({ channel, payload }),
    });
    expect(await service.execute({ root: project.root, action: "run" })).toMatchObject({ started: true, language: "kotlin" });
    children[0].stdout.emit("data", Buffer.from("compiler output\n"));
    children[0].emit("close", null, "SIGTERM");
    await vi.waitFor(() => expect(events.some((event) => event.channel === "polyglot:exit" && event.payload.code === 1)).toBe(true));
    expect(children).toHaveLength(1);
    expect(events.some((event) => event.payload.text === "compiler output\n")).toBe(true);
  });

  it("claims the project before awaiting a plan and terminates its child on Stop", async () => {
    const project = await create("python");
    let child: Child;
    const terminate = vi.fn(async (running: Child) => { running.emit("close", null, "SIGTERM"); return true; });
    service = new PolyglotProjectService(guard, { spawnImpl: () => { child = new Child(); return child; }, terminateImpl: terminate });
    const first = service.execute({ root: project.root, action: "run" });
    await expect(service.execute({ root: project.root, action: "run" })).rejects.toThrow(/bereits/);
    await first;
    await service.stop(project.root);
    expect(terminate).toHaveBeenCalledWith(child!);
    expect(service.running.size).toBe(0);
  });

  it("reports a missing runtime as failure and allows a subsequent retry", async () => {
    const project = await create("python");
    let child: Child;
    const events: Array<{ channel: string; payload: { code?: number; text?: string } }> = [];
    service = new PolyglotProjectService(guard, { spawnImpl: () => { child = new Child(); return child; }, send: (channel: string, payload: { code?: number; text?: string }) => events.push({ channel, payload }) });
    await service.execute({ root: project.root, action: "run" });
    child!.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
    await vi.waitFor(() => expect(service.running.size).toBe(0));
    expect(events.some((event) => event.payload.text?.includes("Compiler oder Interpreter nicht gefunden"))).toBe(true);
    expect(events.filter((event) => event.channel === "polyglot:exit")).toHaveLength(1);
    await service.execute({ root: project.root, action: "run" });
    child!.emit("close", 0);
    await vi.waitFor(() => expect(service.running.size).toBe(0));
  });

  it("creates extensive project templates across Python, Web, Go, Rust, and C#", async () => {
    const fastapi = await create("python", { name: "fastapi-app", template: "fastapi" });
    expect(fs.existsSync(path.join(fastapi.root, "app.py"))).toBe(true);
    expect(fs.readFileSync(path.join(fastapi.root, "app.py"), "utf8")).toContain("FastAPI");
    expect(fs.readFileSync(path.join(fastapi.root, "requirements.txt"), "utf8")).toContain("uvicorn");

    const datascience = await create("python", { name: "ds-app", template: "datascience" });
    expect(fs.existsSync(path.join(datascience.root, "analysis.py"))).toBe(true);
    expect(fs.existsSync(path.join(datascience.root, "data", "sample.csv"))).toBe(true);

    const phpRest = await create("php", { name: "php-api", template: "rest" });
    expect(fs.existsSync(path.join(phpRest.root, "public", "index.php"))).toBe(true);
    expect(fs.readFileSync(path.join(phpRest.root, "public", "index.php"), "utf8")).toContain("application/json");

    const goRest = await create("go", { name: "go-api", template: "rest" });
    expect(fs.existsSync(path.join(goRest.root, "main.go"))).toBe(true);
    expect(fs.readFileSync(path.join(goRest.root, "main.go"), "utf8")).toContain("net/http");

    const rustLib = await create("rust", { name: "rust-lib", template: "library" });
    expect(fs.existsSync(path.join(rustLib.root, "src", "lib.rs"))).toBe(true);

    const csharpWeb = await create("csharp", { name: "cs-api", template: "webapi" });
    expect(fs.existsSync(path.join(csharpWeb.root, "cs-api.csproj"))).toBe(true);
    expect(fs.readFileSync(path.join(csharpWeb.root, "cs-api.csproj"), "utf8")).toContain("Microsoft.NET.Sdk.Web");

    const gitProject = await create("python", { name: "git-app", initGit: true });
    expect(fs.existsSync(path.join(gitProject.root, ".git"))).toBe(true);
  });

  it("plans debug action with inspection flags for TypeScript, Node, and Python", async () => {
    service = new PolyglotProjectService(guard);
    const tsProj = await create("typescript", { name: "ts-debug" });
    const tsPlan = await service.plan({ root: tsProj.root, action: "debug" });
    expect(tsPlan.steps[0].args).toContain("--inspect=0");

    const pyProj = await create("python", { name: "py-debug" });
    const pyPlan = await service.plan({ root: pyProj.root, action: "debug" });
    expect(pyPlan.steps[0].args).toContain("-m");
    expect(pyPlan.steps[0].args).toContain("pdb");
  });

  it("plans run, build, test, and clean actions for all new languages", async () => {
    service = new PolyglotProjectService(guard);

    // Dart
    const dart = await create("dart", { name: "dart-test-proj" });
    const dartRun = await service.plan({ root: dart.root, action: "run" });
    expect(dartRun.steps[0].args).toContain("run");
    const dartBuild = await service.plan({ root: dart.root, action: "build" });
    expect(dartBuild.steps[0].args).toContain("compile");
    const dartTest = await service.plan({ root: dart.root, action: "test" });
    expect(dartTest.steps[0].args).toContain("test");

    // Zig
    const zig = await create("zig", { name: "zig-test-proj" });
    const zigRun = await service.plan({ root: zig.root, action: "run" });
    expect(zigRun.steps[0].args).toEqual(["build", "run"]);
    const zigBuild = await service.plan({ root: zig.root, action: "build" });
    expect(zigBuild.steps[0].args).toEqual(["build"]);
    const zigTest = await service.plan({ root: zig.root, action: "test" });
    expect(zigTest.steps[0].args).toEqual(["build", "test"]);

    // Swift
    const swift = await create("swift", { name: "swift-test-proj" });
    const swiftRun = await service.plan({ root: swift.root, action: "run" });
    expect(swiftRun.steps[0].args).toEqual(["run"]);
    const swiftBuild = await service.plan({ root: swift.root, action: "build" });
    expect(swiftBuild.steps[0].args).toEqual(["build"]);
    const swiftTest = await service.plan({ root: swift.root, action: "test" });
    expect(swiftTest.steps[0].args).toEqual(["test"]);

    // Ruby
    const ruby = await create("ruby", { name: "ruby-test-proj" });
    const rubyRun = await service.plan({ root: ruby.root, action: "run" });
    expect(rubyRun.steps[0].args[0]).toContain("main.rb");
    const rubyTest = await service.plan({ root: ruby.root, action: "test" });
    expect(rubyTest.steps[0].args).toContain("exec");

    // Elixir
    const elixir = await create("elixir", { name: "elixir-test-proj" });
    const elixirRun = await service.plan({ root: elixir.root, action: "run" });
    expect(elixirRun.steps[0].args).toEqual(["run"]);
    const elixirBuild = await service.plan({ root: elixir.root, action: "build" });
    expect(elixirBuild.steps[0].args).toEqual(["compile"]);

    // R
    const r = await create("r", { name: "r-test-proj" });
    const rRun = await service.plan({ root: r.root, action: "run" });
    expect(rRun.steps[0].args[0]).toContain("main.R");

    // Scala
    const scala = await create("scala", { name: "scala-test-proj" });
    const scalaRun = await service.plan({ root: scala.root, action: "run" });
    expect(scalaRun.steps[0].args).toEqual(["run"]);
    const scalaBuild = await service.plan({ root: scala.root, action: "build" });
    expect(scalaBuild.steps[0].args).toEqual(["compile"]);

    // Shell
    const shell = await create("shell", { name: "shell-test-proj" });
    const shellRun = await service.plan({ root: shell.root, action: "run" });
    expect(shellRun.steps[0].args[0]).toContain("main.sh");

    // PowerShell
    const pwsh = await create("powershell", { name: "pwsh-test-proj" });
    const pwshRun = await service.plan({ root: pwsh.root, action: "run" });
    expect(pwshRun.steps[0].args).toContain("-File");

    // Perl
    const perl = await create("perl", { name: "perl-test-proj" });
    const perlRun = await service.plan({ root: perl.root, action: "run" });
    expect(perlRun.steps[0].args[0]).toContain("main.pl");
    const perlBuild = await service.plan({ root: perl.root, action: "build" });
    expect(perlBuild.steps[0].args).toContain("-c");
    const perlTest = await service.plan({ root: perl.root, action: "test" });
    expect(perlTest.steps[0].args).toEqual(["-l", "t"]);

    // GDScript
    const gd = await create("gdscript", { name: "gd-test-proj" });
    const gdRun = await service.plan({ root: gd.root, action: "run" });
    expect(gdRun.steps[0].args).toContain("--headless");
    const gdBuild = await service.plan({ root: gd.root, action: "build" });
    expect(gdBuild.steps[0].args).toContain("--check-only");

    // SQL
    const sqlProj = await create("sql", { name: "sql-test-proj" });
    const sqlRun = await service.plan({ root: sqlProj.root, action: "run" });
    expect(sqlRun.steps[0].args).toContain(":memory:");

    // Terraform
    const tfProj = await create("terraform", { name: "tf-test-proj" });
    const tfRun = await service.plan({ root: tfProj.root, action: "run" });
    expect(tfRun.steps[0].args).toContain("plan");
    const tfBuild = await service.plan({ root: tfProj.root, action: "build" });
    expect(tfBuild.steps[0].args).toContain("validate");

    // Assembly
    const asmProj = await create("assembly", { name: "asm-test-proj" });
    const asmBuild = await service.plan({ root: asmProj.root, action: "build" });
    expect(asmBuild.steps[0].args).toContain("-f");

    // AutoHotkey
    const ahkProj = await create("autohotkey", { name: "ahk-test-proj" });
    const ahkRun = await service.plan({ root: ahkProj.root, action: "run" });
    expect(ahkRun.steps[0].args[0]).toContain("main.ahk");

    // Odin
    const odinProj = await create("odin", { name: "odin-test-proj" });
    const odinRun = await service.plan({ root: odinProj.root, action: "run" });
    expect(odinRun.steps[0].args).toContain("run");
    const odinBuild = await service.plan({ root: odinProj.root, action: "build" });
    expect(odinBuild.steps[0].args).toContain("build");

    // Clean for new languages
    for (const lang of ["dart", "zig", "swift", "ruby", "elixir", "r", "scala", "shell", "powershell", "perl", "gdscript", "sql", "terraform", "assembly", "autohotkey", "odin"]) {
      const p = await create(lang, { name: `clean-${lang}` });
      const cleanPlan = await service.plan({ root: p.root, action: "clean" });
      expect(cleanPlan.steps[0].internal).toBe("clean");
    }

    expect(languageForFile("main.py")).toBe("python");
    expect(languageForFile("App.tsx")).toBe("typescript");
    expect(languageForFile("index.js")).toBe("javascript");
    const files = projectFiles("typescript", "demo-ts", true);
    expect(files["src/index.ts"]).toContain("Hello");
  });
});
