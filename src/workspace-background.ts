/**
 * The picture behind the workbench.
 *
 * There was one image, one opacity and one position: centred, scaled to fit,
 * everywhere at once. That is enough to have a picture and not enough to live
 * with one. A photograph that reads well behind code is usually not the one
 * that reads well behind a file tree, the corner it should sit in depends on
 * where the panels are, and the strength that is right while writing is too
 * much while reading.
 *
 * So each surface gets its own strength, the image gets a place and a size and
 * a blur, and a project can have its own. Everything here is arithmetic on
 * numbers somebody chose; the drawing is CSS, and each value comes out as a
 * custom property so the stylesheet stays the one place that knows how to
 * paint.
 */

export type BackgroundFit = "contain" | "cover" | "stretch" | "tile" | "center";

export type BackgroundAnchor =
  | "center" | "top" | "bottom" | "left" | "right"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface BackgroundSettings {
  /** The image, or the first of several. */
  image: string;
  /** More of them, shown in turn. Empty means the single image above. */
  playlist: string[];
  /** Seconds between changes. 0 turns the rotation off. */
  rotateSeconds: number;
  /** Per-surface strength, 0–100. */
  opacity: number;
  editorOpacity: number;
  explorerOpacity: number;
  terminalOpacity: number;
  /** Where the picture sits and how it is scaled. */
  anchor: BackgroundAnchor;
  fit: BackgroundFit;
  /** Extra scale on top of the fit, in percent. 100 leaves it alone. */
  scale: number;
  /** Gaussian blur in pixels. Code over a sharp photograph is hard to read. */
  blur: number;
  /** A wash of the accent colour over the image, 0–100. */
  tint: number;
  /**
   * How much the picture moves as the editor scrolls, in pixels per thousand
   * scrolled. Deliberately small: anything fast enough to notice is something
   * to look at rather than work behind.
   */
  parallax: number;
  /** What the strength is multiplied by in focus mode, in percent. */
  focusStrength: number;
  /** Whether a moving image may play at all. */
  allowAnimation: boolean;
}

export const defaultBackgroundSettings: BackgroundSettings = {
  image: "",
  playlist: [],
  rotateSeconds: 0,
  opacity: 18,
  // -1 means "follow the overall strength", which is what an untouched
  // setting must do: three sliders that all start at 18 would be three
  // sliders somebody has to keep in step by hand.
  editorOpacity: -1,
  explorerOpacity: -1,
  terminalOpacity: -1,
  anchor: "center",
  fit: "contain",
  scale: 100,
  blur: 0,
  tint: 0,
  parallax: 0,
  focusStrength: 100,
  allowAnimation: false,
};

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Math.round(Number(value) || 0)));

/** The strength of one surface, following the overall one when unset. */
export function surfaceOpacity(settings: BackgroundSettings, own: number): number {
  const overall = clamp(settings.opacity, 0, 100);
  return own < 0 ? overall : clamp(own, 0, 100);
}

/** Where CSS should put the image. */
export function anchorPosition(anchor: BackgroundAnchor): string {
  const map: Record<BackgroundAnchor, string> = {
    center: "center center",
    top: "center top",
    bottom: "center bottom",
    left: "left center",
    right: "right center",
    "top-left": "left top",
    "top-right": "right top",
    "bottom-left": "left bottom",
    "bottom-right": "right bottom",
  };
  return map[anchor] || "center center";
}

/**
 * How CSS should size the image.
 *
 * A scale other than 100 has to win over the fit, because "contain at 140%" is
 * not something `background-size` can say in one word.
 */
export function fitSize(fit: BackgroundFit, scale: number): string {
  const percent = clamp(scale, 10, 400);
  if (percent !== 100) return `${percent}% auto`;
  if (fit === "cover") return "cover";
  if (fit === "stretch") return "100% 100%";
  if (fit === "tile") return "auto";
  if (fit === "center") return "auto";
  return "contain";
}

