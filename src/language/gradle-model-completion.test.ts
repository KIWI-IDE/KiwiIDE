import { describe, expect, it } from "vitest";
import type { GradleEditorModel, GradleModelMember } from "../types";
import { gradleModelSuggestions, gradleProjectForFile, gradleTaskSuggestions } from "./gradle-model-completion";
const property = (name: string, returns: string): GradleModelMember => ({ name, kind: "property", type: returns, returns, signature: name, parameters: [] });
const model: GradleEditorModel = {
  schema: 1, gradleVersion: "test", projects: [{ path: ":", directory: "C:/project", extensions: [{ name: "demoFeature", type: "example.DemoExtension" }], tasks: [], configurations: ["implementation", "customLibraries"] }],
  types: { "org.gradle.api.Project": [property("tasks", "org.gradle.api.tasks.TaskContainer")], "org.gradle.api.tasks.TaskContainer": [], "example.DemoExtension": [property("greeting", "java.lang.String"), property("nested", "example.Nested")], "example.Nested": [property("message", "java.lang.String")] },
};
describe("completion from imported Gradle types", () => {
  it("uses actual plugin extensions, typed blocks and chained return types", () => {
    for (const [text, label] of [["demoFeature {\n gre", "greeting"], ["extensions.configure<DemoExtension> {\n gre", "greeting"], ["demoFeature.nested.me", "message"]]) {
      expect(gradleModelSuggestions(model, "C:/project/build.gradle.kts", text, text.length).some(item => item.label === label), text).toBe(true);
    }
  });
  it("offers actual configurations and respects project boundaries", () => {
    const text = "dependencies {\n cus";
    expect(gradleModelSuggestions(model, "C:/project/build.gradle.kts", text, text.length).some(item => item.label === "customLibraries")).toBe(true);
    expect(gradleProjectForFile(model, "C:/project-other/build.gradle.kts")).toBeUndefined();
    expect(gradleModelSuggestions(model, "C:/project/build.gradle.kts", '// demoFeature.gre', 18)).toEqual([]);
  });
  it("completes actual task names and replaces the suffix inside a quoted task name", () => {
    const actual = { ...model, projects: [{ ...model.projects[0], tasks: [{ name: "customGreeting", path: ":customGreeting", type: "example.GreetingTask", description: "Custom plugin task" }] }] };
    const text = 'tasks.named("cusOld")';
    const offset = text.indexOf("Old");
    const result = gradleTaskSuggestions(actual, "C:/project/build.gradle.kts", text, offset)!;
    expect(result.suggestions.map(entry => entry.label)).toEqual(["customGreeting"]);
    expect(text.slice(0, result.start) + result.suggestions[0].insertText + text.slice(result.end)).toBe('tasks.named("customGreeting")');
    expect(gradleTaskSuggestions(actual, "C:/project/build.gradle.kts", '// tasks.named("cus', 18)).toBeNull();
    expect(gradleModelSuggestions(actual, "C:/project/build.gradle.kts", "tasks.cus", 9).some(item => item.label === "customGreeting")).toBe(true);
  });
});
