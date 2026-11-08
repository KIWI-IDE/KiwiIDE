import { describe, expect, it } from "vitest";
import { samePath } from "../src/utils";
import { fileFromUri, fileUri } from "../src/language/monaco-lsp";

/**
 * The same file, spelled two ways.
 *
 * Monaco knows a file by a URI and writes the drive letter of one in lower
 * case; the workbench knows the same file by the path Windows handed it. Every
 * place that compared the two as text therefore had a chance of deciding they
 * were different files — and each did so silently, because "no match" is a
 * legitimate answer everywhere it was asked.
 *
 * It cost a breakpoint its mark in the gutter: the breakpoint was set, listed
 * and handed to the debugger, and only the glyph was missing, which reads
 * exactly like the click not having worked.
 */
describe("a Monaco path and a workbench path name the same file", () => {
  const workbench = "C:\\Users\\dev\\projekt\\src\\Beta.java";

  it("survives the round trip through a Monaco URI", () => {
    const monaco = fileFromUri(fileUri(workbench));
    expect(samePath(monaco, workbench)).toBe(true);
  });

  it("holds however the drive letter is spelled", () => {
    expect(samePath("c:\\projekt\\Beta.java", "C:\\projekt\\Beta.java")).toBe(true);
    expect(samePath("C:/projekt/Beta.java", "C:\\projekt\\Beta.java")).toBe(true);
  });

  it("still tells two different files apart", () => {
    expect(samePath("C:\\projekt\\Beta.java", "C:\\projekt\\Alpha.java")).toBe(false);
    expect(samePath("C:\\projekt\\src\\Beta.java", "C:\\projekt\\test\\Beta.java")).toBe(false);
  });

  it("is not fooled by an empty path", () => {
    expect(samePath("", "C:\\projekt\\Beta.java")).toBe(false);
    expect(samePath("", "")).toBe(true);
  });
});
