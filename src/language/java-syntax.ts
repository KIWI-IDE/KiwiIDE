/**
 * An immediate structural check for Java sources.
 *
 * JDT LS is the authority on Java errors, but it only answers after a round
 * trip and says nothing at all while it is still starting or while the project
 * fails to import. The mistakes below are exactly the ones that leave a file
 * unparseable — so the language server reports nothing useful for them anyway —
 * and they can be found by scanning, which keeps the feedback instant.
 *
 * Precision matters more than coverage here: anything that could fire on valid
 * code is left to the real compiler.
 */

export type SyntaxProblemKind =
  | "unclosed-bracket"
  | "unexpected-bracket"
  | "mismatched-bracket"
  | "unterminated-string"
  | "unterminated-char"
  | "unterminated-comment";

export interface SyntaxProblem {
  line: number;
  column: number;
  /** How many characters the problem covers, so it can be selected exactly. */
  length: number;
  kind: SyntaxProblemKind | string;
  message: string;
  severity?: "error" | "warning";
}

const openers: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const closers: Record<string, string> = { "}": "{", ")": "(", "]": "[" };

const bracketNames: Record<string, string> = {
  "{": "geschweifte Klammer",
  "(": "runde Klammer",
  "[": "eckige Klammer",
};

/**
 * Walks the source once, tracking whether it is inside a comment or a literal.
 *
 * Everything is reported with the position of the character that caused it, so
 * jumping to a problem lands on the bracket rather than at the end of the file.
 */
export function findJavaSyntaxProblems(source: string): SyntaxProblem[] {
  const problems: SyntaxProblem[] = [];
  const stack: Array<{ char: string; line: number; column: number }> = [];
  const text = String(source || "");

  let line = 1;
  let column = 1;
  let state: "code" | "line-comment" | "block-comment" | "string" | "text-block" | "char" = "code";
  let openedAtLine = 1;
  let openedAtColumn = 1;

  const advance = (character: string) => {
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      advance(character);
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        advance(character);
        advance(next);
        index += 1;
        continue;
      }
      advance(character);
      continue;
    }

    if (state === "string" || state === "char") {
      if (character === "\\") {
        advance(character);
        if (next !== undefined) {
          advance(next);
          index += 1;
        }
        continue;
      }
      // A newline ends the literal in Java, which is the error itself.
      if (character === "\n") {
        problems.push({
          line: openedAtLine,
          column: openedAtColumn,
          // Up to the line break the literal failed to close before.
          length: Math.max(1, column - openedAtColumn),
          kind: state === "string" ? "unterminated-string" : "unterminated-char",
          message: state === "string"
            ? "Zeichenkette wird nicht geschlossen."
            : "Zeichenliteral wird nicht geschlossen.",
        });
        state = "code";
        advance(character);
        continue;
      }
      if ((state === "string" && character === '"') || (state === "char" && character === "'")) state = "code";
      advance(character);
      continue;
    }

    if (state === "text-block") {
      if (character === '"' && next === '"' && text[index + 2] === '"') {
        state = "code";
        advance(character);
        advance(next);
        advance(text[index + 2]);
        index += 2;
        continue;
      }
      advance(character);
      continue;
    }

    // state === "code"
    if (character === "/" && next === "/") {
      state = "line-comment";
      advance(character);
      advance(next);
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      state = "block-comment";
      openedAtLine = line;
      openedAtColumn = column;
      advance(character);
      advance(next);
      index += 1;
      continue;
    }
    if (character === '"' && next === '"' && text[index + 2] === '"') {
      state = "text-block";
      openedAtLine = line;
      openedAtColumn = column;
      advance(character);
      advance(next);
      advance(text[index + 2]);
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      state = character === '"' ? "string" : "char";
      openedAtLine = line;
      openedAtColumn = column;
      advance(character);
      continue;
    }
    if (openers[character]) {
      stack.push({ char: character, line, column });
      advance(character);
      continue;
    }
    if (closers[character]) {
      const open = stack.pop();
      if (!open) {
        problems.push({
          line,
          column,
          length: 1,
          kind: "unexpected-bracket",
          message: `„${character}“ schließt eine ${bracketNames[closers[character]]}, die nie geöffnet wurde.`,
        });
      } else if (openers[open.char] !== character) {
        problems.push({
          line,
          column,
          length: 1,
          kind: "mismatched-bracket",
          message: `„${character}“ passt nicht zur ${bracketNames[open.char]} in Zeile ${open.line}.`,
        });
      }
      advance(character);
      continue;
    }
    advance(character);
  }

  if (state === "block-comment") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 2,
      kind: "unterminated-comment",
      message: "Blockkommentar wird nie mit „*/“ geschlossen.",
    });
  }
  if (state === "string" || state === "text-block") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 1,
      kind: "unterminated-string",
      message: "Zeichenkette wird nicht geschlossen.",
    });
  }
  if (state === "char") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 1,
      kind: "unterminated-char",
      message: "Zeichenliteral wird nicht geschlossen.",
    });
  }

  for (const open of stack) {
    problems.push({
      line: open.line,
      column: open.column,
      length: 1,
      kind: "unclosed-bracket",
      message: `${bracketNames[open.char]} „${open.char}“ wird nie geschlossen.`,
    });
  }

  return problems.sort((left, right) => left.line - right.line || left.column - right.column);
}
