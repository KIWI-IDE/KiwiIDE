import { describe, expect, it } from "vitest";
import {
  duplicateName,
  formatTimeOfDay,
  isDaytime,
  parseThemeFile,
  parseTimeOfDay,
  scheduledTheme,
  settingsFromThemeFile,
  themeFileFrom,
  themeFileName,
  THEME_FILE_VERSION,
} from "../src/theme-file";

const settings = {
  theme: "kiwi-new-dark",
  editorColorScheme: "theme",
  editorTokenColors: { comment: "6A7364", keyword: "#74CB35", kaputt: "nope" },
  themeColorOverrides: { explorerBackground: "111410" },
};

/**
 * Colours somebody spent an evening on lived in one machine's settings, with
 * no way to keep a copy or send one to anybody.
 */
describe("writing a theme file", () => {
  const file = themeFileFrom(settings, "  Mein Theme  ");

  it("keeps the name, the base and both override maps", () => {
    expect(file).toMatchObject({
      version: THEME_FILE_VERSION,
      name: "Mein Theme",
      base: "kiwi-new-dark",
      colorScheme: "theme",
    });
    expect(file.workbench).toEqual({ explorerBackground: "111410" });
  });

  it("drops what is not a colour and normalises what is", () => {
    // A stray hash and a lower-case value are the same colour.
    expect(file.tokens).toEqual({ comment: "6A7364", keyword: "74CB35" });
  });

  it("still gives an unnamed theme a name", () => {
    expect(themeFileFrom(settings, "").name).toBe("Eigenes Theme");
  });
});

describe("reading a theme file", () => {
  it("reads back what it wrote", () => {
    const file = themeFileFrom(settings, "Mein Theme");
    const parsed = parseThemeFile(JSON.stringify(file));
    expect(parsed).toEqual(file);
  });

  it("keeps a file with one mistyped colour rather than refusing it whole", () => {
    const parsed = parseThemeFile(JSON.stringify({
      name: "Halb", base: "kiwi-new-dark", tokens: { comment: "6A7364", kaputt: "xyz" },
    }));
    expect(parsed?.tokens).toEqual({ comment: "6A7364" });
  });

  it("refuses something that is not a theme at all", () => {
    expect(parseThemeFile("kein json")).toBeNull();
    expect(parseThemeFile("[]")).toBeNull();
    expect(parseThemeFile("{}")).toBeNull();
    expect(parseThemeFile("")).toBeNull();
  });

  it("falls back when the base theme is one this build does not have", () => {
    // Carrying it through would leave every unset colour undefined.
    const parsed = parseThemeFile(
      JSON.stringify({ name: "Fremd", base: "aus-einer-anderen-version", tokens: { comment: "6A7364" } }),
      ["kiwi-new-dark", "kiwi-light"],
    );
    expect(parsed?.base).toBe("kiwi-new-dark");
  });

  it("keeps a base this build does know", () => {
    const parsed = parseThemeFile(
      JSON.stringify({ name: "Bekannt", base: "kiwi-light", tokens: { comment: "6A7364" } }),
      ["kiwi-new-dark", "kiwi-light"],
    );
    expect(parsed?.base).toBe("kiwi-light");
  });

  it("turns back into the settings it stands for", () => {
    const file = themeFileFrom(settings, "Mein Theme");
    expect(settingsFromThemeFile(file)).toEqual({
      theme: "kiwi-new-dark",
      editorColorScheme: "theme",
      editorTokenColors: { comment: "6A7364", keyword: "74CB35" },
      themeColorOverrides: { explorerBackground: "111410" },
    });
  });
});

describe("naming the file", () => {
  it("makes a usable name out of a spoken one", () => {
    expect(themeFileName("Mein grünes Theme")).toBe("Mein-grünes-Theme.kiwi-theme.json");
  });

  it("still names a theme called nothing", () => {
    expect(themeFileName("   ")).toBe("kiwi-theme.kiwi-theme.json");
    expect(themeFileName("///")).toBe("kiwi-theme.kiwi-theme.json");
  });
});

/**
 * Duplicating twice must give two themes, not one that silently replaced the
 * other.
 */
