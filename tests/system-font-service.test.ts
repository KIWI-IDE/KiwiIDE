import { describe, expect, it, vi } from "vitest";

const {
  SystemFontService,
  WINDOWS_FONT_REGISTRY_KEYS,
  deduplicateAndSortFontFamilies,
  normalizeRegistryFontName,
  parseWindowsFontRegistry,
} = require("../electron/services/system-font-service.cjs");

describe("system font discovery", () => {
  it("parses Windows registry values and ignores headings or unsupported types", () => {
    const output = [
      "",
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
      "    Arial (TrueType)    REG_SZ    arial.ttf",
      "    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf",
      "    Cambria & Cambria Math (TrueType)    REG_SZ    cambria.ttc",
      "    User Variable Font (OpenType)    REG_EXPAND_SZ    %LOCALAPPDATA%\\font.otf",
      "    (Default)    REG_SZ    ",
      "    Ignored binary    REG_BINARY    01",
    ].join("\r\n");

    expect(parseWindowsFontRegistry(output)).toEqual([
      "Arial",
      "Arial",
      "Cambria",
      "Cambria Math",
      "User Variable Font",
    ]);
  });

  it("normalizes only registry metadata and keeps meaningful family names", () => {
    expect(normalizeRegistryFontName("  Source   Code Pro (TrueType) ")).toEqual(["Source Code Pro"]);
    expect(normalizeRegistryFontName("Rock & Roll Sans (OpenType)")).toEqual(["Rock", "Roll Sans"]);
    expect(normalizeRegistryFontName("Arial Black (TrueType)")).toEqual(["Arial Black"]);
    expect(normalizeRegistryFontName("Arial Bold Italic (TrueType)")).toEqual(["Arial"]);
    expect(normalizeRegistryFontName("Calibri Light (TrueType)")).toEqual(["Calibri Light"]);
    expect(normalizeRegistryFontName("(Default)")).toEqual([]);
  });

  it("deduplicates case-insensitively, removes unsafe whitespace and sorts", () => {
    expect(deduplicateAndSortFontFamilies([
      "  Consolas ",
      "arial",
      "CONSOLAS",
      "Arial",
      "JetBrains   Mono",
      "bad\nfont",
      "",
    ])).toEqual(["arial", "Consolas", "JetBrains Mono"]);
  });

  it("combines both Windows hives with fallbacks and caches the result", async () => {
    const readRegistryKey = vi.fn(async (key: string) => key.startsWith("HKLM")
      ? "    Custom Mono (TrueType)    REG_SZ    custom.ttf\r\n    Consolas (TrueType)    REG_SZ    consola.ttf"
      : "    custom mono (OpenType)    REG_SZ    custom.otf\r\n    Local Sans (TrueType)    REG_SZ    local.ttf");
    const service = new SystemFontService({ platform: "win32", readRegistryKey });

    const first = await service.list();
    first.push("mutation must not enter cache");
    const second = await service.list();

    expect(readRegistryKey).toHaveBeenCalledTimes(WINDOWS_FONT_REGISTRY_KEYS.length);
    expect(second).toContain("Custom Mono");
    expect(second).toContain("Local Sans");
    expect(second).toContain("Consolas");
    expect(second).not.toContain("custom mono");
    expect(second).not.toContain("mutation must not enter cache");
  });

  it("keeps Settings usable when a registry hive cannot be read", async () => {
    const service = new SystemFontService({
      platform: "win32",
      readRegistryKey: async (key: string) => {
        if (key.startsWith("HKCU")) throw new Error("access denied");
        return "    Company Font (TrueType)    REG_SZ    company.ttf";
      },
    });

    await expect(service.list()).resolves.toEqual(expect.arrayContaining([
      "Company Font",
      "Cascadia Code",
      "Consolas",
    ]));
  });

  it("uses a deterministic standard list outside Windows without spawning a query", async () => {
    const readRegistryKey = vi.fn();
    const service = new SystemFontService({ platform: "linux", readRegistryKey });

    await expect(service.list()).resolves.toEqual(expect.arrayContaining([
      "DejaVu Sans Mono",
      "Liberation Mono",
      "monospace",
    ]));
    expect(readRegistryKey).not.toHaveBeenCalled();
  });
});
