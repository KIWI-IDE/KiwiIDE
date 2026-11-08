/**
 * Every command the workbench binds to a key, in one place.
 *
 * Before this, most shortcuts were written straight into the global key
 * handler, so only a third of them could be changed in the settings and the
 * list shown there had no way to stay in sync. The catalogue is now the single
 * source: the handler reads its ids, the settings screen renders its labels,
 * and anything the user has not touched falls back to the default here.
 */

export type KeybindingCategory =
  | "Navigation"
  | "Editor"
  | "Code"
  | "Ausführen & Debuggen"
  | "Ansicht"
  | "Explorer"
  | "Datei";

export interface KeybindingDefinition {
  id: string;
  label: string;
  category: KeybindingCategory;
  /** The shortcut used while the user has not chosen one. */
  fallback: string;
}

export const keybindingCatalogue: KeybindingDefinition[] = [
  { id: "commandPalette", label: "Command Palette", category: "Navigation", fallback: "Ctrl+Shift+P" },
  { id: "searchEverywhere", label: "Überall suchen", category: "Navigation", fallback: "Ctrl+P" },
  { id: "recentFiles", label: "Zuletzt geöffnete Dateien", category: "Navigation", fallback: "Ctrl+E" },
  { id: "classes", label: "Klasse suchen", category: "Navigation", fallback: "Ctrl+N" },
  { id: "files", label: "Datei suchen", category: "Navigation", fallback: "Ctrl+Shift+N" },
  { id: "symbols", label: "Symbol suchen", category: "Navigation", fallback: "Ctrl+Shift+O" },
  { id: "findInFiles", label: "In Dateien suchen", category: "Navigation", fallback: "Ctrl+Shift+F" },
  { id: "gotoLine", label: "Gehe zu Zeile", category: "Navigation", fallback: "Ctrl+G" },
  { id: "gotoDeclaration", label: "Zur Deklaration springen", category: "Navigation", fallback: "F12" },
  { id: "findUsages", label: "Verwendungen suchen", category: "Navigation", fallback: "Alt+F7" },
  { id: "nextTab", label: "Nächster Tab", category: "Navigation", fallback: "Alt+ArrowRight" },
  { id: "previousTab", label: "Vorheriger Tab", category: "Navigation", fallback: "Alt+ArrowLeft" },

  { id: "save", label: "Speichern", category: "Datei", fallback: "Ctrl+S" },
  { id: "saveAll", label: "Alles speichern", category: "Datei", fallback: "Ctrl+Shift+S" },
  { id: "closeTab", label: "Tab schließen", category: "Datei", fallback: "Ctrl+F4" },
  { id: "openProject", label: "Projekt öffnen", category: "Datei", fallback: "Ctrl+O" },
  { id: "settings", label: "Einstellungen", category: "Datei", fallback: "Ctrl+," },

  { id: "redo", label: "Wiederholen", category: "Editor", fallback: "Ctrl+Shift+Z" },

  { id: "quickFix", label: "Quick Fix und Intentionen", category: "Code", fallback: "Alt+Enter" },
  { id: "generate", label: "Java-Code generieren", category: "Code", fallback: "Alt+Insert" },
  { id: "rename", label: "Umbenennen", category: "Code", fallback: "Shift+F6" },
  { id: "reformat", label: "Code formatieren", category: "Code", fallback: "Ctrl+Alt+L" },
  { id: "organizeImports", label: "Imports organisieren", category: "Code", fallback: "Ctrl+Alt+O" },
  { id: "toggleComment", label: "Kommentar umschalten", category: "Code", fallback: "Ctrl+7" },
  { id: "deleteLine", label: "Zeile löschen", category: "Code", fallback: "Ctrl+Y" },
  { id: "duplicateLine", label: "Zeile duplizieren", category: "Code", fallback: "Ctrl+D" },
  { id: "moveLineUp", label: "Zeile nach oben verschieben", category: "Code", fallback: "Alt+Shift+ArrowUp" },
  { id: "moveLineDown", label: "Zeile nach unten verschieben", category: "Code", fallback: "Alt+Shift+ArrowDown" },
  { id: "surroundWith", label: "Auswahl umschließen", category: "Code", fallback: "Ctrl+Alt+T" },
  { id: "fileStructure", label: "Datei-Struktur anzeigen", category: "Navigation", fallback: "Ctrl+F12" },
  { id: "extractMethod", label: "Methode extrahieren", category: "Code", fallback: "Ctrl+Alt+M" },
  { id: "extractVariable", label: "Variable einführen", category: "Code", fallback: "Ctrl+Alt+V" },
  { id: "changeSignature", label: "Signatur ändern", category: "Code", fallback: "Ctrl+F6" },

  { id: "run", label: "Ausführen", category: "Ausführen & Debuggen", fallback: "F5" },
  { id: "stop", label: "Prozess beenden", category: "Ausführen & Debuggen", fallback: "Shift+F5" },
  { id: "build", label: "Projekt bauen", category: "Ausführen & Debuggen", fallback: "Ctrl+Shift+B" },
  { id: "runTests", label: "Tests ausführen", category: "Ausführen & Debuggen", fallback: "Ctrl+Shift+F10" },
  { id: "debug", label: "Debuggen", category: "Ausführen & Debuggen", fallback: "Shift+F9" },
  { id: "toggleBreakpoint", label: "Breakpoint umschalten", category: "Ausführen & Debuggen", fallback: "F9" },

  { id: "togglePanel", label: "Werkzeugfenster umschalten", category: "Ansicht", fallback: "Ctrl+J" },
  { id: "toggleTerminal", label: "Terminal anzeigen", category: "Ansicht", fallback: "Ctrl+Backquote" },
  { id: "toggleProblems", label: "Probleme anzeigen", category: "Ansicht", fallback: "Ctrl+Shift+M" },
  { id: "toggleTodos", label: "TODOs anzeigen", category: "Ansicht", fallback: "Ctrl+Shift+T" },
  { id: "toggleSidebar", label: "Seitenleiste umschalten", category: "Ansicht", fallback: "Ctrl+B" },
  { id: "focusMode", label: "Fokusmodus", category: "Ansicht", fallback: "Ctrl+Shift+F11" },
  { id: "toggleBookmark", label: "Lesezeichen setzen", category: "Ansicht", fallback: "F11" },

  { id: "explorerCut", label: "Explorer: Ausschneiden", category: "Explorer", fallback: "Ctrl+X" },
  { id: "explorerCopy", label: "Explorer: Kopieren", category: "Explorer", fallback: "Ctrl+C" },
  { id: "explorerPaste", label: "Explorer: Einfügen", category: "Explorer", fallback: "Ctrl+V" },
];

