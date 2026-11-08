import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { DependencyService } = require("../electron/services/dependency-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");

let root = "";
let service: { list: (root: string) => Promise<{ type: string; dependencies: Array<Record<string, unknown>> }> };

/**
 * The whole path the dependency editor takes, not only the regex.
 *
 * A parser test proves the pattern; this proves the fix reaches the feature —
 * a real folder on disk, read through the guard and the project detection the
 * editor itself goes through.
 */
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-gradle-"));
  const guard = new PathGuard();
  guard.register(root);
  service = new DependencyService(guard, { detect: async () => ({ type: "Gradle" }) });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

async function writeBuildFile(contents: string) {
  await writeFile(path.join(root, "build.gradle"), contents, "utf8");
}

describe("what the dependency editor is shown for a Gradle project", () => {
  it("lists both ways of declaring a dependency", async () => {
    await writeBuildFile([
      "plugins { id 'java' }",
      "dependencies {",
      '    implementation "org.apache.commons:commons-lang3:3.14.0"',
      "    implementation group: 'org.map', name: 'notation', version: '4.0'",
      "}",
    ].join("\n"));

    const listed = await service.list(root);
    expect(listed.type).toBe("Gradle");
    expect(listed.dependencies.map((entry) => entry.coordinate).sort())
      .toEqual(["org.apache.commons:commons-lang3", "org.map:notation"]);
  });

  it("does not list one that was commented out", async () => {
    // The editor offering to change a dependency that is not active would end
    // with it rewriting the inside of a comment.
    await writeBuildFile([
      "dependencies {",
      '    implementation "echt:da:1.0"',
      "    /*",
      '    implementation "im:kommentar:2.0"',
      "    */",
      '    // implementation "auch:tot:3.0"',
      "}",
    ].join("\n"));

    const listed = await service.list(root);
    expect(listed.dependencies.map((entry) => entry.coordinate)).toEqual(["echt:da"]);
  });

  it("reads a build file in a subproject too", async () => {
    await writeBuildFile("plugins { id 'java' }");
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(
      path.join(root, "app", "build.gradle"),
      'dependencies {\n    implementation "im:unterprojekt:1.0"\n}',
      "utf8",
    );

    const listed = await service.list(root);
    expect(listed.dependencies.map((entry) => entry.coordinate)).toContain("im:unterprojekt");
  });

  it("says the project has none rather than failing on an empty build file", async () => {
    await writeBuildFile("plugins { id 'java' }\n");
    const listed = await service.list(root);
    expect(listed.dependencies).toEqual([]);
  });

  it("refuses a root that was never opened", async () => {
    // Everything here goes through the same guard the rest of the workbench
    // does; a path nobody opened is not one to read build files from.
    await expect(service.list(path.join(tmpdir(), "nie-geoeffnet"))).rejects.toThrow();
  });
});
