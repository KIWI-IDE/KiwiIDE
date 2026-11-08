/**
 * A theme as a file, and a theme that changes by itself.
 *
 * Colours somebody spent an evening on lived in one machine's settings. There
 * was no way to keep a copy, to send one to somebody, to try a variant without
 * losing the original, or to have the workbench follow the light in the room.
 *
 * The format is deliberately small: a name, which built-in theme it started
 * from, and the two override maps the settings already keep. Nothing is
 * derived and nothing is duplicated, so a file written by an older Kiwi still
 * makes sense to a newer one, and a file somebody edited by hand is readable.
 */

/** Bumped only when an old file would be read wrongly rather than partly. */
export const THEME_FILE_VERSION = 1;

export const THEME_FILE_EXTENSION = ".kiwi-theme.json";

export interface KiwiThemeFile {
  version: number;
  /** What it is called in the list. */
  name: string;
  /** The built-in theme its unset colours come from. */
  base: string;
  /** Preset syntax palette, or "theme" to follow the base. */
  colorScheme: string;
  /** Per-token overrides, keyed the way the settings key them. */
  tokens: Record<string, string>;
  /** Per-surface overrides. */
  workbench: Record<string, string>;
}

const hex = /^[0-9a-fA-F]{6}$/;

/** Keeps only what is actually a six-digit colour. */
function colorsOnly(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const candidate = String(entry ?? "").replace(/^#/, "");
    if (hex.test(candidate)) result[key] = candidate.toUpperCase();
  }
  return result;
}

/** The file for what is currently set. */
export function themeFileFrom(settings: {
  theme: string;
  editorColorScheme: string;
  editorTokenColors: Record<string, string>;
  themeColorOverrides: Record<string, string>;
}, name: string): KiwiThemeFile {
  return {
    version: THEME_FILE_VERSION,
    name: String(name || "").trim() || "Eigenes Theme",
    base: settings.theme,
    colorScheme: settings.editorColorScheme || "theme",
    tokens: colorsOnly(settings.editorTokenColors),
    workbench: colorsOnly(settings.themeColorOverrides),
  };
}

/**
 * Reads a theme file.
 *
 * Everything unreadable is dropped rather than guessed at, and what is left is
 * still a theme — a file with one mistyped colour should not be refused whole.
 * Answers null only when there is nothing usable at all, which is what the
 * caller reports.
 */
export function parseThemeFile(text: string, knownThemes: string[] = []): KiwiThemeFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const tokens = colorsOnly(raw.tokens);
  const workbench = colorsOnly(raw.workbench);
  const name = String(raw.name || "").trim();
  // A file with neither a name nor a single colour is not a theme.
  if (!name && !Object.keys(tokens).length && !Object.keys(workbench).length) return null;
  const base = String(raw.base || "");
  return {
    version: Number(raw.version) || THEME_FILE_VERSION,
    name: name || "Importiertes Theme",
    // A base this build does not have would leave every unset colour undefined,
    // so an unknown one falls back rather than being carried through.
    base: knownThemes.length && !knownThemes.includes(base) ? (knownThemes[0] || "") : base,
    colorScheme: String(raw.colorScheme || "theme"),
    tokens,
    workbench,
  };
}

/** The settings a theme file stands for. */
export function settingsFromThemeFile(file: KiwiThemeFile): {
  theme: string;
  editorColorScheme: string;
  editorTokenColors: Record<string, string>;
  themeColorOverrides: Record<string, string>;
} {
  return {
    theme: file.base,
    editorColorScheme: file.colorScheme || "theme",
    editorTokenColors: { ...file.tokens },
    themeColorOverrides: { ...file.workbench },
  };
}

/** A file name that will not collide with the one beside it. */
export function themeFileName(name: string): string {
  // Letters in any script, not just ASCII: this is a German interface, and a
  // theme called "Mein grünes Theme" should not become "Mein-grnes-Theme".
  const cleaned = String(name || "").trim()
    .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
    .replace(/\s+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "");
  return `${cleaned || "kiwi-theme"}${THEME_FILE_EXTENSION}`;
}

/**
 * A name for a copy that is not already taken.
 *
 * "Kopie", then "Kopie 2": duplicating twice must give two themes, not one
 * that silently replaced the other.
 */
export function duplicateName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((entry) => entry.trim().toLowerCase()));
  const stem = String(name || "Theme").trim() || "Theme";
  const first = `${stem} Kopie`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${first} ${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${first} ${Date.now()}`;
}

export type ThemeSchedule = "off" | "system" | "time";

/**
 * Which theme should be showing.
 *
 * "system" follows what Windows says; "time" follows the clock, because the
 * light in a room does not ask the operating system. Answers "" when nothing
 * should change, which the caller takes as "leave it alone" — a schedule that
 * rewrites the theme on every tick would fight anybody choosing one by hand.
 */
export function scheduledTheme(options: {
  schedule: ThemeSchedule;
  dayTheme: string;
  nightTheme: string;
  /** Minutes after midnight. */
  dayStart: number;
  nightStart: number;
  /** What the operating system reports, when it is asked. */
  systemPrefersDark?: boolean;
  /** Minutes after midnight, now. */
  now: number;
}): string {
  const { schedule, dayTheme, nightTheme } = options;
  if (schedule === "off" || !dayTheme || !nightTheme) return "";
  if (schedule === "system") return options.systemPrefersDark ? nightTheme : dayTheme;

  const day = clampMinutes(options.dayStart);
  const night = clampMinutes(options.nightStart);
  const now = clampMinutes(options.now);
  // Two identical times mean no schedule at all rather than a theme that
  // flips every minute.
  if (day === night) return "";
  return isDaytime(now, day, night) ? dayTheme : nightTheme;
}

/** Whether a moment falls in the daytime window, which may wrap past midnight. */
export function isDaytime(now: number, dayStart: number, nightStart: number): boolean {
  return dayStart < nightStart
    ? now >= dayStart && now < nightStart
    // Day starting after night start means the window wraps: 20:00 to 06:00.
    : now >= dayStart || now < nightStart;
}

/** "07:30" as minutes after midnight. Answers -1 for anything else. */
export function parseTimeOfDay(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return -1;
  return hours * 60 + minutes;
}

/** Minutes after midnight as "07:30". */
export function formatTimeOfDay(minutes: number): string {
  const total = clampMinutes(minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clampMinutes(value: number): number {
  const minutes = Math.round(Number(value) || 0);
  return ((minutes % 1440) + 1440) % 1440;
}
