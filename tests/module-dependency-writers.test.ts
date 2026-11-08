import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  addGradleProjectDependency,
  addMavenProjectDependency,
} = require("../electron/services/java-refactor-service.cjs");

/**
 * Making one module depend on another.
 *
 * This runs when a class is moved into a module that the referring module does
 * not depend on yet. It writes into a build file, so getting it wrong does not
 * produce a warning — it produces a build that no longer compiles, in a file
 * nobody was looking at.
 */
describe("declaring a module dependency", () => {
  let workspace = "";

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "kiwi-moduldep-"));
  });

  const write = (relative: string, content: string) => {
    const file = path.join(workspace, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    return path.dirname(file);
  };

  const target = (relative: string, artifactId: string) => {
    write(`${relative}/pom.xml`, [
      "<project>",
      "  <groupId>de.beispiel</groupId>",
      `  <artifactId>${artifactId}</artifactId>`,
      "  <version>1.0.0</version>",
      "</project>",
      "",
    ].join("\n"));
    return { root: path.join(workspace, relative), buildSystem: "Maven", relativePath: relative };
  };

  describe("in a pom", () => {
    it("writes the dependency into the project's own dependencies", async () => {
      const root = write("kern/pom.xml", [
        "<project>",
        "  <groupId>de.beispiel</groupId>",
        "  <artifactId>kern</artifactId>",
        "  <version>1.0.0</version>",
        "  <dependencies>",
        "  </dependencies>",
        "</project>",
        "",
      ].join("\n"));
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "compile",
      );
      expect(change.after).toContain("<artifactId>web</artifactId>");
      expect(change.after).toContain("      <version>1.0.0</version>");
    });

    it("does not write it into dependencyManagement standing after the dependencies", async () => {
      // A parent that manages versions and a module that declares dependencies
      // both end in </dependencies>. Taking the last one put a dependency
      // where only versions belong, and the class still could not be found.
      const root = write("kern/pom.xml", [
        "<project>",
        "  <artifactId>kern</artifactId>",
        "  <dependencies>",
        "  </dependencies>",
        "  <dependencyManagement>",
        "    <dependencies>",
        "      <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.13</version></dependency>",
        "    </dependencies>",
        "  </dependencyManagement>",
        "</project>",
        "",
      ].join("\n"));
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "compile",
      );
      const managementStart = change.after.indexOf("<dependencyManagement>");
      expect(change.after.indexOf("<artifactId>web</artifactId>")).toBeLessThan(managementStart);
    });

    it("adds the dependency even when the artifact only has a managed version", async () => {
      // A managed version is not a dependency. Reading one as "already there"
      // made the action quietly do nothing at all.
      const root = write("kern/pom.xml", [
        "<project>",
        "  <artifactId>kern</artifactId>",
        "  <dependencyManagement>",
        "    <dependencies>",
        "      <dependency><groupId>de.beispiel</groupId><artifactId>web</artifactId><version>1.0.0</version></dependency>",
        "    </dependencies>",
        "  </dependencyManagement>",
        "  <dependencies>",
        "  </dependencies>",
        "</project>",
        "",
      ].join("\n"));
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "compile",
      );
      expect(change.before).not.toEqual(change.after);
      expect(change.after.match(/<artifactId>web<\/artifactId>/g)).toHaveLength(2);
    });

    it("leaves a pom alone when the dependency is really declared", async () => {
      const root = write("kern/pom.xml", [
        "<project>",
        "  <artifactId>kern</artifactId>",
        "  <dependencies>",
        "    <dependency>",
        "      <groupId>de.beispiel</groupId>",
        "      <artifactId>web</artifactId>",
        "      <version>1.0.0</version>",
        "    </dependency>",
        "  </dependencies>",
        "</project>",
        "",
      ].join("\n"));
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "compile",
      );
      expect(change.after).toEqual(change.before);
    });

    it("does not count a commented-out dependency", async () => {
      const root = write("kern/pom.xml", [
        "<project>",
        "  <artifactId>kern</artifactId>",
        "  <dependencies>",
        "    <!--",
        "    <dependency><groupId>de.beispiel</groupId><artifactId>web</artifactId></dependency>",
        "    -->",
        "  </dependencies>",
        "</project>",
        "",
      ].join("\n"));
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "compile",
      );
      expect(change.after).not.toEqual(change.before);
    });

    it("opens a dependencies section in a pom that has none", async () => {
      const root = write("kern/pom.xml", [
        "<project>",
        "  <artifactId>kern</artifactId>",
        "</project>",
        "",
      ].join("\n"));
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "compile",
      );
      expect(change.after).toContain("<dependencies>");
      expect(change.after).toContain("<artifactId>web</artifactId>");
      expect(change.after.trimEnd().endsWith("</project>")).toBe(true);
    });

    it("marks a test dependency as one", async () => {
      const root = write("kern/pom.xml", "<project>\n  <artifactId>kern</artifactId>\n</project>\n");
      const change = await addMavenProjectDependency(
        { root, buildSystem: "Maven" },
        target("web", "web"),
        "test",
      );
      expect(change.after).toContain("<scope>test</scope>");
    });
  });

  describe("in a Gradle script", () => {
    const gradleTarget = (relative: string) => {
      write(`${relative}/build.gradle.kts`, "plugins { java }\n");
      return { root: path.join(workspace, relative), buildSystem: "Gradle", relativePath: relative };
    };

    it("writes into the project's own dependencies block", async () => {
      const root = write("kern/build.gradle.kts", [
        "plugins { java }",
        "",
        "dependencies {",
        '    implementation("org.slf4j:slf4j-api:2.0.13")',
        "}",
        "",
      ].join("\n"));
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("web"),
        "compile",
      );
      expect(change.after).toContain('implementation(project(":web"))');
    });

    it("does not write into a buildscript's dependencies block", async () => {
      // buildscript { dependencies { classpath(...) } } comes first in every
      // script that configures its own plugins. An `implementation` in there is
      // not a configuration that exists, so the build failed before it began.
      const root = write("kern/build.gradle.kts", [
        "buildscript {",
        "    dependencies {",
        '        classpath("com.example:gradle-plugin:1.0")',
        "    }",
        "}",
        "",
        "dependencies {",
        '    implementation("org.slf4j:slf4j-api:2.0.13")',
        "}",
        "",
      ].join("\n"));
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("web"),
        "compile",
      );
      const buildscriptEnd = change.after.indexOf("}\n\ndependencies {");
      expect(change.after.indexOf('implementation(project(":web"))')).toBeGreaterThan(buildscriptEnd);
      expect(change.after).toContain('classpath("com.example:gradle-plugin:1.0")');
    });

    it("opens a dependencies block in a script that has none", async () => {
      const root = write("kern/build.gradle.kts", "plugins { java }\n");
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("web"),
        "compile",
      );
      expect(change.after).toContain("dependencies {\n    implementation(project(\":web\"))\n}");
    });

    it("uses the test configuration for a test dependency", async () => {
      const root = write("kern/build.gradle.kts", "plugins { java }\ndependencies {\n}\n");
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("web"),
        "test",
      );
      expect(change.after).toContain('testImplementation(project(":web"))');
    });

    it("addresses a nested module by its Gradle path", async () => {
      const root = write("kern/build.gradle.kts", "dependencies {\n}\n");
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("dienste/web"),
        "compile",
      );
      expect(change.after).toContain('project(":dienste:web")');
    });

    it("leaves a script alone when the project is already a dependency", async () => {
      const root = write("kern/build.gradle.kts", [
        "dependencies {",
        '    implementation(project(":web"))',
        "}",
        "",
      ].join("\n"));
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("web"),
        "compile",
      );
      expect(change.after).toEqual(change.before);
    });

    it("does not count a commented-out project dependency", async () => {
      const root = write("kern/build.gradle.kts", [
        "dependencies {",
        '    // implementation(project(":web"))',
        "}",
        "",
      ].join("\n"));
      const change = await addGradleProjectDependency(
        { root, buildSystem: "Gradle" },
        gradleTarget("web"),
        "compile",
      );
      expect(change.after).not.toEqual(change.before);
    });
  });
});
