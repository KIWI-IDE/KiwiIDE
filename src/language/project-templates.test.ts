import { describe, expect, it } from "vitest";
import { getProjectNewTemplates, PYTHON_TEMPLATES, PHP_TEMPLATES, WEB_TEMPLATES } from "./project-templates";

describe("Project templates for explorer new menu", () => {
  it("provides python templates with runnable main script", () => {
    const { languageItems, webItems } = getProjectNewTemplates("python");
    expect(languageItems.length).toBeGreaterThan(3);
    const mainScript = languageItems.find((i) => i.id === "python-script");
    expect(mainScript).toBeDefined();
    expect(mainScript?.content("main")).toContain('if __name__ == "__main__":');
    expect(mainScript?.content("main")).toContain("def main():");
    expect(webItems.length).toBeGreaterThan(0);
  });

  it("provides web and php templates", () => {
    const { languageItems, webItems } = getProjectNewTemplates("php");
    expect(languageItems.some((i) => i.id === "php-script")).toBe(true);
    expect(languageItems.some((i) => i.id === "php-class")).toBe(true);
    expect(webItems.some((i) => i.id === "html")).toBe(true);
    expect(webItems.some((i) => i.id === "css")).toBe(true);
    expect(webItems.some((i) => i.id === "js")).toBe(true);
  });

  it("provides rust, go, c, cpp, csharp, kotlin templates", () => {
    for (const lang of ["rust", "go", "c", "cpp", "csharp", "kotlin", "lua", "typescript", "javascript", "node"]) {
      const { languageItems } = getProjectNewTemplates(lang);
      expect(languageItems.length).toBeGreaterThan(0);
      expect(languageItems[0].content("test")).toBeTruthy();
    }
  });
});
