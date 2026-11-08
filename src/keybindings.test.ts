import { describe, expect, it } from "vitest";
import {
  findShortcutConflicts,
  matchesShortcut,
  keybindingCatalogue,
  normalizeShortcut,
  resolveKeybindings,
  shortcutFromEvent,
} from "./keybindings";

const pressed = (overrides: Partial<Parameters<typeof shortcutFromEvent>[0]>) => shortcutFromEvent({
  key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides,
});

describe("keybinding catalogue", () => {
  it("keeps ids unique and every command bound by default", () => {
    expect(new Set(keybindingCatalogue.map((entry) => entry.id)).size).toBe(keybindingCatalogue.length);
    for (const entry of keybindingCatalogue) {
      expect(entry.fallback, entry.id).not.toBe("");
      expect(entry.label, entry.id).not.toBe("");
    }
  });

  it("ships without a shortcut bound to two commands in the same context", () => {
    // Cut/copy/paste are deliberately shared with the editor, so only the
    // Explorer trio may collide; anything else would be a real clash.
    const clashes = findShortcutConflicts(resolveKeybindings({}))
      .filter((conflict) => !conflict.ids.every((id) => id.startsWith("explorer")));
    expect(clashes).toEqual([]);
  });

  it("falls back for unbound commands but keeps a cleared one cleared", () => {
    const resolved = resolveKeybindings({ save: "Ctrl+Alt+S", run: "" });
    expect(resolved.save).toBe("Ctrl+Alt+S");
    // An empty string means the user switched the command off on purpose.
    expect(resolved.run).toBe("");
    expect(resolved.build).toBe("Ctrl+Shift+B");
  });

  it("survives settings without any keybindings at all", () => {
    const resolved = resolveKeybindings(undefined);
    for (const entry of keybindingCatalogue) {
      expect(resolved[entry.id], entry.id).toBe(entry.fallback);
    }
  });

  it("keeps line deletion and redo on separate shortcuts", () => {
    const resolved = resolveKeybindings(undefined);
    expect(resolved.deleteLine).toBe("Ctrl+Y");
    expect(resolved.duplicateLine).toBe("Ctrl+D");
    expect(resolved.redo).toBe("Ctrl+Shift+Z");
  });
});