/** Whether the image repeats, which only tiling wants. */
export function fitRepeat(fit: BackgroundFit): string {
  return fit === "tile" ? "repeat" : "no-repeat";
}

/**
 * Which image is showing.
 *
 * The playlist turns over on a clock rather than on a render, so the picture
 * does not change every time something else does. An empty playlist is the
 * single image, which is what somebody who never opened this expects.
 */
export function currentBackgroundImage(settings: BackgroundSettings, elapsedSeconds: number): string {
  const list = (settings.playlist || []).filter(Boolean);
  if (!list.length) return settings.image || "";
  const every = clamp(settings.rotateSeconds, 0, 86_400);
  if (!every) return list[0];
  const step = Math.floor(Math.max(0, elapsedSeconds) / every);
  return list[step % list.length];
}

/** Whether a path is a moving image, which is the expensive kind. */
export function isAnimatedBackground(pathOrData: string): boolean {
  const value = String(pathOrData || "").toLowerCase();
  if (value.startsWith("data:")) return /^data:(?:image\/gif|image\/webp|image\/apng|video\/)/.test(value);
  return /\.(?:gif|webp|apng|mp4|webm)$/.test(value.split("?")[0]);
}

/**
 * What to say about a moving image, in German and about the cost.
 *
 * Not a refusal. A laptop on battery redrawing a video behind an editor is a
 * real cost, and somebody who wants it anyway should be told once rather than
 * stopped.
 */
export function animationWarning(pathOrData: string, allowed: boolean): string {
  if (!isAnimatedBackground(pathOrData)) return "";
  return allowed
    ? "Bewegte Hintergründe kosten dauerhaft Rechenzeit und Akku."
    : "Dieses Bild bewegt sich. Aktiviere bewegte Hintergründe, sonst wird nur das erste Bild gezeigt.";
}

/**
 * The custom properties the stylesheet paints from.
 *
 * One place that knows the arithmetic, one place that knows the drawing.
 */
export function backgroundVariables(
  settings: BackgroundSettings,
  imageData: string,
  options: { focusMode?: boolean; scrolled?: number } = {},
): Record<string, string> {
  const focus = options.focusMode ? clamp(settings.focusStrength, 0, 300) / 100 : 1;
  const strength = (value: number) => String((surfaceOpacity(settings, value) / 100) * focus);
  // Pixels per thousand scrolled, so the number in the settings is a slow
  // number and the picture drifts rather than moves.
  const shift = (clamp(settings.parallax, 0, 100) * (Number(options.scrolled) || 0)) / 1000;

  return {
    "--workspace-background-image": imageData ? `url(${JSON.stringify(imageData)})` : "none",
    "--workspace-background-opacity": strength(-1),
    "--workspace-background-opacity-editor": strength(settings.editorOpacity),
    "--workspace-background-opacity-explorer": strength(settings.explorerOpacity),
    "--workspace-background-opacity-terminal": strength(settings.terminalOpacity),
    "--workspace-background-position": anchorPosition(settings.anchor),
    "--workspace-background-size": fitSize(settings.fit, settings.scale),
    "--workspace-background-repeat": fitRepeat(settings.fit),
    "--workspace-background-blur": `${clamp(settings.blur, 0, 40)}px`,
    "--workspace-background-tint": String(clamp(settings.tint, 0, 100) / 100),
    "--workspace-background-shift": `${Math.round(shift * 10) / 10}px`,
  };
}

/**
 * The settings that apply to one project.
 *
 * A project's own picture wins over the global one, and only over the picture:
 * somebody who set a photograph for one project did not mean to reset its
 * blur, so anything the project does not name comes from the global settings.
 */
export function backgroundFor(
  global: Partial<BackgroundSettings>,
  project: Partial<BackgroundSettings> | null | undefined,
): BackgroundSettings {
  const merged = { ...defaultBackgroundSettings, ...global };
  if (!project) return merged;
  const named = Object.fromEntries(
    Object.entries(project).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
  return { ...merged, ...named } as BackgroundSettings;
}
