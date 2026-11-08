import { describe, expect, it } from "vitest";
import {
  MACHINE_SPECIFIC_SETTINGS,
  createSettingsBundle,
  mergeLayouts,
  readSettingsBundle,
} from "../src/settings-transfer";
import { defaultIdeSettings } from "../src/workbench/workbench-defaults";

/**
 * Carrying settings, keymaps and layouts to another machine.
 *
 * A bundle is meant to be shared — with a colleague, with a second machine, in
 * a repository — so what must not be in one matters as much as what is.
 */
describe("taking settings somewhere else", () => {
  const layouts = [
    { id: "eins", name: "Schmal", sidebarWidth: 200 },
    { id: "zwei", name: "Breit", sidebarWidth: 400 },
  ];

  it("carries the settings and the keymap", () => {
    const bundle = createSettingsBundle(
      { ...defaultIdeSettings, fontSize: 17, customKeybindings: { generate: "Ctrl+Alt+G" } as never },
      layouts,
    );

    expect(bundle.settings.fontSize).toBe(17);
    expect(bundle.settings.customKeybindings).toEqual({ generate: "Ctrl+Alt+G" });
    expect(bundle.layouts).toEqual(layouts);
    expect(bundle.kind).toBe("kiwi-settings");
  });

  it("leaves behind everything that belongs to one machine", () => {
    const bundle = createSettingsBundle({
      ...defaultIdeSettings,
      jdkPath: "C:/Users/robin/jdk-21",
      recentProjects: ["C:/Users/robin/geheim"],
      lastWorkspace: "C:/Users/robin/geheim",
      extraCertificates: ["C:/Users/robin/firma.pem"],
      githubClientId: "abc123",
      backgroundImage: "C:/Users/robin/bild.png",
    }, []);

    for (const key of MACHINE_SPECIFIC_SETTINGS) {
      expect(bundle.settings).not.toHaveProperty(key);
    }
    // Nothing about that machine survived into the text either.
    expect(JSON.stringify(bundle)).not.toContain("robin");
  });

  it("reads back what it wrote", () => {
    const bundle = createSettingsBundle({ ...defaultIdeSettings, fontSize: 19 }, layouts);
    const read = readSettingsBundle(JSON.stringify(bundle));

    expect(read.settings.fontSize).toBe(19);
    expect(read.layouts).toEqual(layouts);
  });

  it("drops machine settings that an older bundle still carries", () => {
    const older = JSON.stringify({
      kind: "kiwi-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { fontSize: 15, jdkPath: "D:/fremd/jdk", recentProjects: ["D:/fremd"] },
      layouts: [],
    });

    const read = readSettingsBundle(older);
    expect(read.settings.fontSize).toBe(15);
    expect(read.settings).not.toHaveProperty("jdkPath");
    expect(read.settings).not.toHaveProperty("recentProjects");
  });

  it("refuses a file that is not one of these", () => {
    // It comes from wherever somebody found it, so nothing in it is believed.
    for (const text of ["", "{", "null", "[]", '{"kind":"etwas-anderes"}', '"kiwi-settings"']) {
      expect(() => readSettingsBundle(text)).toThrow();
    }
  });

  it("refuses a bundle from a newer Kiwi", () => {
    const future = JSON.stringify({ kind: "kiwi-settings", version: 99, settings: {}, layouts: [] });
    expect(() => readSettingsBundle(future)).toThrow(/neueren/);
  });

  it("skips a layout that could never be applied", () => {
    const bundle = JSON.stringify({
      kind: "kiwi-settings",
      version: 1,
      settings: {},
      layouts: [{ id: "gut", name: "Gut" }, { name: "ohne Id" }, { id: "ohne Name" }, null, "kaputt"],
    });

    expect(readSettingsBundle(bundle).layouts).toEqual([{ id: "gut", name: "Gut" }]);
  });

  it("merges by id and keeps a name that merely repeats", () => {
    const existing = [{ id: "eins", name: "Schmal", sidebarWidth: 200 }];
    const incoming = [
      { id: "eins", name: "Schmal", sidebarWidth: 260 },
      { id: "drei", name: "Schmal", sidebarWidth: 300 },
    ];

    const merged = mergeLayouts(existing, incoming);
    // The same layout arriving again replaces itself; a different one that
    // happens to share a name is still a different one.
    expect(merged).toHaveLength(2);
    expect(merged.find((layout) => layout.id === "eins")?.sidebarWidth).toBe(260);
    expect(merged.find((layout) => layout.id === "drei")?.sidebarWidth).toBe(300);
  });
});
