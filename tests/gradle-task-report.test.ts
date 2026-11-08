import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  BuildService,
  gradleIncludedProjects,
  gradleScriptTasks,
  gradleTaskFailureReason,
  mergeGradleTasks,
  parseGradleTasks,
} = require("../electron/services/build-service.cjs");

/** A shortened but faithful `gradle tasks --all` report. */
const report = [
  "> Task :tasks",
  "",
  "------------------------------------------------------------",
  "Tasks runnable from root project 'honeymc-core'",
  "------------------------------------------------------------",
  "",
  "Build tasks",
  "-----------",
  "assemble - Assembles the outputs of this project.",
  "build - Assembles and tests this project.",
  "shadowJar",
  "",
  "Other tasks",
  "-----------",
  "compileJava",
  "compileTestJava",
  "prepareKotlinBuildScriptModel",
  "",
  "BUILD SUCCESSFUL in 3s",
].join("\n");

describe("the task list Gradle prints", () => {
  it("keeps a task that carries no description", () => {
    // Gradle documents very few of the tasks a plugin adds. Requiring the
    // "name - description" shape hid shadowJar and every compile task, and a
    // project whose tasks are all undocumented showed an empty tool window.
    const names = parseGradleTasks(report).map((task: { name: string }) => task.name);
    expect(names).toContain("shadowJar");
    expect(names).toContain("compileJava");
    expect(names).toContain("prepareKotlinBuildScriptModel");
  });

  it("still reads the description where there is one", () => {
    const parsed = parseGradleTasks(report);
    expect(parsed.find((task: { name: string }) => task.name === "build"))
      .toEqual({ name: "build", description: "Assembles and tests this project.", group: "Build" });
    expect(parsed.find((task: { name: string }) => task.name === "shadowJar"))
      .toEqual({ name: "shadowJar", description: "", group: "Build" });
  });

  it("puts a bare name in the group it was printed under", () => {
    const parsed = parseGradleTasks(report);
    const group = (name: string) => parsed.find((task: { name: string }) => task.name === name)?.group;
    expect(group("shadowJar")).toBe("Build");
    expect(group("compileJava")).toBe("Other");
  });

  it("leaves the prose around the list out of it", () => {
    // Everything above the first group heading is a banner, and the line after
    // it is Gradle's own summary.
    const names = parseGradleTasks(report).map((task: { name: string }) => task.name);
    expect(names).not.toContain("Task");
    expect(names.some((name: string) => /^-+$/.test(name))).toBe(false);
    expect(names).not.toContain("BUILD");
  });

  it("names a task once even when Gradle lists it twice", () => {
    const twice = parseGradleTasks([
      "Build tasks",
      "-----------",
      "jar - Assembles a jar archive.",
      "",
      "Other tasks",
      "-----------",
      "jar",
    ].join("\n"));
    expect(twice).toEqual([{ name: "jar", description: "Assembles a jar archive.", group: "Build" }]);
  });

  it("reads nothing out of an empty or failed run", () => {
    expect(parseGradleTasks("")).toEqual([]);
    expect(parseGradleTasks("FAILURE: Build failed with an exception.")).toEqual([]);
  });
});

describe("why the task list is the generic one", () => {
  it("quotes the reason Gradle actually gave", () => {
    // Without this the tool window silently showed the standard lifecycle and
    // the real cause was printed nowhere at all.
    const reason = gradleTaskFailureReason({
      code: 1,
      stderr: [
        "FAILURE: Build failed with an exception.",
        "",
        "* What went wrong:",
        "Plugin [id: 'com.gradleup.shadow', version: '9.0.0-beta4'] was not found",
        "",
        "* Try:",
        "Run with --stacktrace",
      ].join("\n"),
      stdout: "",
    });
    expect(reason).toContain("com.gradleup.shadow");
    expect(reason).not.toContain("* Try:");
  });

  it("falls back to the FAILURE line when there is no explanation", () => {
    expect(gradleTaskFailureReason({ code: 1, stderr: "FAILURE: Build failed with an exception." }))
      .toContain("FAILURE: Build failed with an exception.");
  });

  it("still says something when the run produced no output at all", () => {
    expect(gradleTaskFailureReason({ code: 1, stderr: "", stdout: "" }))
      .toBe("Gradle konnte die Aufgabenliste nicht lesen; die Standardaufgaben werden angezeigt.");
    expect(gradleTaskFailureReason(undefined)).toContain("Standardaufgaben");
  });

  it("keeps the message short enough to read in a log line", () => {
    const reason = gradleTaskFailureReason({ code: 1, stderr: "FAILURE: " + "x".repeat(2_000) });
    expect(reason.length).toBeLessThan(400);
  });
});


