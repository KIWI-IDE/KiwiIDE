import { describe, expect, it } from "vitest";
import { selectionForProblem } from "../src/editor/problem-selection";
import type { SelectableModel } from "../src/editor/problem-selection";

/** A text model built from lines, answering only what the rules consult. */
function modelOf(lines: string[]): SelectableModel {
  return {
    getLineCount: () => lines.length,
    getLineMaxColumn: (line) => (lines[line - 1] ?? "").length + 1,
    getLineFirstNonWhitespaceColumn: (line) => {
      const text = lines[line - 1] ?? "";
      const index = text.search(/\S/);
      return index < 0 ? 0 : index + 1;
    },
    getWordAtPosition: ({ lineNumber, column }) => {
      const text = lines[lineNumber - 1] ?? "";
      for (const match of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
        const start = match.index + 1;
        const end = start + match[0].length;
        if (column >= start && column <= end) return { startColumn: start, endColumn: end };
      }
      return null;
    },
  };
}

const source = ["public class Unbalanced {", "  void run() {", "    int x = 1;", "}"];

describe("what a problem click selects", () => {
  it("takes the range the reporter gave", () => {
    expect(selectionForProblem(modelOf(source), { line: 1, column: 14, endLine: 1, endColumn: 24 }))
      .toEqual({ startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 24 });
  });

  it("highlights the word under a reporter that only knows a point", () => {
    // javac and Kiwi's own scanner report a single position. A zero-width
    // selection would show nothing, and the click would look like it failed.
    expect(selectionForProblem(modelOf(source), { line: 1, column: 16 }))
      .toEqual({ startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 24 });
  });

  it("falls back to the line when the fault sits on a brace", () => {
    // Column 25 is the opening brace: no word, so there is nothing to mark
    // except the line it is on.
    const selection = selectionForProblem(modelOf(source), { line: 1, column: 25 });
    expect(selection).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 26 });
  });

  it("never returns a collapsed range, whatever it was given", () => {
    // This is the property the whole function exists for: a collapsed range
    // paints nothing, and the reader is left on the right line with no idea
    // which part of it is wrong.
    const model = modelOf(source);
    const cases = [
      { line: 1, column: 25, endLine: 1, endColumn: 25 },
      { line: 1, column: 1, endLine: 1, endColumn: 1 },
      { line: 4, column: 2, endLine: 4, endColumn: 2 },
      { line: 2, column: 3, endLine: 2, endColumn: 1 },
    ];
    for (const problem of cases) {
      const selection = selectionForProblem(model, problem);
      const collapsed = selection.startLineNumber === selection.endLineNumber
        && selection.endColumn <= selection.startColumn;
      expect({ problem, collapsed }).toEqual({ problem, collapsed: false });
    }
  });

  it("stays inside a file that has since become shorter", () => {
    // A build report outlives the edit that shortened the file it describes,
    // and a range past the end selects nothing at all.
    const selection = selectionForProblem(modelOf(source), { line: 99, column: 40, endLine: 120, endColumn: 60 });
    expect(selection.startLineNumber).toBe(4);
    expect(selection.endLineNumber).toBe(4);
    expect(selection.endColumn).toBeLessThanOrEqual(2);
    expect(selection.startColumn).toBeLessThan(selection.endColumn);
  });

  it("keeps a range that spans several lines", () => {
    expect(selectionForProblem(modelOf(source), { line: 2, column: 3, endLine: 3, endColumn: 8 }))
      .toEqual({ startLineNumber: 2, startColumn: 3, endLineNumber: 3, endColumn: 8 });
  });

  it("skips the indent when it falls back to the line", () => {
    // Selecting the leading spaces of a line marks a region that starts where
    // there is nothing to see.
    expect(selectionForProblem(modelOf(source), { line: 3, column: 15 }))
      .toEqual({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 15 });
  });
});
