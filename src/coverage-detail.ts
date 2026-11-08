/**
 * Which branches were taken, and what the change you are about to push covers.
 *
 * Line coverage is the number people quote and the weakest thing JaCoCo
 * measures. A line holding `if (a && b)` counts as covered the moment it runs
 * once, whichever way it went — so a file can read 100% with half its
 * decisions never taken. JaCoCo counts those branches per line and puts them
 * in the same element the line coverage is read from; nobody was reading them.
 *
 * And a project-wide percentage answers a question nobody asked. The one worth
 * answering is narrower: of the lines this change touches, how many are
 * covered — which is the number that decides whether the change is tested.
 */

export interface CoverageLine {
  line: number;
  covered: boolean;
  coveredInstructions?: number;
  missedInstructions?: number;
  /** Branches on this line that were taken, from JaCoCo's `cb`. */
  coveredBranches?: number;
  /** Branches that were not, from `mb`. */
  missedBranches?: number;
}

export interface CoverageFileLike {
  path: string;
  lines: CoverageLine[];
}

export interface BranchSummary {
  /** Branches taken at least once. */
  covered: number;
  /** Branches never taken. */
  missed: number;
  /** Whole percent, or -1 where the file has no branches to take. */
  percentage: number;
}

/**
 * How many of a file's decisions were actually decided both ways.
 *
 * Answers -1 rather than 100 for a file with no branches at all: a file of
 * plain statements has nothing to report, and reporting it as perfect puts it
 * beside files that earned the number.
 */
export function branchSummary(lines: CoverageLine[]): BranchSummary {
  let covered = 0;
  let missed = 0;
  for (const line of lines || []) {
    covered += Math.max(0, Number(line?.coveredBranches) || 0);
    missed += Math.max(0, Number(line?.missedBranches) || 0);
  }
  const total = covered + missed;
  return { covered, missed, percentage: total ? Math.round((covered / total) * 100) : -1 };
}

/** The lines whose branches were only ever taken one way. */
export function partiallyCoveredLines(lines: CoverageLine[]): number[] {
  return (lines || [])
    .filter((line) => Number(line?.missedBranches) > 0 && Number(line?.coveredBranches) > 0)
    .map((line) => line.line);
}

export interface DiffCoverage {
  /** Lines the change touches that a test ran. */
  covered: number;
  /** Lines the change touches that no test ran. */
  missed: number;
  /** Whole percent, or -1 when the change touches nothing measurable. */
  percentage: number;
  /** The uncovered lines, per file, for jumping straight to them. */
  gaps: Array<{ path: string; lines: number[] }>;
}

/** Which lines a change touches, as line numbers per file. */
export type ChangedLines = Map<string, Set<number>>;

/**
 * Coverage of the change rather than of the project.
 *
 * A file the change did not touch is not counted, and a touched line the
 * report says nothing about is not counted either — a line with no executable
 * code on it is neither covered nor missed, and counting it as missed would
 * make every comment and closing brace an argument for another test.
 */
export function diffCoverage(files: CoverageFileLike[], changed: ChangedLines): DiffCoverage {
  let covered = 0;
  let missed = 0;
  const gaps: Array<{ path: string; lines: number[] }> = [];

  for (const file of files || []) {
    const wanted = lookupChanged(changed, file.path);
    if (!wanted || !wanted.size) continue;
    const uncovered: number[] = [];
    for (const line of file.lines || []) {
      if (!wanted.has(line.line)) continue;
      if (line.covered) covered += 1;
      else {
        missed += 1;
        uncovered.push(line.line);
      }
    }
    if (uncovered.length) gaps.push({ path: file.path, lines: uncovered.sort((a, b) => a - b) });
  }

  const total = covered + missed;
  return {
    covered,
    missed,
    percentage: total ? Math.round((covered / total) * 100) : -1,
    gaps: gaps.sort((left, right) => right.lines.length - left.lines.length || left.path.localeCompare(right.path)),
  };
}

/**
 * The changed lines for a path, however the two sides spell it.
 *
 * Coverage reports name a file by its absolute path and git by one relative to
 * the repository, with the other separator — and on Windows the drive letter
 * comes back in whichever case the tool felt like.
 */
function lookupChanged(changed: ChangedLines, filePath: string): Set<number> | null {
  const normalise = (value: string) => String(value || "").replace(/\\/g, "/").toLowerCase();
  const wanted = normalise(filePath);
  for (const [key, lines] of changed) {
    const candidate = normalise(key);
    if (wanted === candidate || wanted.endsWith(`/${candidate}`) || candidate.endsWith(`/${wanted}`)) {
      return lines;
    }
  }
  return null;
}

/**
 * The lines a unified diff adds or changes.
 *
 * Only the new side matters: a deleted line cannot be covered, and asking for
 * a test that runs it would be asking for the change to be undone.
 */
export function changedLinesFromDiff(diff: string): ChangedLines {
  const changed: ChangedLines = new Map();
  let file = "";
  let line = 0;
  for (const raw of String(diff || "").split(/\r?\n/)) {
    const target = raw.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (target) {
      file = target[1].trim();
      if (file === "/dev/null") file = "";
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      const lines = changed.get(file) || new Set<number>();
      lines.add(line);
      changed.set(file, lines);
      line += 1;
      continue;
    }
    // A context line advances the new side; a removed one does not exist on it.
    if (raw.startsWith(" ") || raw === "") line += 1;
  }
  return changed;
}

/** One line for the panel. */
export function describeDiffCoverage(coverage: DiffCoverage): string {
  if (coverage.percentage < 0) return "Die Änderung berührt keinen messbaren Code.";
  const missing = coverage.missed
    ? `, ${coverage.missed} ${coverage.missed === 1 ? "Zeile" : "Zeilen"} ohne Test`
    : "";
  return `${coverage.percentage}% der geänderten Zeilen abgedeckt${missing}`;
}
