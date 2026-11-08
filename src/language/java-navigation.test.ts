import { describe, expect, it } from "vitest";
import type { ModuleInfo } from "../types";
import { groupJavaUsageLocations, hierarchyNodesFromResponse, matchesNavigationScope, pathFromJavaUri } from "./java-navigation";

const moduleInfo: ModuleInfo = {
  id: "app",
  name: "app",
  root: "C:\\project\\app",
  projectRoot: "C:\\project",
  relativePath: "app",
  buildSystem: "Maven",
  sourceRoots: ["C:\\project\\app\\src\\main\\java"],
  testRoots: ["C:\\project\\app\\src\\test\\java"],
  resourceRoots: [],
  testResourceRoots: [],
  outputPath: "C:\\project\\app\\build",
  dependencies: [],
  jdkPath: "",
  languageLevel: "21",
  descriptorPath: null,
  jpms: null,
};

describe("Java navigation model", () => {
  it("normalises Windows file URIs without damaging encoded names", () => {
    expect(pathFromJavaUri("file:///C:/project/app/src/main/java/de/demo/My%20Type.java"))
      .toBe("C:\\project\\app\\src\\main\\java\\de\\demo\\My Type.java");
  });

  it("maps incoming and outgoing call relations to navigable hierarchy nodes", () => {
    const item = {
      name: "run",
      uri: "file:///C:/project/app/src/main/java/de/demo/Main.java",
      range: { start: { line: 4, character: 2 }, end: { line: 8, character: 3 } },
      selectionRange: { start: { line: 4, character: 7 }, end: { line: 4, character: 10 } },
    };
    expect(hierarchyNodesFromResponse([{ from: item }], "incoming")[0]).toMatchObject({ item, direction: "incoming" });
    expect(hierarchyNodesFromResponse([{ to: item }], "outgoing")[0]).toMatchObject({ item, direction: "outgoing" });
  });

  it("filters independently by module and production/test source roots", () => {
    const production = "C:\\project\\app\\src\\main\\java\\de\\demo\\Main.java";
    const test = "C:\\project\\app\\src\\test\\java\\de\\demo\\MainTest.java";
    expect(matchesNavigationScope(production, "C:\\project", [moduleInfo], { moduleId: "app", includeProduction: true, includeTests: false })).toBe(true);
    expect(matchesNavigationScope(test, "C:\\project", [moduleInfo], { moduleId: "app", includeProduction: true, includeTests: false })).toBe(false);
    expect(matchesNavigationScope(test, "C:\\project", [moduleInfo], { moduleId: null, includeProduction: false, includeTests: true })).toBe(true);
  });

  it("groups references by Java package and file and keeps source previews", () => {
    const main = "C:\\project\\app\\src\\main\\java\\de\\demo\\Main.java";
    const helper = "C:\\project\\app\\src\\main\\java\\de\\demo\\Helper.java";
    const locations = [
      { uri: "file:///C:/project/app/src/main/java/de/demo/Main.java", range: { start: { line: 1, character: 4 }, end: { line: 1, character: 8 } } },
      { uri: "file:///C:/project/app/src/main/java/de/demo/Helper.java", range: { start: { line: 2, character: 2 }, end: { line: 2, character: 6 } } },
    ];
    const contents = new Map([
      [main, "class Main {\n    run();\n}"],
      [helper, "class Helper {\n  void call() {\n  run();\n  }\n}"],
    ]);
    const groups = groupJavaUsageLocations(locations, contents, "C:\\project", [moduleInfo]);
    expect(groups).toHaveLength(1);
    expect(groups[0].packageName).toBe("de.demo");
    expect(groups[0].count).toBe(2);
    expect(groups[0].files.map((file) => file.name)).toEqual(["Helper.java", "Main.java"]);
    expect(groups[0].files[1].usages[0].preview).toBe("run();");
  });
});
