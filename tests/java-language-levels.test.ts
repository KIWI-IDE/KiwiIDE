import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JAVA_LANGUAGE_LEVELS } from "../src/language-levels";

const {
  JAVA_LANGUAGE_LEVELS: mainProcessLevels,
  migrateProjectSettings,
} = require("../electron/services/project-service.cjs");

/**
 * Which Java releases a project may be set to.
 *
 * The interface offers a list and the main process checks against one, and for
 * a while they were different lists written out in eight places. A release the
 * check had not heard of was put back to 21 while the dropdown went on showing
 * what had been asked for — a setting that silently would not take.
 */
describe("the Java releases a project can target", () => {
  it("is the same list in the interface and in the main process", () => {
    expect(mainProcessLevels).toEqual(JAVA_LANGUAGE_LEVELS);
  });

  it("keeps every release the interface offers", () => {
    for (const level of JAVA_LANGUAGE_LEVELS) {
      expect({ level, kept: migrateProjectSettings({ languageLevel: level }).languageLevel })
        .toEqual({ level, kept: level });
    }
  });

  it("falls back for a release that does not exist", () => {
    expect(migrateProjectSettings({ languageLevel: "99" }).languageLevel).toBe("21");
    expect(migrateProjectSettings({ languageLevel: "21; rm -rf /" }).languageLevel).toBe("21");
    expect(migrateProjectSettings({}).languageLevel).toBe("21");
  });

  it("offers the long-term releases", () => {
    expect(JAVA_LANGUAGE_LEVELS).toEqual(expect.arrayContaining(["8", "11", "17", "21", "25"]));
  });

  it("is written out nowhere else", () => {
    // Eight copies is how the two lists drifted apart in the first place.
    const files = [
      "src/App.tsx",
      "src/components/ModuleDialog.tsx",
      "src/components/ProjectStructureDialog.tsx",
      "src/components/ProjectStructureWindowApp.tsx",
      "src/components/ProjectWizard.tsx",
      "src/components/SettingsDialog.tsx",
    ];
    for (const file of files) {
      expect({ file, inlined: /\["8",\s*"11",\s*"17"/.test(readFileSync(file, "utf8")) })
        .toEqual({ file, inlined: false });
    }
  });
});

/**
 * What a project settings file is allowed to contain.
 *
 * It is read off disk, so it can say anything at all — including things that
 * reach a command line.
 */
describe("reading a project settings file", () => {
  it("keeps the settings it knows and drops the rest", () => {
    const migrated = migrateProjectSettings({ encoding: "ISO-8859-1", unbekannt: 1 });
    expect(migrated.encoding).toBe("ISO-8859-1");
    expect("unbekannt" in migrated).toBe(false);
  });

  it("fills in what is missing", () => {
    const migrated = migrateProjectSettings({});
    expect(migrated.encoding).toBe("UTF-8");
    expect(migrated.jdkPath).toBe("");
    expect(migrated.compilerArgs).toBe("");
    expect(migrated.excludedPaths).toEqual([]);
  });

  it("survives a file that is not an object at all", () => {
    expect(migrateProjectSettings(null).languageLevel).toBe("21");
    expect(migrateProjectSettings("kaputt").encoding).toBe("UTF-8");
    expect(migrateProjectSettings([]).excludedPaths).toEqual([]);
  });

  it("keeps only plain names as build profiles", () => {
    // A profile id is handed to Maven or Gradle on the command line.
    const migrated = migrateProjectSettings({ buildProfiles: ["schnell", "a b", "rm -rf /", "voll.1", "schnell"] });
    expect(migrated.buildProfiles).toEqual(["schnell", "voll.1"]);
  });

  it("does not let a settings file grow without end", () => {
    const many = Array.from({ length: 50 }, (_, index) => `profil${index}`);
    expect(migrateProjectSettings({ buildProfiles: many }).buildProfiles).toHaveLength(20);
  });

  it("keeps a list a list", () => {
    expect(migrateProjectSettings({ excludedPaths: "nicht-liste" }).excludedPaths).toEqual([]);
    expect(migrateProjectSettings({ excludedLibraries: [1, "zwei"] }).excludedLibraries).toEqual(["1", "zwei"]);
  });
});
