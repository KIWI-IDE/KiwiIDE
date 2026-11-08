/**
 * What Kiwi understands about a Java file on its own.
 *
 * JDT LS is the authority on types, but it is silent for the first seconds of
 * a session, for a project that fails to import, and for a file that does not
 * compile yet — which is most files while they are being written. Everything
 * here is derived from the buffer itself, so the methods somebody just typed
 * can be completed immediately and the shape of a statement can be finished
 * without asking anyone.
 *
 * Deliberately syntactic: no type resolution is attempted, and anything that
 * would need it is left to the language server.
 */

export interface JavaParameter {
  type: string;
  name: string;
}

export interface JavaMethodMember {
  name: string;
  returnType: string;
  parameters: JavaParameter[];
  isStatic: boolean;
  isConstructor: boolean;
  visibility: "public" | "protected" | "private" | "package";
  owner: string;
  line: number;
  /** The signature as it was written, for the completion detail. */
  signature: string;
}

export interface JavaFieldMember {
  name: string;
  type: string;
  isStatic: boolean;
  owner: string;
  line: number;
}

export interface JavaTypeMember {
  name: string;
  kind: "class" | "interface" | "enum" | "record" | "@interface";
  line: number;
}

export interface JavaFileMembers {
  types: JavaTypeMember[];
  methods: JavaMethodMember[];
  fields: JavaFieldMember[];
}

const MODIFIER = "public|protected|private|static|final|abstract|synchronized|native|default|strictfp|transient|volatile";
const BLOCK_KEYWORD = /^(?:if|else|for|while|do|switch|case|default|try|catch|finally|synchronized|return|throw|new|assert|yield|break|continue)\b/;

/**
 * Blanks out comments and literals, keeping every offset and line break.
 *
 * A brace inside a string is not a brace, and a semicolon inside a comment
 * does not end a statement. Replacing rather than removing means a position in
 * the masked text still means the same position in the file.
 */
export function maskJavaLiterals(source: string): string {
  const text = String(source || "");
  const result: string[] = [];
  let state: "code" | "line" | "block" | "string" | "char" | "text-block" = "code";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    const blank = character === "\n" || character === "\r" ? character : " ";
    if (state === "line") {
      if (character === "\n") state = "code";
      result.push(blank);
      continue;
    }
    if (state === "block") {
      if (character === "*" && next === "/") {
        state = "code";
        result.push(blank, " ");
        index += 1;
        continue;
      }
      result.push(blank);
      continue;
    }
    if (state === "string" || state === "char") {
      if (character === "\\" && next !== undefined) {
        result.push(blank, next === "\n" ? next : " ");
        index += 1;
        continue;
      }
      if (character === "\n") {
        // An unterminated literal ends at the line break, which is the error.
        state = "code";
        result.push(character);
        continue;
      }
      if ((state === "string" && character === '"') || (state === "char" && character === "'")) state = "code";
      result.push(blank);
      continue;
    }
    if (state === "text-block") {
      if (character === '"' && next === '"' && text[index + 2] === '"') {
        state = "code";
        result.push(" ", " ", " ");
        index += 2;
        continue;
      }
      result.push(blank);
      continue;
    }
    if (character === "/" && next === "/") {
      state = "line";
      result.push(" ", " ");
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      state = "block";
      result.push(" ", " ");
      index += 1;
      continue;
    }
    if (character === '"' && next === '"' && text[index + 2] === '"') {
      state = "text-block";
      result.push(" ", " ", " ");
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      state = character === '"' ? "string" : "char";
      result.push(" ");
      continue;
    }
    result.push(character);
  }
  return result.join("");
}

