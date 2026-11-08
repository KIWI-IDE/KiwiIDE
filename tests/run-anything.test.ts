import { describe, expect, it } from "vitest";
import {
  collectRunTargets,
  looksLikeCommand,
  orderRunTargets,
  runTargetScore,
} from "../src/run-anything";

const sources = {
  buildTool: "Maven",
  configurations: [
    { id: "c1", name: "Server starten", type: "java", favorite: true },
    { id: "c2", name: "Alle Tests", type: "junit" },
  ],
  tasks: [
    { name: "test", description: "Führt die Tests aus", group: "Build-Lifecycle" },
    { name: "clean", description: "Räumt auf", group: "Build-Lifecycle" },
    { name: "surefire:test", description: "Nur Surefire", group: "Plugins" },
  ],
};

const labels = (query: string) => collectRunTargets(sources, query).map((entry) => entry.label);

/**
 * Running something meant knowing first what kind of thing it was: a run
 * configuration in a dropdown, a Maven goal in one tool window, a Gradle task
 * in another, a command in the terminal. This is the one list.
 */
describe("everything that can be started", () => {
  it("brings configurations and build tasks together", () => {
    const all = collectRunTargets(sources, "");
    expect(all.map((entry) => entry.kind)).toContain("config");
    expect(all.map((entry) => entry.kind)).toContain("build");
    expect(all).toHaveLength(5);
  });

  it("offers nothing for the terminal until something is typed", () => {
    // Offering "run this in the terminal" against an empty box invites
    // running nothing at all.
    expect(collectRunTargets(sources, "").some((entry) => entry.kind === "shell")).toBe(false);
    expect(collectRunTargets(sources, "te").some((entry) => entry.kind === "shell")).toBe(true);
  });

  it("puts the whole name first, then the start, then a word inside", () => {
    expect(labels("test")[0]).toBe("test");
    expect(labels("test")).toContain("surefire:test");
    // "Alle Tests" contains it too, and comes after the ones that start with it.
    expect(labels("test").indexOf("test")).toBeLessThan(labels("test").indexOf("Alle Tests"));
  });

  it("finds a task by a word in the middle of its name", () => {
    // "test" has to reach "surefire:test", which is where Maven puts it.
    expect(labels("sure")).toContain("surefire:test");
  });

  it("puts a favourite ahead of its equals", () => {
    const found = collectRunTargets(sources, "s").filter((entry) => entry.kind === "config");
    expect(found[0].label).toBe("Server starten");
  });

  it("says where each entry comes from", () => {
    const all = collectRunTargets(sources, "");
    expect(all.find((entry) => entry.label === "test")?.detail)
      .toBe("Maven · Build-Lifecycle · Führt die Tests aus");
    expect(all.find((entry) => entry.label === "Server starten")?.detail)
      .toBe("Run-Konfiguration · java");
  });

  it("leaves out what does not answer at all", () => {
    expect(labels("zzz").filter((label) => label !== "zzz")).toEqual([]);
  });

  it("survives a project that has nothing yet", () => {
    expect(collectRunTargets({}, "")).toEqual([]);
    expect(collectRunTargets({}, "x")).toHaveLength(1);
  });
});

/**
 * A command is not a name.
 *
 * Somebody who typed `git status` did not mean a run configuration, and making
 * them scroll past three near-misses is the kind of small rudeness that adds
 * up.
 */
describe("telling a command from a name", () => {
  it("recognises the shapes only a command has", () => {
    expect(looksLikeCommand("mvn -q test")).toBe(true);
    expect(looksLikeCommand("git status")).toBe(true);
    expect(looksLikeCommand("./gradlew build")).toBe(true);
    expect(looksLikeCommand("cat log | findstr fehler")).toBe(true);
  });

  it("leaves a plain name alone", () => {
    expect(looksLikeCommand("test")).toBe(false);
    expect(looksLikeCommand("Server starten")).toBe(false);
    expect(looksLikeCommand("")).toBe(false);
    // One word is a name even when it is also a program.
    expect(looksLikeCommand("gradle")).toBe(false);
  });

  it("moves the terminal entry to the front for a command", () => {
    const ordered = orderRunTargets(collectRunTargets(sources, "mvn -q test"), "mvn -q test");
    expect(ordered[0].kind).toBe("shell");
  });

  it("leaves the order alone for a name", () => {
    const ordered = orderRunTargets(collectRunTargets(sources, "test"), "test");
    expect(ordered[0].kind).not.toBe("shell");
  });
});

describe("how well an entry answers", () => {
  it("ranks the readings in the order a person expects", () => {
    expect(runTargetScore("test", "test")).toBeLessThan(runTargetScore("testAll", "test"));
    expect(runTargetScore("testAll", "test")).toBeLessThan(runTargetScore("surefire:test", "test"));
    expect(runTargetScore("surefire:test", "test")).toBeLessThan(runTargetScore("contest", "test"));
  });

  it("says no when it does not answer", () => {
    expect(runTargetScore("build", "zzz")).toBe(-1);
    expect(runTargetScore("", "x")).toBe(-1);
  });

  it("takes everything when nothing was typed", () => {
    expect(runTargetScore("irgendwas", "")).toBeGreaterThanOrEqual(0);
  });
});
