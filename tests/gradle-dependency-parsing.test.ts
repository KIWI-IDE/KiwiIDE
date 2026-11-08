import { describe, expect, it } from "vitest";

const {
  maskBlockComments,
  parseGradleFile,
  parseVersionCatalog,
} = require("../electron/services/dependency-service.cjs");

/** Parses a build file the way the dependency editor does. */
function parse(source: string, catalogs: unknown[] = []) {
  return parseGradleFile(source, "C:/projekt/build.gradle", "C:/projekt", catalogs).dependencies;
}

const coordinates = (source: string, catalogs: unknown[] = []) =>
  parse(source, catalogs).map((entry: { coordinate: string; version: string }) => `${entry.coordinate}:${entry.version}`);

describe("reading dependencies out of a build file", () => {
  it("finds the ordinary quoted form, with and without brackets", () => {
    const source = [
      "dependencies {",
      '    implementation "org.apache.commons:commons-lang3:3.14.0"',
      "    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'",
      '    api("mit:klammern:9.9")',
      "}",
    ].join("\n");
    expect(coordinates(source)).toEqual([
      "org.apache.commons:commons-lang3:3.14.0",
      "org.junit.jupiter:junit-jupiter:5.10.0",
      "mit:klammern:9.9",
    ]);
  });

  it("keeps the configuration each one was declared under", () => {
    const source = [
      "dependencies {",
      '    implementation "a:b:1.0"',
      '    testImplementation "c:d:2.0"',
      "}",
    ].join("\n");
    expect(parse(source).map((entry: { scope: string }) => entry.scope))
      .toEqual(["implementation", "testImplementation"]);
  });

  it("reads the map form Gradle's own documentation uses", () => {
    // Missing this meant the editor showed fewer dependencies than the project
    // had, with nothing saying so — the reader had to know to distrust it.
    const source = "dependencies {\n    implementation group: 'org.map', name: 'notation', version: '4.0'\n}";
    expect(coordinates(source)).toEqual(["org.map:notation:4.0"]);
  });

  it("ignores a dependency somebody commented out with //", () => {
    const source = [
      "dependencies {",
      '    implementation "echt:da:1.0"',
      '    // implementation "tot:auskommentiert:2.0"',
      "}",
    ].join("\n");
    expect(coordinates(source)).toEqual(["echt:da:1.0"]);
  });

  it("ignores one inside a block comment", () => {
    // This was listed as active. Worse than showing it: changing its version
    // through the editor would have rewritten lines inside a comment.
    const source = [
      "dependencies {",
      '    implementation "echt:da:1.0"',
      "    /*",
      '    implementation "im:kommentar:2.0"',
      "    implementation group: 'auch:tot', name: 'x', version: '3.0'",
      "    */",
      "}",
    ].join("\n");
    expect(coordinates(source)).toEqual(["echt:da:1.0"]);
  });

  it("still points at the real version after the comments are hidden", () => {
    // The comments are blanked rather than removed for exactly this: every
    // offset has to keep meaning what it meant in the file on disk.
    const source = [
      "dependencies {",
      "    /* alt: implementation \"x:y:0.1\" */",
      '    implementation "echt:da:1.0"',
      "    implementation group: 'org.map', name: 'notation', version: '4.0'",
      "}",
    ].join("\n");
    for (const entry of parse(source)) {
      expect({
        coordinate: entry.coordinate,
        text: source.slice(entry._versionStart, entry._versionEnd),
      }).toEqual({ coordinate: entry.coordinate, text: entry.version });
    }
  });

  it("leaves a plugin block alone, which declares no dependencies", () => {
    const source = [
      "plugins {",
      "    id 'java'",
      "    id 'org.springframework.boot' version '3.2.0'",
      "}",
    ].join("\n");
    expect(coordinates(source)).toEqual([]);
  });

  it("refuses a version with a space in it rather than guessing", () => {
    expect(coordinates('dependencies {\n    implementation "a:b:1.0 oder so"\n}')).toEqual([]);
  });

  it("finds nothing in a file that declares nothing", () => {
    expect(coordinates("")).toEqual([]);
    expect(coordinates("plugins { id 'java' }")).toEqual([]);
  });
});

describe("blanking out comments", () => {
  it("keeps the text exactly as long as it was", () => {
    // Anything shorter moves every offset the parser records.
    const source = 'a\n/* weg */\nb "x:y:1.0"\n';
    expect(maskBlockComments(source)).toHaveLength(source.length);
  });

  it("keeps the line breaks, so line numbers still match", () => {
    const source = "eins\n/* zwei\ndrei */\nvier";
    const masked = maskBlockComments(source);
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
    expect(masked.split("\n")[3]).toBe("vier");
  });

  it("leaves a file without comments untouched", () => {
    const source = 'implementation "a:b:1.0"';
    expect(maskBlockComments(source)).toBe(source);
  });

  it("handles several comments and an unterminated one", () => {
    expect(maskBlockComments("/*a*/x/*b*/")).toBe("     x     ");
    // An unclosed comment is a broken build file; it must not eat the parser.
    expect(maskBlockComments("/* offen")).toBe("/* offen");
  });
});

describe("a version catalog", () => {
  it("reads the libraries a catalog declares", () => {
    const toml = [
      "[versions]",
      'junit = "5.10.0"',
      "[libraries]",
      'junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }',
    ].join("\n");
    const catalog = parseVersionCatalog(toml, "C:/projekt/gradle/libs.versions.toml", "C:/projekt");
    const library = catalog.libraries.find((entry: { alias: string }) => entry.alias === "junit-jupiter");
    expect(library).toMatchObject({ groupId: "org.junit.jupiter", artifactId: "junit-jupiter" });
    expect(library.version).toBe("5.10.0");
  });

  it("survives a catalog that declares nothing", () => {
    const catalog = parseVersionCatalog("", "C:/projekt/gradle/libs.versions.toml", "C:/projekt");
    expect(catalog.libraries).toEqual([]);
  });
});
