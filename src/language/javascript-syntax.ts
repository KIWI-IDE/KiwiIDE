import type { SyntaxProblem } from "./java-syntax";

const bracketOpeners: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const bracketClosers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const bracketNames: Record<string, string> = {
  "(": "runde Klammer",
  "[": "eckige Klammer",
  "{": "geschweifte Klammer",
};

const JSX_PRECEDING_KEYWORDS = new Set([
  "return",
  "case",
  "throw",
  "yield",
  "await",
  "else",
  "do",
]);

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface JsxOpenTagMatch {
  tagName: string;
  headerLength: number;
  endIndex: number;
  selfClosing: boolean;
}

function isRegexStart(text: string, slashIndex: number): number {
  let p = slashIndex - 1;
  while (p >= 0 && /[ \t]/.test(text[p])) p -= 1;
  const prev = p >= 0 ? text[p] : "";
  const isArrow = prev === ">" && p >= 1 && text[p - 1] === "=";
  const canStartRegex =
    !prev ||
    isArrow ||
    /[=(,[!:;&|?+{}\n~^%*-]/.test(prev) ||
    /\b(?:return|case|throw|typeof|void|delete|in|of|instanceof)$/.test(text.slice(Math.max(0, p - 12), p + 1));
  if (!canStartRegex) return -1;

  let r = slashIndex + 1;
  let inCharClass = false;
  for (; r < text.length; r += 1) {
    const rc = text[r];
    if (rc === "\n" || rc === "\r") return -1;
    if (rc === "\\") {
      r += 1;
      continue;
    }
    if (rc === "[") inCharClass = true;
    else if (rc === "]") inCharClass = false;
    else if (rc === "/" && !inCharClass) {
      r += 1;
      while (r < text.length && /[dgimsuvy]/.test(text[r])) r += 1;
      return r;
    }
  }
  return -1;
}

/**
 * Determines whether `<` at `startIndex` opens a real JSX element (or fragment `<>`)
 * rather than a TypeScript generic (`React.FC<Props>`, `useState<string>`, `<T>(x: T) =>`)
 * or a comparison operator (`a < b`).
 */
function matchJsxOpeningTag(text: string, startIndex: number, inJsxText = false): JsxOpenTagMatch | null {
  if (text[startIndex] !== "<") return null;

  // Fragment `<>`
  if (text[startIndex + 1] === ">") {
    return {
      tagName: "",
      headerLength: 2,
      endIndex: startIndex + 1,
      selfClosing: false,
    };
  }

  // Directly attached to an identifier/type (`React.FC<Props>`, `useState<number>`, `Array<T>`) -> TypeScript generic
  if (!inJsxText && startIndex > 0 && /[A-Za-z0-9_$?]/.test(text[startIndex - 1])) {
    return null;
  }

  if (!inJsxText) {
    // Check previous non-whitespace token
    let p = startIndex - 1;
    while (p >= 0 && /\s/.test(text[p])) p -= 1;
    if (p >= 0) {
      const prevChar = text[p];
      // After `)` or `]`, `<` is a comparison (`fn() < 0`, `arr[0] < 1`), never a JSX tag
      if (prevChar === ")" || prevChar === "]") {
        return null;
      }
      if (/[A-Za-z0-9_$]/.test(prevChar)) {
        const wordEnd = p + 1;
        while (p >= 0 && /[A-Za-z0-9_$]/.test(text[p])) p -= 1;
        const prevWord = text.slice(p + 1, wordEnd);
        if (!JSX_PRECEDING_KEYWORDS.has(prevWord)) {
          return null;
        }
      }
    }
  }

  const nameMatch = text.slice(startIndex + 1).match(/^([A-Za-z][\w.:-]*)/);
  if (!nameMatch) return null;
  const tagName = nameMatch[1];

  let i = startIndex + 1 + tagName.length;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (braceDepth > 0 && ch === "/" && next !== "/" && next !== "*" && next !== ">") {
      const regexEnd = isRegexStart(text, i);
      if (regexEnd > i) {
        i = regexEnd - 1;
        continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      if (ch === ">") {
        let b = i - 1;
        while (b > startIndex && /\s/.test(text[b])) b -= 1;
        const hasSlash = text[b] === "/";

        // Check if followed by `(...) =>` or `(...): Type =>` (generic arrow function `<T>(x: T) =>`)
        let f = i + 1;
        while (f < text.length && /\s/.test(text[f])) f += 1;
        if (!hasSlash && text[f] === "(" && /^\([^)]*\)\s*(?::[^=]+)?=>/.test(text.slice(f))) {
          return null;
        }
        // Generic type alias `<T> = ...`
        if (!hasSlash && text[f] === "=" && text[f + 1] !== ">") {
          return null;
        }

        const isVoid = VOID_HTML_TAGS.has(tagName.toLowerCase());
        return {
          tagName,
          headerLength: 1 + tagName.length,
          endIndex: i,
          selfClosing: hasSlash || isVoid,
        };
      }

      if (ch === "/") {
        let look = i + 1;
        while (look < text.length && /\s/.test(text[look])) look += 1;
        if (text[look] !== ">") return null;
        continue;
      }

      // Disallow characters at top-level of a JSX opening tag that belong to TS generics or expressions
      if (
        ch === "," ||
        ch === ";" ||
        ch === "&" ||
        ch === "|" ||
        ch === "?" ||
        ch === "(" ||
        ch === ")" ||
        ch === "[" ||
        ch === "]" ||
        ch === "+" ||
        ch === "*" ||
        ch === "<"
      ) {
        return null;
      }

      if (ch === ":") {
        // Only allow XML namespace colons `xmlns:xlink` without surrounding spaces
        if (!/[A-Za-z0-9_$-]/.test(text[i - 1] || "") || !/[A-Za-z0-9_$-]/.test( next || "")) {
          return null;
        }
      }
    }

    if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      if (braceDepth > 0) braceDepth -= 1;
      else return null;
    } else if (ch === "(") {
      parenDepth += 1;
    } else if (ch === ")") {
      if (parenDepth > 0) parenDepth -= 1;
      else return null;
    } else if (ch === "[") {
      bracketDepth += 1;
    } else if (ch === "]") {
      if (bracketDepth > 0) bracketDepth -= 1;
      else return null;
    }
  }

  return null;
}