describe("recording a shortcut", () => {
  it("writes the modifiers in a stable order", () => {
    expect(pressed({ key: "p", code: "KeyP", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+P");
    expect(pressed({ key: "p", code: "KeyP", shiftKey: true, ctrlKey: true, altKey: true })).toBe("Ctrl+Alt+Shift+P");
    expect(pressed({ key: "F5", code: "F5" })).toBe("F5");
  });

  it("stores the physical key for digits and the backtick", () => {
    // Shift+7 reports "/" on a German layout, so the code has to win.
    expect(pressed({ key: "/", code: "Digit7", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+7");
    expect(pressed({ key: "`", code: "Backquote", ctrlKey: true })).toBe("Ctrl+Backquote");
  });

  it("ignores a modifier pressed on its own", () => {
    expect(pressed({ key: "Control", code: "ControlLeft", ctrlKey: true })).toBe("");
    expect(pressed({ key: "Shift", code: "ShiftLeft", shiftKey: true })).toBe("");
  });

  it("treats differently written shortcuts as the same binding", () => {
    expect(normalizeShortcut("ctrl + SHIFT+p")).toBe(normalizeShortcut("Ctrl+Shift+P"));
    expect(normalizeShortcut("Cmd+S")).toBe(normalizeShortcut("Ctrl+S"));
    expect(normalizeShortcut("")).toBe("");
  });

  it("finds a conflict the user has just created", () => {
    const conflicts = findShortcutConflicts(resolveKeybindings({ build: "ctrl+s" }));
    const clash = conflicts.find((conflict) => conflict.shortcut === "Ctrl+S");
    expect(clash?.ids.sort()).toEqual(["build", "save"]);
  });
});


const press = (overrides: Partial<Parameters<typeof matchesShortcut>[0]>) => ({
  key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides,
});

describe("matching a pressed key against a binding", () => {
  it("matches the everyday chords", () => {
    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true }), "Ctrl+S")).toBe(true);
    expect(matchesShortcut(press({ key: "F5", code: "F5" }), "F5")).toBe(true);
    expect(matchesShortcut(press({ key: "F5", code: "F5", shiftKey: true }), "Shift+F5")).toBe(true);
    expect(matchesShortcut(press({ key: "ArrowRight", code: "ArrowRight", altKey: true }), "Alt+ArrowRight")).toBe(true);
  });

  it("matches a digit by the key it was pressed on", () => {
    // Recording stores the physical key for digits, because Shift+7 reports
    // "/" on a German layout. Matching compared the character, so a shortcut
    // recorded as Ctrl+Shift+7 could never fire again.
    expect(matchesShortcut(press({ key: "/", code: "Digit7", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+7")).toBe(true);
    expect(matchesShortcut(press({ key: "7", code: "Digit7", ctrlKey: true }), "Ctrl+7")).toBe(true);
    expect(matchesShortcut(press({ key: "7", code: "Numpad7", ctrlKey: true }), "Ctrl+7")).toBe(true);
  });

  it("matches the backtick by its physical key too", () => {
    expect(matchesShortcut(press({ key: "^", code: "Backquote", ctrlKey: true }), "Ctrl+Backquote")).toBe(true);
  });

  it("what recording writes down is what matching accepts", () => {
    // The two halves have to agree; a shortcut that cannot be matched again is
    // worse than one that was refused when it was typed.
    for (const event of [
      press({ key: "p", code: "KeyP", ctrlKey: true, shiftKey: true }),
      press({ key: "/", code: "Digit7", ctrlKey: true, shiftKey: true }),
      press({ key: "`", code: "Backquote", ctrlKey: true }),
      press({ key: "F9", code: "F9" }),
      press({ key: "Insert", code: "Insert", altKey: true }),
      press({ key: " ", code: "Space", ctrlKey: true }),
    ]) {
      const recorded = shortcutFromEvent(event);
      expect({ recorded, matches: matchesShortcut(event, recorded) }).toEqual({ recorded, matches: true });
    }
  });

  it("insists on exactly the modifiers the binding names", () => {
    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true, shiftKey: true }), "Ctrl+S")).toBe(false);
    expect(matchesShortcut(press({ key: "s", code: "KeyS" }), "Ctrl+S")).toBe(false);
    expect(matchesShortcut(press({ key: "b", code: "KeyB", ctrlKey: true, shiftKey: true }), "Ctrl+B")).toBe(false);
    expect(matchesShortcut(press({ key: "b", code: "KeyB", ctrlKey: true }), "Ctrl+Shift+B")).toBe(false);
  });

  it("takes Cmd for Ctrl, so a Mac keymap still matches", () => {
    expect(matchesShortcut(press({ key: "s", code: "KeyS", metaKey: true }), "Cmd+S")).toBe(true);
    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true }), "Cmd+S")).toBe(true);
  });

  it("never matches a command that was switched off", () => {
    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true }), "")).toBe(false);
    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true }), "   ")).toBe(false);
    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true }), undefined)).toBe(false);
  });

  it("reads a binding however it was written down", () => {
    expect(matchesShortcut(press({ key: "p", code: "KeyP", ctrlKey: true, shiftKey: true }), "ctrl + SHIFT+p")).toBe(true);
  });

  it("keeps every default in the catalogue matchable", () => {
    // A default nobody can trigger is the failure this whole module exists to
    // prevent, so each one is pressed once here.
    const events: Record<string, Partial<Parameters<typeof matchesShortcut>[0]>> = {};
    for (const { id, fallback } of keybindingCatalogue) {
      const parts = fallback.split("+");
      const key = parts.at(-1)!;
      events[id] = {
        key: /^\d$/.test(key) ? key : key,
        code: /^\d$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key,
        ctrlKey: parts.includes("Ctrl"),
        metaKey: false,
        altKey: parts.includes("Alt"),
        shiftKey: parts.includes("Shift"),
      };
      expect({ id, matches: matchesShortcut(press(events[id]), fallback) }).toEqual({ id, matches: true });
    }
  });
});
