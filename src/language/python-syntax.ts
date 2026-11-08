/**
 * An immediate structural check for Python sources.
 *
 * Pyright LSP provides full type and semantic diagnostics, but it takes time
 * to initialize and analyze on startup. This scanner provides zero-latency
 * feedback for syntax errors, indentation errors, missing colons, unclosed
 * quotes/brackets, and common polyglot typos directly as the user types.
 */

export type PythonProblemKind =
  | "unclosed-bracket"
  | "unexpected-bracket"
  | "mismatched-bracket"
  | "unterminated-string"
  | "unterminated-fstring"
  | "fstring-empty-expression"
  | "expected-indent"
  | "unindent-mismatch"
  | "unexpected-indent"
  | "missing-colon"
  | "invalid-syntax"
  | "invalid-assignment"
  | "scope-error"
  | "polyglot-syntax";

export interface PythonSyntaxProblem {
  line: number;
  column: number;
  length: number;
  kind: PythonProblemKind;
  message: string;
  severity?: "error" | "warning";
}

const bracketOpeners: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const bracketClosers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const bracketNames: Record<string, string> = {
  "(": "runde Klammer",
  "[": "eckige Klammer",
  "{": "geschweifte Klammer",
};

/** Keywords that introduce a block and must end with `:` */
const COMPOUND_HEADER_PATTERN =
  /^(?:async\s+def\b|def\b|class\b|if\b|elif\b|else\b|for\b|async\s+for\b|while\b|try\b|except\b|finally\b|with\b|async\s+with\b|match\b|case\b)/;

/**
 * Returns the keyword name from a compound header line.
 */
function extractCompoundKeyword(lineText: string): string {
  const match = lineText.match(COMPOUND_HEADER_PATTERN);
  return match ? match[0].replace(/\s+/g, " ") : "";
}

/**
 * Analyzes Python source text and returns syntax problems with line and column.
 */
