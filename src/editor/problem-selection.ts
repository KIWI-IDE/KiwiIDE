/**
 * The span a problem click should select.
 *
 * Jumping to a problem has to land *on* the offending token: a caret placed
 * somewhere on the right line leaves the reader to find the fault themselves,
 * which is the work the click was supposed to save. Every rule below exists
 * because some reporter does not give a usable range.
 *
 * The model is passed as the four methods this needs rather than Monaco's
 * editor, so the rules can be read and tested without one.
 */

/** What a problem reporter said about where the fault is. */
export interface ProblemPosition {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/** The part of a text model these rules consult. */
export interface SelectableModel {
  getLineCount(): number;
  getLineMaxColumn(line: number): number;
  getLineFirstNonWhitespaceColumn(line: number): number;
  getWordAtPosition(position: { lineNumber: number; column: number }):
    { startColumn: number; endColumn: number } | null;
}

export interface SelectionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function selectionForProblem(model: SelectableModel, position: ProblemPosition): SelectionRange {
  const word = model.getWordAtPosition({ lineNumber: position.line, column: position.column });
  const endLine = position.endLine ?? position.line;
  const endColumn = position.endColumn
    // Reporters that only know a point — javac, for instance — still get the
    // word under it highlighted rather than a zero-width caret.
    ?? (word && word.startColumn <= position.column ? word.endColumn : position.column);
  // A problem on a brace or an operator has no word to highlight, and an empty
  // selection shows nothing at all. The rest of the line is then the honest
  // answer to "where is it".
  const empty = endLine === position.line && Math.max(endColumn, position.column) <= position.column;
  const wholeLine = (line: number): SelectionRange => ({
    startLineNumber: line,
    startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
    endLineNumber: line,
    endColumn: model.getLineMaxColumn(line),
  });
  // A point inside a word marks the whole word, not the tail of it. The
  // reported column is usually where the token starts, so this only shows
  // when it is not — and half a highlighted identifier reads as a mistake in
  // the editor rather than as the fault it is pointing at.
  const wordStart = position.endColumn === undefined && word
    && word.startColumn <= position.column && position.column <= word.endColumn
    ? word.startColumn
    : position.column;
  const range = empty ? wholeLine(position.line) : {
    startLineNumber: position.line,
    startColumn: wordStart,
    endLineNumber: endLine,
    endColumn: Math.max(endColumn, position.column),
  };
  // Whatever the reporter said, what lands on screen has to be a range the
  // model actually has: a build report can outlive the edit that shortened the
  // file it describes.
  const lastLine = model.getLineCount();
  const startLine = Math.max(1, Math.min(range.startLineNumber, lastLine));
  const endLineNumber = Math.max(startLine, Math.min(range.endLineNumber, lastLine));
  const clamped: SelectionRange = {
    startLineNumber: startLine,
    startColumn: Math.max(1, Math.min(range.startColumn || 1, model.getLineMaxColumn(startLine))),
    endLineNumber,
    endColumn: Math.max(1, Math.min(range.endColumn || 1, model.getLineMaxColumn(endLineNumber))),
  };
  // Clamping can collapse a range that was fine before it, and a collapsed
  // selection highlights nothing — which is the whole point of jumping to a
  // problem rather than only scrolling to it.
  const collapsed = clamped.startLineNumber === clamped.endLineNumber
    && clamped.endColumn <= clamped.startColumn;
  return collapsed ? wholeLine(startLine) : clamped;
}
