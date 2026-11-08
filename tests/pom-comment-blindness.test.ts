import { describe, expect, it } from "vitest";

const { parseMavenFile } = require("../electron/services/dependency-service.cjs");

/**
 * What the Dependencies tool window reads out of a pom.
 *
 * A commented-out dependency is what a pom looks like while somebody is trying
 * a version out. Listed as a real one it is worse than noise: the row carries a
 * remove button and a version field, and both of them edit inside the comment.
 */
describe("reading dependencies out of a pom", () => {
  const parse = (lines: string[]) =>
    parseMavenFile(`${lines.join("\n")}\n`, "C:/projekt/pom.xml", "C:/projekt");

  it("lists a declared dependency with its resolved version", () => {
    const model = parse([
      "<project>",
      "  <properties><slf4j.version>2.0.13</slf4j.version></properties>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.slf4j</groupId>",
      "      <artifactId>slf4j-api</artifactId>",
      "      <version>${slf4j.version}</version>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ]);
    expect(model.dependencies).toHaveLength(1);
    expect(model.dependencies[0]).toMatchObject({
      coordinate: "org.slf4j:slf4j-api",
      version: "2.0.13",
      versionSource: "property",
      managed: false,
    });
  });

  it("does not list a commented-out dependency", () => {
    const model = parse([
      "<project>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.slf4j</groupId>",
      "      <artifactId>slf4j-api</artifactId>",
      "      <version>2.0.13</version>",
      "    </dependency>",
      "    <!--",
      "    <dependency>",
      "      <groupId>alt</groupId>",
      "      <artifactId>vergessen</artifactId>",
      "      <version>1.0</version>",
      "    </dependency>",
      "    -->",
      "  </dependencies>",
      "</project>",
    ]);
    expect(model.dependencies.map((entry: { coordinate: string }) => entry.coordinate))
      .toEqual(["org.slf4j:slf4j-api"]);
  });

  it("keeps the offsets pointing at the file as it is on disk", () => {
    // The comment is blanked rather than cut, so what the remove button edits
    // is still the text that is really there.
    const model = parse([
      "<project>",
      "  <dependencies>",
      "    <!-- alt: <dependency><groupId>a</groupId><artifactId>b</artifactId></dependency> -->",
      "    <dependency>",
      "      <groupId>org.slf4j</groupId>",
      "      <artifactId>slf4j-api</artifactId>",
      "      <version>2.0.13</version>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ]);
    const [entry] = model.dependencies;
    expect(model.source.slice(entry._blockStart, entry._blockEnd)).toContain("<artifactId>slf4j-api</artifactId>");
    expect(model.source.slice(entry._removeStart, entry._removeEnd)).not.toContain("<!--");
  });

  it("does not read a property out of a comment", () => {
    const model = parse([
      "<project>",
      "  <properties>",
      "    <!-- <slf4j.version>1.7.36</slf4j.version> -->",
      "    <slf4j.version>2.0.13</slf4j.version>",
      "  </properties>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.slf4j</groupId>",
      "      <artifactId>slf4j-api</artifactId>",
      "      <version>${slf4j.version}</version>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ]);
    expect(model.dependencies[0].version).toBe("2.0.13");
  });

  it("still marks a managed dependency as managed", () => {
    const model = parse([
      "<project>",
      "  <dependencyManagement>",
      "    <dependencies>",
      "      <dependency>",
      "        <groupId>org.slf4j</groupId>",
      "        <artifactId>slf4j-api</artifactId>",
      "        <version>2.0.13</version>",
      "      </dependency>",
      "    </dependencies>",
      "  </dependencyManagement>",
      "</project>",
    ]);
    expect(model.dependencies[0]).toMatchObject({ managed: true, direct: false });
  });
});
