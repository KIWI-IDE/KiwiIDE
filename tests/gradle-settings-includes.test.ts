import { describe, expect, it } from "vitest";
import path from "node:path";

const {
  addGradleModule,
  parseGradleIncludes,
  removeGradleModule,
} = require("../electron/services/module-service.cjs");

/**
 * Taking a module out of a Gradle settings file.
 *
 * `include` takes a list, and both Gradle languages are commonly written that
 * way. Only a call naming exactly one project was recognised, so removing a
 * module that shared its call left the name declared while its directory was
 * gone — and the next build stopped at "project directory does not exist",
 * pointing at a folder nobody had asked for.
 */
describe("removing a project from settings.gradle", () => {
  const remaining = (source: string) => parseGradleIncludes(source);

  it("removes a call that names only that project", () => {
    const after = removeGradleModule('include(":api")\ninclude(":runner")\n', "runner");
    expect(remaining(after)).toEqual(["api"]);
    expect(after).not.toContain("runner");
  });

  it("removes one name out of a Kotlin call that lists several", () => {
    const after = removeGradleModule('include(":api", ":runner", ":web")\n', "runner");
    expect(remaining(after)).toEqual(["api", "web"]);
    expect(after).toContain('include(":api", ":web")');
  });

  it("removes one name out of a Groovy call that lists several", () => {
    const after = removeGradleModule("include ':api', ':runner'\n", "runner");
    expect(remaining(after)).toEqual(["api"]);
    expect(after.trim()).toBe("include ':api'");
  });

  it("takes the whole statement away when nothing is left in it", () => {
    const after = removeGradleModule('rootProject.name = "demo"\ninclude(":api")\n', "api");
    expect(remaining(after)).toEqual([]);
    expect(after).toBe('rootProject.name = "demo"\n');
  });

  it("keeps every other line of the settings file", () => {
    const source = [
      'rootProject.name = "demo"',
      "pluginManagement {",
      "    repositories { gradlePluginPortal() }",
      "}",
      'include(":api", ":runner")',
      "",
    ].join("\n");
    const after = removeGradleModule(source, "runner");
    expect(after).toContain("pluginManagement {");
    expect(after).toContain("gradlePluginPortal()");
    expect(remaining(after)).toEqual(["api"]);
  });

  it("leaves a settings file alone when the project is not in it", () => {
    const source = 'include(":api", ":runner")\n';
    expect(removeGradleModule(source, "web")).toBe(source);
  });

  it("removes a nested project by its whole path", () => {
    const after = removeGradleModule('include(":libs:core", ":api")\n', path.join("libs", "core"));
    expect(remaining(after)).toEqual(["api"]);
  });

  it("undoes exactly what adding it did", () => {
    const settings = 'rootProject.name = "demo"\n';
    const added = addGradleModule(settings, path.join("libs", "core"));
    expect(remaining(added)).toEqual([path.join("libs", "core")]);
    expect(removeGradleModule(added, path.join("libs", "core"))).toBe(settings);
  });
});