export type KeybindingId = string;

/**
 * Fills in the defaults for everything the user has not bound.
 *
 * An empty string is kept as-is: that is how a command is switched off, and it
 * must not silently spring back to its default.
 */
export function resolveKeybindings(custom: Record<string, string> | undefined): Record<KeybindingId, string> {
  const resolved: Record<string, string> = {};
  for (const { id, fallback } of keybindingCatalogue) {
    const configured = custom?.[id];
    resolved[id] = typeof configured === "string" ? configured.trim() : fallback;
  }
  return resolved;
}

/** Normalises a shortcut so "ctrl + SHIFT+p" and "Ctrl+Shift+P" compare equal. */
export function normalizeShortcut(shortcut: string): string {
  const parts = String(shortcut || "").toLowerCase().replace(/\s+/g, "").split("+").filter(Boolean);
  const key = parts.at(-1) || "";
  if (!key) return "";
  const modifiers = [
    parts.some((part) => part === "ctrl" || part === "cmd" || part === "meta") ? "Ctrl" : "",
    parts.includes("alt") ? "Alt" : "",
    parts.includes("shift") ? "Shift" : "",
  ].filter(Boolean);
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key.replace(/^./, (first) => first.toUpperCase())].join("+");
}

/** Turns a pressed key into the text stored in the settings. */
export function shortcutFromEvent(event: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string {
  const modifierOnly = ["Control", "Alt", "Shift", "Meta", "OS"];
  if (modifierOnly.includes(event.key)) return "";
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  // The physical key is the stable half: Shift+7 reports "/" on a German
  // layout, and storing that would never match again.
  let key = event.key;
  if (key === " ") key = "Space";
  else if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  else if (event.code === "Backquote") key = "Backquote";
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  parts.push(key);
  return parts.join("+");
}

/**
 * The name a pressed key is stored under.
 *
 * Mirrors `shortcutFromEvent`: the physical key wins for digits and the
 * backtick, because a German layout reports "/" for Shift+7 and a French one
 * reports "è" for the unshifted 7. Without this the workbench compared the
 * character against the stored digit and a recorded Ctrl+Shift+7 could never
 * fire again.
 */
export function eventKeyNames(event: { key: string; code: string }): string[] {
  const names = new Set<string>();
  const key = String(event.key || "");
  const code = String(event.code || "");
  if (key) names.add(key === " " ? "space" : key.toLowerCase());
  if (code) names.add(code.toLowerCase());
  const digit = code.match(/^(?:Digit|Numpad)(\d)$/);
  if (digit) names.add(digit[1]);
  // Letters are deliberately not read off the physical key: they are recorded
  // from the character, so deriving "z" from KeyZ would let one press match
  // two commands on a layout where the two differ.
  return [...names];
}

/**
 * Whether a pressed key is the shortcut a command is bound to.
 *
 * An empty binding never matches: that is how a command is switched off.
 */
export function matchesShortcut(
  event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  shortcut: string | undefined,
): boolean {
  const parts = String(shortcut || "").toLowerCase().replace(/\s+/g, "").split("+").filter(Boolean);
  const key = parts.at(-1);
  if (!key) return false;
  const wantsCtrl = parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta");
  return eventKeyNames(event).includes(key)
    && (event.ctrlKey || event.metaKey) === wantsCtrl
    && event.altKey === parts.includes("alt")
    && event.shiftKey === parts.includes("shift");
}

/**
 * Reports every shortcut that is bound to more than one command.
 *
 * Two commands on one key is not automatically wrong — the Explorer bindings
 * deliberately reuse Ctrl+X/C/V while the tree has focus — so this only
 * flags them for the user rather than refusing the change.
 */
export function findShortcutConflicts(bindings: Record<string, string>): Array<{ shortcut: string; ids: string[] }> {
  const byShortcut = new Map<string, string[]>();
  for (const { id } of keybindingCatalogue) {
    const shortcut = normalizeShortcut(bindings[id] || "");
    if (!shortcut) continue;
    byShortcut.set(shortcut, [...(byShortcut.get(shortcut) || []), id]);
  }
  return [...byShortcut.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([shortcut, ids]) => ({ shortcut, ids }));
}
