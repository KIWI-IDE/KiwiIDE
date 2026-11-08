import type { DebugBreakpoint } from "../types";

export type JavaGutterAction =
  | { kind: "test"; targetId: string }
  | { kind: "breakpoint"; line: number };

/**
 * Gives JUnit gutter icons precedence over ordinary line breakpoints.
 * Everywhere else in a Java model, the glyph margin toggles a breakpoint.
 */
export function resolveJavaGutterAction(
  languageId: string | undefined,
  line: number | undefined,
  testTargets: ReadonlyArray<{ id: string; line: number }>,
): JavaGutterAction | null {
  if (languageId !== "java" || typeof line !== "number" || !Number.isInteger(line) || line < 1) return null;
  const testTarget = testTargets.find((candidate) => candidate.line === line);
  return testTarget
    ? { kind: "test", targetId: testTarget.id }
    : { kind: "breakpoint", line };
}

/**
 * Adds or removes one line breakpoint without affecting exception points.
 *
 * Identity is the file when the caller knows it. The class name is what the
 * debugger needs, but it is derived from the file's name and its package
 * declaration — so two files called Beta.java with no package produce the same
 * one, and a breakpoint set in either was treated as a breakpoint in both. The
 * click then removed the other file's breakpoint, the workbench said
 * "Breakpoint" as it always does, and nothing appeared in the gutter.
 *
 * Breakpoints stored before this carry no path, so they still match on the
 * class name alone rather than being orphaned by the change.
 */
export function toggleJavaLineBreakpoint(
  breakpoints: readonly DebugBreakpoint[],
  className: string,
  line: number,
  path = "",
): DebugBreakpoint[] {
  const sameSpot = (breakpoint: DebugBreakpoint) => breakpoint.type !== "exception"
    && breakpoint.line === line
    && (path && breakpoint.path
      ? breakpoint.path === path
      : breakpoint.className === className);
  if (breakpoints.some(sameSpot)) return breakpoints.filter((breakpoint) => !sameSpot(breakpoint));
  return [...breakpoints, {
    type: "line",
    className,
    ...(path ? { path } : {}),
    line,
    condition: "",
    hitCondition: "",
    logMessage: "",
    enabled: true,
  }];
}
