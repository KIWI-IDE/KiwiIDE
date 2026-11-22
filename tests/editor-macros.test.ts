import { describe, expect, it } from "vitest";
import { simulateMacro, type MacroStep } from "../src/editor/editor-macros";
const point = (column: number, line = 0) => ({ line, column, relative: line === 0 });
const initial = (lineNumber: number, column: number) => ({ anchor: { lineNumber, column }, head: { lineNumber, column } });
describe("editor macro replay", () => {
  it("replays edits relative to a different cursor and repeats as one result", () => {
    const steps: MacroStep[] = [{ kind: 'edit', edits: [{ start: point(0), end: point(0), text: '!' }], after: { anchor: point(1), head: point(1) } }];
    expect(simulateMacro('abc\nxyz', initial(2, 2), steps, 3)).toMatchObject({ text: 'abc\nx!!!yz', selection: initial(2, 5) });
  });
  it("uses line-end navigation on lines of different lengths", () => {
    const end = { line: 0, column: 0, relative: true, edge: 'end' as const };
    const steps: MacroStep[] = [{ kind: 'move', selection: { anchor: end, head: end } }, { kind: 'edit', edits: [{ start: point(0), end: point(0), text: ';' }], after: { anchor: point(1), head: point(1) } }];
    expect(simulateMacro('short\r\nmuch longer line', initial(2, 1), steps).text).toBe('short\r\nmuch longer line;');
  });
  it("preserves selected ranges and supports multiline edits", () => {
    const steps: MacroStep[] = [{ kind: 'edit', edits: [{ start: point(-3), end: point(0), text: 'new\nvalue' }], after: { anchor: point(6, 1), head: point(6, 1) } }];
    expect(simulateMacro('old!', initial(1, 4), steps)).toMatchObject({ text: 'new\nvalue!', selection: initial(2, 6) });
  });
  it("rejects out-of-bounds and overlapping edits before returning a changed result", () => {
    expect(() => simulateMacro('x', initial(1, 1), [{ kind: 'move', selection: { anchor: point(1, 2), head: point(1, 2) } }])).toThrow();
    expect(() => simulateMacro('text', initial(1, 1), [{ kind: 'edit', edits: [{ start: point(0), end: point(3), text: 'x' }, { start: point(1), end: point(4), text: 'y' }] }])).toThrow('Überlappende');
    expect(() => simulateMacro('x', initial(1, 1), [], 101)).toThrow();
  });
});
