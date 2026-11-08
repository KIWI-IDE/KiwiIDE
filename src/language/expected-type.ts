/**
 * What kind of value belongs where the caret is.
 *
 * This decided the order of the list under "smart" completion, and it was one
 * regular expression over the current line: a declaration, a cast, or the word
 * "return" — and "return" was handed on as though it were a type name, so at
 * every return statement the ranking tokenised the word, threw it away as a
 * keyword, found nothing to match, and penalised the entire list equally. The
 * one place where the expected type is most obvious was the one place it was
 * never worked out.
 *
 * What it does now: finds the innermost construct the caret sits in — an
 * argument list, a condition, a return, a declaration, an assignment — and
 * answers the type that construct requires, with how sure it is.
 *
 * It is a reader, not a compiler. The language server is the authority on
 * types and answers for argument positions through signature help; this covers
 * everything signature help does not, and says how much it trusts itself so a
 * guess never outweighs a fact.
 */
import { enclosingMethodAt, maskJavaLiterals, type JavaFileMembers } from "./java-completion";

export interface ExpectedTypeContext {
  /** Everything in the file up to the caret. */
  textBeforeCursor: string;
  /** The 1-based line the caret is on, for finding the enclosing method. */
  line?: number;
  /** What the file declares, so a return knows what it has to produce. */
  members?: JavaFileMembers;
}

export type ExpectedTypeSource =
  | "declaration" | "cast" | "return" | "assignment"
  | "condition" | "throw" | "iteration" | "argument";

export interface ExpectedType {
  /** The type a value here has to be, e.g. "List<String>" or "boolean". */
  type: string;
  /** Where it was read from. */
  source: ExpectedTypeSource;
  /**
   * How sure the reading is, 0 to 1.
   *
   * A declaration says the type outright; an assignment has to find where the
   * variable was declared; a condition is inferred from the keyword. Ranking
   * multiplies by this, so a guess never outweighs something read directly.
   */
  confidence: number;
  /**
   * The other types that would also fit.
   *
   * An argument position with several applicable overloads expects any of
   * their parameter types, and a candidate that fits the second overload is as
   * right as one that fits the first.
   */
  alternatives?: string[];
}

/** Keywords whose parenthesis holds a condition rather than an argument. */
const CONDITION_KEYWORDS = new Set(["if", "while", "assert", "switch"]);

/**
 * Whether the caret writes the body of a lambda.
 *
 * It matters because the type expected there is not the one the call wants.
 * At `list.stream().filter(spieler -> spieler.` the parameter is a
 * `Predicate<? super Spieler>` and signature help says so — but what is being
 * written at the caret is the predicate's result, a boolean. Ranking against
 * the interface pushes every boolean-returning member down the list at exactly
 * the moment one of them is wanted.
 *
 * Only the innermost bracket is considered, and only an arrow at its own
 * depth: the arrow of `switch` lives inside braces, which end the scan before
 * it is reached.
 */
export function insideLambdaBody(textBeforeCursor: string): boolean {
  const masked = maskJavaLiterals(String(textBeforeCursor || ""));
  const open = innermostOpenBracket(masked);
  if (open < 0) return false;
  let depth = 0;
  for (let index = open + 1; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && character === "-" && masked[index + 1] === ">") return true;
  }
  return false;
}

/**
 * What a functional interface's method gives back.
 *
 * Answers "" where nothing is expected — a Consumer returns nothing, and an
 * interface this does not know is better left unranked than guessed at.
 */
export function functionalResultType(type: string): string {
  const text = String(type || "").trim();
  const bare = withoutGenerics(text).split(".").at(-1) || "";
  const args = typeArguments(text);
  if (/^(?:Bi)?Predicate$/.test(bare) || /^(?:Int|Long|Double)Predicate$/.test(bare)) return "boolean";
  if (bare === "Comparator" || /^ToInt(?:Bi)?Function$/.test(bare) || bare === "IntUnaryOperator") return "int";
  if (/^ToLong(?:Bi)?Function$/.test(bare) || bare === "LongUnaryOperator") return "long";
  if (/^ToDouble(?:Bi)?Function$/.test(bare) || bare === "DoubleUnaryOperator") return "double";
  // The result of a Function is its last type argument; of a Supplier its only
  // one; of an operator the type it operates on.
  if (/^(?:Bi)?Function$/.test(bare)) return args.at(-1) || "";
  if (bare === "Supplier" || bare === "Callable") return args[0] || "";
  if (bare === "UnaryOperator" || bare === "BinaryOperator") return args[0] || "";
  return "";
}

