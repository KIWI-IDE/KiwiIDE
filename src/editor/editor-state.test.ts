import { describe, expect, it } from "vitest";
import {
  EditorStateStore,
  MAX_REMEMBERED_FILES,
  isRestorable,
  parseStates,
  stateKey,
  trimStates,
  type EditorFileState,
} from "./editor-state";

function state(path: string, patch: Partial<EditorFileState> = {}): EditorFileState {
  return {
    path,
    cursorLine: 1,
    cursorColumn: 1,
    scrollTop: 0,
    scrollLeft: 0,
    lastOpened: 0,
    ...patch,
  };
}

describe("the key a file is remembered under", () => {
  it("tells the same file name in two projects apart", () => {
    // Project A left src/Main.java at line 120 and project B at line 550.
    // One key for both would have the second overwrite the first.
    expect(stateKey("C:/a", "C:/a/src/Main.java")).not.toBe(stateKey("C:/b", "C:/b/src/Main.java"));
  });

  it("is the same however the path is spelled", () => {
    const windowsPath = ["C:", "bau", "src", "Main.java"].join(String.fromCharCode(92));
    const windowsRoot = ["C:", "bau"].join(String.fromCharCode(92));
    expect(stateKey("C:/bau", "C:/bau/src/Main.java")).toBe(stateKey(windowsRoot, windowsPath));
    expect(stateKey("C:/bau", "C:/bau/src/Main.java")).toBe(stateKey("C:/BAU/", "C:/BAU/src/main.java"));
  });
});

describe("which states are worth putting back", () => {
  it("skips a file that was left where it opens anyway", () => {
    // Restoring line 1 means doing work to arrive where the editor already is,
    // and every one of those is a chance to arrive somewhere else instead.
    expect(isRestorable(state("A.java"))).toBe(false);
  });

  it("keeps a caret further down", () => {
    expect(isRestorable(state("A.java", { cursorLine: 428, cursorColumn: 17 }))).toBe(true);
  });

  it("keeps a scrolled file whose caret never moved", () => {
    expect(isRestorable(state("A.java", { scrollTop: 9_000 }))).toBe(true);
  });

  it("keeps a selection or a fold on their own", () => {
    expect(isRestorable(state("A.java", { selection: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 } }))).toBe(true);
    expect(isRestorable(state("A.java", { folds: [12] }))).toBe(true);
  });

  it("says no to nothing at all", () => {
    expect(isRestorable(undefined)).toBe(false);
    expect(isRestorable(null)).toBe(false);
  });
});

describe("keeping the list to a length", () => {
  it("drops the oldest visit rather than the first arrival", () => {
    // The file opened first and worked in all day must not be the first to go.
    const states = [
      state("alt.java", { lastOpened: 10 }),
      state("neu.java", { lastOpened: 900 }),
      state("mittel.java", { lastOpened: 500 }),
    ];
    expect(trimStates(states, 2).map((entry) => entry.path)).toEqual(["neu.java", "mittel.java"]);
  });

  it("throws away entries that are not states", () => {
    expect(trimStates([state("A.java"), { path: "" } as EditorFileState])).toHaveLength(1);
  });
});

describe("reading back what was stored", () => {
  it("survives a file that holds nonsense", () => {
    expect(parseStates(null)).toEqual([]);
    expect(parseStates("kaputt")).toEqual([]);
    expect(parseStates([null, 7, { }, { path: "" }])).toEqual([]);
  });

  it("repairs impossible numbers rather than restoring them", () => {
    const [parsed] = parseStates([{
      path: "A.java",
      cursorLine: -4,
      cursorColumn: 0,
      scrollTop: -100,
      lastOpened: "gestern",
    }]);
    expect(parsed).toMatchObject({ cursorLine: 1, cursorColumn: 1, scrollTop: 0, lastOpened: 0 });
  });

  it("drops an empty selection, which is only the caret again", () => {
    const [parsed] = parseStates([{
      path: "A.java",
      selection: { startLine: 5, startColumn: 3, endLine: 5, endColumn: 3 },
    }]);
    expect(parsed.selection).toBeUndefined();
  });

  it("keeps a real selection and its folds", () => {
    const [parsed] = parseStates([{
      path: "A.java",
      selection: { startLine: 5, startColumn: 3, endLine: 9, endColumn: 1 },
      folds: [12, 40, -3],
    }]);
    expect(parsed.selection).toEqual({ startLine: 5, startColumn: 3, endLine: 9, endColumn: 1 });
    expect(parsed.folds).toEqual([12, 40]);
  });
});

describe("the store the whole session shares", () => {
  it("hands a file back where it was left", () => {
    const store = new EditorStateStore();
    store.adopt("C:/bau", []);
    store.write(state("C:/bau/src/Main.java", { cursorLine: 428, cursorColumn: 17, scrollTop: 9_000, lastOpened: 5 }));
    expect(store.read("C:/bau/src/Main.java")).toMatchObject({ cursorLine: 428, scrollTop: 9_000 });
  });

  it("keeps a file that was closed", () => {
    // A closed tab means the file is not open, not that where somebody was
    // working in it is worth forgetting.
    const store = new EditorStateStore();
    store.adopt("C:/bau", []);
    store.write(state("C:/bau/CloudServerManager.java", { cursorLine: 735, lastOpened: 1 }));
    expect(store.read("C:/bau/CloudServerManager.java")?.cursorLine).toBe(735);
    expect(store.snapshot()).toHaveLength(1);
  });

  it("forgets one file when it is really gone", () => {
    const store = new EditorStateStore();
    store.adopt("C:/bau", []);
    store.write(state("C:/bau/Weg.java", { cursorLine: 3 }));
    store.forget("C:/bau/Weg.java");
    expect(store.read("C:/bau/Weg.java")).toBeUndefined();
  });

  it("takes over a project's stored states", () => {
    const store = new EditorStateStore();
    store.adopt("C:/bau", [state("C:/bau/A.java", { cursorLine: 12, lastOpened: 3 })]);
    expect(store.read("C:/bau/A.java")?.cursorLine).toBe(12);

    // Switching projects starts from that project's own records.
    store.adopt("C:/anderes", []);
    expect(store.read("C:/bau/A.java")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("stays within its limit, keeping the newest visits", () => {
    const store = new EditorStateStore();
    store.adopt("C:/bau", []);
    for (let index = 0; index < MAX_REMEMBERED_FILES + 40; index += 1) {
      store.write(state(`C:/bau/Datei${index}.java`, { cursorLine: 2, lastOpened: index }));
    }
    expect(store.size).toBe(MAX_REMEMBERED_FILES);
    expect(store.read("C:/bau/Datei0.java")).toBeUndefined();
    expect(store.read(`C:/bau/Datei${MAX_REMEMBERED_FILES + 39}.java`)).toBeDefined();
  });
});
