import { describe, expect, it } from "vitest";
import {
  applyIndexChange,
  emptyIndex,
  indexNeedsRefresh,
  isBuildArtifact,
  INDEX_VERSION,
  normalizeIndexPath,
  readProjectIndex,
  relativeIndexPath,
  searchIndex,
  type ProjectIndex,
} from "../src/project-index";

const ROOT = "C:/projekt";
const NOW = 1_700_000_000_000;

const index = (paths: string[], builtAt = NOW): ProjectIndex => ({
  version: INDEX_VERSION,
  root: ROOT,
  builtAt,
  files: paths.map((path) => ({ path, modified: NOW })),
});

const files = [
  "src/main/java/de/beispiel/plugin/SpielerVerwaltung.java",
  "src/main/java/de/beispiel/plugin/Spieler.java",
  "src/test/java/de/beispiel/plugin/SpielerVerwaltungTest.java",
  "pom.xml",
  "README.md",
];

/**
 * The file palette searched the Explorer's tree, and that tree loads one level
 * at a time — so a file in a folder nobody had expanded to was not there.
 */
describe("finding a file by name", () => {
  it("finds one nobody has expanded to", () => {
    expect(searchIndex(index(files), "SpielerVerwaltung")[0].path)
      .toBe("src/main/java/de/beispiel/plugin/SpielerVerwaltung.java");
  });

  it("puts the exact name before the longer one that contains it", () => {
    const found = searchIndex(index(files), "spieler").map((match) => match.name);
    expect(found[0]).toBe("Spieler.java");
  });

  it("matches the name, not the folders above it", () => {
    // Typing a class name means the class, not every file under a folder that
    // happens to contain those letters.
    expect(searchIndex(index(files), "beispiel")).toEqual([]);
  });

  it("matches the whole path when the query has a slash in it", () => {
    const found = searchIndex(index(files), "test/java");
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("SpielerVerwaltungTest.java");
  });

  it("ignores case, because nobody types it", () => {
    expect(searchIndex(index(files), "SPIELERVERWALTUNG")).toHaveLength(2);
  });

  it("answers nothing for nothing", () => {
    expect(searchIndex(index(files), "")).toEqual([]);
    expect(searchIndex(index(files), "zzz")).toEqual([]);
    expect(searchIndex(emptyIndex(ROOT), "a")).toEqual([]);
  });

  it("keeps the list short enough to render", () => {
    const many = index(Array.from({ length: 500 }, (_, i) => `src/A${i}.java`));
    expect(searchIndex(many, "a").length).toBeLessThanOrEqual(60);
  });
});

/**
 * Rebuilding the whole list because one file was saved is what made the old
 * tree refresh visible on a large project.
 */
describe("keeping it current without walking again", () => {
  it("adds a file that appeared", () => {
    const next = applyIndexChange(index(["a.java"]), { changed: ["C:/projekt/src/Neu.java"] }, NOW + 1);
    expect(next.files.map((file) => file.path)).toContain("src/Neu.java");
  });

  it("drops a file that is gone", () => {
    const next = applyIndexChange(index(["a.java", "b.java"]), { removed: ["C:/projekt/a.java"] }, NOW + 1);
    expect(next.files.map((file) => file.path)).toEqual(["b.java"]);
  });

  it("does not add the same file twice", () => {
    const next = applyIndexChange(index(["a.java"]), { changed: ["C:/projekt/a.java"] }, NOW + 1);
    expect(next.files).toHaveLength(1);
    expect(next.files[0].modified).toBe(NOW + 1);
  });

  it("takes a path in either spelling", () => {
    const next = applyIndexChange(index([]), { changed: ["C:\\projekt\\src\\Neu.java"] }, NOW);
    expect(next.files[0].path).toBe("src/Neu.java");
  });

  it("leaves everything else alone", () => {
    const before = index(files);
    const after = applyIndexChange(before, { changed: ["C:/projekt/pom.xml"] }, NOW + 1);
    expect(after.files).toHaveLength(before.files.length);
  });
});

/**
 * The stored list is a cache and is treated as one. A cache that refuses to
 * load is a rebuild; a cache that loads the wrong project's files is a search
 * that lies.
 */
