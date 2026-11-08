import { describe, expect, it } from "vitest";
import type { ModuleInfo } from "../types";
import { resolveCrossModuleJavaMove } from "./java-refactor-integration";

function module(id: string, root: string): ModuleInfo {
  return {
    id,
    name: id,
    root,
    projectRoot: "C:\\project",
    relativePath: id,
    buildSystem: "Gradle",
    sourceRoots: [`${root}\\src\\main\\java`],
    testRoots: [`${root}\\src\\test\\java`],
    resourceRoots: [],
    testResourceRoots: [],
    outputPath: `${root}\\build\\classes`,
    dependencies: [],
    jdkPath: "",
    languageLevel: "21",
    descriptorPath: null,
    jpms: null,
  };
}

describe("Explorer Java refactoring routing", () => {
  const modules = [
    module("core", "C:\\project\\core"),
    module("api", "C:\\project\\api"),
  ];

  it("routes a cross-module Java class move to a semantic preview", () => {
    expect(resolveCrossModuleJavaMove([
      { path: "C:\\project\\core\\src\\main\\java\\dev\\old\\Service.java", type: "file" },
    ], "C:\\project\\api\\src\\main\\java\\dev\\api", modules)).toEqual({
      kind: "preview",
      request: {
        sourcePath: "C:\\project\\core\\src\\main\\java\\dev\\old\\Service.java",
        targetModuleId: "api",
        targetSourceRoot: "C:\\project\\api\\src\\main\\java",
        targetPackage: "dev.api",
        targetKind: "production",
      },
    });
  });

  it("preserves the package when dropped on the module root", () => {
    const result = resolveCrossModuleJavaMove([
      { path: "C:\\project\\core\\src\\main\\java\\dev\\old\\Service.java", type: "file" },
    ], "C:\\project\\api", modules);
    expect(result).toMatchObject({
      kind: "preview",
      request: { targetSourceRoot: "C:\\project\\api\\src\\main\\java", targetPackage: undefined },
    });
  });

  it("blocks package folders and multi-selection instead of bypassing semantic refactoring", () => {
    expect(resolveCrossModuleJavaMove([
      { path: "C:\\project\\core\\src\\main\\java\\dev\\old", type: "directory" },
    ], "C:\\project\\api", modules)).toMatchObject({ kind: "blocked" });
    expect(resolveCrossModuleJavaMove([
      { path: "C:\\project\\core\\src\\main\\java\\dev\\A.java", type: "file" },
      { path: "C:\\project\\core\\src\\main\\java\\dev\\B.java", type: "file" },
    ], "C:\\project\\api", modules)).toMatchObject({ kind: "blocked" });
  });

  it("keeps same-module and non-Java moves as normal filesystem operations", () => {
    expect(resolveCrossModuleJavaMove([
      { path: "C:\\project\\core\\src\\main\\java\\dev\\Service.java", type: "file" },
    ], "C:\\project\\core\\src\\main\\java\\other", modules)).toEqual({ kind: "none" });
    expect(resolveCrossModuleJavaMove([
      { path: "C:\\project\\core\\README.md", type: "file" },
    ], "C:\\project\\api", modules)).toEqual({ kind: "none" });
  });
});