/**
 * Immediate syntax and structural analysis for JavaScript, TypeScript, JSX, and TSX files.
 */
export function findJavaScriptSyntaxProblems(source: string, languageId = "typescript"): SyntaxProblem[] {
  const problems: SyntaxProblem[] = [];
  const text = String(source || "");
  const lines = text.split(/\r?\n/);
  const isJsx =
    languageId.includes("react") ||
    languageId.endsWith("x") ||
    /<\/[A-Za-z][\w.:-]*\s*>|\/>/.test(text);

  const bracketStack: Array<{ char: string; line: number; column: number }> = [];
  const jsxStack: Array<{
    tag: string;
    line: number;
    column: number;
    bracketDepth: number;
    openTagEndIndex: number;
  }> = [];
  const openTagEndStack: Array<{ endIndex: number; bracketDepth: number }> = [];

  let line = 1;
  let column = 1;
  let state: "code" | "single-quote" | "double-quote" | "template" | "line-comment" | "block-comment" = "code";
  let openedAtLine = 1;
  let openedAtColumn = 1;
  const templateBraceStack: number[] = [];

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

    if (state === "line-comment") {
      if (ch === "\n") state = "code";
      advance(ch);
      continue;
    }

    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        state = "code";
        advance(ch);
        advance(next);
        index += 1;
        continue;
      }
      advance(ch);
      continue;
    }

    if (state === "single-quote" || state === "double-quote") {
      const quote = state === "single-quote" ? "'" : '"';
      if (ch === "\\") {
        advance(ch);
        if (next !== undefined) {
          advance(next);
          index += 1;
        }
        continue;
      }
      if (ch === "\n") {
        problems.push({
          line: openedAtLine,
          column: openedAtColumn,
          length: Math.max(1, column - openedAtColumn),
          kind: "unterminated-string",
          message: "Zeichenkette wird vor dem Zeilenende nicht geschlossen.",
          severity: "error",
        });
        state = "code";
        advance(ch);
        continue;
      }
      if (ch === quote) {
        state = "code";
      }
      advance(ch);
      continue;
    }

    if (state === "template") {
      if (ch === "\\") {
        advance(ch);
        if (next !== undefined) {
          advance(next);
          index += 1;
        }
        continue;
      }
      if (ch === "$" && next === "{") {
        templateBraceStack.push(bracketStack.length);
        bracketStack.push({ char: "{", line, column: column + 1 });
        state = "code";
        advance(ch);
        advance(next);
        index += 1;
        continue;
      }
      if (ch === "`") {
        state = "code";
      }
      advance(ch);
      continue;
    }

    while (openTagEndStack.length > 0 && index > openTagEndStack[openTagEndStack.length - 1].endIndex) {
      openTagEndStack.pop();
    }
    const inOpeningTagAttrs =
      openTagEndStack.length > 0 &&
      openTagEndStack[openTagEndStack.length - 1].bracketDepth === bracketStack.length;

    // Check if we are currently inside JSX text children (between `>` and `<` outside `{...}`)
    const topJsx = jsxStack.length > 0 ? jsxStack[jsxStack.length - 1] : null;
    const inJsxText =
      !inOpeningTagAttrs &&
      topJsx !== null &&
      index > topJsx.openTagEndIndex &&
      bracketStack.length === topJsx.bracketDepth;

    if (inJsxText) {
      if (ch === "{") {
        bracketStack.push({ char: "{", line, column });
        advance(ch);
        continue;
      }
      if (ch === "}") {
        problems.push({
          line,
          column,
          length: 1,
          kind: "unexpected-bracket",
          message: "„}“ im JSX-Text ohne passendes „{“.",
          severity: "error",
        });
        advance(ch);
        continue;
      }
      if (ch !== "<") {
        advance(ch);
        continue;
      }
    }

    // state === "code"
    if (ch === "/" && next === "/") {
      state = "line-comment";
      advance(ch);
      advance(next);
      index += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      state = "block-comment";
      openedAtLine = line;
      openedAtColumn = column;
      advance(ch);
      advance(next);
      index += 1;
      continue;
    }

    // Skip regex literals `/pattern/flags` so quotes or brackets inside regexes are not misread
    if (ch === "/" && next !== "/" && next !== "*" && next !== ">" && !inOpeningTagAttrs) {
      const regexEnd = isRegexStart(text, index);
      if (regexEnd > index) {
        while (index < regexEnd) {
          advance(text[index]);
          index += 1;
        }
        index -= 1;
        continue;
      }
    }

    if (ch === '"' || ch === "'") {
      state = ch === '"' ? "double-quote" : "single-quote";
      openedAtLine = line;
      openedAtColumn = column;
      advance(ch);
      continue;
    }

    if (ch === "`") {
      state = "template";
      openedAtLine = line;
      openedAtColumn = column;
      advance(ch);
      continue;
    }

    // JSX tag scanning
    if (isJsx && ch === "<") {
      // Closing fragment `</>` or closing tag `</Tag>`
      if (next === "/") {
        const closeMatch = text.slice(index).match(/^<\/([A-Za-z][\w.:-]*)?\s*>/);
        if (closeMatch) {
          const tagName = closeMatch[1] || "";
          const open = jsxStack.pop();
          const displayClose = tagName ? `</${tagName}>` : "</>";
          if (!open) {
            problems.push({
              line,
              column,
              length: closeMatch[0].length,
              kind: "unexpected-jsx-tag",
              message: `Schließendes JSX-Tag „${displayClose}“ ohne passendes Start-Tag.`,
              severity: "error",
            });
          } else if (open.tag !== tagName) {
            const displayOpen = open.tag ? `<${open.tag}>` : "<>";
            problems.push({
              line,
              column,
              length: closeMatch[0].length,
              kind: "mismatched-jsx-tag",
              message: `„${displayClose}“ passt nicht zum geöffneten „${displayOpen}“ in Zeile ${open.line}.`,
              severity: "error",
            });
          }
          for (let k = 0; k < closeMatch[0].length; k += 1) advance(closeMatch[0][k]);
          index += closeMatch[0].length - 1;
          continue;
        }
      } else if (next === ">" || /[A-Za-z]/.test(next || "")) {
        const openTag = matchJsxOpeningTag(text, index, inJsxText);
        if (openTag) {
          openTagEndStack.push({
            endIndex: openTag.endIndex,
            bracketDepth: bracketStack.length,
          });
          if (!openTag.selfClosing) {
            jsxStack.push({
              tag: openTag.tagName,
              line,
              column,
              bracketDepth: bracketStack.length,
              openTagEndIndex: openTag.endIndex,
            });
          }
          for (let k = 0; k < openTag.headerLength; k += 1) advance(text[index + k]);
          index += openTag.headerLength - 1;
          continue;
        }
      }
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
      } else if (
        ch === "}" &&
        templateBraceStack.length > 0 &&
        templateBraceStack[templateBraceStack.length - 1] === bracketStack.length
      ) {
        templateBraceStack.pop();
        state = "template";
      }
      advance(ch);
      continue;
    }

    // Common syntax errors
    if (ch === "=" && next === "=" && text[index + 2] === "=" && text[index + 3] === "=") {
      problems.push({
        line,
        column,
        length: 4,
        kind: "invalid-syntax",
        message: "Ungültiger Operator „====“; meintest du „===“?",
        severity: "error",
      });
      advance(ch);
      advance(next);
      advance(text[index + 2]);
      advance(text[index + 3]);
      index += 3;
      continue;
    }

    advance(ch);
  }

  // EOF state checks
  if (state === "block-comment") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 2,
      kind: "unterminated-comment",
      message: "Blockkommentar wird nie mit „*/“ geschlossen.",
      severity: "error",
    });
  }
  if (state === "single-quote" || state === "double-quote" || state === "template") {
    problems.push({
      line: openedAtLine,
      column: openedAtColumn,
      length: 1,
      kind: "unterminated-string",
      message: state === "template"
        ? "Template-String (`) wird vor Dateiende nicht geschlossen."
        : "Zeichenkette wird nicht geschlossen.",
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

  for (const jsx of jsxStack) {
    const displayTag = jsx.tag ? `<${jsx.tag}>` : "<>";
    problems.push({
      line: jsx.line,
      column: jsx.column,
      length: jsx.tag.length + 2,
      kind: "unclosed-jsx-tag",
      message: `JSX-Tag „${displayTag}“ wird nie geschlossen.`,
      severity: "error",
    });
  }

  // Line-by-line checks for Polyglot mistakes (ignoring strings and comments)
  for (let l = 0; l < lines.length; l += 1) {
    const raw = lines[l];
    const lineNum = l + 1;
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")
      .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
      .trim();

    // Python 'def' in JS/TS
    const defMatch = stripped.match(/^(?:export\s+|async\s+)*def\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (defMatch) {
      const col = raw.indexOf("def");
      problems.push({
        line: lineNum,
        column: col + 1,
        length: 3,
        kind: "polyglot-syntax",
        message: "In JavaScript/TypeScript heißt es „function“, nicht „def“.",
        severity: "error",
      });
    }

    // Python 'elif' in JS/TS
    const elifMatch = stripped.match(/^(?:}\s*)?elif\b/);
    if (elifMatch) {
      const col = raw.indexOf("elif");
      problems.push({
        line: lineNum,
        column: col + 1,
        length: 4,
        kind: "polyglot-syntax",
        message: "In JavaScript/TypeScript heißt es „else if“, nicht „elif“.",
        severity: "error",
      });
    }

    // Invalid literal assignment: `1 = x`, `true = x`
    const badAssign = stripped.match(/^(?:(\d+|true|false|null))\s*=(?!=)/);
    if (badAssign) {
      const col = raw.indexOf(badAssign[1]);
      problems.push({
        line: lineNum,
        column: col + 1,
        length: badAssign[0].length,
        kind: "invalid-assignment",
        message: `Zuweisung an Literal „${badAssign[1]}“ ist ungültig. Meintest du „===“?`,
        severity: "error",
      });
    }
  }

  return problems.sort((left, right) => left.line - right.line || left.column - right.column);
}
