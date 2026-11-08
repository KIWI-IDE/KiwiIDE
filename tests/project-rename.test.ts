import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { WorkspaceStateService } = require("../electron/services/workspace-state-service.cjs");

const built: string[] = [];

/** A service on its own settings file, with two real project folders beside it. */
function workspace() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-umbenennen-"));
  built.push(home);
  const userData = path.join(home, "userData");
  fs.mkdirSync(userData, { recursive: true });
  const eins = path.join(home, "demo-projekt");
  const zwei = path.join(home, "zweites");
  for (const root of [eins, zwei]) fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // Only what the service actually reaches for.
  const recentProjects: string[] = [];
  const settings = {
    get: () => ({ recentProjects, lastWorkspace: null }),
    rememberWorkspace: async (root: string) => {
      if (!recentProjects.includes(root)) recentProjects.unshift(root);
    },
    forgetWorkspace: async (root: string) => {
      const at = recentProjects.indexOf(root);
      if (at >= 0) recentProjects.splice(at, 1);
    },
    update: async () => undefined,
  };
  return {
    eins,
    zwei,
    service: () => new WorkspaceStateService(userData, settings),
  };
}

afterEach(() => {
  for (const home of built.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10 });
  }
});

describe("giving a project a name of one's own", () => {
  it("shows the new name where the folder name stood", async () => {
    const { eins, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins]);
    expect(state.snapshot().projects[0].name).toBe("demo-projekt");

    const nachher = await state.rename(eins, "Meine App");
    expect(nachher.projects[0].name).toBe("Meine App");
    // The folder is not touched. Renaming a project is a label, not a move.
    expect(fs.existsSync(eins)).toBe(true);
    expect(nachher.projects[0].root).toBe(path.resolve(eins));
  });

  it("keeps the name after a restart", async () => {
    const { eins, service } = workspace();
    const erst = service();
    await erst.load();
    await erst.add([eins]);
    await erst.rename(eins, "Meine App");

    const wieder = service();
    const state = await wieder.load();
    expect(state.projects[0].name).toBe("Meine App");
    expect(state.resumableProjects[0].name).toBe("Meine App");
  });

  it("reaches the resumable list, so hub and switcher agree", async () => {
    const { eins, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins]);
    const nachher = await state.rename(eins, "Meine App");
    // The switcher reads resumableProjects; the hub reads whichever is fuller.
    expect(nachher.resumableProjects.map((item: { name: string }) => item.name)).toEqual(["Meine App"]);
  });

  it("goes back to the folder name when the name is cleared", async () => {
    const { eins, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins]);
    await state.rename(eins, "Meine App");
    expect((await state.rename(eins, "   ")).projects[0].name).toBe("demo-projekt");
  });

  it("drops the chosen name when the folder's own name is typed back", async () => {
    // The dialog refuses an empty field, so this is the way back. Storing a
    // name identical to the folder's would only be a copy that stops following
    // it if the folder is ever renamed.
    const { eins, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins]);
    await state.rename(eins, "Meine App");
    const nachher = await state.rename(eins, "demo-projekt");
    expect(nachher.projects[0].name).toBe("demo-projekt");
    expect(nachher.projects[0].label).toBeUndefined();
  });

  it("trims what was typed", async () => {
    const { eins, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins]);
    expect((await state.rename(eins, "  Meine App  ")).projects[0].name).toBe("Meine App");
  });

  it("renames only the project asked for", async () => {
    const { eins, zwei, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins, zwei]);
    const nachher = await state.rename(eins, "Meine App");
    const namen = nachher.projects.map((item: { root: string; name: string }) => [path.basename(item.root), item.name]);
    expect(namen).toEqual([["demo-projekt", "Meine App"], ["zweites", "zweites"]]);
  });

  it("follows the folder when a project without its own name is renamed on disk", async () => {
    // Kiwi stored the folder name at the moment a project was added. Rename the
    // folder outside Kiwi, point the entry at the new place, and the list still
    // read the old name.
    const { eins, service } = workspace();
    const state = service();
    await state.load();
    await state.add([eins]);
    const neu = path.join(path.dirname(eins), "anders-benannt");
    fs.renameSync(eins, neu);
    await state.add([neu]);
    const gefunden = state.snapshot().projects.find((item: { root: string }) => item.root === path.resolve(neu));
    expect(gefunden.name).toBe("anders-benannt");
  });
});
