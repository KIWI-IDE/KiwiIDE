import type { ModuleInfo } from "../types";
import { isPathWithin } from "../utils";

/**
 * Finds the module whose configured source set owns a Java file.
 *
 * Project-root containment alone is not enough: a plain project can have both
 * `src/Foo.java` and a conventional `src/main/java` module. Assigning Foo to
 * that module excludes it from javac and leaves no class for the debugger.
 */
export function findDebugModule(file: string, modules: readonly ModuleInfo[]): ModuleInfo | undefined {
  return modules
    .filter((module) => {
      const sourceRoots = [...(module.sourceRoots || []), ...(module.testRoots || [])];
      return sourceRoots.some((sourceRoot) => isPathWithin(file, sourceRoot))
        || (!sourceRoots.length && module.relativePath !== "." && isPathWithin(file, module.root));
    })
    .sort((left, right) => right.root.length - left.root.length)[0];
}
