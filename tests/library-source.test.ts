import { describe, expect, it } from "vitest";
import {
  describeLibraryUri,
  editorOpenTarget,
  isLibraryUri,
  isReadOnlyDocument,
  libraryClassSubtitle,
} from "../src/language/library-source";

const JDT = "jdt://contents/jline-3.25.1.jar/org.jline.terminal/TerminalBuilder.class?=demo/x";

/**
 * Classes that come out of a jar.
 *
 * They have no file on disk, so the tab has to be named from the address the
 * language server used — and a tab labelled with a wrong class name would be
 * worse than one labelled with the address itself.
 */
describe("recognising an address inside a library", () => {
  it("knows the schemes a class can arrive under", () => {
    expect(isLibraryUri(JDT)).toBe(true);
    expect(isLibraryUri("jar:file:///a/b.jar!/C.class")).toBe(true);
    expect(isLibraryUri("file:///C:/projekt/src/Main.java")).toBe(false);
    expect(isLibraryUri("C:/projekt/src/Main.java")).toBe(false);
    expect(isLibraryUri("")).toBe(false);
  });

  it("reads the class, the package and the jar", () => {
    expect(describeLibraryUri(JDT)).toEqual({
      name: "TerminalBuilder.class",
      packageName: "org.jline.terminal",
      origin: "jline-3.25.1.jar",
    });
  });

  it("drops the opaque handle the address ends with", () => {
    expect(describeLibraryUri(JDT)?.name).not.toContain("?");
  });

  it("leaves out what it cannot read rather than guessing", () => {
    const sparse = describeLibraryUri("jdt://contents/Thing.class");
    expect(sparse?.name).toBe("Thing.class");
    expect(sparse?.origin).toBe("");
    expect(sparse?.packageName).toBe("");
  });

  it("answers nothing for an address that is not in a library", () => {
    expect(describeLibraryUri("file:///C:/projekt/Main.java")).toBeNull();
    expect(describeLibraryUri("")).toBeNull();
  });

  it("says where a class came from, in the order a reader wants it", () => {
    expect(libraryClassSubtitle(describeLibraryUri(JDT)))
      .toBe("org.jline.terminal · jline-3.25.1.jar");
    expect(libraryClassSubtitle(describeLibraryUri("jdt://contents/Thing.class"))).toBe("");
    expect(libraryClassSubtitle(null)).toBe("");
  });
});

describe("what can be written to", () => {
  it("treats everything from a library as read-only", () => {
    // There is no file to save into, and a decompiled body is not the source
    // anybody wrote.
    expect(isReadOnlyDocument(JDT)).toBe(true);
    expect(isReadOnlyDocument("C:/projekt/src/Main.java")).toBe(false);
  });
});

/**
 * What Ctrl+Click asks to be opened.
 *
 * Monaco hands over an address and, when it knows one, a selection or a bare
 * position. The two shapes differ, and reading only one of them puts the
 * reader at the top of the file instead of on the line they asked for.
 */
describe("deciding what to open", () => {
  const toPath = (uri: string) => uri.startsWith("file:///")
    ? uri.slice("file:///".length).split("/").join("\\")
    : "";

  it("sends a library address to the read-only path", () => {
    expect(editorOpenTarget(JDT, "", { startLineNumber: 12, startColumn: 5 }, toPath))
      .toEqual({ kind: "library", uri: JDT, position: { line: 12, column: 5 } });
  });

  it("sends a file address to the ordinary one", () => {
    expect(editorOpenTarget("file:///C:/projekt/Main.java", "", { lineNumber: 3, column: 7 }, toPath))
      .toEqual({ kind: "file", path: "C:\\projekt\\Main.java", position: { line: 3, column: 7 } });
  });

  it("reads a selection and a bare position alike", () => {
    const fromSelection = editorOpenTarget(JDT, "", { startLineNumber: 9, startColumn: 2 });
    const fromPosition = editorOpenTarget(JDT, "", { lineNumber: 9, column: 2 });
    expect(fromSelection).toEqual(fromPosition);
  });

  it("opens without a position when the jump did not name one", () => {
    expect(editorOpenTarget(JDT, "", undefined))
      .toEqual({ kind: "library", uri: JDT, position: undefined });
    expect(editorOpenTarget(JDT, "", { startLineNumber: 0, startColumn: 0 }).position).toBeUndefined();
  });

  it("falls back to the path Monaco read when it cannot decode the address", () => {
    expect(editorOpenTarget("untitled:Draft", "C:\\projekt\\Draft.java", null, toPath))
      .toEqual({ kind: "file", path: "C:\\projekt\\Draft.java", position: undefined });
  });

  it("refuses rather than opening nothing", () => {
    // Answering "handled" for an address nothing can open would swallow the
    // jump exactly as the missing opener did.
    expect(editorOpenTarget("", "", null)).toEqual({ kind: "none" });
    expect(editorOpenTarget("untitled:Draft", "", null, toPath)).toEqual({ kind: "none" });
  });
});
