import { describe, expect, it } from "vitest";

const {
  insertGradleDependency,
  insertMavenDependency,
} = require("../electron/services/dependency-service.cjs");

/**
 * Writing a library into the build file.
 *
 * This is what the "Abhängigkeit hinzufügen" dialog does, and every fault here
 * looks the same from the outside: the dialog closes, says it worked, and the
 * build file does not contain what was asked for — or contains it somewhere it
 * has no effect.
 */
const guava = { groupId: "com.google.guava", artifactId: "guava", version: "33.2.1-jre" };

describe("adding a dependency to a Gradle script", () => {
  const add = (source: string, configuration = "implementation") =>
    insertGradleDependency(source, guava, configuration, true);

  it("writes into a block that already has entries", () => {
    const after = add([
      "dependencies {",
      '    implementation("org.slf4j:slf4j-api:2.0.13")',
      "}",
      "",
    ].join("\n"));
    expect(after).toBe([
      "dependencies {",
      '    implementation("org.slf4j:slf4j-api:2.0.13")',
      '    implementation("com.google.guava:guava:33.2.1-jre")',
      "}",
      "",
    ].join("\n"));
  });

  it("writes inside an empty one-line block", () => {
    // `dependencies {}` is what a generated build file carries, and the entry
    // used to land on the line above it — outside the block, where Gradle
    // stops with a script error rather than a missing library.
    const after = add('plugins {\n    id("java")\n}\n\ndependencies {}\n');
    expect(after).toBe([
      "plugins {",
      '    id("java")',
      "}",
      "",
      "dependencies {",
      '    implementation("com.google.guava:guava:33.2.1-jre")',
      "}",
      "",
    ].join("\n"));
  });

  it("writes into a one-line block that has an entry", () => {
    const after = add('dependencies { implementation("a:b:1") }\n');
    expect(after).toBe([
      'dependencies { implementation("a:b:1")',
      '    implementation("com.google.guava:guava:33.2.1-jre")',
      "}",
      "",
    ].join("\n"));
  });

  it("does not write into a buildscript's dependencies", () => {
    // classpath entries are the build's own libraries. An `implementation` in
    // there is not a configuration Gradle knows, so the script fails to
    // configure and the project stops opening at all.
    const after = add([
      "buildscript {",
      "    dependencies {",
      '        classpath("com.example:plugin:1.0")',
      "    }",
      "}",
      "",
      "dependencies {",
      '    implementation("org.slf4j:slf4j-api:2.0.13")',
      "}",
      "",
    ].join("\n"));
    expect(after).toContain('        classpath("com.example:plugin:1.0")\n    }');
    expect(after.indexOf("com.google.guava")).toBeGreaterThan(after.indexOf("org.slf4j"));
  });

  it("opens a block in a script that has none", () => {
    expect(add('plugins {\n    id("java")\n}\n')).toContain('dependencies {\n    implementation("com.google.guava:guava:33.2.1-jre")\n}');
  });

  it("adds a library back that had been commented out", () => {
    // Somebody tries a library, comments it out, decides to keep it after all.
    // Counting the comment as a declaration made the dialog close with nothing
    // written and the message that it was already there.
    const after = add('dependencies {\n    // implementation("com.google.guava:guava:31.0-jre")\n}\n');
    expect(after).toContain('    implementation("com.google.guava:guava:33.2.1-jre")');
  });

  it("leaves a script alone when the library really is declared", () => {
    const source = 'dependencies {\n    implementation("com.google.guava:guava:31.0-jre")\n}\n';
    expect(add(source)).toBe(source);
  });

  it("uses the configuration it was given", () => {
    expect(add("dependencies {\n}\n", "testImplementation"))
      .toContain('testImplementation("com.google.guava:guava:33.2.1-jre")');
  });

  it("writes Groovy without the parentheses", () => {
    expect(insertGradleDependency("dependencies {\n}\n", guava, "implementation", false))
      .toContain('    implementation "com.google.guava:guava:33.2.1-jre"');
  });
});

describe("adding a dependency to a pom", () => {
  const add = (source: string, scope = "compile") => insertMavenDependency(source, guava, scope);
  const element = [
    "    <dependency>",
    "      <groupId>com.google.guava</groupId>",
    "      <artifactId>guava</artifactId>",
    "      <version>33.2.1-jre</version>",
    "    </dependency>",
  ].join("\n");

  it("writes into a section that already exists", () => {
    const after = add("<project>\n  <dependencies>\n  </dependencies>\n</project>\n");
    expect(after).toBe(`<project>\n  <dependencies>\n${element}\n  </dependencies>\n</project>\n`);
  });

  it("opens a section written as <dependencies/>", () => {
    // A self-closing section has no closing tag to insert before, and a second
    // <dependencies> next to it is not a pom Maven will read.
    const after = add("<project>\n  <dependencies/>\n</project>\n");
    expect(after.match(/<dependencies>/g)).toHaveLength(1);
    expect(after).toContain("<artifactId>guava</artifactId>");
  });

  it("opens a section written on one line", () => {
    const after = add("<project>\n  <dependencies></dependencies>\n</project>\n");
    expect(after).toBe(`<project>\n  <dependencies>\n${element}\n  </dependencies>\n</project>\n`);
  });

  it("opens a section in a pom that has none", () => {
    const after = add("<project>\n  <artifactId>a</artifactId>\n</project>\n");
    expect(after).toContain("<dependencies>");
    expect(after.trimEnd().endsWith("</project>")).toBe(true);
  });

  it("adds a library back that had been commented out", () => {
    const after = add([
      "<project>",
      "  <dependencies>",
      "    <!-- <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId></dependency> -->",
      "  </dependencies>",
      "</project>",
      "",
    ].join("\n"));
    expect(after).toContain("<version>33.2.1-jre</version>");
  });

  it("adds a library that only had a managed version", () => {
    const after = add([
      "<project>",
      "  <dependencyManagement><dependencies>",
      "    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>31.0-jre</version></dependency>",
      "  </dependencies></dependencyManagement>",
      "  <dependencies>",
      "  </dependencies>",
      "</project>",
      "",
    ].join("\n"));
    expect(after.match(/<artifactId>guava<\/artifactId>/g)).toHaveLength(2);
  });

  it("does not write into dependencyManagement", () => {
    const after = add([
      "<project>",
      "  <dependencies>",
      "  </dependencies>",
      "  <dependencyManagement><dependencies>",
      "    <dependency><groupId>x</groupId><artifactId>y</artifactId><version>1</version></dependency>",
      "  </dependencies></dependencyManagement>",
      "</project>",
      "",
    ].join("\n"));
    expect(after.indexOf("guava")).toBeLessThan(after.indexOf("<dependencyManagement>"));
  });

  it("leaves a pom alone when the library really is declared", () => {
    const source = [
      "<project>",
      "  <dependencies>",
      "    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>31.0-jre</version></dependency>",
      "  </dependencies>",
      "</project>",
      "",
    ].join("\n");
    expect(add(source)).toBe(source);
  });

  it("writes the scope when it is not the default", () => {
    expect(add("<project>\n  <dependencies>\n  </dependencies>\n</project>\n", "test"))
      .toContain("      <scope>test</scope>");
    expect(add("<project>\n  <dependencies>\n  </dependencies>\n</project>\n", "compile"))
      .not.toContain("<scope>");
  });
});
