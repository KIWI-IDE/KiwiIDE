/**
 * Whether a colour somebody picked can actually be read.
 *
 * A theme editor makes it easy to choose a colour that looks right in the
 * swatch and disappears in the code — dark grey comments on a dark background,
 * a keyword the same shade as the surface behind it. The swatch shows the
 * colour alone; what matters is the pair, and nobody checks pairs by eye.
 *
 * So the pairs are checked here, against WCAG's contrast ratio. It is not a
 * law: an editor is not a web page, and somebody who deliberately wants faint
 * comments is not making a mistake. The result is a warning beside the control
 * that caused it, never a refusal — the colour is theirs.
 */

/** WCAG's threshold for ordinary body text. */
export const CONTRAST_READABLE = 4.5;

/**
 * Where code stops being comfortable.
 *
 * Below this a token is still visible but takes effort at a glance, which for
 * something read all day is the number that actually matters.
 */
export const CONTRAST_COMFORTABLE = 3;

export type ContrastVerdict = "gut" | "knapp" | "unlesbar";

/** The channels of a six-digit hex colour, 0–255. Answers null for anything else. */
export function parseHexColor(value: string): [number, number, number] | null {
  const hex = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** Relative luminance, per WCAG 2.1. */
export function relativeLuminance(value: string): number {
  const channels = parseHexColor(value);
  if (!channels) return 0;
  const [red, green, blue] = channels.map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The contrast between two colours, from 1 (identical) to 21 (black on white).
 *
 * Answers 0 for anything that is not a colour, which the caller reports as
 * "cannot say" rather than as a failure — a half-typed hex value is not a
 * contrast problem.
 */
export function contrastRatio(foreground: string, background: string): number {
  if (!parseHexColor(foreground) || !parseHexColor(background)) return 0;
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** What a ratio means, in one word. */
export function contrastVerdict(ratio: number): ContrastVerdict | "" {
  if (!ratio) return "";
  if (ratio >= CONTRAST_READABLE) return "gut";
  return ratio >= CONTRAST_COMFORTABLE ? "knapp" : "unlesbar";
}

export interface ContrastFinding {
  /** The token or surface whose control the warning belongs beside. */
  id: string;
  label: string;
  ratio: number;
  verdict: ContrastVerdict;
  /** In German, and about what to do rather than about the standard. */
  message: string;
}

/**
 * Checks every foreground against the surface it is actually drawn on.
 *
 * Only the ones worth saying something about come back: a pair that reads
 * fine is not a finding, and a list that warns about everything is a list
 * nobody reads.
 */
export function checkContrast(
  pairs: Array<{ id: string; label: string; foreground: string; background: string }>,
): ContrastFinding[] {
  // One bad colour, one warning. Most tokens inherit their colour from another,
  // so setting comments to something unreadable produced three identical
  // warnings — comments, Javadoc and Javadoc tags — for one cause and one fix.
  const byColour = new Map<string, { pair: typeof pairs[number]; also: string[] }>();
  for (const pair of pairs) {
    const ratio = contrastRatio(pair.foreground, pair.background);
    const verdict = contrastVerdict(ratio);
    if (!verdict || verdict === "gut") continue;
    const key = `${pair.foreground.toUpperCase()}|${pair.background.toUpperCase()}`;
    const existing = byColour.get(key);
    // The first one named is the one kept, and `pairs` is given in the order
    // the settings list them — so the anchor comes before what inherits it.
    if (existing) existing.also.push(pair.label);
    else byColour.set(key, { pair, also: [] });
  }

  const findings: ContrastFinding[] = [];
  for (const { pair, also } of byColour.values()) {
    const ratio = contrastRatio(pair.foreground, pair.background);
    const verdict = contrastVerdict(ratio) as ContrastVerdict;
    const named = also.length
      ? `${pair.label} (und ${also.length} weitere in derselben Farbe)`
      : pair.label;
    findings.push({
      id: pair.id,
      label: pair.label,
      ratio: Math.round(ratio * 10) / 10,
      verdict,
      message: verdict === "unlesbar"
        ? `${named} hebt sich kaum vom Hintergrund ab (Kontrast ${formatRatio(ratio)}).`
        : `${named} ist lesbar, aber anstrengend (Kontrast ${formatRatio(ratio)}).`,
    });
  }
  // Worst first: if only one warning is read, it should be the one that
  // matters.
  return findings.sort((left, right) => left.ratio - right.ratio);
}

/** A ratio the way it is written about: "3,2:1". */
export function formatRatio(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1).replace(".", ",")}:1`;
}

/**
 * A readable version of a colour on a given background.
 *
 * Offered beside a warning as a one-click repair. The hue is kept and only the
 * lightness moves, because somebody who picked purple wanted purple — they did
 * not want grey, and a "fix" that changes the colour is not a fix.
 */
export function readableAgainst(foreground: string, background: string, target = CONTRAST_READABLE): string {
  const channels = parseHexColor(foreground);
  if (!channels || !parseHexColor(background)) return "";
  const backgroundLuminance = relativeLuminance(background);
  // Toward white on a dark surface, toward black on a light one.
  const towards = backgroundLuminance < 0.5 ? 255 : 0;
  let best = foreground.replace(/^#/, "").toUpperCase();
  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20;
    const moved = channels
      .map((channel) => Math.round(channel + (towards - channel) * amount))
      .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    best = moved;
    if (contrastRatio(moved, background) >= target) return moved;
  }
  return best;
}
