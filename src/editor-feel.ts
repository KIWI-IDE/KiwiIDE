/**
 * How the editor feels rather than what it does.
 *
 * These are the settings nobody can justify on a feature list and everybody
 * notices after an hour: how fast the caret blinks, whether the view slides or
 * jumps when you go to a definition, whether comments are set in the same face
 * as the code, how wide the text is allowed to get before the eye has to
 * travel. None of it changes what the editor can do; all of it changes whether
 * a day in it is tiring.
 *
 * Everything here turns a number somebody chose into what Monaco or the
 * stylesheet needs. The arithmetic lives in one place so the two never
 * disagree — a caret that blinks at one speed and a setting that says another
 * is worse than no setting.
 */

export type LineHighlight = "none" | "line" | "gutter" | "all";

/** How a jump to another place in the file is shown. */
export type RevealMotion = "instant" | "smooth";

export interface EditorFeelSettings {
  /** Milliseconds for one blink. 0 stops the caret blinking at all. */
  cursorBlinkMs: number;
  /** Whether the caret slides between positions instead of jumping. */
  cursorAnimation: boolean;
  /** Whether scrolling glides. */
  smoothScrolling: boolean;
  /** Whether going somewhere else in the file glides too. */
  revealMotion: RevealMotion;
  lineHighlight: LineHighlight;
  /** Fonts for the three things that are read differently. Empty follows the code font. */
  commentFont: string;
  inlayFont: string;
  /** Font sizes relative to the code, in percent. */
  inlayFontScale: number;
  /** OpenType features, e.g. "'calt', 'ss01'". "off" and "on" also work. */
  ligatures: string;
  /** Faces to fall back to when the first one has no glyph. */
  fontFallbacks: string;
  /** Minimap tint and how solid it is. */
  minimapOpacity: number;
  /** How wide the text may get in focus mode, in characters. 0 leaves it alone. */
  focusMaxWidth: number;
  /** Whether sticky scroll and breadcrumbs get a stronger separation. */
  stickyEmphasis: number;
  breadcrumbEmphasis: number;
}

export const defaultEditorFeel: EditorFeelSettings = {
  // Monaco's own rhythm, so an untouched setting is what it always was.
  cursorBlinkMs: 1000,
  cursorAnimation: true,
  smoothScrolling: true,
  revealMotion: "smooth",
  lineHighlight: "all",
  commentFont: "",
  inlayFont: "",
  inlayFontScale: 90,
  ligatures: "on",
  fontFallbacks: "",
  minimapOpacity: 100,
  focusMaxWidth: 0,
  stickyEmphasis: 100,
  breadcrumbEmphasis: 100,
};

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Math.round(Number(value) || 0)));

/**
 * The font stack for the editor.
 *
 * A fallback list matters more here than anywhere else in the workbench: a
 * monospace face missing one glyph substitutes a proportional one for it, and
 * a single wrong-width character moves everything after it on the line.
 */
