/**
 * Reading the expression a postfix template would wrap.
 *
 * The expression was matched with one character class, so anything containing
 * a string, a comma or a space ended it: `players.get("server").stream().` was
 * read as `stream` and `.for` on it wrapped a method name. A chain split over
 * several lines was not read at all.
 *
 * This walks backwards from the dot instead, balancing brackets and stepping
 * over string literals, which is what it takes to find where an expression
 * actually begins.
 */

/** What is being reached for, and what has been typed after the dot. */
export interface PostfixTarget {
  expression: string;
  typed: string;
}

const IDENTIFIER = /[A-Za-z0-9_$]/;

/**
 * The expression immediately before the caret's dot.
 *
 * Answers null when the caret is not after a dot, or when what precedes it is
 * not an expression — a number, the start of a line, an operator.
 */
export function postfixTargetAt(textBeforeCursor: string): PostfixTarget | null {
  const text = String(textBeforeCursor || "");
  const typedMatch = text.match(/[A-Za-z][\w$]*$/);
  const typed = typedMatch ? typedMatch[0] : "";
  const dotIndex = text.length - typed.length - 1;
  if (dotIndex < 0 || text[dotIndex] !== ".") return null;

  let index = dotIndex - 1;
  let depth = 0;
  let cameFromDot = true;
  while (index >= 0) {
    const character = text[index];
    if (character === ")" || character === "]") {
      depth += 1;
      index -= 1;
      cameFromDot = false;
      continue;
    }
    if (character === "(" || character === "[") {
      if (depth === 0) break;
      depth -= 1;
      index -= 1;
      cameFromDot = false;
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipStringBackwards(text, index);
      cameFromDot = false;
      continue;
    }
    if (depth > 0) {
      index -= 1;
      continue;
    }
    if (/\s/.test(character)) {
      // A break in a chain written over several lines is part of the
      // expression; a space anywhere else ends it.
      const previous = lastNonSpaceBefore(text, index);
      if (cameFromDot && previous >= 0 && (IDENTIFIER.test(text[previous]) || ")]".includes(text[previous]))) {
        index = previous;
        continue;
      }
      break;
    }
    if (IDENTIFIER.test(character) || character === ".") {
      cameFromDot = character === ".";
      index -= 1;
      continue;
    }
    break;
  }

  const expression = text.slice(index + 1, dotIndex).trim();
  if (!expression) return null;
  // A number with a dot after it is a literal being written, not a receiver.
  if (/^\d+$/.test(expression)) return null;
  return { expression, typed };
}

function lastNonSpaceBefore(text: string, from: number): number {
  let index = from;
  while (index >= 0 && /\s/.test(text[index])) index -= 1;
  return index;
}

function skipStringBackwards(text: string, closingQuote: number): number {
  const quote = text[closingQuote];
  let index = closingQuote - 1;
  while (index >= 0) {
    if (text[index] === quote) {
      // A quote that is itself escaped does not end the literal.
      let backslashes = 0;
      let scan = index - 1;
      while (scan >= 0 && text[scan] === "\\") {
        backslashes += 1;
        scan -= 1;
      }
      if (backslashes % 2 === 0) return index - 1;
    }
    index -= 1;
  }
  return -1;
}

/**
 * What an expression looks like it evaluates to.
 *
 * Syntactic, and deliberately unsure of itself: the language server is the
 * authority on types and is not asked here, because a postfix template has to
 * be offered while the character after the dot is still being typed.
 *
 * So it answers "unknown" readily, and "unknown" allows everything. Hiding a
 * template somebody wanted is worse than offering one they do not — the first
 * looks broken, the second is one line further down a list.
 */
export type ExpressionKind = "boolean" | "iterable" | "number" | "string" | "unknown";

export function expressionKind(expression: string): ExpressionKind {
  const text = String(expression || "").trim();
  if (!text) return "unknown";
  if (/^(?:true|false)$/.test(text)) return "boolean";
  if (/^!/.test(text)) return "boolean";
  if (/(?:==|!=|<=|>=|&&|\|\|)/.test(text)) return "boolean";
  // The conventional shapes of a predicate, which is most of what "boolean"
  // means in Java in practice.
  if (/\b(?:is|has|can|should|contains|equals|matches|startsWith|endsWith|isEmpty|isPresent|isBlank)[A-Z_$]?[\w$]*\s*\([^)]*\)\s*$/.test(text)) {
    return "boolean";
  }
  if (/^"/.test(text) || /\.(?:toString|name|join|format|strip|trim|substring)\s*\([^)]*\)\s*$/.test(text)) return "string";
  if (/^-?\d+(?:\.\d+)?[dDfFlL]?$/.test(text)) return "number";
  if (/\.(?:size|length|count|indexOf|ordinal|hashCode)\s*\([^)]*\)\s*$/.test(text) || /\.length$/.test(text)) {
    return "number";
  }
  if (/\.(?:stream|toList|values|keySet|entrySet|asList|of|collect|filter|map|sorted|distinct|limit)\s*\([^)]*\)\s*$/.test(text)) {
    return "iterable";
  }
  if (/\[[^\]]*\]\s*$/.test(text)) return "unknown";
  // A plural name is the one naming convention reliable enough to read.
  if (/\b[a-z][\w$]*(?:s|List|Set|Map|Array|Collection)$/.test(text)) return "iterable";
  return "unknown";
}

