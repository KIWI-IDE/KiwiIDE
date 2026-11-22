import { describe, expect, it, vi } from "vitest";
import { defineMonacoThemes } from "./monaco-workbench-themes";

describe("editor widget accents", () => {
  it("recolors controls while preserving syntax and explicit editor colors", () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } } as unknown as Parameters<typeof defineMonacoThemes>[0];
    const render = (accent: string) => {
      defineTheme.mockClear();
      defineMonacoThemes(monaco, false, { keyword: "112233" }, "theme", { editorCursor: "ABCDEF" }, accent);
      return defineTheme.mock.calls.find(([id]) => id === "kiwi-nord")![1];
    };
    const blue = render("#3388ee");
    const pink = render("#dd2266");
    expect(blue.colors.focusBorder).toBe("#3388ee");
    expect(pink.colors.focusBorder).toBe("#dd2266");
    expect(pink.colors["button.background"]).toBe("#dd2266");
    expect(pink.colors["inputOption.activeBorder"]).toBe("#dd2266");
    expect(pink.colors["editorCursor.foreground"]).toBe("#ABCDEF");
    expect(pink.rules).toEqual(blue.rules);
  });
});
