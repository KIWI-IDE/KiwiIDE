/**
 * Breakpoints on a member rather than on a line.
 *
 * A line breakpoint answers "where does this run". The two questions it cannot
 * answer are the ones that cost the most time: "who put that value there",
 * when the write is in a class nobody suspected, and "who calls this at all",
 * when a method is reached through an interface or a framework. JDI can watch
 * a field and can stop on entering a method; what is missing on this side is
 * naming the member somebody means.
 *
 * The caret is the answer. Somebody wanting a breakpoint on a field is looking
 * at the field, so the work here is reading the declaration under the cursor
 * well enough to say which member it is — and saying nothing rather than
 * guessing when the cursor is somewhere else, because a breakpoint on the
 * wrong member is worse than no breakpoint.
 */

import type { DebugBreakpoint } from "./types";

export interface MemberAtCaret {
  /** "field" or "method" — what the declaration under the caret is. */
  kind: "field" | "method";
  name: string;
}

/** Words that begin a declaration without being part of its name. */
const MODIFIERS = new Set([
  "public", "protected", "private", "static", "final", "transient", "volatile",
  "abstract", "synchronized", "native", "strictfp", "default", "sealed", "non-sealed",
]);

/**
 * Keywords whose statements look like declarations.
 *
 * `if (x) {` has a method header's exact shape once the keyword is ignored,
 * and `int count = 0;` inside a method body has a field's. The first is
 * excluded here; the second is excluded by only reading lines that sit at a
 * type's own indentation — see `memberAtCaret`.
 */
const STATEMENT_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "synchronized", "return", "new",
  "do", "else", "try", "throw", "case", "assert", "yield",
]);

/**
 * The member declared on a line.
 *
 * Reads one line, which is enough for the declarations people put breakpoints
 * on and is honest about the rest: a declaration split across lines answers
 * nothing rather than half a name.
 */
export function memberOnLine(line: string): MemberAtCaret | null {
  const text = String(line || "").replace(/\/\/.*$/, "").trim();
  if (!text || text.startsWith("*") || text.startsWith("/*") || text.startsWith("@")) return null;

  const method = /(?:^|[\s>\]])([A-Za-z_$][\w$]*)\s*\(/.exec(text);
  if (method && !STATEMENT_KEYWORDS.has(method[1])) {
    // A call is not a declaration. What separates them is what comes after the
    // parameter list: a body, a semicolon on an abstract method, or `throws`.
    const after = text.slice(text.indexOf("(", method.index));
    if (/\)\s*(\{|;|throws\b)/.test(after) && !/\bnew\s+$/.test(text.slice(0, method.index + 1))) {
      const before = text.slice(0, method.index).trim();
      // A declaration has a return type or is a constructor; `foo(bar);` on its
      // own is a call.
      const words = before.split(/[\s<>\[\],]+/).filter(Boolean);
      const declaration = words.length > 0 || /^(?:public|protected|private)/.test(text);
      if (declaration) return { kind: "method", name: method[1] };
    }
    return null;
  }

  const field = /^([\w$<>,\[\]\s.?]+?)\s+([A-Za-z_$][\w$]*)\s*(?:=[^=]|;)/.exec(text);
  if (field) {
    // `List<Spieler>` is one type. Splitting it would leave `Spieler` looking
    // like a name and `List` like a modifier nobody has heard of.
    const words = field[1].replace(/<[^<>]*>/g, "").split(/[\s<>\[\],]+/).filter(Boolean);
    // The type is the last word before the name; everything before it must be a
    // modifier, or this is an assignment to something declared elsewhere.
    const type = words.at(-1) || "";
    if (!type || STATEMENT_KEYWORDS.has(words[0] || "")) return null;
    if (words.slice(0, -1).some((word) => !MODIFIERS.has(word))) return null;
    return { kind: "field", name: field[2] };
  }
  return null;
}

/**
 * The member the caret is on, if it is on one.
 *
 * Only members of the type itself count. A local variable has a field's exact
 * shape, and putting a watchpoint on one would fail in the VM rather than in
 * the IDE — so depth decides: a declaration nested inside a method body is not
 * a member. Braces in strings and comments would break that count, so they are
 * blanked first.
 */
export function memberAtCaret(source: string, line: number): MemberAtCaret | null {
  const lines = String(source || "").split(/\r?\n/);
  const index = Number(line) - 1;
  if (index < 0 || index >= lines.length) return null;

  const member = memberOnLine(lines[index]);
  if (!member) return null;

  const masked = maskLiterals(String(source || "")).split(/\r?\n/);
  let depth = 0;
  for (let position = 0; position < index; position += 1) {
    for (const character of masked[position] || "") {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
  }
  // One level in is inside the type; anything deeper is inside a body. A field
  // at depth 0 is not in a class at all.
  return depth === 1 ? member : null;
}

/** Blanks strings, chars and comments, keeping every line's length. */
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
    // A string or a char: a backslash hides whatever follows it, including the
    // quote that would otherwise end it.
    if (character === "\\") { result += "  "; index += 1; continue; }
    if ((mode === "string" && character === '"') || (mode === "char" && character === "'")) mode = "code";
    result += keep ? character : " ";
  }
  return result;
}

/**
 * The breakpoint for a member.
 *
 * Writes are what people mean by a field breakpoint — reads fire on every
 * mention and would stop a hundred times before the write anybody was looking
 * for. Entry is the same choice for a method: an exit breakpoint is for the
 * return value, which is a second question.
 */
export function memberBreakpoint(className: string, member: MemberAtCaret, path = ""): DebugBreakpoint | null {
  const type = String(className || "").trim();
  if (!type || !member?.name) return null;
  return member.kind === "field"
    ? { type: "field", className: type, path, line: 0, fieldName: member.name, onWrite: true, onRead: false, enabled: true }
    : { type: "method", className: type, path, line: 0, methodName: member.name, onEntry: true, onExit: false, enabled: true };
}

/** How a breakpoint reads in the list. In German, like the rest of the panel. */
export function describeBreakpoint(breakpoint: DebugBreakpoint): string {
  const simple = String(breakpoint?.className || "").split(".").at(-1) || "";
  if (breakpoint?.type === "field") {
    const when = breakpoint.onRead && breakpoint.onWrite !== false
      ? "lesen/schreiben"
      : breakpoint.onRead ? "lesen" : "schreiben";
    return `${simple}.${breakpoint.fieldName} (${when})`;
  }
  if (breakpoint?.type === "method") {
    const when = breakpoint.onExit && breakpoint.onEntry !== false
      ? "Eintritt/Austritt"
      : breakpoint.onExit ? "Austritt" : "Eintritt";
    return `${simple}.${breakpoint.methodName}() (${when})`;
  }
  if (breakpoint?.type === "exception") return breakpoint.className;
  return `${breakpoint?.className || ""}:${breakpoint?.line || 0}`;
}

/**
 * Whether two breakpoints are the same one.
 *
 * The list is keyed by class and line, which two member breakpoints on the
 * same class share — without this, setting one on a second field would replace
 * the first.
 */
export function sameBreakpoint(left: DebugBreakpoint, right: DebugBreakpoint): boolean {
  const kind = (breakpoint: DebugBreakpoint) => breakpoint?.type || "line";
  if (kind(left) !== kind(right) || left?.className !== right?.className) return false;
  if (kind(left) === "field") return left.fieldName === right.fieldName;
  if (kind(left) === "method") return left.methodName === right.methodName;
  if (kind(left) === "exception") return true;
  return left?.line === right?.line && (left?.path || "") === (right?.path || "");
}
