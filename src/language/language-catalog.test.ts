import { describe, expect, it } from "vitest";
import { editorLanguageFromPath, isPolyglotLanguage, languageDisplayName, polyglotLanguages, sourceLanguage } from "./language-catalog";

describe("hybrid IDE language catalogue", () => {
  it.each([
    ["Main.java", "java"], ["Main.kt", "kotlin"], ["build.gradle.kts", "kotlin"],
    ["main.py", "python"], ["GUI.PYW", "python"], ["types.pyi", "python"],
    ["src/main.rs", "rust"], ["index.php", "php"], ["template.phtml", "php"],
    ["main.lua", "lua"], ["main.go", "go"], ["main.c", "c"], ["lib.h", "c"],
    ["main.cpp", "cpp"], ["main.cc", "cpp"], ["class.hpp", "cpp"], ["class.hxx", "cpp"],
    ["Program.cs", "csharp"], ["script.csx", "csharp"], ["AppDelegate.m", "objective-c"], ["Bridge.mm", "objective-cpp"],
    ["index.html", "html"], ["theme.scss", "scss"], ["theme.less", "less"],
    ["App.jsx", "javascript"], ["App.tsx", "typescript"], ["types.d.ts", "typescript"],
    ["package.json", "json"], ["settings.jsonc", "json"], ["Cargo.toml", "toml"],
    ["Dockerfile", "dockerfile"], ["Dockerfile.dev", "dockerfile"], ["Makefile", "makefile"], ["CMakeLists.txt", "cmake"],
  ])("recognizes %s as %s", (file, id) => expect(editorLanguageFromPath(file)).toBe(id));

  it("does not read an extension from a parent directory or hidden filename", () => {
    expect(editorLanguageFromPath("C:\\project.py\\LICENSE")).toBe("plaintext");
    expect(editorLanguageFromPath("/workspace.rs/.python-version")).toBe("plaintext");
    expect(editorLanguageFromPath("/a.folder/file.unknown")).toBe("plaintext");
  });

  it("preserves existing build and request-file languages", () => {
    expect(editorLanguageFromPath("pom.xml")).toBe("xml");
    expect(editorLanguageFromPath("build.gradle")).toBe("groovy");
    expect(editorLanguageFromPath("application.properties")).toBe("ini");
    expect(editorLanguageFromPath("requests.http")).toBe("kiwi-http");
    expect(editorLanguageFromPath("requests.rest")).toBe("kiwi-http");
  });

  it("has language-specific completions for every requested external language", () => {
    expect(polyglotLanguages.map(({ id }) => id)).toEqual([
      "kotlin", "python", "rust", "php", "lua", "go", "c", "cpp", "csharp", "objective-c", "objective-cpp",
      "dart", "zig", "swift", "ruby", "elixir", "r", "scala", "shell", "powershell", "perl", "gdscript",
      "sql", "terraform", "assembly", "autohotkey", "odin",
    ]);
    for (const { id } of polyglotLanguages) {
      expect(isPolyglotLanguage(id)).toBe(true);
      expect(sourceLanguage(id)!.keywords.length).toBeGreaterThan(10);
      expect(sourceLanguage(id)!.snippets.length).toBeGreaterThan(2);
      expect(languageDisplayName(id)).not.toBe("");
    }
    expect(isPolyglotLanguage("java")).toBe(false);
    expect(isPolyglotLanguage("html")).toBe(false);
    expect(isPolyglotLanguage("css")).toBe(false);
    expect(isPolyglotLanguage("javascript")).toBe(true);
    expect(isPolyglotLanguage("typescript")).toBe(true);
  });
});