export function editorFontStack(fontFamily: string, fallbacks: string): string {
  const first = String(fontFamily || "").trim();
  const rest = String(fallbacks || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const entry of [first, ...rest, "JetBrains Mono", "Cascadia Code", "Consolas", "monospace"]) {
    if (!entry) continue;
    const key = entry.toLowerCase().replace(/^["']|["']$/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    // A name with a space needs quoting or the browser reads it as two.
    stack.push(/[\s]/.test(entry) && !/^["']/.test(entry) ? `"${entry}"` : entry);
  }
  return stack.join(", ");
}

/**
 * What Monaco wants for ligatures.
 *
 * It takes either a boolean or a feature string, and a feature string is what
 * makes "the arrows but not the equals ligature" possible at all.
 */
export function ligatureSetting(value: string): boolean | string {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate === "off" || candidate === "false") return false;
  if (candidate === "on" || candidate === "true") return true;
  return candidate;
}

/**
 * Monaco's editor options for the feel settings.
 *
 * Reduced motion wins over every one of them: somebody who asked the system
 * for less movement did not mean "except here".
 */
export function editorFeelOptions(settings: EditorFeelSettings, reducedMotion: boolean): Record<string, unknown> {
  return {
    cursorBlinking: settings.cursorBlinkMs === 0 ? "solid" : "blink",
    cursorSmoothCaretAnimation: reducedMotion || !settings.cursorAnimation ? "off" : "on",
    smoothScrolling: reducedMotion ? false : settings.smoothScrolling,
    renderLineHighlight: settings.lineHighlight,
    fontLigatures: ligatureSetting(settings.ligatures),
  };
}

/**
 * How a jump should be shown, as Monaco's scroll type.
 *
 * 0 is immediate and 1 is smooth in Monaco's own enum, spelled out here so the
 * caller does not have to import an enum for one number.
 */
export function revealScrollType(settings: EditorFeelSettings, reducedMotion: boolean): 0 | 1 {
  return reducedMotion || settings.revealMotion === "instant" ? 0 : 1;
}

/**
 * The custom properties the stylesheet paints the feel from.
 *
 * Monaco has no option for most of these — a caret's blink rate, the font of
 * a comment, how solid the minimap is — but every one of them is a CSS
 * question, and the classes are stable.
 */
export function editorFeelVariables(
  settings: EditorFeelSettings,
  options: { reducedMotion?: boolean; fontSize?: number } = {},
): Record<string, string> {
  const still = Boolean(options.reducedMotion);
  const blink = clamp(settings.cursorBlinkMs, 0, 5_000);
  const size = Math.max(6, Number(options.fontSize) || 13);
  return {
    // A blink of 0 means a caret that does not blink, which is what "solid"
    // gives — the duration is then never used, but a zero here would make the
    // animation run infinitely fast if it ever were.
    "--caret-blink": still || !blink ? "0s" : `${blink}ms`,
    "--comment-font": settings.commentFont
      ? `${quoted(settings.commentFont)}, var(--editor-font)`
      : "var(--editor-font)",
    "--inlay-font": settings.inlayFont
      ? `${quoted(settings.inlayFont)}, var(--editor-font)`
      : "var(--editor-font)",
    "--inlay-font-size": `${Math.round(size * (clamp(settings.inlayFontScale, 40, 160) / 100) * 10) / 10}px`,
    "--minimap-opacity": String(clamp(settings.minimapOpacity, 0, 100) / 100),
    "--sticky-emphasis": String(clamp(settings.stickyEmphasis, 0, 200) / 100),
    "--breadcrumb-emphasis": String(clamp(settings.breadcrumbEmphasis, 0, 200) / 100),
    // In characters rather than pixels: a line length is a reading measure, and
    // 0 means the text may use the whole pane, which is what it always did.
    "--focus-max-width": settings.focusMaxWidth
      ? `${clamp(settings.focusMaxWidth, 40, 200)}ch`
      : "none",
  };
}

/**
 * Which of Monaco's token classes carries a colour.
 *
 * Monaco does not name its token spans. It numbers them — `.mtk3` — by the
 * position of their colour in the theme's colour map, and injects a stylesheet
 * that says which number is which colour. So a rule that wants to reach
 * comments has to find the number, and the injected stylesheet is the only
 * place that knows it.
 *
 * Answers 0 when it cannot be found, which the caller takes as "leave the font
 * alone" — comments in the code font are what they always were, and a rule
 * aimed at the wrong number would set the wrong tokens in Georgia.
 */
export function tokenClassForColor(rules: Array<{ selector: string; color: string }>, color: string): number {
  const wanted = normalizeColor(color);
  if (!wanted) return 0;
  for (const rule of rules) {
    if (normalizeColor(rule.color) !== wanted) continue;
    const match = /^\.mtk(\d+)$/.exec(String(rule.selector || "").trim());
    if (match) return Number(match[1]);
  }
  return 0;
}

/** A colour as six lower-case hex digits, from hex or from `rgb(...)`. */
export function normalizeColor(value: string): string {
  const text = String(value || "").trim().toLowerCase();
  const hex = /^#?([0-9a-f]{6})$/.exec(text);
  if (hex) return hex[1];
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (!rgb) return "";
  return [rgb[1], rgb[2], rgb[3]]
    .map((channel) => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, "0"))
    .join("");
}

function quoted(name: string): string {
  const value = String(name || "").trim();
  if (!value) return "";
  return /\s/.test(value) && !/^["']/.test(value) ? `"${value}"` : value;
}

/**
 * What a line-highlight choice does, for the settings description.
 *
 * "all" is Monaco's word for the line and its number together, which is not
 * obvious from the word.
 */
export function describeLineHighlight(value: LineHighlight): string {
  return {
    none: "Nichts hervorheben",
    line: "Nur die Zeile",
    gutter: "Nur die Zeilennummer",
    all: "Zeile und Zeilennummer",
  }[value] || "Zeile und Zeilennummer";
}