const TYPE = "[A-Za-z_$][\\w$.]*(?:\\s*<[^;=(){}]*>)?(?:\\s*\\[\\s*\\])*";

export function expectedTypeAt(context: ExpectedTypeContext): ExpectedType | null {
  const text = String(context.textBeforeCursor || "");
  if (!text) return null;
  // Masked for scanning so a bracket inside a string is not a bracket; the
  // types themselves are read out of the original at the same offsets.
  const masked = maskJavaLiterals(text);

  // A cast applies to whatever comes straight after it, wherever that is —
  // inside an argument list, a return, a declaration. So it is read from the
  // caret backwards rather than from the construct the caret sits in.
  const cast = trailingCast(text, masked);
  if (cast) return { type: cast, source: "cast", confidence: 0.85 };

  const open = innermostOpenBracket(masked);
  if (open >= 0) {
    const fromBracket = expectedInsideBracket(text, masked, open);
    if (fromBracket) return fromBracket;
  }

  const statement = statementStart(masked, open + 1);
  return expectedInStatement(text.slice(statement), context);
}

/**
 * The last bracket that was opened and never closed.
 *
 * That is the construct the caret is actually inside — `call(other(x, ` is an
 * argument of `other`, not of `call`.
 */
function innermostOpenBracket(masked: string): number {
  let depth = 0;
  for (let index = masked.length - 1; index >= 0; index -= 1) {
    const character = masked[index];
    if (character === ")" || character === "]") depth += 1;
    else if (character === "(" || character === "[") {
      if (depth === 0) return index;
      depth -= 1;
    } else if (character === ";" || character === "{" || character === "}") {
      // A statement boundary: there is no open bracket above this.
      return -1;
    }
  }
  return -1;
}

function expectedInsideBracket(text: string, masked: string, open: number): ExpectedType | null {
  if (text[open] === "[") return { type: "int", source: "argument", confidence: 0.8 };
  const before = masked.slice(0, open).replace(/\s+$/, "");
  const keyword = before.match(/[A-Za-z_$][\w$]*$/)?.[0] || "";
  if (CONDITION_KEYWORDS.has(keyword)) {
    // switch takes anything switchable; the other three take a boolean.
    if (keyword === "switch") return null;
    return { type: "boolean", source: "condition", confidence: 0.75 };
  }
  if (keyword === "for") {
    // Only the enhanced form says anything: `for (Type name : ` wants
    // something to iterate over.
    const header = text.slice(open + 1);
    const enhanced = header.match(new RegExp(`^\\s*(?:final\\s+)?(${TYPE})\\s+[A-Za-z_$][\\w$]*\\s*:\\s*[^;]*$`));
    if (enhanced) {
      const element = enhanced[1].trim();
      return element === "var"
        ? null
        : { type: `Iterable<${element}>`, source: "iteration", confidence: 0.6 };
    }
    return null;
  }
  if (keyword === "catch" || keyword === "synchronized") return null;
  // Anything else is an argument list, and the language server answers for
  // those through signature help — which knows the overload and the position.
  return null;
}

/**
 * A cast standing immediately before the caret.
 *
 * `(Player) ` is a cast; `if (ready) ` is not, and neither is `compute(x) `.
 * Told apart by what precedes the bracket and by the shape of what is inside
 * it — Java writes type names capitalised, and the primitives are a closed
 * list. Getting this wrong the other way would make every `if` in the file
 * expect its own condition's type.
 */
function trailingCast(text: string, masked: string): string {
  const match = masked.match(new RegExp(`\\(\\s*(${TYPE})\\s*\\)\\s*$`));
  if (!match || match.index === undefined) return "";
  const inner = text.slice(match.index + 1, match.index + match[0].length).replace(/\)\s*$/, "").trim();
  const bare = inner.replace(/<.*>$/, "").replace(/\[\s*\]$/, "").split(".").at(-1) || "";
  // A type is CamelCase or a primitive. A name in capitals is a constant being
  // passed as an argument — `configure(TIMEOUT) ` is not a cast.
  const looksLikeType = /^[A-Z]/.test(bare) && /[a-z]/.test(bare);
  if (!looksLikeType && !PRIMITIVES.has(bare)) return "";
  const before = masked.slice(0, match.index).replace(/\s+$/, "");
  const keyword = before.match(/[A-Za-z_$][\w$]*$/)?.[0] || "";
  // `if (Player) ` is not a cast, and neither is the result of a call.
  if (CONDITION_KEYWORDS.has(keyword) || keyword === "for" || keyword === "catch") return "";
  if (before.endsWith(")") || before.endsWith("]")) return "";
  return inner;
}

