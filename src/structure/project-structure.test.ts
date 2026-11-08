import { describe, expect, it } from "vitest";
import { projectStructureProblems } from "./project-structure";
import type { JdkInfo, ModuleInfo, ProjectInfo, ProjectSettings } from "../types";

const jdk = (major: number, path = `C:\\jdk-${major}`): JdkInfo =>
  ({ available: true, version: `${major}.0.1`, major, path });

const project = (patch: Partial<ProjectInfo> = {}): ProjectInfo =>
  ({ type: "Maven", buildFile: "pom.xml", javaVersion: "21", jdkMajor: 21, ...patch });

const settings = (patch: Partial<ProjectSettings> = {}): ProjectSettings => ({
  jdkPath: "", languageLevel: "21", encoding: "UTF-8", compilerArgs: "",
  mavenOffline: false, gradleOffline: false, annotationProcessing: true,
  generatedSources: true, lombokSupport: false, unusedAnalysis: true,
  previewFeatures: false, autoSyncBuild: true, preferWrapper: true,
  parallelBuilds: false, cleanBeforeTest: false, excludedPaths: [],
  excludedLibraries: [], buildProfiles: [], backgroundImage: "", fontFamily: "", fontFallbacks: "", ...patch,
});

const module = (patch: Partial<ModuleInfo> = {}): ModuleInfo => ({
  id: "app", name: "app", root: "C:\\p\\app", projectRoot: "C:\\p", relativePath: "app",
  buildSystem: "Maven", sourceRoots: ["C:\\p\\app\\src\\main\\java"], testRoots: [],
  resourceRoots: [], testResourceRoots: [], outputPath: "C:\\p\\app\\target\\classes",
  dependencies: [], jdkPath: "", languageLevel: "", descriptorPath: null, jpms: null, ...patch,
});

describe("project structure problems", () => {
  it("stays silent on a healthy project", () => {
    expect(projectStructureProblems(project(), settings(), [module()], [jdk(21)], null)).toEqual([]);
  });

  it("reports a language level the SDK cannot compile", () => {
    const [problem] = projectStructureProblems(project(), settings({ languageLevel: "25" }), [module()], [jdk(21)], null);
    // This one only surfaces as a build failure otherwise, far from its cause.
    expect(problem).toMatchObject({ severity: "error", section: "project" });
    expect(problem.title).toContain("25");
    expect(problem.detail).toContain("21");
  });

  it("reports a missing SDK before anything else can work", () => {
    const problems = projectStructureProblems(project(), settings(), [module()], [], null);
    expect(problems[0]).toMatchObject({ severity: "error", section: "sdks" });
  });

  it("flags a Project SDK pointing somewhere unknown", () => {
    const problems = projectStructureProblems(project(), settings({ jdkPath: "C:\\gone" }), [module()], [jdk(21)], null);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ severity: "warning", section: "project", detail: "C:\\gone" });
  });

  it("flags a module without a source root", () => {
    const problems = projectStructureProblems(project(), settings(), [module({ sourceRoots: [] })], [jdk(21)], null);
    expect(problems[0].title).toContain("kein Source Root");
    expect(problems[0].section).toBe("modules");
  });

  it("flags a dependency on a module that does not exist", () => {
    const problems = projectStructureProblems(
      project(), settings(), [module({ dependencies: ["ghost"] })], [jdk(21)], null,
    );
    expect(problems[0]).toMatchObject({ severity: "error", detail: "ghost" });
  });

  it("flags two modules sharing one name", () => {
    const problems = projectStructureProblems(
      project(),
      settings(),
      [module({ id: "a", name: "core" }), module({ id: "b", name: "core", root: "C:\\p\\b" })],
      [jdk(21)],
      null,
    );
    expect(problems.some((problem) => problem.title.includes("2-mal vergeben"))).toBe(true);
  });

  it("carries dependency warnings through as library problems", () => {
    const audit = {
      dependencies: [{ coordinate: "org.demo:lib", version: "1.0" }],
      warnings: [{ coordinate: "org.demo:lib", message: "Version wird extern verwaltet" }],
    } as any;
    const problems = projectStructureProblems(project(), settings(), [module()], [jdk(21)], audit);
    expect(problems).toEqual([{
      severity: "warning",
      section: "libraries",
      title: "org.demo:lib",
      detail: "Version wird extern verwaltet",
    }]);
  });

  it("does not invent a level problem when nothing is known yet", () => {
    // A project that has not been detected reports neither level nor SDK; a
    // comparison against zero would flag every fresh project.
    expect(projectStructureProblems(
      project({ jdkMajor: 0, languageLevel: "" }),
      settings({ languageLevel: "" }),
      [module()],
      [jdk(21)],
      null,
    )).toEqual([]);
  });
});
