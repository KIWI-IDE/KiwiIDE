import { describe, expect, it } from "vitest";
import {
  buildFileKind,
  coordinateQueryAt,
  gradleBlockPath,
  gradleCompletions,
  mavenCompletions,
  mavenElementPath,
  buildFileLabel,
  coordinateSpanAt,
  gradleCoordinateText,
  mavenDependencyEdits,
  mvnRepositoryUrl,
} from "./build-files";

const caret = (source: string) => {
  const offset = source.indexOf("|");
  return { text: source.replace("|", ""), offset };
};

describe("recognising build files", () => {
  it("knows which files it can help with", () => {
    expect(buildFileKind("C:\\p\\pom.xml")).toBe("maven");
    expect(buildFileKind("build.gradle")).toBe("gradle");
    expect(buildFileKind("settings.gradle.kts")).toBe("gradle");
    expect(buildFileKind("Main.java")).toBeNull();
    // An XML file that is not a pom must not get Maven elements offered.
    expect(buildFileKind("config.xml")).toBeNull();
  });
});

describe("Maven completion", () => {
  it("tracks the open element chain without a strict parse", () => {
    const { text, offset } = caret("<project><dependencies><dependency><groupId>|");
    expect(mavenElementPath(text, offset)).toEqual(["project", "dependencies", "dependency", "groupId"]);
  });

  it("ignores self-closing and already closed elements", () => {
    const { text, offset } = caret("<project><modules><module>a</module></modules><build/>|");
    expect(mavenElementPath(text, offset)).toEqual(["project"]);
  });

  it("offers the children of the enclosing element", () => {
    const { text, offset } = caret("<project><dependencies><dependency>\n  |\n</dependency>");
    expect(mavenCompletions(text, offset).map((item) => item.label))
      .toEqual(["groupId", "artifactId", "version", "scope", "optional", "classifier", "exclusions"]);
  });

  it("closes the element it inserts", () => {
    const { text, offset } = caret("<project><dependencies><dependency>|");
    const groupId = mavenCompletions(text, offset).find((item) => item.label === "groupId");
    expect(groupId?.insertText).toBe("groupId>$0</groupId>");
    // A container gets room for its children instead of a one-liner.
    const exclusions = mavenCompletions(text, offset).find((item) => item.label === "exclusions");
    expect(exclusions?.insertText).toBe("exclusions>\n    $0\n</exclusions>");
  });

  it("offers values, not elements, inside an element that has a fixed set", () => {
    const { text, offset } = caret("<project><dependencies><dependency><scope>|</scope>");
    expect(mavenCompletions(text, offset).map((item) => item.label))
      .toEqual(["compile", "provided", "runtime", "test", "system", "import"]);
  });

  it("offers the compiler properties inside <properties>", () => {
    const { text, offset } = caret("<project><properties>\n  |\n</properties>");
    expect(mavenCompletions(text, offset).map((item) => item.label)).toContain("maven.compiler.release");
  });
});

describe("Gradle completion", () => {
  it("tracks the enclosing blocks", () => {
    const { text, offset } = caret("dependencies {\n    |\n}");
    expect(gradleBlockPath(text, offset)).toEqual(["dependencies"]);
  });

  it("does not treat braces in strings or comments as blocks", () => {
    const { text, offset } = caret("dependencies {\n    // a } here\n    implementation(\"a{b\")\n    |\n}");
    expect(gradleBlockPath(text, offset)).toEqual(["dependencies"]);
  });

  it("leaves a closed block behind", () => {
    const { text, offset } = caret("repositories {\n    mavenCentral()\n}\n|");
    expect(gradleBlockPath(text, offset)).toEqual([]);
  });

  it("offers configurations inside dependencies and repositories elsewhere", () => {
    const inDependencies = caret("dependencies {\n    |\n}");
    expect(gradleCompletions(inDependencies.text, inDependencies.offset).map((item) => item.label))
      .toContain("testImplementation");

    const inRepositories = caret("repositories {\n    |\n}");
    expect(gradleCompletions(inRepositories.text, inRepositories.offset).map((item) => item.label))
      .toContain("mavenCentral");

    // A configuration has no business being suggested at the top level.
    const topLevel = caret("|");
    const labels = gradleCompletions(topLevel.text, topLevel.offset).map((item) => item.label);
    expect(labels).toContain("plugins");
    expect(labels).not.toContain("testImplementation");
  });

  it("says nothing inside a block it does not know", () => {
    const { text, offset } = caret("somePluginConfig {\n    |\n}");
    expect(gradleCompletions(text, offset)).toEqual([]);
  });
});