/** Where the statement the caret is in begins. */
function statementStart(masked: string, floor: number): number {
  for (let index = masked.length - 1; index >= Math.max(0, floor); index -= 1) {
    const character = masked[index];
    if (character === ";" || character === "{" || character === "}") return index + 1;
  }
  return Math.max(0, floor);
}

function expectedInStatement(statement: string, context: ExpectedTypeContext): ExpectedType | null {
  const text = statement.replace(/^\s+/, "");
  if (!text) return null;

  if (/^throw\b/.test(text)) return { type: "Throwable", source: "throw", confidence: 0.7 };

  // A declaration says its type outright, which is the surest reading there is.
  const declaration = text.match(new RegExp(`^(?:final\\s+)?(${TYPE})\\s+[A-Za-z_$][\\w$]*\\s*=\\s*[^;]*$`));
  if (declaration && declaration[1] !== "var" && !isKeyword(declaration[1])) {
    return { type: declaration[1].trim(), source: "declaration", confidence: 0.95 };
  }

  if (/^return\b/.test(text)) {
    const returned = enclosingReturnType(context);
    // A method returning void expects nothing, and saying so is better than
    // ranking against a type that cannot occur.
    if (returned && returned !== "void") {
      return { type: returned, source: "return", confidence: 0.9 };
    }
    return null;
  }

  // Assigning to something that already exists: the type is wherever it was
  // declared, which is the reading the old line-shaped guess could not make.
  const assignment = text.match(/^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*[^;=]*$/);
  if (assignment) {
    const target = assignment[1].split(".").at(-1)?.trim() || "";
    const declared = declaredTypeOf(target, context);
    if (declared) return { type: declared, source: "assignment", confidence: 0.8 };
  }

  return null;
}

const KEYWORDS = new Set([
  "return", "throw", "new", "if", "else", "for", "while", "do", "switch", "case",
  "try", "catch", "finally", "assert", "break", "continue", "yield", "synchronized",
]);

function isKeyword(word: string): boolean {
  return KEYWORDS.has(String(word || "").trim());
}

/**
 * What the method the caret is in has to return.
 *
 * The enclosing method is the last one declared at or before the caret's line.
 * A method declared after it cannot contain it, and one declared before it is
 * only left behind by the next declaration.
 */
export function enclosingReturnType(context: ExpectedTypeContext): string {
  if (!context.members) return "";
  const method = enclosingMethodAt(context.members, Number(context.line) || 0);
  if (!method || method.isConstructor) return "";
  return String(method.returnType || "").trim();
}

/**
 * Where a name was declared, read backwards from the caret.
 *
 * Locals first — the nearest declaration is the one in scope — and the file's
 * own fields after them, which is the order Java resolves in.
 */
export function declaredTypeOf(name: string, context: ExpectedTypeContext): string {
  const target = String(name || "").trim();
  if (!target) return "";
  const text = maskJavaLiterals(String(context.textBeforeCursor || ""));
  const declaration = new RegExp(
    `(?:^|[;{}(,]|\\breturn\\b|\\bfinal\\b)\\s*(${TYPE})\\s+${target}\\s*(?:=|;|:|,|\\))`,
    "g",
  );
  let found = "";
  for (const match of text.matchAll(declaration)) {
    const type = match[1].trim();
    if (type === "var" || isKeyword(type)) continue;
    // The last one before the caret is the one in scope.
    found = type;
  }
  if (found) return found;
  const field = (context.members?.fields || []).find((entry) => entry.name === target);
  return field ? String(field.type || "").trim() : "";
}

/**
 * How well a candidate fits what is expected, from -1 to 1.
 *
 * 1 is the same type, down through a compatible one, to -1 for something that
 * cannot be it. Deliberately generous about not knowing: an item whose type
 * cannot be read scores 0 and keeps the order the language server gave it,
 * because pushing an unreadable item down is how a correct answer disappears.
 */