export function findPythonSyntaxProblems(source: string): PythonSyntaxProblem[] {
  const problems: PythonSyntaxProblem[] = [];
  const text = String(source || "");
  const lines = text.split(/\r?\n/);

  // 1. First pass: character scanning for string literals, comments, f-strings, and bracket matching.
  const bracketStack: Array<{ char: string; line: number; column: number }> = [];

  let line = 1;
  let column = 1;
  let state: "code" | "single-quote" | "double-quote" | "triple-single" | "triple-double" | "comment" = "code";
  let openedAtLine = 1;
  let openedAtColumn = 1;
  let isFString = false;
  let fstringBraceDepth = 0;
  let fstringBraceStart = { line: 1, column: 1 };

  const advance = (ch: string) => {
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];
    const next2 = text[index + 2];

    if (state === "comment") {
      if (ch === "\n") {
        state = "code";
      }
      advance(ch);
      continue;
    }

    if (state === "single-quote" || state === "double-quote") {
      const quoteChar = state === "single-quote" ? "'" : '"';

      if (isFString && ch === "{") {
        if (next === "{") {
          // Escaped {{ in f-string
          advance(ch);
          advance(next);
          index += 1;
          continue;
        }
        fstringBraceDepth += 1;
        fstringBraceStart = { line, column };
      } else if (isFString && ch === "}" && fstringBraceDepth > 0) {
        if (next === "}") {
          // Escaped }} in f-string
          advance(ch);
          advance(next);
          index += 1;
          continue;
        }
        fstringBraceDepth -= 1;
      }

      if (ch === "\\") {
        advance(ch);
        if (next !== undefined) {
          advance(next);
          index += 1;
        }
        continue;
      }

      if (ch === "\n") {
        // Unterminated single-line string at newline
        problems.push({
          line: openedAtLine,
          column: openedAtColumn,
          length: Math.max(1, column - openedAtColumn),
          kind: isFString ? "unterminated-fstring" : "unterminated-string",
          message: isFString
            ? "F-String wird vor dem Zeilenende nicht geschlossen."
            : "Zeichenkette wird vor dem Zeilenende nicht geschlossen.",
          severity: "error",
        });
        state = "code";
        isFString = false;
        fstringBraceDepth = 0;
        advance(ch);
        continue;
      }

      if (ch === quoteChar && fstringBraceDepth === 0) {
        state = "code";
        isFString = false;
      }
      advance(ch);
      continue;
    }

    if (state === "triple-single" || state === "triple-double") {
      const quoteChar = state === "triple-single" ? "'" : '"';

      if (isFString && ch === "{") {
        if (next === "{") {
          advance(ch);
          advance(next);
          index += 1;
          continue;
        }
        fstringBraceDepth += 1;
        fstringBraceStart = { line, column };
      } else if (isFString && ch === "}" && fstringBraceDepth > 0) {
        if (next === "}") {
          advance(ch);
          advance(next);
          index += 1;
          continue;
        }
        fstringBraceDepth -= 1;
      }

      if (ch === "\\" && next !== undefined) {
        advance(ch);
        advance(next);
        index += 1;
        continue;
      }

      if (ch === quoteChar && next === quoteChar && next2 === quoteChar && fstringBraceDepth === 0) {
        state = "code";
        isFString = false;
        advance(ch);
        advance(next);
        advance(next2);
        index += 2;
        continue;
      }

      advance(ch);
      continue;
    }

    // In code mode:
    if (ch === "#") {
      state = "comment";
      advance(ch);
      continue;
    }

    // Check for triple-quote openers
    if (ch === '"' && next === '"' && next2 === '"') {
      const prevPrefix = index > 0 ? text[index - 1] : "";
      isFString = prevPrefix === "f" || prevPrefix === "F";
      state = "triple-double";
      openedAtLine = line;
      openedAtColumn = column;
      advance(ch);
      advance(next);
      advance(next2);
      index += 2;
      continue;
    }
    if (ch === "'" && next === "'" && next2 === "'") {
      const prevPrefix = index > 0 ? text[index - 1] : "";
      isFString = prevPrefix === "f" || prevPrefix === "F";
      state = "triple-single";
      openedAtLine = line;
      openedAtColumn = column;
      advance(ch);
      advance(next);
      advance(next2);
      index += 2;
      continue;
    }

    // Check for single-quote openers
    if (ch === '"' || ch === "'") {
      const prevPrefix = index > 0 ? text[index - 1] : "";
      isFString = prevPrefix === "f" || prevPrefix === "F";
      state = ch === '"' ? "double-quote" : "single-quote";
      openedAtLine = line;
      openedAtColumn = column;
      advance(ch);
      continue;
    }

    // Bracket tracking
    if (bracketOpeners[ch]) {
      bracketStack.push({ char: ch, line, column });
      advance(ch);
      continue;
    }

    if (bracketClosers[ch]) {
      const open = bracketStack.pop();
      if (!open) {
        problems.push({
          line,
          column,
          length: 1,
          kind: "unexpected-bracket",
          message: `„${ch}“ schließt eine ${bracketNames[bracketClosers[ch]]}, die nie geöffnet wurde.`,
          severity: "error",
        });
      } else if (bracketOpeners[open.char] !== ch) {
        problems.push({
          line,
          column,
          length: 1,
          kind: "mismatched-bracket",
          message: `„${ch}“ passt nicht zur ${bracketNames[open.char]} in Zeile ${open.line}.`,
          severity: "error",
        });
      }
      advance(ch);
      continue;
    }

    // Common polyglot / syntax mistakes in code:
    if (ch === "=" && next === "=" && next2 === "=") {
      problems.push({
        line,
        column,
        length: 3,
        kind: "invalid-syntax",
        message: "„===“ gibt es in Python nicht; verwende „==“ oder „is“.",
        severity: "error",
      });
      advance(ch);
      advance(next);
      advance(next2);
      index += 2;
      continue;
    }
    if (ch === "!" && next === "=" && next2 === "=") {
      problems.push({
        line,
        column,
        length: 3,
        kind: "invalid-syntax",
        message: "„!==“ gibt es in Python nicht; verwende „!=“ oder „is not“.",
        severity: "error",
      });
      advance(ch);
      advance(next);
      advance(next2);
      index += 2;
      continue;
    }
    if (ch === "&" && next === "&") {
      problems.push({
        line,
        column,
        length: 2,
        kind: "polyglot-syntax",
        message: "Verwende das Schlüsselwort „and“ statt „&&“.",
        severity: "error",
      });
      advance(ch);
      advance(next);
      index += 1;
      continue;
    }
    if (ch === "|" && next === "|") {
      problems.push({
        line,
        column,
        length: 2,
        kind: "polyglot-syntax",
        message: "Verwende das Schlüsselwort „or“ statt „||“.",
        severity: "error",
      });
      advance(ch);
      advance(next);
      index += 1;
      continue;
    }
    if (ch === "+" && next === "+") {
      problems.push({
        line,
        column,
        length: 2,
        kind: "polyglot-syntax",
        message: "In Python gibt es kein „++“; verwende „+= 1“.",
        severity: "error",
      });
      advance(ch);
      advance(next);
      index += 1;
      continue;
    }

    advance(ch);
  }

  // Check EOF states
  if (state === "triple-single" || state === "triple-double") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 3,
      kind: "unterminated-string",
      message: "Mehrzeilige Zeichenkette wird nicht geschlossen.",
      severity: "error",
    });
  } else if (state === "single-quote" || state === "double-quote") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 1,
      kind: isFString ? "unterminated-fstring" : "unterminated-string",
      message: "Zeichenkette wird nicht geschlossen.",
      severity: "error",
    });
  }

  for (const open of bracketStack) {
    problems.push({
      line: open.line,
      column: open.column,
      length: 1,
      kind: "unclosed-bracket",
      message: `${bracketNames[open.char]} „${open.char}“ wird nie geschlossen.`,
      severity: "error",
    });
  }

  // 2. Second pass: Line-by-line Indentation, Compound Statements, and Scope Checks
  // We strip string literals and comments on each line to analyze indentation and keywords cleanly.
  const indentStack: number[] = [0];
  let expectIndentAfter: { line: number; keyword: string } | null = null;
  const blockStack: Array<{ type: "def" | "loop" | "class" | "other"; indent: number }> = [];

  let inMultilineString = false;
  let multilineQuote = "";
  let insideParentheses = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const lineNum = lineIdx + 1;
    const rawLine = lines[lineIdx];

    // Check for trailing backslash with whitespace error
    const trailingBackslashMatch = rawLine.match(/\\\s+$/);
    if (trailingBackslashMatch && trailingBackslashMatch.index !== undefined) {
      problems.push({
        line: lineNum,
        column: trailingBackslashMatch.index + 1,
        length: trailingBackslashMatch[0].length,
        kind: "invalid-syntax",
        message: "Nach dem Zeilenfortsetzungszeichen „\\“ darf kein Leerzeichen stehen.",
        severity: "error",
      });
    }

    // Calculate line indentation (spaces = 1, tabs = 4)
    let leadingWhitespace = 0;
    let hasTabs = false;
    let hasSpaces = false;
    let firstNonWs = -1;

    for (let c = 0; c < rawLine.length; c += 1) {
      if (rawLine[c] === " ") {
        leadingWhitespace += 1;
        hasSpaces = true;
      } else if (rawLine[c] === "\t") {
        leadingWhitespace += 4;
        hasTabs = true;
      } else {
        firstNonWs = c;
        break;
      }
    }

    // Check for mixed tabs and spaces in indentation
    if (hasTabs && hasSpaces && firstNonWs > 0) {
      problems.push({
        line: lineNum,
        column: 1,
        length: firstNonWs,
        kind: "invalid-syntax",
        message: "Gemischte Einrückung mit Tabs und Leerzeichen (TabError).",
        severity: "warning",
      });
    }

    // Strip comments and track multiline strings to get clean code tokens
    let cleanCode = "";
    let i = 0;
    while (i < rawLine.length) {
      if (inMultilineString) {
        if (rawLine.startsWith(multilineQuote, i)) {
          inMultilineString = false;
          i += 3;
        } else {
          i += 1;
        }
        continue;
      }

      // Check opening of multiline string
      if (rawLine.startsWith('"""', i) || rawLine.startsWith("'''", i)) {
        multilineQuote = rawLine.slice(i, i + 3);
        const closingIdx = rawLine.indexOf(multilineQuote, i + 3);
        if (closingIdx !== -1) {
          i = closingIdx + 3;
        } else {
          inMultilineString = true;
          break;
        }
        continue;
      }

      // Check single-line string
      if (rawLine[i] === '"' || rawLine[i] === "'") {
        const q = rawLine[i];
        let j = i + 1;
        while (j < rawLine.length && rawLine[j] !== q) {
          if (rawLine[j] === "\\" && j + 1 < rawLine.length) j += 1;
          j += 1;
        }
        i = j + 1;
        continue;
      }

      // Check comment
      if (rawLine[i] === "#") {
        break;
      }

      cleanCode += rawLine[i];
      i += 1;
    }

    // Track brackets across lines for continuation
    for (const char of cleanCode) {
      if (char === "(" || char === "[" || char === "{") insideParentheses += 1;
      else if (char === ")" || char === "]" || char === "}") insideParentheses = Math.max(0, insideParentheses - 1);
    }

    const trimmed = cleanCode.trim();

    // Skip empty lines or pure comments or lines inside multiline strings/brackets for block indentation
    if (!trimmed || inMultilineString) {
      continue;
    }

    // If inside brackets, Python allows arbitrary indentation
    if (insideParentheses > 0) {
      continue;
    }

    // Check Polyglot typo: `else if`
    if (/^else\s+if\b/.test(trimmed)) {
      const col = rawLine.indexOf("else");
      problems.push({
        line: lineNum,
        column: col + 1,
        length: 7,
        kind: "polyglot-syntax",
        message: "In Python heißt es „elif“, nicht „else if“.",
        severity: "error",
      });
    }

    // Check invalid assignment to literal: `1 = x`, `"str" = x`, `True = x`
    const badAssignMatch = trimmed.match(/^(?:(\d+|"[^"]*"|'[^']*'|True|False|None))\s*=(?!=)/);
    if (badAssignMatch) {
      const col = rawLine.indexOf(badAssignMatch[1]);
      problems.push({
        line: lineNum,
        column: col + 1,
        length: badAssignMatch[0].length,
        kind: "invalid-assignment",
        message: `Zuweisung an Literal „${badAssignMatch[1]}“ ist ungültig (SyntaxError: cannot assign to literal). Meintest du „==“?`,
        severity: "error",
      });
    }

    // Check for polyglot casing: standalone `true`, `false`, `null`
    const polyglotLiterals = [
      { regex: /\btrue\b/g, correct: "True", name: "True" },
      { regex: /\bfalse\b/g, correct: "False", name: "False" },
      { regex: /\bnull\b/g, correct: "None", name: "None" },
    ];
    for (const lit of polyglotLiterals) {
      let m: RegExpExecArray | null;
      while ((m = lit.regex.exec(cleanCode)) !== null) {
        // Ensure not preceded by dot (e.g. obj.true)
        if (m.index > 0 && cleanCode[m.index - 1] === ".") continue;
        problems.push({
          line: lineNum,
          column: m.index + 1,
          length: m[0].length,
          kind: "polyglot-syntax",
          message: lit.correct === "None"
            ? "In Python heißt der Wert „None“, nicht „null“."
            : `In Python wird „${lit.correct}“ großgeschrieben.`,
          severity: "warning",
        });
      }
    }

    // Indentation Validation
    const currentIndent = leadingWhitespace;

    if (expectIndentAfter) {
      if (currentIndent <= indentStack[indentStack.length - 1]) {
        problems.push({
          line: lineNum,
          column: 1,
          length: Math.max(1, currentIndent || 1),
          kind: "expected-indent",
          message: `Einrückung nach „${expectIndentAfter.keyword}“ in Zeile ${expectIndentAfter.line} erwartet (IndentationError: expected an indented block).`,
          severity: "error",
        });
      } else {
        indentStack.push(currentIndent);
        // Track the block in blockStack
        const kw = expectIndentAfter.keyword;
        let blockType: "def" | "loop" | "class" | "other" = "other";
        if (kw === "def" || kw.startsWith("async def")) blockType = "def";
        else if (kw === "for" || kw === "while" || kw.startsWith("async for")) blockType = "loop";
        else if (kw === "class") blockType = "class";
        blockStack.push({ type: blockType, indent: currentIndent });
      }
      expectIndentAfter = null;
    } else {
      if (currentIndent > indentStack[indentStack.length - 1]) {
        problems.push({
          line: lineNum,
          column: 1,
          length: currentIndent,
          kind: "unexpected-indent",
          message: "Unerwartete Einrückung (IndentationError: unexpected indent).",
          severity: "error",
        });
      } else if (currentIndent < indentStack[indentStack.length - 1]) {
        // Unindent: must match an outer indentation level
        const matchIdx = indentStack.lastIndexOf(currentIndent);
        if (matchIdx === -1) {
          problems.push({
            line: lineNum,
            column: 1,
            length: Math.max(1, currentIndent),
            kind: "unindent-mismatch",
            message: "Einrückung passt zu keiner übergeordneten Ebene (IndentationError: unindent does not match any outer indentation level).",
            severity: "error",
          });
        } else {
          indentStack.length = matchIdx + 1;
          // Pop block stack entries that were at or deeper than the old indentation
          while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent > currentIndent) {
            blockStack.pop();
          }
        }
      }
    }

    // Scope checking: `return` or `yield` outside function
    if (/^(?:return\b|yield\b)/.test(trimmed)) {
      const isInsideDef = blockStack.some((b) => b.type === "def");
      if (!isInsideDef) {
        const kw = trimmed.startsWith("return") ? "return" : "yield";
        const col = rawLine.indexOf(kw);
        problems.push({
          line: lineNum,
          column: col + 1,
          length: kw.length,
          kind: "scope-error",
          message: `„${kw}“ außerhalb einer Funktion ist unzulässig (SyntaxError: '${kw}' outside function).`,
          severity: "error",
        });
      }
    }

    // Scope checking: `break` or `continue` outside loop
    if (/^(?:break\b|continue\b)/.test(trimmed)) {
      const isInsideLoop = blockStack.some((b) => b.type === "loop");
      if (!isInsideLoop) {
        const kw = trimmed.startsWith("break") ? "break" : "continue";
        const col = rawLine.indexOf(kw);
        problems.push({
          line: lineNum,
          column: col + 1,
          length: kw.length,
          kind: "scope-error",
          message: `„${kw}“ außerhalb einer Schleife ist unzulässig (SyntaxError: '${kw}' outside loop).`,
          severity: "error",
        });
      }
    }

    // Compound statement colon checking
    if (COMPOUND_HEADER_PATTERN.test(trimmed)) {
      const keyword = extractCompoundKeyword(trimmed);

      // If the statement ends with `:`
      if (trimmed.endsWith(":")) {
        // Check if there is code on the same line after the colon (e.g. `if x: return y` or `def f(): pass`)
        const colonIdx = trimmed.lastIndexOf(":");
        const beforeColon = trimmed.slice(0, colonIdx);
        // If the only colon is at the end, and no statement followed on the same line:
        if (beforeColon.trim().length > 0) {
          expectIndentAfter = { line: lineNum, keyword };
        }
      } else {
        // Statement did not end with a colon!
        // Make sure it wasn't a continuation line ending with `\`
        if (!rawLine.trimEnd().endsWith("\\")) {
          const col = rawLine.length;
          problems.push({
            line: lineNum,
            column: Math.max(1, col),
            length: 1,
            kind: "missing-colon",
            message: `Doppelpunkt „:“ am Ende von „${keyword}“-Anweisung erwartet.`,
            severity: "error",
          });
        }
      }
    }
  }

  // If the file ended with an unfulfilled block expectation
  if (expectIndentAfter) {
    problems.push({
      line: expectIndentAfter.line,
      column: lines[expectIndentAfter.line - 1]?.length || 1,
      length: 1,
      kind: "expected-indent",
      message: `Einrückung nach „${expectIndentAfter.keyword}“ in Zeile ${expectIndentAfter.line} erwartet (IndentationError: expected an indented block).`,
      severity: "error",
    });
  }

  return problems.sort((left, right) => left.line - right.line || left.column - right.column);
}