describe("what the build file itself says it can do", () => {
  /** The build file from the report, shortened to what matters here. */
  const shadowProject = [
    'plugins {',
    '    id("java")',
    '    id("com.gradleup.shadow") version "9.0.0-beta4"',
    '}',
    '',
    'tasks.shadowJar{',
    '    archiveBaseName.set("Runner")',
    '}',
  ].join("\n");

  it("finds the task a plugin brings without the file ever naming it", () => {
    // A build file says id("com.gradleup.shadow") and never mentions shadowJar
    // again. Reading the plugin block is the only way to know it exists while
    // Gradle itself cannot be asked.
    const names = gradleScriptTasks('plugins { id("com.gradleup.shadow") }').map((task) => task.name);
    expect(names).toContain("shadowJar");
    expect(names).toContain("runShadow");
  });

  it("recognises shadowJar where the project configures it", () => {
    const task = gradleScriptTasks(shadowProject).find((entry) => entry.name === "shadowJar");
    expect(task).toMatchObject({ name: "shadowJar", group: "Build" });
    expect(task.description).toBeTruthy();
  });

  it("puts a plugin's own description ahead of 'configured here'", () => {
    // Both rules match shadowJar in this file, and the plugin knows what it is.
    expect(gradleScriptTasks(shadowProject).find((entry) => entry.name === "shadowJar").description)
      .toContain("Fat-Jar");
  });

  it("reads a task the script registers itself, in either DSL", () => {
    expect(gradleScriptTasks('tasks.register("printVersion") { }').map((task) => task.name))
      .toEqual(["printVersion"]);
    expect(gradleScriptTasks('tasks.register<Jar>("fatJar") { }').map((task) => task.name))
      .toEqual(["fatJar"]);
    expect(gradleScriptTasks('val docsZip by tasks.registering(Zip::class) { }').map((task) => task.name))
      .toEqual(["docsZip"]);
    expect(gradleScriptTasks('task hello {\n    doLast { println "hi" }\n}').map((task) => task.name))
      .toEqual(["hello"]);
  });

  it("does not take a Gradle API call for a task name", () => {
    // tasks.withType, tasks.named and the rest are how tasks are reached, not
    // tasks — offering them would put entries in the list that cannot be run.
    const names = gradleScriptTasks([
      'tasks.withType<JavaCompile>().configureEach { }',
      'tasks.named("test") { }',
      'tasks.matching { it.name.startsWith("x") }.configureEach { }',
    ].join("\n")).map((task) => task.name);
    expect(names).not.toContain("withType");
    expect(names).not.toContain("matching");
    expect(names).not.toContain("named");
    expect(names).toContain("test");
  });

  it("ignores a task that only exists inside a comment", () => {
    const names = gradleScriptTasks([
      '// tasks.register("auskommentiert") { }',
      '/* tasks.register("auchTot") { } */',
      'tasks.register("echt") { }',
    ].join("\n")).map((task) => task.name);
    expect(names).toEqual(["echt"]);
  });

  it("knows what the everyday plugins add", () => {
    const namesFor = (plugin) => gradleScriptTasks(`plugins { id("${plugin}") }`).map((task) => task.name);
    expect(namesFor("org.springframework.boot")).toContain("bootRun");
    expect(namesFor("jacoco")).toContain("jacocoTestReport");
    expect(namesFor("maven-publish")).toContain("publishToMavenLocal");
  });

  it("reads the Kotlin DSL accessors, which take no quotes", () => {
    expect(gradleScriptTasks("plugins {\n    java\n    application\n}").map((task) => task.name))
      .toContain("run");
  });

  it("finds nothing in a file that declares nothing", () => {
    expect(gradleScriptTasks("")).toEqual([]);
    expect(gradleScriptTasks("group = \"de.honeymc\"")).toEqual([]);
  });
});

describe("putting the two sources of tasks together", () => {
  it("keeps what Gradle said and adds only what it did not", () => {
    const merged = mergeGradleTasks(
      [{ name: "build", description: "Assembles and tests this project.", group: "Build" }],
      [
        { name: "build", description: "Im Buildskript konfiguriert", group: "Weitere Tasks" },
        { name: "shadowJar", description: "Fat-Jar", group: "Build" },
      ],
    );
    expect(merged).toEqual([
      { name: "build", description: "Assembles and tests this project.", group: "Build" },
      { name: "shadowJar", description: "Fat-Jar", group: "Build" },
    ]);
  });

  it("survives either side being empty", () => {
    expect(mergeGradleTasks([], [{ name: "a", description: "", group: "x" }]))
      .toEqual([{ name: "a", description: "", group: "x" }]);
    expect(mergeGradleTasks([{ name: "a", description: "", group: "x" }], []))
      .toEqual([{ name: "a", description: "", group: "x" }]);
  });
});