describe("recognising a coordinate being typed", () => {
  it("reads the Maven field and what the block already declares", () => {
    const { text, offset } = caret([
      "<project><dependencies><dependency>",
      "  <groupId>org.springframework</groupId>",
      "  <artifactId>spring-co|</artifactId>",
      "</dependency>",
    ].join("\n"));
    expect(coordinateQueryAt(text, offset, "maven")).toEqual({
      field: "artifactId",
      term: "spring-co",
      groupId: "org.springframework",
      artifactId: "spring-co",
    });
  });

  it("stays quiet outside a coordinate element", () => {
    const { text, offset } = caret("<project><name>Dem|</name>");
    expect(coordinateQueryAt(text, offset, "maven")).toBeNull();
    // A version inside <properties> is not a dependency coordinate either.
    const properties = caret("<project><properties><version>1.|</version>");
    expect(coordinateQueryAt(properties.text, properties.offset, "maven")).toBeNull();
  });

  it("splits a Gradle coordinate string into its parts", () => {
    const group = caret('dependencies {\n    implementation("org.spring|")\n}');
    expect(coordinateQueryAt(group.text, group.offset, "gradle")).toMatchObject({ field: "groupId", term: "org.spring" });

    const artifact = caret('dependencies {\n    testImplementation("org.junit.jupiter:junit-jup|")\n}');
    expect(coordinateQueryAt(artifact.text, artifact.offset, "gradle"))
      .toMatchObject({ field: "artifactId", groupId: "org.junit.jupiter", term: "junit-jup" });

    const version = caret('dependencies {\n    implementation("com.google.guava:guava:33.|")\n}');
    expect(coordinateQueryAt(version.text, version.offset, "gradle"))
      .toMatchObject({ field: "version", groupId: "com.google.guava", artifactId: "guava" });
  });

  it("ignores a string that is not a dependency", () => {
    const { text, offset } = caret('tasks {\n    description = "some |"\n}');
    expect(coordinateQueryAt(text, offset, "gradle")).toBeNull();
  });
});


/** Applies the offset edits the rules return, so the result can be read as text. */
function applyEdits(text: string, edits: Array<{ start: number; end: number; newText: string }>) {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((current, edit) => current.slice(0, edit.start) + edit.newText + current.slice(edit.end), text);
}

const gson = { groupId: "com.google.code.gson", artifactId: "gson", version: "2.11.0" };

describe("the page an artifact is read about on", () => {
  it("links straight to the version being offered", () => {
    expect(mvnRepositoryUrl("com.google.code.gson", "gson", "2.11.0"))
      .toBe("https://mvnrepository.com/artifact/com.google.code.gson/gson/2.11.0");
  });

  it("links to the artifact when no version is known yet", () => {
    expect(mvnRepositoryUrl("com.google.code.gson", "gson"))
      .toBe("https://mvnrepository.com/artifact/com.google.code.gson/gson");
  });

  it("falls back to a search rather than a broken address", () => {
    expect(mvnRepositoryUrl("", "gson")).toBe("https://mvnrepository.com/search?q=gson");
    expect(mvnRepositoryUrl("", "")).toBe("https://mvnrepository.com/search?q=");
  });

  it("escapes what would otherwise leave the path", () => {
    expect(mvnRepositoryUrl("a/b", "c d")).toBe("https://mvnrepository.com/artifact/a%2Fb/c%20d");
  });
});

describe("which part of the file a coordinate replaces", () => {
  it("covers the whole string a Gradle dependency is being typed into", () => {
    const text = 'dependencies {\n    implementation "gso"\n}';
    const offset = text.indexOf('"gso') + 4;
    const span = coordinateSpanAt(text, offset, "gradle")!;
    expect(text.slice(span.start, span.end)).toBe("gso");
  });

  it("covers a coordinate that is already half typed", () => {
    const text = 'dependencies {\n    implementation("com.google.code.gson:gso")\n}';
    const offset = text.indexOf(":gso") + 4;
    const span = coordinateSpanAt(text, offset, "gradle")!;
    // The whole coordinate, so accepting a proposal replaces the group as well
    // rather than appending a second one.
    expect(text.slice(span.start, span.end)).toBe("com.google.code.gson:gso");
  });

  it("covers the text inside a Maven element", () => {
    const text = "<project><dependencies><dependency><artifactId>gso</dependency>";
    const offset = text.indexOf("gso") + 3;
    const span = coordinateSpanAt(text, offset, "maven")!;
    expect(text.slice(span.start, span.end)).toBe("gso");
  });

  it("says nothing where the caret is not in a coordinate", () => {
    expect(coordinateSpanAt("plugins {\n    id(\"java\")\n}", 20, "gradle")).toBeNull();
    expect(coordinateSpanAt("<project><name>demo</name>", 19, "maven")).toBeNull();
  });
});