describe("reading a stored index", () => {
  it("reads back what was written", () => {
    expect(readProjectIndex(JSON.stringify(index(files)), ROOT).files).toHaveLength(files.length);
  });

  it("rebuilds rather than failing on anything unreadable", () => {
    expect(readProjectIndex("{ kaputt", ROOT).files).toEqual([]);
    expect(readProjectIndex("", ROOT).files).toEqual([]);
  });

  it("refuses an index written by another version", () => {
    const old = JSON.stringify({ ...index(files), version: 0 });
    expect(readProjectIndex(old, ROOT).files).toEqual([]);
  });

  it("refuses another project's index outright", () => {
    // Loading it would answer every search with files that are not there.
    const other = JSON.stringify({ ...index(files), root: "C:/anderes" });
    expect(readProjectIndex(other, ROOT).files).toEqual([]);
  });

  it("takes the same project written the other way", () => {
    const windows = JSON.stringify({ ...index(files), root: "C:\\Projekt" });
    expect(readProjectIndex(windows, ROOT).files).toHaveLength(files.length);
  });

  it("drops an entry with no path rather than the whole index", () => {
    const partly = JSON.stringify({ ...index([]), files: [{ path: "" }, { path: "a.java" }] });
    expect(readProjectIndex(partly, ROOT).files.map((file) => file.path)).toEqual(["a.java"]);
  });
});

describe("when to walk again", () => {
  it("walks when there is nothing stored", () => {
    expect(indexNeedsRefresh(emptyIndex(ROOT), NOW)).toBe(true);
  });

  it("walks when the list is old, because Kiwi was not watching", () => {
    expect(indexNeedsRefresh(index(files, NOW - 2 * 60 * 60 * 1000), NOW)).toBe(true);
    expect(indexNeedsRefresh(index(files, NOW - 1000), NOW)).toBe(false);
  });
});

describe("writing a path down one way", () => {
  it("uses forward slashes whatever the platform wrote", () => {
    expect(normalizeIndexPath("src\\main\\A.java")).toBe("src/main/A.java");
    expect(normalizeIndexPath("./a.java")).toBe("a.java");
  });

  it("cuts the project root off the front", () => {
    expect(relativeIndexPath(ROOT, "C:/projekt/src/A.java")).toBe("src/A.java");
    expect(relativeIndexPath(ROOT, "c:\\PROJEKT\\src\\A.java")).toBe("src/A.java");
    // Already relative, or somewhere else entirely: left as it is.
    expect(relativeIndexPath(ROOT, "src/A.java")).toBe("src/A.java");
  });
});

/**
 * Nobody has ever wanted to open a .class file from a file palette.
 */
describe("telling what a build produced from what was written", () => {
  it("knows the compiled shapes", () => {
    expect(isBuildArtifact("target/classes/de/A.class")).toBe(true);
    expect(isBuildArtifact("build/libs/app.jar")).toBe(true);
    expect(isBuildArtifact("out/production/A.class")).toBe(true);
  });

  it("leaves the sources alone", () => {
    expect(isBuildArtifact("src/main/java/de/A.java")).toBe(false);
    expect(isBuildArtifact("pom.xml")).toBe(false);
    // A source folder that merely has "build" in its name is not build output.
    expect(isBuildArtifact("src/main/java/de/buildtools/A.java")).toBe(false);
  });

  it("reads a Windows path the same way", () => {
    // Written with real separators: without them the string ends in ".class"
    // anyway and the test passes without testing anything.
    expect(isBuildArtifact("target\\classes\\de\\Foo.java")).toBe(true);
    expect(isBuildArtifact("src\\main\\java\\Foo.java")).toBe(false);
  });
});

describe("what the watcher is allowed to add", () => {
  it("refuses build output the walk would never have collected", () => {
    // The compiler writes class files constantly and the watcher reports every
    // one; without this the index filled with target/classes and a search for
    // a class answered with its .class file first.
    const next = applyIndexChange(index(["src/A.java"]), {
      changed: ["C:/projekt/target/classes/de/A.class", "C:/projekt/src/B.java"],
    }, NOW + 1);
    expect(next.files.map((file) => file.path)).toEqual(["src/A.java", "src/B.java"]);
  });
});
