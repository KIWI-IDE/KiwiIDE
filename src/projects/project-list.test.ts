import { describe, expect, it } from "vitest";
import type { WorkspaceProject, WorkspaceState } from "../types";
import { mergeProjectList, readinessLabel } from "./project-list";

function project(name: string, patch: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return {
    root: `C:/bau/${name}`,
    name,
    addedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
    pinned: false,
    exists: true,
    ...patch,
  };
}

function workspace(patch: Partial<WorkspaceState> = {}): WorkspaceState {
  return { version: 1, projects: [], activeRoot: null, ...patch };
}

describe("every project Kiwi knows about", () => {
  it("carries the workspace's own projects", () => {
    const list = mergeProjectList(workspace({ projects: [project("alpha"), project("beta")] }));
    expect(list.map((entry) => entry.name)).toEqual(["alpha", "beta"]);
  });

  it("prefers the resumable list once a restart has left one", () => {
    const list = mergeProjectList(workspace({
      projects: [project("alt")],
      resumableProjects: [project("neu")],
    }));
    expect(list.map((entry) => entry.name)).toEqual(["neu"]);
  });

  it("adds a recent project the workspace no longer lists", () => {
    // Opened yesterday, closed since: the hub showed it and the switcher did
    // not, which is the whole reason this function exists.
    const list = mergeProjectList(workspace({ projects: [project("offen")] }), ["C:/bau/gestern"]);
    expect(list.map((entry) => entry.name)).toEqual(["offen", "gestern"]);
  });

  it("never lists the same project twice", () => {
    const list = mergeProjectList(
      workspace({ projects: [project("alpha", { root: "C:/bau/alpha" })] }),
      ["C:/BAU/ALPHA", "C:/bau/alpha/", "C:/bau/alpha"],
    );
    expect(list).toHaveLength(1);
  });

  it("puts pinned projects first, then the most recently opened", () => {
    const list = mergeProjectList(workspace({
      projects: [
        project("alt", { lastOpenedAt: "2026-01-01T00:00:00.000Z" }),
        project("angeheftet", { pinned: true, lastOpenedAt: "2020-01-01T00:00:00.000Z" }),
        project("neu", { lastOpenedAt: "2026-09-01T00:00:00.000Z" }),
      ],
    }));
    expect(list.map((entry) => entry.name)).toEqual(["angeheftet", "neu", "alt"]);
  });

  it("survives a workspace that carries nothing at all", () => {
    expect(mergeProjectList(workspace())).toEqual([]);
    expect(mergeProjectList(workspace(), ["", "  "])).toHaveLength(1);
  });
});

describe("what is said beside a project", () => {
  it("names the states somebody can act on", () => {
    expect(readinessLabel("ready")).toBe("Bereit");
    expect(readinessLabel("preloading")).toBe("Wird vorbereitet");
    expect(readinessLabel("outdated")).toBe("Aktualisierung erforderlich");
    expect(readinessLabel("error")).toBe("Fehler");
  });

  it("says nothing about a project nobody has looked at", () => {
    // Every project starts here, and a list where every row carries a label is
    // a list where the labels stop being read.
    expect(readinessLabel("not-loaded")).toBe("");
  });
});
