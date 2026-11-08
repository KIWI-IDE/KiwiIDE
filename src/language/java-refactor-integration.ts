import type { ModuleInfo } from "../types";

export interface ExplorerMoveEntry {
  path: string;
  type: "file" | "directory";
}

export interface SafeJavaMoveRequest {
  sourcePath: string;
  targetModuleId: string;
  targetPackage?: string;
  targetSourceRoot: string;
  targetKind: "production" | "test";
}

export type CrossModuleMoveResolution =
  | { kind: "none" }
  | { kind: "blocked"; message: string }
  | { kind: "preview"; request: SafeJavaMoveRequest };

const normalPath = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();

function pathWithin(candidate: string, parent: string) {
  const child = normalPath(candidate);
  const root = normalPath(parent);
  return child === root || child.startsWith(`${root}/`);
}

function moduleForPath(candidate: string, modules: ModuleInfo[]) {
  return modules
    .filter((module) => pathWithin(candidate, module.root))
    .sort((left, right) => right.root.length - left.root.length)[0] || null;
}

/**
 * Decides whether an Explorer move can remain a filesystem operation or must
 * become a semantic Java refactoring. Used by both paste and drag-and-drop so
 * the two entry points cannot drift apart again.
 */
export function resolveCrossModuleJavaMove(
  entries: ExplorerMoveEntry[],
  targetDirectory: string,
  modules: ModuleInfo[],
): CrossModuleMoveResolution {
  const targetModule = moduleForPath(targetDirectory, modules);
  if (!targetModule) return { kind: "none" };
  const crossModule = entries
    .map((entry) => ({ entry, sourceModule: moduleForPath(entry.path, modules) }))
    .filter(({ sourceModule }) => sourceModule && sourceModule.id !== targetModule.id);
  if (!crossModule.length) return { kind: "none" };
  if (crossModule.some(({ entry }) => entry.type === "directory")) {
    return {
      kind: "blocked",
      message: "Packages und Ordner mit Java-Quellen können nicht unsicher zwischen Modulen verschoben werden. Verschiebe die Klassen einzeln.",
    };
  }
  const javaEntries = crossModule.filter(({ entry }) => /\.java$/i.test(entry.path));
  if (!javaEntries.length) return { kind: "none" };
  if (entries.length !== 1 || javaEntries.length !== 1) {
    return {
      kind: "blocked",
      message: "Verschiebe Java-Klassen zwischen Modulen einzeln, damit jede Abhängigkeit sicher geprüft werden kann.",
    };
  }
  const { entry, sourceModule } = javaEntries[0];
  const sourceIsTest = sourceModule!.testRoots.some((root) => pathWithin(entry.path, root));
  const preferredRoots = sourceIsTest ? targetModule.testRoots : targetModule.sourceRoots;
  const allTargetRoots = [...targetModule.sourceRoots, ...targetModule.testRoots];
  const targetSourceRoot = allTargetRoots
    .filter((root) => pathWithin(targetDirectory, root))
    .sort((left, right) => right.length - left.length)[0] || preferredRoots[0];
  if (!targetSourceRoot) {
    return { kind: "blocked", message: "Das Zielmodul besitzt keinen passenden Java-Source-Root." };
  }
  const targetIsTest = targetModule.testRoots.some((root) => normalPath(root) === normalPath(targetSourceRoot));
  const targetPackage = pathWithin(targetDirectory, targetSourceRoot)
    ? targetDirectory
      .slice(targetSourceRoot.replace(/[\\/]$/, "").length)
      .replace(/^[\\/]+/, "")
      .replace(/[\\/]+/g, ".")
      .replace(/^\.+|\.+$/g, "")
    : undefined;
  return {
    kind: "preview",
    request: {
      sourcePath: entry.path,
      targetModuleId: targetModule.id,
      targetSourceRoot,
      targetPackage,
      targetKind: targetIsTest ? "test" : "production",
    },
  };
}
