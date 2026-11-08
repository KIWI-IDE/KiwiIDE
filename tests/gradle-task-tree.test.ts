import { describe, expect, it } from "vitest";
import { moduleTaskPath, taskProjectPath, taskShortName, tasksForProject } from "../src/utils";

const { mergeGradleTasks } = require("../electron/services/build-service.cjs");

/**
 * How the Gradle tool window divides a multi-project build.
 *
 * Every task was listed against every project: the root folder held `assemble`
 * and `honeymc-cloud:assemble` side by side, and opening the module below it
 * showed the whole list a second time. For a build with one subproject that is
 * four entries where there are two tasks.
 */
describe("which project a task belongs to", () => {
  it("reads the project out of the task's name", () => {
    expect(taskProjectPath("assemble")).toBe("");
    expect(taskProjectPath("honeymc-cloud:shadowJar")).toBe("honeymc-cloud");
    expect(taskProjectPath(":honeymc-cloud:shadowJar")).toBe("honeymc-cloud");
    expect(taskProjectPath("dienste:web:build")).toBe("dienste:web");
  });

  it("reads the task's own name", () => {
    expect(taskShortName("assemble")).toBe("assemble");
    expect(taskShortName(":honeymc-cloud:shadowJar")).toBe("shadowJar");
    expect(taskShortName("dienste:web:build")).toBe("build");
  });

  it("turns a module's directory into the path Gradle names it by", () => {
    expect(moduleTaskPath("honeymc-cloud")).toBe("honeymc-cloud");
    expect(moduleTaskPath("dienste/web")).toBe("dienste:web");
    expect(moduleTaskPath("dienste\\web")).toBe("dienste:web");
    expect(moduleTaskPath(".")).toBe("");
    expect(moduleTaskPath("")).toBe("");
  });
});

describe("the tasks one project shows", () => {
  const tasks = [
    { name: "assemble" },
    { name: "build" },
    { name: "honeymc-cloud:assemble" },
    { name: "honeymc-cloud:build" },
    { name: ":honeymc-cloud:shadowJar" },
    { name: "honeymc-cloud:shadowJar" },
  ];

  it("gives the root project only its own tasks", () => {
    expect(tasksForProject(tasks, "").map((task) => task.name)).toEqual(["assemble", "build"]);
  });

  it("gives a module only its own tasks", () => {
    expect(tasksForProject(tasks, "honeymc-cloud").map((task) => task.name))
      .toEqual(["honeymc-cloud:assemble", "honeymc-cloud:build", ":honeymc-cloud:shadowJar"]);
  });

  it("names a task once however it was written", () => {
    // `:honeymc-cloud:shadowJar` and `honeymc-cloud:shadowJar` are one task.
    const names = tasksForProject(tasks, "honeymc-cloud").map((task) => taskShortName(task.name));
    expect(names).toEqual([...new Set(names)]);
  });

  it("hands back everything when no task names a project", () => {
    // Maven's lifecycle, and a Gradle build with one project: there is nothing
    // to divide, and every task applies to whichever module it is run for.
    const lifecycle = [{ name: "clean" }, { name: "package" }, { name: "install" }];
    expect(tasksForProject(lifecycle, "")).toEqual(lifecycle);
    expect(tasksForProject(lifecycle, "web")).toEqual(lifecycle);
  });

  it("gives a module nothing when it has no tasks of its own", () => {
    expect(tasksForProject(tasks, "unbekannt")).toEqual([]);
  });
});

describe("merging what Gradle reports with what the build files declare", () => {
  it("keeps a task once when the two spell it differently", () => {
    const merged = mergeGradleTasks(
      [{ name: "honeymc-cloud:shadowJar", description: "gemeldet" }],
      [{ name: ":honeymc-cloud:shadowJar", description: "deklariert" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].description).toBe("gemeldet");
  });

  it("keeps a task the report did not mention", () => {
    const merged = mergeGradleTasks(
      [{ name: "build" }],
      [{ name: ":honeymc-cloud:shadowJar" }],
    );
    expect(merged.map((task: { name: string }) => task.name)).toEqual(["build", ":honeymc-cloud:shadowJar"]);
  });

  it("does not let the declared side repeat itself", () => {
    const merged = mergeGradleTasks([], [{ name: ":a:jar" }, { name: "a:jar" }]);
    expect(merged).toHaveLength(1);
  });
});