export function typeAffinity(expected: string, candidate: string): number {
  const want = normalizeType(expected);
  const have = normalizeType(candidate);
  if (!want || !have) return 0;
  if (want === have) return 1;

  const wantRaw = withoutGenerics(want);
  const haveRaw = withoutGenerics(have);
  if (wantRaw === haveRaw) {
    // Same type, different type arguments: List<String> against List<Integer>
    // is worse than List against List, and better than an unrelated type.
    return compatibleArguments(want, have) ? 0.8 : 0.2;
  }
  if (BOXED[wantRaw] === haveRaw || BOXED[haveRaw] === wantRaw) return 0.9;
  if (assignableTo(wantRaw, haveRaw)) return 0.6;
  if (wantRaw === "object") return 0.3;
  // A primitive cannot be a reference type and the other way round, which is
  // the one incompatibility worth stating outright.
  if (PRIMITIVES.has(wantRaw) !== PRIMITIVES.has(haveRaw)) return -0.6;
  return -0.3;
}

const PRIMITIVES = new Set(["boolean", "byte", "short", "int", "long", "float", "double", "char", "void"]);

const BOXED: Record<string, string> = {
  boolean: "boolean", byte: "byte", short: "short", int: "integer", long: "long",
  float: "float", double: "double", char: "character",
};

/** The few supertypes worth knowing without asking the language server. */
const SUPERTYPES: Record<string, string[]> = {
  iterable: ["collection", "list", "set", "queue", "deque", "arraylist", "linkedlist", "hashset", "treeset", "stream"],
  collection: ["list", "set", "queue", "deque", "arraylist", "linkedlist", "hashset", "treeset"],
  list: ["arraylist", "linkedlist", "immutablelist", "copyonwritearraylist"],
  set: ["hashset", "treeset", "linkedhashset"],
  map: ["hashmap", "treemap", "linkedhashmap", "concurrenthashmap"],
  charsequence: ["string", "stringbuilder", "stringbuffer"],
  number: ["integer", "long", "double", "float", "short", "byte", "bigdecimal", "biginteger"],
  throwable: ["exception", "runtimeexception", "error", "ioexception", "illegalargumentexception", "illegalstateexception"],
  object: [],
};

function assignableTo(expected: string, candidate: string): boolean {
  const subtypes = SUPERTYPES[expected];
  if (!subtypes) return false;
  return subtypes.includes(candidate);
}

function compatibleArguments(expected: string, candidate: string): boolean {
  const wanted = typeArguments(expected);
  const given = typeArguments(candidate);
  if (!wanted.length || !given.length || wanted.length !== given.length) return false;
  return wanted.every((argument, index) =>
    argument === given[index] || argument === "?" || given[index] === "?");
}

function typeArguments(type: string): string[] {
  return splitTypeArguments(type.match(/<(.*)>$/)?.[1] || "");
}

/** `String, List<Integer>` as two arguments rather than three. */
function splitTypeArguments(inside: string): string[] {
  if (!inside) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of inside) {
    if (character === "<") depth += 1;
    if (character === ">") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function withoutGenerics(type: string): string {
  return type.replace(/<.*>$/, "").trim();
}

/**
 * The type of the value a proposal would produce.
 *
 * The language server writes this three ways depending on version and
 * settings — `online() : List<Player>`, `List<Player> online()`, or just the
 * type for a field — and each of them may carry the owning class after a
 * middle dot. Answers "" rather than guessing, and "" means the ranking leaves
 * the item where the server put it.
 */
export function candidateTypeOf(item: { detail?: string; expectedType?: string }): string {
  const annotated = String(item?.expectedType || "").trim();
  if (annotated) return annotated;
  const detail = String(item?.detail || "").split("·")[0].trim();
  if (!detail) return "";
  // `name(args) : ReturnType` — the return type is what the call produces.
  const returned = detail.match(/:\s*([^:]+)$/);
  if (returned) return returned[1].trim();
  // `ReturnType name(args)`.
  const leading = detail.match(new RegExp(`^(${TYPE})\\s+[A-Za-z_$][\\w$]*\\s*\\(`));
  if (leading) return leading[1].trim();
  // A field or variable, whose detail is the type and nothing else.
  const bare = detail.match(new RegExp(`^${TYPE}$`));
  return bare ? detail : "";
}

/** A type name reduced to what can be compared: no package, no case, no gaps. */
export function normalizeType(value: string): string {
  const text = String(value || "").trim().replace(/\s+/g, "");
  if (!text) return "";
  const array = text.endsWith("[]");
  const bare = array ? text.slice(0, -2) : text;
  const generic = bare.match(/^(.*?)<(.*)>$/);
  const raw = (generic ? generic[1] : bare).split(".").at(-1) || "";
  const normalized = raw.toLowerCase();
  if (!generic) return array ? `${normalized}[]` : normalized;
  const args = splitTypeArguments(generic[2]).map((argument) => normalizeType(argument));
  return `${normalized}<${args.join(",")}>${array ? "[]" : ""}`;
}
