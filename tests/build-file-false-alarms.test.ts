import { describe, expect, it } from "vitest";

const { validateContent } = require("../electron/services/file-validators.cjs");

/**
 * Build files that are correct and must therefore be reported as correct.
 *
 * A check that fires on a valid file is worse than no check: the reader learns
 * to ignore the panel, and the one real error in it goes with the rest. Every
 * case here was written from something a build script legitimately contains.
 */
const problemsIn = (name: string, content: string) => validateContent(`C:/projekt/${name}`, content);
const quiet = (name: string, label: string, content: string) =>
  expect({ label, problems: problemsIn(name, content).map((entry: { message: string }) => entry.message) })
    .toEqual({ label, problems: [] });

describe("a Gradle script that is fine", () => {
  it("accepts a triple-quoted block", () => {
    // The closing delimiter is as long as the opening one; comparing a single
    // character against """ never matched, so every raw string was called
    // unterminated and every brace after it was read as if still inside one.
    quiet("build.gradle.kts", "Rohstring", 'val text = """\n  ein " Zitat\n"""\n');
  });

  it("keeps reading the file correctly after a triple-quoted block", () => {
    // The real damage was downstream: one mis-parsed string turned the rest of
    // the file into complaints about braces that are perfectly balanced.
    quiet("build.gradle.kts", "Rohstring und danach", [
      'val banner = """',
      '  { nicht wirklich eine Klammer',
      '"""',
      "",
      "tasks.test {",
      "    useJUnitPlatform()",
      "}",
    ].join("\n"));
  });

  it("accepts the everyday shapes of a build script", () => {
    quiet("build.gradle.kts", "Klammer im String", 'val text = "eine } Klammer"\n');
    quiet("build.gradle.kts", "Template", 'val name = "${project.name}-fertig"\n');
    quiet("build.gradle.kts", "URL", 'maven { url = uri("https://repo.example.org/maven-public/") }\n');
    quiet("build.gradle.kts", "Zeichenliteral", "val c = '}'\n");
    quiet("build.gradle.kts", "Backslash", 'val p = "C:\\\\Programme\\\\Kiwi IDE\\\\"\n');
    quiet("build.gradle", "maskierter Apostroph", "def text = 'it\\'s fine'\n");
    quiet("build.gradle", "GString mit Map", "def value = \"${map['schlüssel']}\"\n");
    quiet("build.gradle", "Klammer im Kommentar", "// eine } im Kommentar\ntask x { }\n");
  });

  it("still reports a brace that really is unbalanced", () => {
    expect(problemsIn("build.gradle.kts", "tasks.test {\n")).not.toEqual([]);
    expect(problemsIn("build.gradle.kts", 'val s = "offen\n')).not.toEqual([]);
  });
});

describe("a POM that is fine", () => {
  const pom = (body: string) => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<project>",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>de.beispiel</groupId>",
    "  <artifactId>demo</artifactId>",
    "  <version>1.0.0</version>",
    body,
    "</project>",
  ].join("\n");

  it("does not read a commented-out section as if it were live", () => {
    // People comment out modules and dependencies constantly. Reading the
    // comment as a declaration produced "a project with <modules> must be
    // packaged as pom" on a file that declares no modules at all.
    quiet("pom.xml", "auskommentierte Module", pom("  <!-- <modules><module>alt</module></modules> -->"));
    quiet("pom.xml", "auskommentiertes Packaging", pom("  <!-- <packaging>unfug</packaging> -->"));
    quiet("pom.xml", "auskommentierte Version", pom("  <!-- <version>LATEST</version> -->"));
  });

  it("accepts CDATA and an escaped ampersand", () => {
    quiet("pom.xml", "CDATA", pom("  <description><![CDATA[A & B]]></description>"));
    quiet("pom.xml", "maskiertes Ampersand", pom("  <name>A &amp; B</name>"));
  });

  it("accepts a child module that inherits its coordinates", () => {
    quiet("pom.xml", "Kind mit Parent", [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<project>",
      "  <modelVersion>4.0.0</modelVersion>",
      "  <parent><groupId>de.beispiel</groupId><artifactId>eltern</artifactId><version>1</version></parent>",
      "  <artifactId>kind</artifactId>",
      "</project>",
    ].join("\n"));
  });

  it("accepts an aggregator and an empty element", () => {
    quiet("pom.xml", "Aggregator", [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<project>",
      "  <modelVersion>4.0.0</modelVersion>",
      "  <groupId>de.beispiel</groupId>",
      "  <artifactId>eltern</artifactId>",
      "  <version>1.0.0</version>",
      "  <packaging>pom</packaging>",
      "  <modules><module>kind</module></modules>",
      "</project>",
    ].join("\n"));
    quiet("pom.xml", "leeres Element", pom("  <repositories/>"));
  });

  it("still reports the mistakes that are mistakes", () => {
    const withModules = pom("  <modules><module>kind</module></modules>");
    expect(problemsIn("pom.xml", withModules).map((entry: { message: string }) => entry.message).join(" "))
      .toContain("packaging");
    expect(problemsIn("pom.xml", '<?xml version="1.0"?>\n<project><modelVersion>4.0.0</modelVersion>\n')).not.toEqual([]);
    expect(problemsIn("pom.xml", pom("  <name>A & B</name>"))).not.toEqual([]);
  });
});