describe("writing a coordinate into a Gradle script", () => {
  it("writes all three parts, which is what was missing", () => {
    expect(gradleCoordinateText(gson)).toBe("com.google.code.gson:gson:2.11.0");
  });

  it("leaves out a part nobody knows", () => {
    expect(gradleCoordinateText({ groupId: "a", artifactId: "b", version: "" })).toBe("a:b");
  });
});

describe("writing a dependency into a pom", () => {
  const pom = [
    "<project>",
    "  <dependencies>",
    "    <dependency>",
    "      <groupId></groupId>",
    "      <artifactId>gso</artifactId>",
    "      <version></version>",
    "    </dependency>",
    "  </dependencies>",
    "</project>",
  ].join("\n");

  it("fills the whole block, not only the element under the caret", () => {
    // Completing the artifactId alone left groupId and version empty, and a
    // pom with an empty groupId does not build.
    const offset = pom.indexOf("gso") + 3;
    const result = applyEdits(pom, mavenDependencyEdits(pom, offset, gson));
    expect(result).toContain("<groupId>com.google.code.gson</groupId>");
    expect(result).toContain("<artifactId>gson</artifactId>");
    expect(result).toContain("<version>2.11.0</version>");
  });

  it("never overwrites a version somebody chose", () => {
    const pinned = pom.replace("<version></version>", "<version>2.8.9</version>");
    const offset = pinned.indexOf("gso") + 3;
    const result = applyEdits(pinned, mavenDependencyEdits(pinned, offset, gson));
    expect(result).toContain("<version>2.8.9</version>");
    expect(result).toContain("<artifactId>gson</artifactId>");
  });

  it("adds no element that is not already there", () => {
    // Where to put a missing element is a guess, and a pom is not the place
    // for one.
    const sparse = [
      "<project><dependencies><dependency>",
      "  <artifactId>gso</artifactId>",
      "</dependency></dependencies></project>",
    ].join("\n");
    const offset = sparse.indexOf("gso") + 3;
    const result = applyEdits(sparse, mavenDependencyEdits(sparse, offset, gson));
    expect(result).toContain("<artifactId>gson</artifactId>");
    expect(result).not.toContain("<groupId>");
  });

  it("writes the group where the caret is in the groupId", () => {
    const offset = pom.indexOf("<groupId>") + "<groupId>".length;
    const edits = mavenDependencyEdits(pom, offset, gson);
    const result = applyEdits(pom, edits);
    expect(result).toContain("<groupId>com.google.code.gson</groupId>");
    expect(result).toContain("<version>2.11.0</version>");
  });

  it("says nothing where the caret is not in a coordinate", () => {
    expect(mavenDependencyEdits("<project><name>demo</name></project>", 19, gson)).toEqual([]);
  });
});

describe("naming a build file when several are on offer", () => {
  const root = "C:/projekt";

  it("names the module, because the file names are all the same", () => {
    // Every build file in a multi-project build is called build.gradle.kts,
    // and a list of identical entries is not a choice.
    expect(buildFileLabel("C:/projekt/honeymc-cloud/build.gradle.kts", root))
      .toBe("honeymc-cloud · build.gradle.kts");
  });

  it("calls the root what it is", () => {
    expect(buildFileLabel("C:/projekt/build.gradle.kts", root)).toBe("Projekt · build.gradle.kts");
  });

  it("spells out a nested module", () => {
    expect(buildFileLabel("C:/projekt/dienste/api/pom.xml", root)).toBe("dienste › api · pom.xml");
  });

  it("reads a Windows path the same as a posix one", () => {
    expect(buildFileLabel("C:\\projekt\\app\\build.gradle", "C:\\projekt"))
      .toBe("app · build.gradle");
  });

  it("ignores the case the drive letter happens to have", () => {
    expect(buildFileLabel("c:/Projekt/app/pom.xml", "C:/projekt")).toBe("app · pom.xml");
  });

  it("still says something for a file outside the project", () => {
    expect(buildFileLabel("D:/woanders/pom.xml", root)).toBe("D: › woanders · pom.xml");
  });
});
