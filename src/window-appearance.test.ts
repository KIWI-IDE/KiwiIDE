import { describe, expect, it } from "vitest";
import type { IdeSettings, KiwiApi } from "./types";
import { watchWindowAppearance } from "./window-appearance";
import { defaultIdeSettings } from "./workbench/workbench-defaults";
import { defaultThemeId, findTheme } from "./themes";

function documentRoot() {
  const variables = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => variables.set(name, value),
      removeProperty: (name: string) => variables.delete(name),
    },
  };
  return { root: root as unknown as HTMLElement, variables };
}

function settingsSource() {
  let resolve!: (settings: IdeSettings) => void;
  const listeners = new Set<Parameters<KiwiApi["settings"]["onChanged"]>[0]>();
  return {
    api: {
      get: () => new Promise<IdeSettings>((done) => { resolve = done; }),
      onChanged: (listener: Parameters<KiwiApi["settings"]["onChanged"]>[0]) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    },
    resolve: (settings: IdeSettings) => resolve(settings),
    change: (settings: IdeSettings) => listeners.forEach((listener) => listener({ settings, patch: settings })),
  };
}

describe("window appearance", () => {
  it("defaults and falls back to Kiwi Nord", () => {
    expect(defaultIdeSettings.theme).toBe("kiwi-nord");
    expect(defaultIdeSettings.themeNight).toBe("kiwi-nord");
    expect(defaultIdeSettings.accentColor).toBe("#88c0d0");
    expect(defaultThemeId).toBe("kiwi-nord");
    expect(findTheme("missing-theme").id).toBe("kiwi-nord");
  });

  it("updates every document, removes cleared overrides and ignores stale reads", async () => {
    const source = settingsSource();
    const first = documentRoot();
    const second = documentRoot();
    // Each real renderer has its own settings read and event subscription.
    watchWindowAppearance({ ...source.api, get: async () => defaultIdeSettings }, first.root);
    const stop = watchWindowAppearance(source.api, second.root);
    await Promise.resolve();
    const custom = { ...defaultIdeSettings, theme: "kiwi-light", accentColor: "#dd2266", uiRoundness: 140, themeColorOverrides: { chromeBackground: "112233", selection: "ddeeff" } };
    source.change(custom);
    for (const doc of [first, second]) {
      expect(doc.root.dataset.theme).toBe("kiwi-light");
      expect(doc.variables.get("--accent")).toBe("#dd2266");
      expect(doc.variables.get("--roundness")).toBe("1.4");
      expect(doc.variables.get("--chrome-base-source")).toBe("#112233");
      expect(doc.variables.get("--selection-accent")).toBe("#ddeeff");
      expect(doc.variables.get("--theme-contrast-surface")).toBe("#ffffff");
    }
    source.resolve(defaultIdeSettings);
    await Promise.resolve();
    expect(second.root.dataset.theme).toBe("kiwi-light");
    source.change({ ...defaultIdeSettings, accentColor: "#3388ee" });
    for (const doc of [first, second]) {
      expect(doc.root.dataset.theme).toBe("kiwi-nord");
      expect(doc.variables.has("--chrome-base-source")).toBe(false);
      expect(doc.variables.has("--selection-accent")).toBe(false);
      expect(doc.variables.get("--accent")).toBe("#3388ee");
    }
    stop();
    source.change(custom);
    expect(second.root.dataset.theme).toBe("kiwi-nord");
  });
});
