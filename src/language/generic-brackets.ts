/**
 * Colouring the angle brackets of nested generics.
 *
 * Monaco colours `(`, `[` and `{` by nesting depth and leaves `<` alone, for a
 * good reason: in Java an angle bracket is a comparison as often as it is a
 * type argument, and colouring `a < b` as a bracket would be worse than
 * colouring nothing.
 *
 * But `Map<String, List<Map<String, Set<Integer>>>>` is exactly where the
 * colouring earns its keep, and reading it without help means counting angle
 * brackets by eye — which is the thing the feature exists to stop.
 *
 * So this scans for the ones that are certainly type arguments and ignores
 * everything it cannot be sure about. A missed pair costs nothing; a wrong one
 * colours an inequality as a bracket, so the rule is deliberately narrow: an
 * opening angle bracket counts only when it directly follows an identifier
 * that looks like a type, and the run between it and its match contains
 * nothing that could not appear in a type argument.
 */

export interface BracketSpan {
  /** Zero-based offset in the text. */
  start: number;
  end: number;
  /** 0 for the outermost pair, rising inwards. */
  depth: number;
}

/** How many colours the rainbow has before it starts again. */
export const GENERIC_BRACKET_COLORS = 6;

/**
 * Whether the character run before an angle bracket is a type name.
 *
 * `List<` is; `a <` and `1 <` are not.
 */
export function looksLikeTypeName(before: string): boolean {
  const match = /([A-Za-z_$][\w$]*)\s*$/.exec(String(before || ""));
  if (!match) return false;
  const name = match[1];
  // Keywords that can precede a comparison and never precede a type argument.
  if (["return", "if", "while", "case", "assert", "else", "do", "new"].includes(name)) return false;
  /*
   * An upper-case first letter.
   *
   * This is a convention rather than a rule — a lower-case generic type is
   * legal Java — and it is used here anyway, because `a < b` and `List<String>`
   * are otherwise the same shape and no amount of local reading tells them
   * apart. Missing a lower-case generic costs a colour nobody had before;
   * colouring an inequality costs trust in every colour on the screen.
   */
  return /^[A-Z_$]/.test(name);
}

/** Characters that may appear inside a type argument list and nowhere else. */
const INSIDE = /^[\w$.,\s<>\[\]?&|@]*$/;

/**
 * Runs that look like a type argument character by character and are not one.
 *
 * `&` is a bound — `T extends A & B` — but `&&` is a condition, and the two
 * differ only by a repeat.
 */
const NOT_A_TYPE = /&&|\|\|/;

/**
 * The angle-bracket pairs that are certainly type arguments.
 *
 * Scans once, keeping a stack. A `<` that does not find its match before
 * something impossible turns up is dropped along with everything opened after
 * it — half a guess is worse than none.
 */
export function genericBracketSpans(source: string, maxSpans = 4_000): BracketSpan[] {
  const text = String(source || "");
  const masked = maskLiterals(text);
  const spans: BracketSpan[] = [];
  const stack: number[] = [];

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "<") {
      // `<<` is a shift, never a type argument.
      if (masked[index + 1] === "<" || masked[index - 1] === "<") {
        stack.length = 0;
        index += 1;
        continue;
      }
      if (stack.length || looksLikeTypeName(masked.slice(Math.max(0, index - 80), index))) {
        stack.push(index);
      }
      continue;
    }
    if (character === ">") {
      const start = stack.pop();
      if (start === undefined) continue;
      // `->` is a lambda arrow and `>=` a comparison; neither closes anything.
      if (masked[index - 1] === "-" || masked[index + 1] === "=") {
        stack.length = 0;
        continue;
      }
      const between = masked.slice(start + 1, index);
      if (!INSIDE.test(between) || NOT_A_TYPE.test(between)) {
        stack.length = 0;
        continue;
      }
      spans.push({ start, end: index, depth: stack.length });
      if (spans.length >= maxSpans) break;
      continue;
    }
    // Anything that cannot appear inside a type argument ends the attempt.
    if (stack.length && !INSIDE.test(character)) stack.length = 0;
  }

  // Depth is counted from the outside in, so the outermost pair is 0 — which
  // is how Monaco numbers its own bracket colours, and matching it means one
  // palette rather than two.
  return spans.sort((left, right) => left.start - right.start);
}

/** Which of the rainbow's colours a depth gets. */
export function bracketColorIndex(depth: number): number {
  const level = Math.max(0, Math.round(Number(depth) || 0));
  return level % GENERIC_BRACKET_COLORS;
}

/** Blanks strings, chars and comments, keeping every offset. */
function maskLiterals(source: string): string {
  let result = "";
  let mode: "code" | "line" | "block" | "string" | "char" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    const keep = character === "\n" || character === "\r";
    if (mode === "code") {
      if (character === "/" && next === "/") { mode = "line"; result += "  "; index += 1; continue; }
      if (character === "/" && next === "*") { mode = "block"; result += "  "; index += 1; continue; }
      if (character === '"') { mode = "string"; result += " "; continue; }
      if (character === "'") { mode = "char"; result += " "; continue; }
      result += character;
      continue;
    }
    if (mode === "line") {
      if (keep) mode = "code";
      result += keep ? character : " ";
      continue;
    }
    if (mode === "block") {
      if (character === "*" && next === "/") { mode = "code"; result += "  "; index += 1; continue; }
      result += keep ? character : " ";
      continue;
    }
    if (character === "\\") { result += "  "; index += 1; continue; }
    if ((mode === "string" && character === '"') || (mode === "char" && character === "'")) mode = "code";
    result += keep ? character : " ";
  }
  return result;
}
