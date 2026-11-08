import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  MAX_SEARCHABLE_BYTES,
  WorkspaceService,
  commentExtensions,
  ignoredDirectories,
  isSearchableTextFile,
  textExtensions,
} = require("../electron/services/workspace-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");

/**
 * Which files the project-wide search reads.
 *
 * A search that skips a file does not say so — it reports no result, which
 * reads exactly like the word not being there. The list was written for a
 * plain Java project and had not kept up with what Kiwi itself supports: a
 * Gradle version catalogue is a .toml and Kiwi's own request files are .http,
 * and neither was ever opened.
 */
describe("what the search reads", () => {
  const searchable = (file: string) => isSearchableTextFile(path.join("C:", "projekt", file));

  it("reads Java sources and build files", () => {
    for (const file of ["App.java", "pom.xml", "build.gradle.kts", "settings.gradle", "gradle.properties"]) {
      expect({ file, read: searchable(file) }).toEqual({ file, read: true });
    }
  });

  it("reads a Gradle version catalogue", () => {
    expect(searchable("libs.versions.toml")).toBe(true);
  });

  it("reads the request files Kiwi itself edits", () => {
    expect(searchable("api.http")).toBe(true);
  });

  it("reads config files that carry no extension", () => {
    for (const file of ["Dockerfile", "gradlew", "mvnw", "Makefile", "README"]) {
      expect({ file, read: searchable(file) }).toEqual({ file, read: true });
    }
  });

  it("reads dotfiles", () => {
    expect(searchable(".gitignore")).toBe(true);
    expect(searchable(".editorconfig")).toBe(true);
  });

  it("does not read binaries", () => {
    for (const file of ["logo.png", "Main.class", "library.jar", "archive.zip", "font.woff2"]) {
      expect({ file, read: searchable(file) }).toEqual({ file, read: false });
    }
  });

  it("does not care how the name is capitalised", () => {
    expect(searchable("DOCKERFILE")).toBe(true);
    expect(searchable("App.JAVA")).toBe(true);
  });

  it("survives being asked about nothing", () => {
    expect(isSearchableTextFile("")).toBe(false);
    expect(isSearchableTextFile(null)).toBe(false);
  });
});

describe("the lists behind it", () => {
  it("skips the directories no search should ever walk into", () => {
    for (const name of [".git", "node_modules", ".gradle", ".idea", ".kiwi"]) {
      expect({ name, ignored: ignoredDirectories.has(name) }).toEqual({ name, ignored: true });
    }
    expect(ignoredDirectories.has("src")).toBe(false);
  });

  it("scans for task comments in every source it can read comments from", () => {
    for (const extension of [".java", ".kts", ".gradle", ".ts", ".toml", ".http"]) {
      expect({ extension, scanned: commentExtensions.has(extension) }).toEqual({ extension, scanned: true });
    }
  });

  it("does not scan for comments in a format whose comments it cannot read", () => {
    // XML comments are <!-- -->, which the scanner does not know; reading it
    // with the // and # rules would report the contents of ordinary tags.
    expect(commentExtensions.has(".xml")).toBe(false);
    expect(commentExtensions.has(".json")).toBe(false);
    expect(commentExtensions.has(".md")).toBe(false);
  });

  it("keeps every commented format searchable", () => {
    for (const extension of commentExtensions) {
      expect({ extension, searchable: textExtensions.has(extension) })
        .toEqual({ extension, searchable: true });
    }
  });
});

describe("how large a file the search will open", () => {
  it("stops well short of anything a person writes by hand", () => {
    expect(MAX_SEARCHABLE_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_SEARCHABLE_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);
  });

  it("reads a source file and passes over a generated one", async () => {
    // A build log and an exported table are both text and both belong in the
    // list of formats the search reads. Either can be hundreds of megabytes,
    // and the search reads a file whole before splitting it into lines.
    const root = mkdtempSync(path.join(tmpdir(), "kiwi-suche-"));
    writeFileSync(path.join(root, "Main.java"), "class Main { int zaehler = 1; }\n", "utf8");
    writeFileSync(path.join(root, "build.log"), "zaehler ".repeat(MAX_SEARCHABLE_BYTES / 8 + 1), "utf8");
    const guard = new PathGuard();
    guard.register(root);
    const service = new WorkspaceService(guard, {}, () => undefined);
    const matches = await service.search(root, "zaehler");
    expect(matches.map((match: { path: string }) => path.basename(match.path))).toEqual(["Main.java"]);
  });
});
