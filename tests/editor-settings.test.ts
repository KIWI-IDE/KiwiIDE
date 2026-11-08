import { describe, expect, it } from "vitest";

const { defaults, migrateSettings } = require("../electron/services/settings-service.cjs");

/**
 * The editor settings that decide how typing feels.
 *
 * Each of these is a switch somebody flips once and expects to stay flipped.
 * A setting the main process drops on the way to disk is worse than one that
 * does not exist: the dialog shows it as set and nothing behaves that way.
 */
describe("highlighting the line the caret is on", () => {
  it("is on unless it has been turned off", () => {
    expect(defaults.highlightActiveLine).toBe(true);
    expect(migrateSettings({}).highlightActiveLine).toBe(true);
  });

  it("stays off once it has been turned off", () => {
    expect(migrateSettings({ highlightActiveLine: false }).highlightActiveLine).toBe(false);
  });

  it("survives a settings file written by an older version", () => {
    // The key is new, so a stored file will not have it. It has to arrive at
    // its default rather than as undefined, which would read as "off".
    const stored = { schemaVersion: 3, fontSize: 15, theme: "kiwi-new-dark" };
    const migrated = migrateSettings(stored);
    expect(migrated.highlightActiveLine).toBe(true);
    expect(migrated.fontSize).toBe(15);
  });
});

describe("the width of one indent", () => {
  it("keeps the configured width and the choice of spaces", () => {
    const migrated = migrateSettings({ tabSize: 2, insertSpaces: false });
    expect(migrated.tabSize).toBe(2);
    expect(migrated.insertSpaces).toBe(false);
  });

  it("defaults to four spaces, which is what Java is written in", () => {
    expect(defaults.tabSize).toBe(4);
    expect(defaults.insertSpaces).toBe(true);
  });
});