function splitParameters(raw: string): JavaParameter[] {
  const inside = String(raw || "").trim();
  if (!inside) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of inside) {
    if (character === "<" || character === "(" || character === "[") depth += 1;
    if (character === ">" || character === ")" || character === "]") depth -= 1;
    if (character === "," && depth <= 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim().replace(/^(?:final\s+|@\w+\s+)+/, ""))
    .filter(Boolean)
    .map((part) => {
      const name = part.split(/\s+/).at(-1) || "";
      const type = part.slice(0, part.length - name.length).trim();
      return { type: type || name, name: type ? name : "" };
    })
    .filter((parameter) => Boolean(parameter.type));
}

function visibilityOf(modifiers: string): JavaMethodMember["visibility"] {
  if (/\bpublic\b/.test(modifiers)) return "public";
  if (/\bprotected\b/.test(modifiers)) return "protected";
  if (/\bprivate\b/.test(modifiers)) return "private";
  return "package";
}

const typePattern = new RegExp(
  `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*((?:(?:${MODIFIER})\\s+)*)(class|interface|enum|record|@interface)\\s+([A-Za-z_$][\\w$]*)`,
);

const methodPattern = new RegExp(
  `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*((?:(?:${MODIFIER})\\s+)*)(?:<[^<>]*(?:<[^<>]*>)?[^<>]*>\\s+)?`
  + `([A-Za-z_$][\\w$.]*(?:\\s*<[^;{}]*>)?(?:\\s*\\[\\s*\\])*)\\s+([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)`,
);

const constructorPattern = new RegExp(
  `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*((?:(?:${MODIFIER})\\s+)*)([A-Z][\\w$]*)\\s*\\(([^)]*)\\)\\s*(?:throws\\s+[\\w$.,\\s]+)?\\{`,
);

const fieldPattern = new RegExp(
  `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*((?:(?:${MODIFIER})\\s+)*)`
  + `([A-Za-z_$][\\w$.]*(?:\\s*<[^;{}]*>)?(?:\\s*\\[\\s*\\])*)\\s+([A-Za-z_$][\\w$]*)\\s*(?:=[^=]|;)`,
);

/**
 * Every type, method and field the file declares.
 *
 * Line-based on purpose: a signature that is split across lines is rare, and a
 * reader that guesses at one is far more likely to invent a method that is not
 * there than to miss one. Nothing here is used to decide anything — only to
 * offer completions — so missing a member costs a suggestion, while inventing
 * one costs trust.
 */
