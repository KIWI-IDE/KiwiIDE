import type { ModuleInfo, ProjectTask } from "../types";
import { moduleTaskPath, taskProjectPath } from "../utils";

/**
 * One node of the build tool window, the way Gradle and Maven describe a build.
 *
 * A multi-project build is a list of peers, not a nesting: `settings.gradle`
 * names the subprojects and every one of them owns its tasks, its dependencies
 * and nothing of anybody else's. Showing them indented under the root said the
 * opposite — that a subproject's tasks belong to the root — and made the tree
 * two levels deeper than the build actually is.
 */
export interface BuildProjectNode {
  /** The module id, and the key everything expanded is remembered under. */
  id: string;
  name: string;
  /** How Gradle addresses this project's tasks: "" for the root, else "api". */
  taskPath: string;
  /** Relative to the workspace, "." for the root. */
  relativePath: string;
  isRoot: boolean;
}

/**
 * The projects of a build, root first and subprojects after it, all as peers.
 *
 * Modules come from the module service, which reads `settings.gradle` and the
 * aggregator pom. A build whose tasks name projects the module service missed
 * still gets those projects listed, because a task nobody can see is a task
 * nobody can run.
 */
export function buildProjectNodes(
  modules: ModuleInfo[],
  tasks: ProjectTask[],
  rootName: string,
): BuildProjectNode[] {
  const nodes: BuildProjectNode[] = [];
  const seen = new Set<string>();
  const add = (node: BuildProjectNode) => {
    if (seen.has(node.taskPath)) return;
    seen.add(node.taskPath);
    nodes.push(node);
  };

  const root = modules.find((module) => moduleTaskPath(module.relativePath) === "");
  add({
    id: root?.id || "",
    name: root?.name || rootName,
    taskPath: "",
    relativePath: ".",
    isRoot: true,
  });
  for (const module of modules) {
    const taskPath = moduleTaskPath(module.relativePath);
    if (!taskPath) continue;
    add({ id: module.id, name: module.name, taskPath, relativePath: module.relativePath, isRoot: false });
  }
  // Projects only the task list mentions. `gradle tasks --all` names every one
  // of them, so a build whose settings file the module service could not read
  // still shows up complete rather than as a root with everything missing.
  for (const task of tasks) {
    const taskPath = taskProjectPath(task.name);
    if (!taskPath || seen.has(taskPath)) continue;
    add({
      id: taskPath,
      name: taskPath.split(":").at(-1) || taskPath,
      taskPath,
      relativePath: taskPath.replace(/:/g, "/"),
      isRoot: false,
    });
  }
  return nodes;
}

/**
 * Whether a dependency configuration is worth a line in the tree.
 *
 * Gradle reports every configuration a plugin declares, most of them empty for
 * any given project, and listing all fifteen buries the two that resolve to
 * something. IntelliJ shows the ones that have contents; so does this.
 */
export function usefulConfigurations<T extends { name: string; nodes?: unknown[] }>(configurations: T[]): T[] {
  return configurations.filter((configuration) => (configuration.nodes || []).length > 0);
}

/** The key an expanded branch is remembered under, unique across projects. */
export function branchKey(projectId: string, branch: string, detail = ""): string {
  return [projectId, branch, detail].join(" ");
}

/**
 * The key one task group is remembered under.
 *
 * The project is part of it because "Build" exists in every project of a
 * multi-project build, and a key that was only the group name would open all
 * of them at once. Expand-all built its keys the other way and so opened
 * nothing at all.
 */
export function taskGroupKey(projectId: string, group: string): string {
  return branchKey(projectId, "group", group);
}