describe("naming a copy", () => {
  it("calls the first one Kopie", () => {
    expect(duplicateName("Kiwi Dunkel", [])).toBe("Kiwi Dunkel Kopie");
  });

  it("numbers the next ones", () => {
    expect(duplicateName("Kiwi Dunkel", ["Kiwi Dunkel Kopie"])).toBe("Kiwi Dunkel Kopie 2");
    expect(duplicateName("Kiwi Dunkel", ["Kiwi Dunkel Kopie", "Kiwi Dunkel Kopie 2"]))
      .toBe("Kiwi Dunkel Kopie 3");
  });

  it("does not care about capitals when checking what is taken", () => {
    expect(duplicateName("Kiwi", ["kiwi kopie"])).toBe("Kiwi Kopie 2");
  });
});

/**
 * A schedule that rewrote the theme on every tick would fight anybody choosing
 * one by hand.
 */
describe("a theme that changes by itself", () => {
  const base = {
    dayTheme: "kiwi-light",
    nightTheme: "kiwi-new-dark",
    dayStart: 7 * 60,
    nightStart: 19 * 60,
  };

  it("leaves the theme alone when nothing is scheduled", () => {
    expect(scheduledTheme({ ...base, schedule: "off", now: 12 * 60 })).toBe("");
  });

  it("follows the operating system when asked to", () => {
    expect(scheduledTheme({ ...base, schedule: "system", systemPrefersDark: true, now: 12 * 60 }))
      .toBe("kiwi-new-dark");
    expect(scheduledTheme({ ...base, schedule: "system", systemPrefersDark: false, now: 12 * 60 }))
      .toBe("kiwi-light");
  });

  it("follows the clock when asked to", () => {
    // The light in a room does not ask the operating system.
    expect(scheduledTheme({ ...base, schedule: "time", now: 12 * 60 })).toBe("kiwi-light");
    expect(scheduledTheme({ ...base, schedule: "time", now: 22 * 60 })).toBe("kiwi-new-dark");
    expect(scheduledTheme({ ...base, schedule: "time", now: 3 * 60 })).toBe("kiwi-new-dark");
  });

  it("takes a window that wraps past midnight", () => {
    // Somebody who works nights: day from 20:00 to 06:00.
    expect(isDaytime(22 * 60, 20 * 60, 6 * 60)).toBe(true);
    expect(isDaytime(2 * 60, 20 * 60, 6 * 60)).toBe(true);
    expect(isDaytime(12 * 60, 20 * 60, 6 * 60)).toBe(false);
  });

  it("changes nothing when the two times are the same", () => {
    // Otherwise the theme flips every minute.
    expect(scheduledTheme({ ...base, schedule: "time", dayStart: 480, nightStart: 480, now: 600 })).toBe("");
  });

  it("changes nothing when a theme is missing", () => {
    expect(scheduledTheme({ ...base, nightTheme: "", schedule: "time", now: 22 * 60 })).toBe("");
  });

  it("switches exactly at the boundary and not before", () => {
    expect(scheduledTheme({ ...base, schedule: "time", now: 19 * 60 - 1 })).toBe("kiwi-light");
    expect(scheduledTheme({ ...base, schedule: "time", now: 19 * 60 })).toBe("kiwi-new-dark");
  });
});

describe("times of day", () => {
  it("reads a written time", () => {
    expect(parseTimeOfDay("07:30")).toBe(450);
    expect(parseTimeOfDay("7:05")).toBe(425);
    expect(parseTimeOfDay("00:00")).toBe(0);
  });

  it("refuses something that is not a time", () => {
    expect(parseTimeOfDay("24:00")).toBe(-1);
    expect(parseTimeOfDay("07:60")).toBe(-1);
    expect(parseTimeOfDay("halb acht")).toBe(-1);
    expect(parseTimeOfDay("")).toBe(-1);
  });

  it("writes one back", () => {
    expect(formatTimeOfDay(450)).toBe("07:30");
    expect(formatTimeOfDay(0)).toBe("00:00");
    // A value that ran past midnight wraps rather than becoming "25:00".
    expect(formatTimeOfDay(25 * 60)).toBe("01:00");
    expect(formatTimeOfDay(-60)).toBe("23:00");
  });
});