/** Which templates make sense for a value of this kind. */
export function templateFitsExpression(key: string, kind: ExpressionKind): boolean {
  if (kind === "unknown") return true;
  const name = key.replace(/^\./, "");
  if (name === "if" || name === "not") return kind === "boolean";
  if (name === "for") return kind === "iterable";
  // null and nn are about references, so a primitive number cannot be either.
  if (name === "null" || name === "nn") return kind !== "number" && kind !== "boolean";
  return true;
}

/**
 * Whether a template's syntax exists in the language level being compiled for.
 *
 * Offering `var` to a project on Java 8 produces a line that does not compile,
 * and the person who accepted it has to know why — which is a worse outcome
 * than the template simply not being there.
 */
export function templateFitsLanguageLevel(insertText: string, languageLevel: number): boolean {
  const level = Number.isFinite(languageLevel) && languageLevel > 0 ? languageLevel : 21;
  if (/\bvar\b/.test(insertText) && level < 10) return false;
  // The arrow form of switch, and switch as an expression.
  if (/switch\s*\([^)]*\)\s*\{[^}]*->/.test(insertText) && level < 14) return false;
  if (/\brecord\s+[A-Z]/.test(insertText) && level < 16) return false;
  return true;
}

/**
 * Drops a Kiwi template the language server already proposes.
 *
 * JDT LS ships templates of its own — sysout, fori, main — and two entries for
 * one snippet is a list saying the same thing twice. The server's is kept: it
 * knows the file's context, and Kiwi's is a fallback for when it has not
 * answered.
 */
export function withoutServerDuplicates<T>(
  templates: T[],
  serverLabels: Iterable<string>,
  labelOf: (item: T) => string,
): T[] {
  const taken = new Set([...serverLabels].map((label) => normalizeTemplateName(label)));
  return templates.filter((template) => !taken.has(normalizeTemplateName(labelOf(template))));
}

/** Template names compared the way a person would: without dots or case. */
export function normalizeTemplateName(label: string): string {
  return String(label || "").replace(/^\./, "").trim().toLowerCase();
}

/**
 * The Java release a version string names.
 *
 * Java writes its own version three ways — "21", "17.0.9" and the old "1.8" —
 * and only the release number decides what syntax compiles. Answers 0 when
 * there is nothing to read, which callers treat as "assume current" rather
 * than as "assume ancient": refusing modern syntax to a project whose version
 * simply could not be read would be the more annoying mistake.
 */
export function javaReleaseNumber(version: string): number {
  const text = String(version || "").trim();
  const legacy = text.match(/^1\.(\d+)/);
  if (legacy) return Number(legacy[1]);
  const modern = text.match(/(\d+)/);
  return modern ? Number(modern[1]) : 0;
}

/** The ways a selection can be wrapped. */
export const SURROUND_KINDS = ["if", "if_else", "try", "try_finally", "synchronized", "for", "while", "comment"] as const;

export type SurroundKind = (typeof SURROUND_KINDS)[number];

/**
 * Wraps the selected lines in a block.
 *
 * The selection keeps its own shape: every line is indented one step further
 * and nothing inside it is reformatted. Wrapping code in a try block is not an
 * invitation to re-lay-out the code, and a wrap that also reformats is one
 * somebody has to read in full before trusting it.
 *
 * The indentation of the opening line is taken from the first selected line,
 * so the block lands where the code it wraps already was.
 */
export function surroundSelection(
  selection: string,
  kind: SurroundKind,
  options: { indent?: string } = {},
): string {
  const step = options.indent ?? "    ";
  const lines = String(selection ?? "").split("\n");
  const outerIndent = (lines[0]?.match(/^[ \t]*/) || [""])[0];
  // An empty line stays empty rather than becoming an indented blank one.
  const body = lines
    .map((line) => (line.trim() ? `${step}${line}` : line))
    .join("\n");
  const opening = surroundOpening(kind, outerIndent);
  const closing = surroundClosing(kind, outerIndent);
  return `${opening}\n${body}\n${closing}`;
}

function surroundOpening(kind: SurroundKind, indent: string): string {
  if (kind === "if" || kind === "if_else") return `${indent}if (${"${1:true}"}) {`;
  if (kind === "try" || kind === "try_finally") return `${indent}try {`;
  if (kind === "synchronized") return `${indent}synchronized (${"${1:this}"}) {`;
  if (kind === "for") return `${indent}for (${"${1:var item}"} : ${"${2:items}"}) {`;
  if (kind === "comment") return `${indent}/*`;
  return `${indent}while (${"${1:true}"}) {`;
}

function surroundClosing(kind: SurroundKind, indent: string): string {
  // A try that catches nothing does not compile, so the catch comes with it.
  if (kind === "try") {
    return `${indent}} catch (${"${1:Exception}"} ${"${2:e}"}) {\n${indent}    ${"${0}"}\n${indent}}`;
  }
  if (kind === "try_finally") {
    return `${indent}} finally {\n${indent}    ${"${0}"}\n${indent}}`;
  }
  if (kind === "if_else") {
    return `${indent}} else {\n${indent}    ${"${0}"}\n${indent}}`;
  }
  if (kind === "comment") {
    return `${indent}*/`;
  }
  return `${indent}}`;
}

/** What each way of wrapping is called, for a menu. */
export const SURROUND_LABELS: Record<SurroundKind, string> = {
  if: "if (…) { … }",
  if_else: "if (…) { … } else { … }",
  try: "try { … } catch",
  try_finally: "try { … } finally",
  synchronized: "synchronized (…) { … }",
  for: "for (… : …) { … }",
  while: "while (…) { … }",
  comment: "/* … */ (Kommentar)",
};
