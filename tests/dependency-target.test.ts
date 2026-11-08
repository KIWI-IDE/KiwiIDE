import { describe, expect, it } from "vitest";
import { acceptsDependencies, buildFileKind } from "../src/language/build-files";
import { samePath } from "../src/utils";
import { fileFromUri, fileUri } from "../src/language/monaco-lsp";

/**
 * Which file a library gets written into.
 *
 * This is the part that made "adding a dependency does nothing" true without
 * anything failing: the library was written, correctly, into the root build
 * file of a multi-project build — a file that governs no source. Nothing about
 * the project changed, and no message said otherwise.
 */
describe("files a dependency can be written into", () => {
  it("accepts the two that carry a dependency block", () => {
    expect(acceptsDependencies("C:/projekt/pom.xml")).toBe(true);
    expect(acceptsDependencies("C:/projekt/build.gradle")).toBe(true);
    expect(acceptsDependencies("C:/projekt/build.gradle.kts")).toBe(true);
  });

  it("refuses the build files that hold no dependencies", () => {
    // A settings file lists the projects; gradle.properties holds values.
    expect(acceptsDependencies("C:/projekt/settings.gradle.kts")).toBe(false);
    expect(acceptsDependencies("C:/projekt/settings.gradle")).toBe(false);
    expect(acceptsDependencies("C:/projekt/gradle.properties")).toBe(false);
  });

  it("refuses an ordinary file", () => {
    expect(acceptsDependencies("C:/projekt/src/App.java")).toBe(false);
    expect(acceptsDependencies("C:/projekt/README.md")).toBe(false);
    expect(acceptsDependencies("")).toBe(false);
  });

  it("reads a Windows path as readily as a POSIX one", () => {
    expect(acceptsDependencies("C:\\projekt\\honeymc-cloud\\build.gradle.kts")).toBe(true);
    expect(acceptsDependencies("/home/x/projekt/pom.xml")).toBe(true);
  });

  it("is not fooled by a name that merely ends the same way", () => {
    expect(acceptsDependencies("C:/projekt/mein-pom.xml")).toBe(false);
    expect(acceptsDependencies("C:/projekt/alt.build.gradle")).toBe(false);
  });

  it("stays narrower than the general build-file test", () => {
    expect(buildFileKind("C:/projekt/settings.gradle.kts")).toBe("gradle");
    expect(acceptsDependencies("C:/projekt/settings.gradle.kts")).toBe(false);
  });
});

describe("the file an editor is showing", () => {
  const roundTrip = (file: string) => fileFromUri(fileUri(file));

  it("survives the trip out to a URI and back", () => {
    expect(roundTrip("C:\\projekt\\honeymc-cloud\\build.gradle.kts"))
      .toBe("C:\\projekt\\honeymc-cloud\\build.gradle.kts");
    expect(roundTrip("/home/x/projekt/pom.xml")).toBe("/home/x/projekt/pom.xml");
  });

  it("brings a name with spaces and umlauts back unharmed", () => {
    expect(roundTrip("C:\\Mein Projekt\\Übung\\pom.xml")).toBe("C:\\Mein Projekt\\Übung\\pom.xml");
  });

  it("answers with nothing for anything that is not a file", () => {
    // A guess here would be a path pointing at nothing.
    expect(fileFromUri("inmemory://model/1")).toBe("");
    expect(fileFromUri("https://example.com/pom.xml")).toBe("");
    expect(fileFromUri("")).toBe("");
  });

  it("recognises a build file through its URI", () => {
    expect(acceptsDependencies(fileFromUri(fileUri("D:\\projekt\\honeymc-cloud\\build.gradle.kts")))).toBe(true);
    expect(acceptsDependencies(fileFromUri(fileUri("D:\\projekt\\settings.gradle.kts")))).toBe(false);
  });
});

describe("the build file the service accepts", () => {
  it("names the same file whichever way the drive letter is written", () => {
    // Monaco writes the drive letter in lower case and the rest of Kiwi writes
    // it as Windows does. Compared as text those are two files, and adding a
    // library from the editor was refused as "not a build file of this
    // project" — by the very file that was open.
    const expected = ["C:", "projekt", "build.gradle.kts"].join("\\");
    // This is the shape Monaco actually produces: a lower-case drive letter
    // and the colon percent-encoded.
    expect(fileFromUri("file:///c%3A/projekt/build.gradle.kts")).toBe(expected);
    expect(fileFromUri("file:///c:/projekt/build.gradle.kts")).toBe(expected);
    expect(fileFromUri("file:///C:/projekt/build.gradle.kts")).toBe(expected);
    expect(acceptsDependencies(fileFromUri("file:///c%3A/projekt/build.gradle.kts"))).toBe(true);
  });
});

/**
 * Whether two paths name the same file.
 *
 * Windows cares about neither case nor which slash was used, and the parts of
 * Kiwi that produce a path do not agree about either: a watcher reports what
 * the filesystem gave it, an editor knows its file through a Monaco URI.
 */
describe("comparing two paths", () => {
  it("ignores the case, as Windows does", () => {
    expect(samePath("C:/Projekt/Main.java", "c:/projekt/main.java")).toBe(true);
  });

  it("ignores which slash was used", () => {
    expect(samePath("C:/Projekt/src/Main.java", ["C:", "Projekt", "src", "Main.java"].join("\\"))).toBe(true);
  });

  it("ignores a trailing separator", () => {
    expect(samePath("C:/Projekt/src/", "C:/Projekt/src")).toBe(true);
  });

  it("still tells two different files apart", () => {
    expect(samePath("C:/Projekt/A.java", "C:/Projekt/B.java")).toBe(false);
    expect(samePath("C:/Projekt/src", "C:/Projekt/src/tief")).toBe(false);
  });

  it("survives being asked about nothing", () => {
    expect(samePath("", "")).toBe(true);
    expect(samePath("C:/Projekt", "")).toBe(false);
  });
});
