import { describe, expect, it } from "vitest";
import { buildTypeLabel, filterProjects, lastOpenedLabel } from "./project-summary";

const jetzt = Date.parse("2026-09-06T12:00:00.000Z");
const vor = (minuten: number) => new Date(jetzt - minuten * 60_000).toISOString();

describe("when a project was last opened", () => {
  it("says it the way a person would", () => {
    expect(lastOpenedLabel(vor(0), jetzt)).toBe("gerade eben");
    expect(lastOpenedLabel(vor(20), jetzt)).toBe("vor 20 Min.");
    expect(lastOpenedLabel(vor(3 * 60), jetzt)).toBe("vor 3 Std.");
    expect(lastOpenedLabel(vor(26 * 60), jetzt)).toBe("gestern");
    expect(lastOpenedLabel(vor(4 * 24 * 60), jetzt)).toBe("vor 4 Tagen");
    expect(lastOpenedLabel(vor(10 * 24 * 60), jetzt)).toBe("vor 1 Woche");
    expect(lastOpenedLabel(vor(60 * 24 * 60), jetzt)).toBe("vor 2 Monaten");
    expect(lastOpenedLabel(vor(800 * 24 * 60), jetzt)).toBe("vor 2 Jahren");
  });

  it("says nothing at all about a project with no timestamp", () => {
    // A project that came from the recent paths carries none, and inventing
    // one would be worse than leaving the line short.
    expect(lastOpenedLabel("", jetzt)).toBe("");
    expect(lastOpenedLabel("irgendwas", jetzt)).toBe("");
  });

  it("does not read a clock that ran backwards as the future", () => {
    expect(lastOpenedLabel(new Date(jetzt + 60_000).toISOString(), jetzt)).toBe("gerade eben");
  });
});

describe("searching the list", () => {
  const projekte = [
    { name: "honeymc-core", root: "D:/programmierung/honeymc-reborn/honeymc-core" },
    { name: "PushCloudNET", root: "D:/programmierung/SytrexNET/PushCloudNET" },
    { name: "leafcloudservice", root: "D:/programmierung/LeafCloudService/leafcloudservice" },
  ];

  it("hands everything back when nothing was typed", () => {
    expect(filterProjects(projekte, "")).toHaveLength(3);
    expect(filterProjects(projekte, "   ")).toHaveLength(3);
  });

  it("matches the name", () => {
    expect(filterProjects(projekte, "honey").map((entry) => entry.name)).toEqual(["honeymc-core"]);
  });

  it("matches the path, which is how somebody looks for a folder", () => {
    expect(filterProjects(projekte, "sytrex").map((entry) => entry.name)).toEqual(["PushCloudNET"]);
  });

  it("takes several words as several conditions", () => {
    expect(filterProjects(projekte, "cloud leaf").map((entry) => entry.name)).toEqual(["leafcloudservice"]);
    expect(filterProjects(projekte, "cloud nichts")).toEqual([]);
  });
});

describe("how a build type reads", () => {
  it("names the two build tools by their own names", () => {
    expect(buildTypeLabel("Gradle")).toBe("Gradle");
    expect(buildTypeLabel("Maven")).toBe("Maven");
  });

  it("spells out what a project without one is", () => {
    expect(buildTypeLabel("Java")).toBe("Plain Java");
  });

  it("says nothing about a project nobody has looked at yet", () => {
    expect(buildTypeLabel(undefined)).toBe("");
    expect(buildTypeLabel("")).toBe("");
  });
});