describe("a build that keeps its work in subprojects", () => {
  /**
   * The project from the report, in miniature: a root that declares the
   * plugins and nothing else, and one subproject where the interesting task
   * lives. Reading only the root read the one file that says the least.
   */
  const rootScript = [
    "plugins {",
    "    application",
    "}",
    "",
    "application {",
    '    mainClass = "de.honeymc.honeymcreborn.Main"',
    "}",
  ].join("\n");

  const subScript = [
    "plugins {",
    "    java",
    '        id("com.gradleup.shadow") version "9.0.0-beta4"',
    "}",
    "",
    "dependencies {",
    "    // Source: https://mvnrepository.com/artifact/org.projectlombok/lombok",
    '    implementation("org.projectlombok:lombok:0.11.0")',
    "}",
    "",
    "tasks.shadowJar{",
    '    archiveBaseName.set("honeymc-cloud")',
    "}",
  ].join("\n");

  let root = "";
  const service = () => new BuildService(
    { assertWorkspace: (value: string) => value, assertAllowed: (value: string) => value },
    {},
    { detect: async () => ({ type: "Gradle" }) },
    {},
    () => undefined,
  );

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "kiwi-gradle-multi-"));
    await writeFile(path.join(root, "build.gradle.kts"), rootScript, "utf8");
    await writeFile(path.join(root, "settings.gradle.kts"), 'rootProject.name = "honeymc-reborn"\ninclude(":honeymc-cloud")\n', "utf8");
    await mkdir(path.join(root, "honeymc-cloud"), { recursive: true });
    await writeFile(path.join(root, "honeymc-cloud", "build.gradle.kts"), subScript, "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("reads the projects the settings file declares", () => {
    expect(gradleIncludedProjects('rootProject.name = "x"\ninclude(":honeymc-cloud")')).toEqual(["honeymc-cloud"]);
    expect(gradleIncludedProjects("include ':api', ':runner'")).toEqual(["api", "runner"]);
    expect(gradleIncludedProjects('include(":a:b")')).toEqual(["a:b"]);
  });

  it("ignores an include that only exists in a comment", () => {
    expect(gradleIncludedProjects('// include(":alt")\ninclude(":echt")')).toEqual(["echt"]);
  });

  it("finds the subproject's task, which is the whole point", async () => {
    // shadowJar is declared one directory down. Reading only the root left it
    // out of the tool window entirely, and the task the build exists to
    // produce was the one task nobody could click.
    const tasks = await service().gradleDeclaredTasks(root, rootScript);
    expect(tasks.map((task: { name: string }) => task.name)).toContain(":honeymc-cloud:shadowJar");
  });

  it("names it the way Gradle addresses it", async () => {
    // Running "shadowJar" in a multi-project build means something else than
    // running ":honeymc-cloud:shadowJar".
    const tasks = await service().gradleDeclaredTasks(root, rootScript);
    expect(tasks.map((task: { name: string }) => task.name)).not.toContain("shadowJar");
  });

  it("keeps the root's own tasks alongside", async () => {
    const names = (await service().gradleDeclaredTasks(root, rootScript)).map((task: { name: string }) => task.name);
    expect(names).toContain("installDist");
    expect(names).toContain("run");
  });

  it("refuses a settings entry that points out of the project", async () => {
    // include("../woanders") would otherwise read a build file outside the
    // project that was opened.
    await writeFile(path.join(root, "settings.gradle.kts"), 'include("../woanders")\ninclude(":honeymc-cloud")', "utf8");
    const names = (await service().gradleDeclaredTasks(root, rootScript)).map((task: { name: string }) => task.name);
    expect(names).toContain(":honeymc-cloud:shadowJar");
    expect(names.some((name: string) => name.includes("woanders"))).toBe(false);
  });

  it("survives a project with no settings file at all", async () => {
    await rm(path.join(root, "settings.gradle.kts"));
    const names = (await service().gradleDeclaredTasks(root, rootScript)).map((task: { name: string }) => task.name);
    expect(names).toContain("installDist");
    expect(names.some((name: string) => name.includes("shadowJar"))).toBe(false);
  });

  it("skips a declared project that has no build file", async () => {
    await rm(path.join(root, "honeymc-cloud", "build.gradle.kts"));
    await expect(service().gradleDeclaredTasks(root, rootScript)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "installDist" })]),
    );
  });
});
