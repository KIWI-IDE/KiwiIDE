import { describe, expect, it } from "vitest";
import type { ModuleInfo, ProjectTask } from "../types";
import { branchKey, buildProjectNodes, taskGroupKey, usefulConfigurations } from "./build-tree";

function module(name: string, relativePath: string): ModuleInfo {
  return {
    id: name,
    name,
    root: `C:/build/${relativePath}`,
    projectRoot: "C:/build",
    relativePath,
    buildSystem: "Gradle",
    sourceRoots: [],
    testRoots: [],
    resourceRoots: [],
    testResourceRoots: [],
    outputPath: "",
    dependencies: [],
    jdkPath: "",
    languageLevel: "",
    descriptorPath: null,
    jpms: null,
  };
}

function task(name: string, group: string): ProjectTask {
  return { name, description: "", group };
}

describe("the projects of a build", () => {
  const modules = [
    module("leafcloudservice", "."),
    module("leafcloud-api", "leafcloud-api"),
    module("leafcloud-runner", "leafcloud-runner"),
  ];

  it("lists the root first and the subprojects beside it", () => {
    const nodes = buildProjectNodes(modules, [], "leafcloudservice");
    expect(nodes.map((node) => node.name)).toEqual(["leafcloudservice", "leafcloud-api", "leafcloud-runner"]);
    expect(nodes.map((node) => node.taskPath)).toEqual(["", "leafcloud-api", "leafcloud-runner"]);
    expect(nodes.filter((node) => node.isRoot)).toHaveLength(1);
  });

  it("names a root even when no module list arrived", () => {
    const nodes = buildProjectNodes([], [], "leafcloudservice");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ name: "leafcloudservice", taskPath: "", isRoot: true });
  });

  it("adds the projects only the task list mentions", () => {
    // A settings file the module service could not read leaves the subprojects
    // out, and their tasks would then have nowhere to be shown.
    const nodes = buildProjectNodes([module("leafcloudservice", ".")], [
      task("leafcloud-driver:build", "Build"),
      task("leafcloud-driver:test", "Verification"),
    ], "leafcloudservice");
    expect(nodes.map((node) => node.name)).toEqual(["leafcloudservice", "leafcloud-driver"]);
    expect(nodes[1].relativePath).toBe("leafcloud-driver");
  });

  it("names a nested project by its last segment and keeps its path", () => {
    const nodes = buildProjectNodes([], [task("dienste:web:build", "Build")], "wurzel");
    expect(nodes[1]).toMatchObject({ name: "web", taskPath: "dienste:web", relativePath: "dienste/web" });
  });

  it("never lists the same project twice", () => {
    const nodes = buildProjectNodes(modules, [
      task("leafcloud-api:build", "Build"),
      task("leafcloud-api:test", "Verification"),
    ], "leafcloudservice");
    expect(nodes.filter((node) => node.taskPath === "leafcloud-api")).toHaveLength(1);
  });
});

describe("which dependency configurations get a line", () => {
  it("keeps the ones that resolve to something", () => {
    const configurations = [
      { name: "compileClasspath", nodes: [] },
      { name: "testCompileClasspath", nodes: [{}] },
      { name: "testRuntimeClasspath", nodes: [{}, {}] },
    ];
    expect(usefulConfigurations(configurations).map((entry) => entry.name))
      .toEqual(["testCompileClasspath", "testRuntimeClasspath"]);
  });

  it("survives a configuration that reported no list at all", () => {
    expect(usefulConfigurations([{ name: "default" }])).toEqual([]);
  });
});

describe("remembering what is expanded", () => {
  it("tells two projects' branches of the same name apart", () => {
    expect(branchKey("leafcloud-api", "tasks")).not.toBe(branchKey("leafcloud-runner", "tasks"));
    expect(branchKey("a", "tasks", "Build")).not.toBe(branchKey("a", "tasks", "Verification"));
  });

  it("keys a task group by its project as well as its name", () => {
    // "Build" exists in every project of a multi-project build. Expand-all
    // stored bare group names while the tree looked them up by project, so the
    // button opened nothing at all.
    expect(taskGroupKey("leafcloud-api", "Build")).not.toBe(taskGroupKey("leafcloud-runner", "Build"));
    expect(taskGroupKey("", "Build")).not.toBe(taskGroupKey("", "Verifikation"));
    expect(taskGroupKey("api", "Build")).not.toBe(branchKey("api", "tasks"));
  });
});
