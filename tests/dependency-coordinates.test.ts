import { describe, expect, it } from "vitest";

const {
  GRADLE_CONFIGURATIONS,
  MAVEN_SCOPES,
  assertCoordinates,
  assertVersion,
  assertVersionPlaceholders,
} = require("../electron/services/dependency-service.cjs");

const ok = { groupId: "org.example", artifactId: "lib", version: "1.0" };

describe("the coordinates a dependency is added under", () => {
  it("takes what a real coordinate looks like", () => {
    expect(assertCoordinates(ok)).toEqual(ok);
    expect(assertCoordinates({ ...ok, groupId: "com.fasterxml.jackson.core" }).groupId)
      .toBe("com.fasterxml.jackson.core");
  });

  it("refuses a group or artifact with anything structural in it", () => {
    // These are written into build files unquoted in places, and a slash or a
    // quote there stops being a name and starts being syntax.
    for (const groupId of ["org/example", 'org"example', "org example", "", "org<example"]) {
      expect(() => assertCoordinates({ ...ok, groupId })).toThrow(/groupId/);
    }
    for (const artifactId of ["li b", "lib/../x", '"lib"', ""]) {
      expect(() => assertCoordinates({ ...ok, artifactId })).toThrow(/artifactId/);
    }
  });

  it("keeps the placeholders a build file legitimately uses", () => {
    // Gradle and Maven both carry the version in a property, and refusing that
    // would make the editor useless for the projects that do it properly.
    for (const version of ["${junitVersion}", "${project.version}", "1.0-SNAPSHOT", "[1.0,2.0)", "1.0+"]) {
      expect({ version, accepted: assertCoordinates({ ...ok, version }).version })
        .toEqual({ version, accepted: version });
    }
  });

  it("refuses a placeholder that is an expression rather than a name", () => {
    // The version lands inside a double-quoted Gradle string, and Groovy
    // evaluates ${…} when it reads the file. Anything but a name there runs on
    // the machine doing the build — which, in a shared session, is the host's.
    // Two of these are already stopped by the character set; the point is
    // that none of them reaches a build file, whichever rule catches it.
    for (const version of ['${System.exit(0)}', '${"rm -rf /".execute()}', "${a.b()}", "${new File('x')}"]) {
      expect({ version, refused: (() => {
        try { assertCoordinates({ ...ok, version }); return false; } catch { return true; }
      })() }).toEqual({ version, refused: true });
    }
    // And the ones the character set allows are caught by the placeholder
    // rule specifically, which is the part this change added.
    expect(() => assertCoordinates({ ...ok, version: "${System.exit(0)}" })).toThrow(/Platzhalter/);
    expect(() => assertCoordinates({ ...ok, version: "${a.b()}" })).toThrow(/Platzhalter/);
  });

  it("refuses a version carrying a quote, which would end the string early", () => {
    expect(() => assertCoordinates({ ...ok, version: '1.0"; evil' })).toThrow(/Version/);
    expect(() => assertCoordinates({ ...ok, version: "1.0'" })).toThrow(/Version/);
  });

  it("applies the same rule wherever a version is checked", () => {
    expect(assertVersion("${junitVersion}")).toBe("${junitVersion}");
    expect(() => assertVersion("${System.exit(0)}")).toThrow(/Platzhalter/);
  });

  it("looks at every placeholder, not only the first", () => {
    expect(() => assertVersionPlaceholders("${good}-${bad()}")).toThrow(/Platzhalter/);
    expect(() => assertVersionPlaceholders("${good}-${also.good}")).not.toThrow();
  });

  it("has nothing to complain about in a version without placeholders", () => {
    expect(() => assertVersionPlaceholders("1.2.3")).not.toThrow();
    expect(() => assertVersionPlaceholders("")).not.toThrow();
  });
});

describe("what a dependency may be scoped to", () => {
  it("offers the scopes Maven actually has", () => {
    for (const scope of ["compile", "test", "provided", "runtime"]) {
      expect({ scope, offered: MAVEN_SCOPES.includes(scope) }).toEqual({ scope, offered: true });
    }
  });

  it("offers the configurations Gradle actually has", () => {
    for (const configuration of ["implementation", "testImplementation"]) {
      expect({ configuration, offered: GRADLE_CONFIGURATIONS.includes(configuration) })
        .toEqual({ configuration, offered: true });
    }
  });

  it("keeps the two lists apart, because the build tools do", () => {
    // Offering a Gradle configuration in a Maven project produces a pom that
    // Maven rejects with an error about a scope nobody chose.
    expect(MAVEN_SCOPES).not.toContain("implementation");
    expect(GRADLE_CONFIGURATIONS).not.toContain("provided");
  });
});
