/**
 * Noticing that Kiwi got slower.
 *
 * The last five numbers were already kept and shown. Five numbers tell you
 * what just happened; they do not tell you whether it was normal. A startup
 * that takes four seconds means nothing on its own — it is either a slow
 * machine or a regression, and only the machine's own history says which.
 *
 * So the history becomes a baseline: the median of what this machine usually
 * does, and a spread around it. A run well outside that is worth saying out
 * loud, once, rather than logging into a list nobody opens.
 *
 * Median rather than mean, because one cold start after a reboot would drag a
 * mean up for the rest of the week and then quietly hide the regression it was
 * supposed to catch.
 */

export type MetricKind = "startup" | "project" | "index" | "memory";

export interface PerformanceSample {
  kind: MetricKind;
  value: number;
  unit: "ms" | "MB";
  timestamp: string;
  projectRoot?: string;
}

/** Below this many samples there is no baseline, only a few numbers. */
export const MIN_BASELINE_SAMPLES = 5;

/** How far past the usual a run has to be before it is worth mentioning. */
export const REGRESSION_FACTOR = 1.6;

/**
 * How much slower in absolute terms before it is worth a word.
 *
 * Not a single number: a fixed 400 ms makes anything that normally takes 40 ms
 * unwatchable, because it would have to become ten times slower before
 * anybody was told. And a fixed small number would report noise on something
 * that normally takes three seconds.
 *
 * So the floor follows the baseline and is capped at both ends: never less
 * than a delay somebody could feel, never more than the ceiling below.
 */
export const REGRESSION_FLOOR_MS = 400;
export const REGRESSION_MIN_FLOOR_MS = 150;
export const REGRESSION_FLOOR_MB = 150;
export const REGRESSION_MIN_FLOOR_MB = 60;

/** The excess a measurement of this size has to show. */
export function regressionFloor(median: number, unit: "ms" | "MB"): number {
  const ceiling = unit === "MB" ? REGRESSION_FLOOR_MB : REGRESSION_FLOOR_MS;
  const bottom = unit === "MB" ? REGRESSION_MIN_FLOOR_MB : REGRESSION_MIN_FLOOR_MS;
  return Math.min(ceiling, Math.max(bottom, Number(median) || 0));
}

export interface Baseline {
  kind: MetricKind;
  /** What this machine usually does. */
  median: number;
  /** The slowest quarter's edge, which is where "unusual" starts. */
  upper: number;
  samples: number;
}

/** The middle value, which one cold start cannot drag around. */
export function median(values: number[]): number {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The value a given share of the samples falls below. */
export function percentile(values: number[], share: number): number {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const position = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)));
  return sorted[position];
}

/**
 * What this machine usually does for one kind of measurement.
 *
 * The newest sample is left out: it is the one being judged, and a baseline
 * that included it would move toward whatever it was measuring.
 */
export function baselineFor(samples: PerformanceSample[], kind: MetricKind, exclude = 1): Baseline | null {
  const values = samples
    .filter((sample) => sample.kind === kind && Number.isFinite(sample.value))
    .map((sample) => sample.value);
  const history = exclude > 0 ? values.slice(0, Math.max(0, values.length - exclude)) : values;
  if (history.length < MIN_BASELINE_SAMPLES) return null;
  return {
    kind,
    median: median(history),
    upper: percentile(history, 0.75),
    samples: history.length,
  };
}

export interface Regression {
  kind: MetricKind;
  value: number;
  median: number;
  unit: "ms" | "MB";
  /** How many times the usual, rounded to one place. */
  factor: number;
  /** In German, and about what happened rather than about statistics. */
  message: string;
}

const KIND_LABELS: Record<MetricKind, string> = {
  startup: "Der Start",
  project: "Das Öffnen des Projekts",
  index: "Die Indexierung",
  memory: "Der Speicherverbrauch",
};

/**
 * Whether the newest measurement is unusual for this machine.
 *
 * Two conditions, and both have to hold: clearly more than the usual, and
 * enough more to matter. Without the second, something that normally takes 20
 * ms and once took 40 would be reported as having doubled — true, and not
 * worth a word.
 */
export function detectRegression(samples: PerformanceSample[], kind: MetricKind): Regression | null {
  const ofKind = samples.filter((sample) => sample.kind === kind && Number.isFinite(sample.value));
  const newest = ofKind.at(-1);
  if (!newest) return null;
  const baseline = baselineFor(samples, kind);
  if (!baseline || baseline.median <= 0) return null;

  const factor = newest.value / baseline.median;
  const excess = newest.value - baseline.median;
  if (factor < REGRESSION_FACTOR || excess < regressionFloor(baseline.median, newest.unit)) return null;

  const rounded = Math.round(factor * 10) / 10;
  return {
    kind,
    value: newest.value,
    median: Math.round(baseline.median),
    unit: newest.unit,
    factor: rounded,
    message: `${KIND_LABELS[kind]} hat ${newest.value} ${newest.unit} gebraucht`
      + ` — sonst etwa ${Math.round(baseline.median)} ${newest.unit}.`,
  };
}

/**
 * Whether memory is climbing rather than moving.
 *
 * A single high reading is not a leak: a big project legitimately needs more
 * than a small one. What a leak looks like is a floor that keeps rising —
 * every dip is higher than the last — because whatever is being held is never
 * given back.
 *
 * So the samples are cut in half and the two halves' *minima* compared. Minima
 * rather than averages, because the low points are what is actually held after
 * everything collectable has gone.
 */
export function detectMemoryTrend(samples: PerformanceSample[], minimumSamples = 8): {
  leaking: boolean;
  earlyFloor: number;
  lateFloor: number;
  growthMb: number;
  message: string;
} | null {
  const values = samples
    .filter((sample) => sample.kind === "memory" && Number.isFinite(sample.value))
    .map((sample) => sample.value);
  if (values.length < minimumSamples) return null;

  const half = Math.floor(values.length / 2);
  const earlyFloor = Math.min(...values.slice(0, half));
  const lateFloor = Math.min(...values.slice(half));
  const growthMb = Math.round(lateFloor - earlyFloor);
  // A quarter more than it started with, and at least this much in absolute
  // terms — a project that grew from 90 to 120 MB grew because more is open.
  const leaking = growthMb >= 120 && lateFloor >= earlyFloor * 1.25;
  return {
    leaking,
    earlyFloor: Math.round(earlyFloor),
    lateFloor: Math.round(lateFloor),
    growthMb,
    message: leaking
      ? `Der Speicherverbrauch steigt dauerhaft: von etwa ${Math.round(earlyFloor)} MB auf ${Math.round(lateFloor)} MB,`
        + " auch zwischen den Spitzen. Ein Neustart von Kiwi schafft Platz."
      : "",
  };
}

/**
 * A short account of what this machine usually does, for a report.
 *
 * Written for somebody comparing two machines or two versions, so it names the
 * sample count: a median of three runs is not a baseline and should not read
 * like one.
 */
export function describeBaselines(samples: PerformanceSample[]): string[] {
  const lines: string[] = [];
  for (const kind of ["startup", "project", "index", "memory"] as MetricKind[]) {
    const baseline = baselineFor(samples, kind, 0);
    if (!baseline) continue;
    const unit = samples.find((sample) => sample.kind === kind)?.unit || "ms";
    lines.push(`${KIND_LABELS[kind]}: ${Math.round(baseline.median)} ${unit}`
      + ` (${baseline.samples} Messungen, langsamstes Viertel ab ${Math.round(baseline.upper)} ${unit})`);
  }
  return lines;
}