export function parseJavaMembers(source: string): JavaFileMembers {
  const lines = maskJavaLiterals(source).split(/\r?\n/);
  const types: JavaTypeMember[] = [];
  const methods: JavaMethodMember[] = [];
  const fields: JavaFieldMember[] = [];
  let owner = "";
  lines.forEach((line, index) => {
    const number = index + 1;
    const type = line.match(typePattern);
    if (type) {
      owner = type[3];
      types.push({ name: type[3], kind: type[2] as JavaTypeMember["kind"], line: number });
      return;
    }
    const constructor = line.match(constructorPattern);
    if (constructor && constructor[2] === owner) {
      methods.push({
        name: constructor[2],
        returnType: "",
        parameters: splitParameters(constructor[3]),
        isStatic: false,
        isConstructor: true,
        visibility: visibilityOf(constructor[1]),
        owner,
        line: number,
        signature: line.trim().replace(/\s*\{\s*$/, ""),
      });
      return;
    }
    const method = line.match(methodPattern);
    // The body may sit on the same line — `public String name(){}` is a whole
    // declaration — so the brace is looked for after the parameters rather
    // than at the end of the line.
    if (method && !BLOCK_KEYWORD.test(line.trim()) && /\)\s*(?:throws\s+[\w$.,\s]+)?\s*[{;]/.test(line)) {
      const returnType = method[2].replace(/\s+/g, " ").trim();
      // `new Runnable()` and `while (ready)` reach here as "type name(...)";
      // a declaration never starts with a keyword.
      if (!BLOCK_KEYWORD.test(returnType)) {
        methods.push({
          name: method[3],
          returnType,
          parameters: splitParameters(method[4]),
          isStatic: /\bstatic\b/.test(method[1]),
          isConstructor: false,
          visibility: visibilityOf(method[1]),
          owner,
          line: number,
          signature: line.trim().replace(/\s*\{\s*$/, "").replace(/;\s*$/, ""),
        });
        return;
      }
    }
    const field = line.match(fieldPattern);
    if (field && !BLOCK_KEYWORD.test(line.trim()) && !BLOCK_KEYWORD.test(field[2])) {
      fields.push({
        name: field[3],
        type: field[2].replace(/\s+/g, " ").trim(),
        isStatic: /\bstatic\b/.test(field[1]),
        owner,
        line: number,
      });
    }
  });
  return { types, methods, fields };
}

/** How a method reads in the completion list. */
export function methodSignatureLabel(method: JavaMethodMember): string {
  const parameters = method.parameters.map((parameter) => parameter.type).join(", ");
  return `${method.name}(${parameters})`;
}

/**
 * The snippet that inserts a call to a method the file declares.
 *
 * A method without parameters leaves the caret after the call; one with them
 * puts it on the first argument, because that is what has to be filled in.
 */
export function methodCallSnippet(method: JavaMethodMember): string {
  if (!method.parameters.length) return `${method.name}()`;
  const placeholders = method.parameters
    .map((parameter, index) => `\${${index + 1}:${parameter.name || parameter.type}}`)
    .join(", ");
  return `${method.name}(${placeholders})\${0}`;
}

/**
 * Generic types from the JDK, with the number of type arguments they take.
 *
 * Used only when nothing better is known: JDT reports the type parameters of
 * anything it has indexed, and that answer always wins. This is what makes
 * `new ArrayList` finish as `new ArrayList<>()` in the first seconds of a
 * session, before the classpath is ready.
 */
export const genericJdkTypes: Record<string, number> = {
  ArrayList: 1, LinkedList: 1, List: 1, Collection: 1, Iterable: 1, Iterator: 1,
  HashSet: 1, LinkedHashSet: 1, TreeSet: 1, Set: 1, SortedSet: 1, NavigableSet: 1,
  ArrayDeque: 1, Deque: 1, Queue: 1, PriorityQueue: 1, Stack: 1, Vector: 1,
  CopyOnWriteArrayList: 1, ConcurrentLinkedQueue: 1, ConcurrentLinkedDeque: 1,
  HashMap: 2, LinkedHashMap: 2, TreeMap: 2, Map: 2, SortedMap: 2, NavigableMap: 2,
  ConcurrentHashMap: 2, ConcurrentMap: 2, WeakHashMap: 2, IdentityHashMap: 2, EnumMap: 2,
  Optional: 1, AtomicReference: 1, ThreadLocal: 1, CompletableFuture: 1, Future: 1,
  Supplier: 1, Consumer: 1, Predicate: 1, Function: 2, BiFunction: 3, BiConsumer: 2,
  Comparator: 1, Stream: 1, Class: 1, Entry: 2,
};

/** How many type arguments a completion's own label says the type takes. */
export function genericArity(label: string, detail = ""): number {
  const written = `${label} ${detail}`.match(/^[^<]*<([^<>]*(?:<[^<>]*>)?[^<>]*)>/);
  if (written) return written[1].split(",").length;
  const bare = String(label || "").replace(/[^\w$].*$/, "");
  return genericJdkTypes[bare] || 0;
}

export interface NewExpressionContext {
  /** Everything on the line up to the caret. */
  lineBeforeCursor: string;
  /** Everything on the line after the caret. */
  lineAfterCursor: string;
  /** Type arguments the completed type takes, 0 for a non-generic one. */
  arity: number;
  /** Whether the file's statements should be finished with a semicolon. */
  finishStatements: boolean;
}

/**
 * Turns a bare type name into the expression somebody actually meant.
 *
 * Typing `new ArrayList` and accepting the proposal used to leave exactly
 * that: no diamond, no parentheses and no semicolon, so three more edits
 * followed every single time. The diamond is only added where Java infers it —
 * after `new`, with a generic type — and the semicolon only where the
 * statement demonstrably ends at the caret.
 */
export function completeNewExpression(insertText: string, context: NewExpressionContext): string {
  const text = String(insertText || "");
  if (!/\bnew\s+[\w$.]*$/.test(context.lineBeforeCursor)) return text;
  // A proposal that already carries its own arguments or diamond is JDT's
  // considered answer and is left exactly as it is.
  if (/[<(]/.test(text)) return text;
  const diamond = context.arity > 0 ? "<>" : "";
  const call = `${text}${diamond}(\${0})`;
  return needsClosingSemicolon(context) ? `${call};` : call;
}

function needsClosingSemicolon(context: NewExpressionContext): boolean {
  if (!context.finishStatements) return false;
  if (context.lineAfterCursor.trim()) return false;
  const before = maskJavaLiterals(context.lineBeforeCursor);
  if (bracketBalance(before) !== 0) return false;
  if (hasOpenTernary(before)) return false;
  // Only where the line is unmistakably a statement: an assignment or a
  // return. Inside an argument list or a for-header a semicolon would be wrong.
  return hasTopLevelAssignment(before) || /^\s*return\b/.test(before);
}

/** Net depth of every bracket kind on a line that has been masked. */
export function bracketBalance(masked: string): number {
  let depth = 0;
  for (const character of String(masked || "")) {
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth -= 1;
  }
  return depth;
}

/** Whether a line assigns something, as opposed to comparing it. */
export function hasTopLevelAssignment(masked: string): boolean {
  const text = String(masked || "");
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{" || character === "<") depth += 1;
    if (character === ")" || character === "]" || character === "}" || character === ">") depth -= 1;
    if (character !== "=" || depth > 0) continue;
    const previous = text[index - 1] || "";
    const next = text[index + 1] || "";
    if (next === "=" || "=!<>+-*/%&|^".includes(previous)) continue;
    return true;
  }
  return false;
}

/**
 * Whether a line contains a ternary operator (`?`) that has not yet been closed
 * with its matching `:`.
 *
 * Semicolons must never be inserted while a ternary is still open, even if the line
 * begins with `return` or contains an assignment `=`.
 */
export function hasOpenTernary(masked: string): boolean {
  const text = String(masked || "");
  const stack: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(0);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.length > 1) {
        stack.pop();
      }
    } else if (ch === "?") {
      let prevIdx = i - 1;
      while (prevIdx >= 0 && /\s/.test(text[prevIdx])) prevIdx -= 1;
      const prevChar = prevIdx >= 0 ? text[prevIdx] : "";
      if (prevChar === "<" || prevChar === ",") {
        continue;
      }
      stack[stack.length - 1] += 1;
    } else if (ch === ":") {
      if (text[i + 1] === ":") {
        i += 1;
        continue;
      }
      if (stack[stack.length - 1] > 0) {
        stack[stack.length - 1] -= 1;
      }
    }
  }
  return stack.some((count) => count > 0);
}

