import { describe, expect, it } from "vitest";
import { dependencyKeyAction } from "../src/components/DependencyDialog";

/**
 * Reaching the dependency dialog from the keyboard.
 *
 * The dialog opens with the search field focused and it accepts a whole
 * coordinate pasted into it — and then Enter did nothing, so the fastest path
 * it offers ended at a button that had to be clicked.
 */
describe("what a key press does in the dependency dialog", () => {
  const press = (key: string, state: Partial<Parameters<typeof dependencyKeyAction>[0]> = {}) =>
    dependencyKeyAction({ key, hasTarget: false, resultCount: 0, cursor: -1, ...state });

  it("adds what is ready to be added", () => {
    expect(press("Enter", { hasTarget: true })).toEqual({ action: "add", index: -1 });
  });

  it("takes the first result when nothing is chosen yet", () => {
    expect(press("Enter", { resultCount: 5 })).toEqual({ action: "move", index: 0 });
  });

  it("does nothing on Enter with neither a coordinate nor a result", () => {
    expect(press("Enter")).toEqual({ action: "none", index: -1 });
  });

  it("walks down and up through the results", () => {
    expect(press("ArrowDown", { resultCount: 3 })).toEqual({ action: "move", index: 0 });
    expect(press("ArrowDown", { resultCount: 3, cursor: 0 })).toEqual({ action: "move", index: 1 });
    expect(press("ArrowUp", { resultCount: 3, cursor: 2 })).toEqual({ action: "move", index: 1 });
  });

  it("stops at both ends instead of wrapping", () => {
    // Wrapping from the last result back to the first reads as a lost key
    // press, because nothing on screen says the list started over.
    expect(press("ArrowDown", { resultCount: 3, cursor: 2 })).toEqual({ action: "none", index: 2 });
    expect(press("ArrowUp", { resultCount: 3, cursor: 0 })).toEqual({ action: "none", index: 0 });
  });

  it("ignores the arrows while there is nothing to walk", () => {
    expect(press("ArrowDown")).toEqual({ action: "none", index: -1 });
  });

  it("ignores every other key", () => {
    expect(press("a", { hasTarget: true, resultCount: 3 })).toEqual({ action: "none", index: -1 });
    expect(press("Escape", { hasTarget: true })).toEqual({ action: "none", index: -1 });
    expect(press("Tab", { resultCount: 3 })).toEqual({ action: "none", index: -1 });
  });

  it("does nothing while the dialog is writing the dependency", () => {
    // A second Enter during the write would ask for the same dependency twice.
    expect(press("Enter", { hasTarget: true, busy: true })).toEqual({ action: "none", index: -1 });
    expect(press("ArrowDown", { resultCount: 3, busy: true })).toEqual({ action: "none", index: -1 });
  });
});
