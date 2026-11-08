/**
 * `//region` markers in a Java source.
 *
 * The markers are a comment convention, not Java syntax, so nothing in the
 * language server reports them. Finding them here keeps the editor's folding
 * and its highlighting reading the same source of truth, and makes the rules
 * — which spellings count, what happens to an unclosed region — something a
 * test can pin down instead of something the editor decides twice.
 */

export interface JavaRegion {
  /** 1-based line carrying the opening marker. */
  startLine: number;
  /** 1-based line carrying the matching `endregion`, or the last line. */
  endLine: number;
  /** The text after the marker, empty when the region was left unnamed. */
  name: string;
  /** False when no `endregion` followed, which is worth showing as a defect. */
  closed: boolean;
}

/**
 * Both spellings are accepted. IntelliJ writes `//region Name`, Visual Studio
 * and the editors that followed it write `//#region Name`, and files travel
 * between them.
 */
const startPattern = /^\s*\/\/\s*#?region\b[ \t]*(.*)$/i;
const endPattern = /^\s*\/\/\s*#?endregion\b/i;

/** True when the line opens a region. */
export function isRegionStart(line: string): boolean {
  return startPattern.test(line);
}

/** True when the line closes one. */
export function isRegionEnd(line: string): boolean {
  return endPattern.test(line);
}

/**
 * Every region in the source, innermost last.
 *
 * Regions nest, so the opening markers are kept on a stack and each `endregion`
 * closes the nearest one still open. Markers left open at the end of the file
 * still produce a region running to the last line: folding something that was
 * clearly meant to fold is more useful than dropping it silently, and `closed`
 * says it was never terminated.
 */
export function findJavaRegions(source: string): JavaRegion[] {
  const lines = String(source ?? "").split(/\r?\n/);
  const open: Array<{ startLine: number; name: string }> = [];
  const regions: JavaRegion[] = [];
  lines.forEach((line, index) => {
    const started = startPattern.exec(line);
    if (started) {
      open.push({ startLine: index + 1, name: started[1].trim() });
      return;
    }
    if (!endPattern.test(line)) return;
    const start = open.pop();
    // An `endregion` with nothing open is a stray marker, not a region.
    if (!start) return;
    regions.push({ ...start, endLine: index + 1, closed: true });
  });
  for (const start of open) {
    regions.push({ ...start, endLine: Math.max(start.startLine, lines.length), closed: false });
  }
  // Markers on consecutive lines hold nothing to fold, and an arrow in the
  // gutter that collapses nothing is worse than no arrow at all.
  return regions
    .filter((region) => region.endLine > region.startLine + 1)
    .sort((left, right) => left.startLine - right.startLine);
}
