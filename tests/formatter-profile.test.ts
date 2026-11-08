import { describe, expect, it } from "vitest";

const { formatterProfile } = require("../electron/services/language-service.cjs");

/**
 * What the profile leaves out, Eclipse decides — and three of its defaults
 * rewrite what somebody typed. These pin the settings that stop it.
 */
function settingsOf(xml: string) {
  const found = new Map<string, string>();
  for (const line of xml.split("\n")) {
    const match = line.match(/id="org\.eclipse\.jdt\.core\.formatter\.([^"]+)" value="([^"]*)"/);
    if (match) found.set(match[1], match[2]);
  }
  return found;
}

describe("Java formatter profile", () => {
  it("indents the way the editor does", () => {
    const spaces = settingsOf(formatterProfile({ tabSize: 2, insertSpaces: true }));
    expect(spaces.get("tabulation.char")).toBe("space");
    expect(spaces.get("tabulation.size")).toBe("2");
    expect(spaces.get("indentation.size")).toBe("2");

    // Eclipse's own default is tabs. A project written with spaces was
    // re-indented with tabs on every save until the profile said otherwise.
    const tabs = settingsOf(formatterProfile({ tabSize: 4, insertSpaces: false }));
    expect(tabs.get("tabulation.char")).toBe("tab");
    expect(tabs.get("tabulation.size")).toBe("4");
  });

  it("leaves blank lines to the author", () => {
    const found = settingsOf(formatterProfile());
    // Zero is the Eclipse default, and it deletes blank lines outright.
    expect(Number(found.get("number_of_empty_lines_to_preserve"))).toBeGreaterThanOrEqual(8);
    // Off by default, which empties a blank line inside a method so that
    // typing on it afterwards starts at column one.
    expect(found.get("indent_empty_lines")).toBe("true");
  });

  it("falls back to four spaces and stays valid XML", () => {
    for (const format of [undefined, {}, { tabSize: 0 }, { tabSize: Number.NaN }, { tabSize: 999 }]) {
      const xml = formatterProfile(format as never);
      const width = Number(settingsOf(xml).get("tabulation.size"));
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(16);
      expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
      expect(xml).toContain('<profile kind="CodeFormatterProfile" name="Kiwi"');
      expect(xml).toContain("</profiles>");
    }
  });
});
