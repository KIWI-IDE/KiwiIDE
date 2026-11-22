import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { defaultIdeSettings } from "../src/workbench/workbench-defaults";
const require = createRequire(import.meta.url);
const { splashAppearance } = require("../electron/services/splash-appearance.cjs");
const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("startup appearance", () => {
  it("reuses theme anchors in source and minified stylesheets", () => {
    for (const css of [stylesheet, stylesheet.replace(/\[data-theme="([^"]+)"\]/g, '[data-theme=$1]').replace(/\s+/g, ' ')]) {
      const appearance = splashAppearance(css, { ...defaultIdeSettings, theme: "kiwi-light", accentColor: "#dd2266", themeColorOverrides: { panelBackground: "123456" } });
      expect(appearance.theme).toBe("kiwi-light");
      expect(appearance.css).toContain("--panel-base-source:#123456");
      expect(appearance.css).toContain("--accent:#dd2266");
      expect(appearance.css).toContain("--theme-contrast-surface:#ffffff");
    }
  });
  it("uses Nord for unknown themes and rejects malformed colors", () => {
    const appearance = splashAppearance(stylesheet, { ...defaultIdeSettings, theme: '"><script>', accentColor: 'red;</style><script>', themeColorOverrides: { panelBackground: 'nope' } });
    expect(appearance.theme).toBe("kiwi-nord");
    expect(appearance.css).toContain("--accent:#88c0d0");
    expect(appearance.css).not.toContain("<script>");
  });
});