const declarationHeader = new RegExp(
  `^(?:(?:${MODIFIER})\\s+)*(?:<[^<>]*>\\s*)?[A-Za-z_$][\\w$.<>,\\[\\] ?]*\\s+[A-Za-z_$][\\w$]*\\s*\\([^()]*\\)(?:\\s*throws\\s+[\\w$.,\\s]+)?$`,
);

const typeDeclaration = new RegExp(`^(?:(?:${MODIFIER})\\s+)*(?:class|interface|enum|record)\\b`);

export interface JavaLineShape {
  /** The line with its comments and literals blanked out. */
  masked: string;
  /** Whether a comment starts on this line. */
  hasComment: boolean;
  /** Whether a string or character literal is still open at the line's end. */
  unterminatedLiteral: boolean;
}

/**
 * What one line looks like once its comments and literals are out of the way.
 *
 * The masked text answers the structural questions — brackets, assignments —
 * while the original still answers what the line ends with, because masking
 * turns a closing quote into a blank and would make every assigned string look
 * like a line that stops after the equals sign.
 */
export function analyseJavaLine(line: string): JavaLineShape {
  const raw = String(line || "");
  const masked = maskJavaLiterals(raw);
  let hasComment = false;
  for (let index = 0; index < raw.length - 1; index += 1) {
    const pair = raw.slice(index, index + 2);
    if ((pair === "//" || pair === "/*") && masked.slice(index, index + 2) === "  ") {
      hasComment = true;
      break;
    }
  }
  // A literal that never closes leaves its opening quote blanked and the rest
  // of the line with it; comparing what survived is enough to notice.
  const quotes = (raw.match(/["']/g) || []).length;
  const maskedQuotes = (masked.match(/["']/g) || []).length;
  const unterminatedLiteral = !hasComment && (quotes - maskedQuotes) % 2 === 1;
  return { masked, hasComment, unterminatedLiteral };
}

/**
 * Whether pressing Enter here should finish the statement with a semicolon.
 *
 * Written to say no whenever it is not sure. The cost of a missing semicolon
 * is a keystroke; the cost of one in the wrong place is a line the user has to
 * repair, so every case that could still be continued on the next line — an
 * open bracket, a trailing operator, a block header — is left alone.
 */
/** What is known about the call a line ends with, beyond how it is written. */
export interface StatementEndKnowledge {
  /**
   * The return type of the call just written, when something knows it.
   *
   * The completion that was accepted to write the call carries it, which is
   * the only place it can be had without asking the language server — and the
   * answer is needed while Enter is being handled, which cannot wait.
   */
  callReturnType?: string;
  /** What the file declares, so a call to one of its own methods resolves. */
  members?: JavaFileMembers;
}

export function needsStatementSemicolon(
  lineBeforeCursor: string,
  lineAfterCursor: string,
  knowledge: StatementEndKnowledge = {},
): boolean {
  if (lineAfterCursor.trim()) return false;
  const raw = String(lineBeforeCursor || "");
  const { masked, hasComment, unterminatedLiteral } = analyseJavaLine(raw);
  // A line that carries a comment or an unclosed literal is not a statement
  // this can reason about.
  if (hasComment || unterminatedLiteral) return false;
  const trimmed = raw.trimEnd().trim();
  if (!trimmed) return false;
  if (bracketBalance(masked) !== 0) return false;
  if (hasOpenTernary(masked)) return false;
  if (/[;{}(,[:?]$/.test(trimmed)) return false;
  if (/[+\-*/%=<>&|^!~.@]$/.test(trimmed)) return false;
  if (/^(?:if|else|for|while|do|switch|case|default|try|catch|finally|synchronized)\b/.test(trimmed)) return false;
  if (/^[}@]/.test(trimmed) || typeDeclaration.test(trimmed)) return false;
  // The keywords are decided before the declaration header, because that
  // pattern allows spaces inside the type it matches and so read `throw new`
  // as one — which left `throw new IllegalStateException(text)` without its
  // semicolon. A line beginning with a statement keyword is never a
  // declaration.
  if (/^(?:package|import)\b/.test(trimmed)) return true;
  if (/^(?:return|throw|yield|break|continue|assert)\b/.test(trimmed)) return true;
  // `this(…)` and `super(…)` are constructor calls and end a statement.
  // `this.terminal = TerminalBuilder.builder()` merely begins with the same
  // word, and treating it as one is what put a semicolon in the middle of a
  // method chain — the statement carried on with `.streams(…)` a line later.
  if (/^(?:this|super)\s*\(/.test(trimmed)) return true;
  if (declarationHeader.test(trimmed)) return false;
  if (!/[\w$)\]"']$/.test(trimmed)) return false;
  // A call is the one thing that can always be continued on the next line:
  // `.build()` under `TerminalBuilder.builder()` is one statement, and a
  // semicolon put after the first line breaks it. So a call ends a statement
  // only where nothing can follow it — where it returns nothing.
  if (/\)$/.test(trimmed)) return callReturnsNothing(trimmed, knowledge);
  if (hasTopLevelAssignment(masked)) return true;
  // A declaration without an initialiser.
  return /^[A-Za-z_$][\w$.<>,\[\] ?]*\s+[A-Za-z_$][\w$]*$/.test(trimmed);
}

/**
 * Whether the call a line ends with returns nothing.
 *
 * Two things can answer without asking the language server, which cannot be
 * asked while Enter is being handled: the return type recorded when the
 * completion that wrote the call was accepted, and — for a call to a method of
 * this very file — what the file itself declares.
 *
 * Anything else is unknown, and unknown means no semicolon. A missing one
 * costs a keystroke; one in the middle of a method chain costs a repair.
 */
export function callReturnsNothing(trimmed: string, knowledge: StatementEndKnowledge): boolean {
  const recorded = String(knowledge.callReturnType || "").trim();
  if (recorded) return isVoidType(recorded);
  const call = trailingCallName(trimmed);
  if (!call || !knowledge.members) return false;
  // Only a call this file can resolve: a qualified one reaches somewhere the
  // buffer says nothing about.
  if (call.receiver && call.receiver !== "this" && call.receiver !== "super") return false;
  const declared = knowledge.members.methods.filter((method) => method.name === call.name);
  // Overloads that do not agree are no answer at all.
  if (!declared.length) return false;
  return declared.every((method) => isVoidType(method.returnType));
}

function isVoidType(type: string): boolean {
  return String(type || "").trim().split(".").at(-1)?.toLowerCase() === "void";
}

/**
 * The name and receiver of the call a line ends with.
 *
 * Walks back from the closing bracket to the one that opened it, so the
 * arguments — brackets, strings and all — are stepped over rather than parsed.
 */
export function trailingCallName(trimmed: string): { name: string; receiver: string } | null {
  const text = String(trimmed || "");
  if (!text.endsWith(")")) return null;
  const masked = maskJavaLiterals(text);
  let depth = 0;
  let open = -1;
  for (let index = masked.length - 1; index >= 0; index -= 1) {
    const character = masked[index];
    if (character === ")") depth += 1;
    else if (character === "(") {
      depth -= 1;
      if (depth === 0) {
        open = index;
        break;
      }
    }
  }
  if (open <= 0) return null;
  const before = text.slice(0, open);
  const name = before.match(/[A-Za-z_$][\w$]*$/)?.[0] || "";
  if (!name) return null;
  const beforeName = before.slice(0, before.length - name.length).replace(/\s+$/, "");
  if (!beforeName.endsWith(".")) return { name, receiver: "" };
  const receiver = beforeName.slice(0, -1).replace(/\s+$/, "");
  return { name, receiver: receiver.match(/[A-Za-z_$][\w$]*$/)?.[0] || receiver };
}

export interface MethodNameContext {
  /** The declaration being written, up to the caret. */
  lineBeforeCursor: string;
  fields: JavaFieldMember[];
  methods: JavaMethodMember[];
}

export interface MethodNameProposal {
  name: string;
  detail: string;
  /** The whole declaration, as a snippet, or just the name where one exists. */
  insertText: string;
}

const declarationStart = new RegExp(
  `^\\s*((?:(?:${MODIFIER})\\s+)*)([A-Za-z_$][\\w$.]*(?:<[^<>]*(?:<[^<>]*>)?[^<>]*>)?(?:\\[\\s*\\])*)\\s+([A-Za-z_$][\\w$]*)?$`,
);

/** `name` → `Name`, for building getName out of a field. */
function capitalise(value: string) {
  return value ? value[0].toLocaleUpperCase() + value.slice(1) : value;
}

function fieldBaseName(field: JavaFieldMember) {
  return field.name.replace(/^(?:m_|s_|_)/, "");
}

/**
 * Names worth giving the method that is being declared.
 *
 * The return type says most of it: a `boolean` is almost always an `is…`, a
 * `void` a `set…` or a verb, and anything else a `get…`. Pairing that with the
 * fields the class already has turns the guess into a real proposal —
 * `public String get` on a class with a `name` field can only sensibly become
 * `getName()`, body included.
 */
export function methodNameProposals(context: MethodNameContext): MethodNameProposal[] {
  const declaration = String(context.lineBeforeCursor || "").match(declarationStart);
  if (!declaration) return [];
  const returnType = declaration[2];
  if (/^(?:return|new|throw|else|case|import|package)$/.test(returnType)) return [];
  const prefix = declaration[3] || "";
  const isStatic = /\bstatic\b/.test(declaration[1]);
  const taken = new Set(context.methods.map((method) => method.name));
  const proposals: MethodNameProposal[] = [];
  const add = (name: string, detail: string, body: string) => {
    if (!name || taken.has(name) || proposals.some((entry) => entry.name === name)) return;
    proposals.push({ name, detail, insertText: `${name}(\${1}) {\n\t${body}\n}` });
  };

  const usable = context.fields.filter((field) => field.isStatic === isStatic);
  if (returnType === "void") {
    for (const field of usable) {
      const base = fieldBaseName(field);
      add(`set${capitalise(base)}`, `Setter für ${field.name}`, `this.${field.name} = ${base};`);
    }
    for (const name of ["run", "start", "stop", "init", "close", "reset", "update"]) {
      add(name, "Methode ohne Rückgabe", "\${0}");
    }
  } else if (returnType === "boolean") {
    for (const field of usable) {
      const base = capitalise(fieldBaseName(field));
      add(field.type === "boolean" ? `is${base}` : `has${base}`, `Prüfung auf ${field.name}`, `return ${field.name};`);
    }
    for (const name of ["isEmpty", "isValid", "isPresent", "contains", "matches"]) {
      add(name, "Prüfung", "return false;\${0}");
    }
  } else {
    for (const field of usable) {
      if (field.type !== returnType) continue;
      add(`get${capitalise(fieldBaseName(field))}`, `Getter für ${field.name}`, `return ${field.name};`);
    }
    for (const field of usable) {
      add(`get${capitalise(fieldBaseName(field))}`, `Getter für ${field.name}`, `return ${field.name};`);
    }
    const generic = ["get", "create", "build", "of", "from", "parse"];
    if (returnType === "String") generic.push("toString");
    for (const name of generic) {
      add(name, `${returnType} zurückgeben`, "return \${0};");
    }
  }
  const wanted = prefix.toLocaleLowerCase();
  return proposals
    .filter((proposal) => !wanted || proposal.name.toLocaleLowerCase().startsWith(wanted))
    .slice(0, 12);
}

export interface LocalCompletionContext {
  lineBeforeCursor: string;
  /** The line the caret sits on, so a member is not offered to itself. */
  line: number;
}

export interface LocalCompletion {
  label: string;
  insertText: string;
  detail: string;
  kind: "method" | "field";
}

/**
 * Completions for what this very file declares.
 *
 * The gap this fills is small and constant: between typing a method and the
 * language server having seen the file, its own class cannot complete its own
 * members. That window covers exactly the moment somebody writes
 * `public String name()` and then wants to call it.
 */
/**
 * What stands before the dot a member is being completed on.
 *
 * Answers null when the caret is not after a dot at all, the receiver's last
 * word when it is, and "" when something ended the receiver that is not a word
 * — a call, an index, a string, a closing bracket. The caller needs only to
 * know whether the receiver is this file's own class, so a name is enough and
 * anything else is deliberately not guessed at.
 *
 * A decimal number is not a member access: "1." is a literal being typed, and
 * offering members there would put a list over somebody's arithmetic.
 */
export function memberAccessReceiver(lineBeforeCursor: string): string | null {
  const text = String(lineBeforeCursor || "");
  // Whatever is being typed after the dot is not part of the receiver.
  const withoutPartialWord = text.replace(/[A-Za-z_$][\w$]*$/, "");
  const beforeDot = withoutPartialWord.replace(/\s*$/, "");
  if (!beforeDot.endsWith(".")) return null;
  let receiver = beforeDot.slice(0, -1).replace(/\s*$/, "");
  // "1." is a number being written, not a member being reached for.
  if (/(?:^|[^\w$.])\d+$/.test(receiver)) return null;
  if (receiver.endsWith(")")) {
    let depth = 0;
    let index = receiver.length - 1;
    while (index >= 0) {
      if (receiver[index] === ")") depth += 1;
      else if (receiver[index] === "(") {
        depth -= 1;
        if (depth === 0) {
          receiver = receiver.slice(0, index).replace(/\s*$/, "");
          break;
        }
      }
      index -= 1;
    }
  }
  const lastWord = receiver.match(/[A-Za-z_$][\w$]*$/);
  return lastWord ? lastWord[0] : "";
}

/**
 * The method the caret is inside.
 *
 * The last one declared at or before the caret's line: a method declared after
 * it cannot contain it, and one declared before it is only left behind by the
 * next declaration. Answers null above the first method — a field initialiser,
 * an import, the class header.
 */
export function enclosingMethodAt(
  members: JavaFileMembers,
  line: number,
): JavaMethodMember | null {
  const at = Number(line) || 0;
  if (!at) return null;
  let best: JavaMethodMember | null = null;
  for (const method of members.methods) {
    if (method.line > at) continue;
    if (!best || method.line > best.line) best = method;
  }
  return best;
}

export function localMemberCompletions(
  members: JavaFileMembers,
  context: LocalCompletionContext,
): LocalCompletion[] {
  const before = String(context.lineBeforeCursor || "");
  const member = memberAccessReceiver(before);
  // Whether an instance exists here at all.
  //
  // In a static method there is no `this`, so an instance member cannot be
  // reached — offering one proposes a line that does not compile, with the
  // error appearing on the word that was just accepted. `main` is the method
  // this happens in most, which is to say the first one anybody writes.
  const enclosing = enclosingMethodAt(members, context.line);
  const staticContext = Boolean(enclosing?.isStatic);
  // After a dot the receiver decides what exists, and this scan knows nothing
  // about it. Only `this` and `super` are this file's own members.
  //
  // The test used to be whether a plain name stood before the dot, so it saw
  // `player.` and stopped — but not `getPlayer().`, `list.get(0).`, `array[0].`
  // or `"text".`, and after each of those it offered the members of the class
  // being edited as though they belonged to the value in hand.
  if (member !== null && member !== "this" && member !== "super") return [];
  const receiver = member === null ? null : [member, member];
  // `this` and `super` do not exist in a static method, so nothing follows
  // that dot — not even the static members, which are reached by their own
  // name there.
  if (receiver && staticContext) return [];
  if (/\bnew\s+[\w$.]*$/.test(before)) return [];
  // Unqualified in a static method, only the static members are in reach.
  // Anywhere else both are: Java lets an instance method call a static one by
  // its bare name.
  const reachable = <T extends { isStatic: boolean }>(entries: T[]) =>
    (staticContext ? entries.filter((entry) => entry.isStatic) : entries);
  const completions: LocalCompletion[] = [];
  for (const method of reachable(members.methods)) {
    if (method.isConstructor || method.line === context.line) continue;
    completions.push({
      label: methodSignatureLabel(method),
      insertText: methodCallSnippet(method),
      detail: method.signature,
      kind: "method",
    });
  }
  if (receiver) return completions;
  for (const field of reachable(members.fields)) {
    if (field.line === context.line) continue;
    completions.push({
      label: field.name,
      insertText: field.name,
      detail: `${field.type} · ${field.owner || "Feld"}`,
      kind: "field",
    });
  }
  return completions;
}
