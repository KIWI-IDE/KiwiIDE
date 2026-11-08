import { describe, expect, it } from "vitest";
import { isBuildArtifact, isGeneratedSourcePath } from "../src/project-index";

const {
  isGeneratedBranch,
  isGeneratedSource,
  isSkippedBuildDirectory,
  relativeTo,
} = require("../electron/services/generated-sources.cjs");

/**
 * MapStruct's `*MapperImpl`, Immutables' `Immutable*`, Dagger's components:
 * real classes that are compiled against, appear in stack traces and are
 * stepped through — and lived in the one directory every walk skipped whole.
 */
describe("walking into generated sources", () => {
  it("lets the walk reach them through the build directory", () => {
    // The question is asked before the rest of the path exists, so every
    // prefix has to be allowed or the leaf is unreachable.
    expect(isGeneratedBranch("target")).toBe(true);
    expect(isGeneratedBranch("target/generated-sources")).toBe(true);
    expect(isGeneratedBranch("target/generated-sources/annotations/de")).toBe(true);
    expect(isGeneratedBranch("build/generated/sources/annotationProcessor")).toBe(true);
  });

  it("does not open the rest of the build directory", () => {
    expect(isGeneratedBranch("target/classes")).toBe(false);
    expect(isGeneratedBranch("target/surefire-reports")).toBe(false);
    expect(isGeneratedBranch("build/libs")).toBe(false);
    expect(isGeneratedBranch("build/tmp")).toBe(false);
  });

  it("skips a build directory that leads nowhere generated", () => {
    expect(isSkippedBuildDirectory("target", "target/classes")).toBe(true);
    expect(isSkippedBuildDirectory("build", "build/libs")).toBe(true);
    expect(isSkippedBuildDirectory("target", "target")).toBe(false);
  });

  it("does not skip a package that happens to be called build", () => {
    // `de.beispiel.build` is a package, and hiding it would lose a source tree.
    expect(isSkippedBuildDirectory("build", "src/main/java/de/beispiel/build")).toBe(false);
    expect(isSkippedBuildDirectory("src", "src")).toBe(false);
  });

  it("reads a Windows path the same way", () => {
    expect(isGeneratedBranch("target\\generated-sources\\annotations")).toBe(true);
    expect(isSkippedBuildDirectory("target", "target\\classes")).toBe(true);
  });

  it("measures the path from the project root", () => {
    expect(relativeTo("C:/p", "C:/p/target/classes").replace(/\\/g, "/")).toBe("target/classes");
    // Outside the project is not a relative path at all.
    expect(relativeTo("C:/p", "C:/other/file.java")).toBe("");
  });
});

describe("which files count as generated source", () => {
  it("takes the Java a processor wrote", () => {
    expect(isGeneratedSource("target/generated-sources/annotations/de/SpielerMapperImpl.java")).toBe(true);
    expect(isGeneratedSource("build/generated/sources/annotationProcessor/java/main/de/A.java")).toBe(true);
  });

  it("does not take what the compiler wrote", () => {
    expect(isGeneratedSource("target/generated-sources/annotations/de/A.class")).toBe(false);
    expect(isGeneratedSource("target/classes/de/A.java")).toBe(false);
  });
});

/**
 * The rule lives twice: once in the main process, where the walk happens, and
 * once in the renderer, where the index is filtered. They have to agree, or a
 * file is walked into and then thrown away.
 */
describe("the two copies of the rule", () => {
  const paths = [
    "target/generated-sources/annotations/de/SpielerMapperImpl.java",
    "target/generated-test-sources/test-annotations/de/AT.java",
    "build/generated/sources/annotationProcessor/java/main/de/A.java",
    "build/generated/source/kapt/main/de/B.java",
    "build/generated-src/de/C.java",
    "target/classes/de/A.java",
    "build/libs/app.java",
    "src/main/java/de/A.java",
  ];

  it("answers the same on both sides", () => {
    for (const candidate of paths) {
      expect([candidate, isGeneratedSourcePath(candidate)])
        .toEqual([candidate, isGeneratedSource(candidate)]);
    }
  });

  it("keeps generated sources in the index", () => {
    expect(isBuildArtifact("target/generated-sources/annotations/de/SpielerMapperImpl.java")).toBe(false);
    // Everything else under target is still out.
    expect(isBuildArtifact("target/classes/de/A.class")).toBe(true);
    expect(isBuildArtifact("target/site/index.html")).toBe(true);
    expect(isBuildArtifact("build/libs/app.jar")).toBe(true);
  });
});
