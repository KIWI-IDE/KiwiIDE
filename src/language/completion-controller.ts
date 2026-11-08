import {
  IN_SCOPE_KIND_NAMES,
  MEMBER_KIND_NAMES,
  monacoCompletionKindName,
} from "./completion-kinds";
import {
  candidateTypeOf,
  typeAffinity,
  type ExpectedType,
} from "./expected-type";
import {
  expandPostfixTemplate,
  mergeCustomTemplates,
  type CustomTemplate,
} from "./custom-templates";
import {
  expressionKind,
  postfixTargetAt,
  templateFitsExpression,
  templateFitsLanguageLevel,
  withoutServerDuplicates,
  type ExpressionKind,
} from "./postfix-templates";
export type CompletionIntent = "basic" | "broaden" | "smart";

export interface RankedCompletion {
  label: string | { label: string; detail?: string; description?: string };
  insertText?: string;
  filterText?: string;
  sortText?: string;
  detail?: string;
  kind?: number;
  tags?: number[];
  source?: "jdt" | "live" | "postfix";
  expectedType?: string;
  usageScore?: number;
  [key: string]: unknown;
}

export interface JavaTemplate {
  key: string;
  label: string;
  detail: string;
  insertText: string;
  source: "live" | "postfix";
  expression?: string;
  typedSuffix?: string;
}

const liveTemplates: JavaTemplate[] = [
  { key: "psvm", label: "psvm", detail: "public static void main", insertText: "public static void main(String[] args) {\n\t${0}\n}", source: "live" },
  { key: "sout", label: "sout", detail: "System.out.println", insertText: "System.out.println(${1});${0}", source: "live" },
  { key: "souf", label: "souf", detail: "System.out.printf", insertText: "System.out.printf(\"${1}\", ${2});${0}", source: "live" },
  { key: "iter", label: "iter", detail: "Enhanced for loop", insertText: "for (${1:var} ${2:item} : ${3:items}) {\n\t${0}\n}", source: "live" },
  { key: "fori", label: "fori", detail: "Indexierter for loop", insertText: "for (int ${1:i} = 0; ${1:i} < ${2:size}; ${1:i}++) {\n\t${0}\n}", source: "live" },
  { key: "ifn", label: "ifn", detail: "Null-Prüfung", insertText: "if (${1:value} == null) {\n\t${0}\n}", source: "live" },
  { key: "inn", label: "inn", detail: "Not-null-Prüfung", insertText: "if (${1:value} != null) {\n\t${0}\n}", source: "live" },
  { key: "try", label: "try", detail: "try/catch", insertText: "try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${0}\n}", source: "live" },
  { key: "switch", label: "switch", detail: "Switch expression", insertText: "switch (${1:value}) {\n\tcase ${2:value} -> ${3};\n\tdefault -> ${0};\n}", source: "live" },
];

const postfixBodies: Record<string, (expression: string) => string> = {
  if: (expression) => `if (\${1:${expression}}) {\n\t\${0}\n}`,
  not: (expression) => `!\${1:${expression}}`,
  null: (expression) => `if (\${1:${expression}} == null) {\n\t\${0}\n}`,
  nn: (expression) => `if (\${1:${expression}} != null) {\n\t\${0}\n}`,
  for: (expression) => `for (var \${1:item} : \${2:${expression}}) {\n\t\${0}\n}`,
  sout: (expression) => `System.out.println(\${1:${expression}});\${0}`,
  return: (expression) => `return \${1:${expression}};\${0}`,
  try: (expression) => `try {\n\t\${1:${expression}};\n} catch (\${2:Exception} \${3:e}) {\n\t\${0}\n}`,
};

export interface TemplateContext {
  /** The Java release the project compiles for, so unusable syntax is not offered. */
  languageLevel?: number;
  /** Labels the language server already proposed, so nothing is said twice. */
  serverLabels?: Iterable<string>;
  /** What the open project keeps in `.kiwi/templates.json`. */
  customTemplates?: CustomTemplate[];
}

export function javaTemplates(
  textBeforeCursor: string,
  context: TemplateContext = {},
): JavaTemplate[] {
  const level = context.languageLevel ?? 21;
  const custom = context.customTemplates || [];
  const usable = (templates: JavaTemplate[]) => withoutServerDuplicates(
    templates.filter((template) => templateFitsLanguageLevel(template.insertText, level)),
    context.serverLabels || [],
    (template) => template.label,
  );

  const target = postfixTargetAt(textBeforeCursor);
  if (!target) {
    return usable(mergeCustomTemplates(
      liveTemplates,
      custom.filter((template) => template.source === "live"),
    ));
  }
  const { expression, typed } = target;
  // What the expression looks like it evaluates to. A template that cannot
  // apply is not offered: ".if" over a list produces a line that does not
  // compile, proposed at exactly the moment somebody is not reading closely.
  const kind = expressionKind(expression);
  const suffix = `Postfix template · ${expression.replace(/\s+/g, " ")}`;
  // A built-in knows which expressions it applies to; a project template says
  // so itself, and is offered everywhere when it does not.
  const builtIn: JavaTemplate[] = Object.entries(postfixBodies)
    .filter(([key]) => templateFitsExpression(key, kind))
    .map(([key, body]) => ({
      key: `.${key}`,
      label: `.${key}`,
      detail: suffix,
      insertText: body(expression),
      source: "postfix" as const,
    }));
  const projectPostfix: JavaTemplate[] = custom
    .filter((template) => template.source === "postfix")
    .filter((template) => customFitsExpression(template, kind))
    .map((template) => ({
      key: template.key,
      label: template.label,
      detail: template.detail,
      insertText: expandPostfixTemplate(template.insertText, expression),
      source: "postfix" as const,
    }));

  return usable(mergeCustomTemplates(builtIn, projectPostfix)
    .filter((template) => template.key.slice(1).toLowerCase().startsWith(typed.toLowerCase()))
    .map((template) => ({ ...template, expression, typedSuffix: typed })));
}

/**
 * Whether a project's postfix template applies here.
 *
 * A template that did not say which expressions it is for is offered for all
 * of them, and one that did is still offered when Kiwi cannot tell what the
 * expression is — the same bias the built-ins have, because hiding a template
 * somebody wrote themselves is the more confusing mistake.
 */
function customFitsExpression(template: CustomTemplate, kind: ExpressionKind): boolean {
  if (!template.when || kind === "unknown") return true;
  return template.when === kind;
}

/**
 * Type-appropriate placeholder for a generated method argument.
 *
 * JDT fills arguments it cannot guess with `null`, which does not compile for
 * primitives and is rarely what you want for a String. Returns null when the
 * type has no better default than JDT's own.
 */
export function javaArgumentDefault(type: string): string | null {
  const bare = String(type || "").trim().replace(/<.*>$/, "").split(".").at(-1) || "";
  if (/\[\]$/.test(bare)) return null;
  const defaults: Record<string, string> = {
    byte: "0", short: "0", int: "0", long: "0L",
    float: "0.0f", double: "0.0", boolean: "false", char: "' '",
    Byte: "0", Short: "0", Integer: "0", Long: "0L",
    Float: "0.0f", Double: "0.0", Boolean: "false", Character: "' '",
    String: '""', CharSequence: '""',
  };
  return defaults[bare] ?? null;
}

/**
 * Replaces `null` argument placeholders in a completion snippet with values
 * derived from the signature, so `setCount(${1:null})` becomes `setCount(${1:0})`.
 * Snippet placeholder numbering is preserved.
 */
export function improveArgumentDefaults(insertText: string, signature: string): string {
  const parameters = signature.match(/\(([^)]*)\)/)?.[1];
  if (!insertText || !parameters?.trim()) return insertText;
  const types = parameters
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] || "")
    .filter(Boolean);
  if (!types.length) return insertText;
  let index = -1;
  return insertText.replace(/\$\{(\d+):([^}]*)\}/g, (whole, slot, value) => {
    index += 1;
    if (String(value).trim() !== "null") return whole;
    const replacement = javaArgumentDefault(types[index] || "");
    return replacement ? `\${${slot}:${replacement}}` : whole;
  });
}

export function completionLabel(item: RankedCompletion) {
  return typeof item.label === "string" ? item.label : item.label.label;
}

export function camelHumpScore(label: string, query: string) {
  if (!query) return 40;
  const candidate = label.toLowerCase();
  const needle = query.toLowerCase();
  if (candidate === needle) return 0;
  if (candidate.startsWith(needle)) return 5 + Math.min(20, label.length - query.length);
  const capitals = label.replace(/[^A-Z0-9]/g, "").toLowerCase();
  if (capitals.startsWith(needle)) return 28 + Math.min(20, capitals.length - needle.length);
  let cursor = 0;
  for (const character of candidate) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return 55 + Math.min(30, label.length - query.length);
  }
  return 250;
}

/**
 * What is expected here, however the caller knows it.
 *
 * A plain type name from a caller that has only that, or a reading that says
 * where it came from and how sure it is. A bare string is trusted fully, which
 * is what every existing caller meant by passing one.
 */
export type ExpectedTypeHint = string | ExpectedType | null;

function asExpectedType(hint: ExpectedTypeHint): ExpectedType | null {
  if (!hint) return null;
  if (typeof hint === "string") {
    return hint.trim() ? { type: hint, source: "declaration", confidence: 1 } : null;
  }
  return hint.type ? hint : null;
}

/** What a perfect type match is worth, in score points. */
const TYPE_MATCH_WEIGHT = 70;

export function completionScore(
  item: RankedCompletion,
  query: string,
  intent: CompletionIntent,
  expectedType: ExpectedTypeHint = "",
) {
  const label = completionLabel(item);
  let score = camelHumpScore(item.filterText || label, query);
  // Semantic JDT proposals must stay ahead of generic templates, especially
  // directly after a member-access dot such as `person.` or `SomeType.`.
  if (item.source === "jdt") score -= 24;
  if (item.source === "postfix") score -= 5;
  if (item.source === "live") score -= 3;
  if (item.tags?.includes(1)) score += 80;
  score -= Math.min(48, Math.max(0, Number(item.usageScore || 0)) * 6);
  score += localityPenalty(item);
  const expected = intent === "smart" ? asExpectedType(expectedType) : null;
  if (expected) {
    // How well the candidate fits, weighted by how sure the reading of what is
    // expected was. An item whose own type cannot be read scores zero and is
    // left exactly where the server put it — the previous rule penalised every
    // such item by a flat amount, which at a return statement was every item in
    // the list, and pushing a correct answer down is how it disappears.
    const candidate = candidateTypeOf(item);
    // An argument position with several applicable overloads expects any of
    // their parameter types, and fitting the second is as right as the first.
    const affinity = Math.max(...[expected.type, ...(expected.alternatives || [])]
      .map((wanted) => typeAffinity(wanted, candidate)));
    score -= affinity * TYPE_MATCH_WEIGHT * expected.confidence;
  }
  if (intent === "broaden") score = Math.min(score, 90);
  return score;
}

/**
 * What reaching a name costs beyond typing it.
 *
 * Three things a list never accounted for, all of them small on their own:
 * something already in scope is nearer than something that has to be imported,
 * a name that would add an import costs a line at the top of the file, and a
 * proposal the server marked as barely relevant is one it does not believe in
 * either. None of them outweighs the prefix or the type; together they settle
 * the ties those leave.
 */
export function localityPenalty(item: RankedCompletion): number {
  if (item.source === "live" || item.source === "postfix") return 0;
  let penalty = 0;
  // An import is a line somebody else has to read, and a name that needs none
  // is one this file already uses.
  if (Array.isArray(item.additionalTextEdits) && item.additionalTextEdits.length) penalty += 6;
  const kind = lspKindOf(item);
  // A proposal whose kind cannot be read is left alone rather than guessed at.
  if (kind === undefined) return penalty;
  // What is already in scope first, then a member of some type, then the rest.
  const name = monacoCompletionKindName(kind);
  if (IN_SCOPE_KIND_NAMES.includes(name)) penalty -= 8;
  else if (MEMBER_KIND_NAMES.includes(name)) penalty -= 4;
  return penalty;
}

/**
 * The protocol kind of a proposal.
 *
 * By the time the list is ranked the items carry Monaco's numbering, which is
 * not the protocol's; `_lsp` is the answer as it arrived and is the one to
 * read. Undefined when there is none, which the caller treats as not knowing
 * rather than as a kind.
 */
function lspKindOf(item: RankedCompletion): number | undefined {
  const original = (item as { _lsp?: { kind?: unknown } })._lsp;
  const kind = Number(original?.kind ?? item.lspKind);
  return Number.isFinite(kind) && kind > 0 ? kind : undefined;
}


export function dedupeAndRankCompletions(
  items: RankedCompletion[],
  query: string,
  intent: CompletionIntent,
  expectedType: ExpectedTypeHint = "",
) {
  const unique = new Map<string, RankedCompletion>();
  for (const item of items) {
    const label = completionLabel(item);
    const signature = `${label}\u0000${item.insertText || label}\u0000${item.detail || ""}`;
    const current = unique.get(signature);
    if (!current || (current.source !== "jdt" && item.source === "jdt")) unique.set(signature, item);
  }
  return rankAgainstServerOrder([...unique.values()], query, intent, expectedType);
}

/**
 * How far Kiwi may move a proposal from where the server put it.
 *
 * The language server has resolved the expression, knows the expected type,
 * the receiver, the visibility and the imports, and it orders its answer
 * accordingly. What is known here is narrower: how well the typed prefix
 * matches, what has been chosen before, and whether the detail line mentions
 * the type being assigned to.
 *
 * So its order is the ground and this is an adjustment on top — enough to lift
 * something the server ranked twentieth into view when the prefix plainly
 * matches it, not enough to bury what it put first.
 */
export const MAX_RANK_SHIFT = 8;

/** What one point of Kiwi's score is worth in places. */
const POINTS_PER_PLACE = 12;

/**
 * Orders the list, keeping the server's ranking underneath.
 *
 * Kiwi's score used to be the whole sort key, with the server's relevance kept
 * only as a tie-breaker — so a heuristic built from a prefix and a detail
 * string decided the order of an answer that had been resolved properly. Now
 * the server's own order is the starting position and the score moves an entry
 * a bounded number of places from it.
 *
 * Proposals that did not come from the server — templates and what was read
 * out of the buffer — have no place in its order, so they start after the
 * server's and are moved by the same rule.
 */
export function rankAgainstServerOrder(
  items: RankedCompletion[],
  query: string,
  intent: CompletionIntent,
  expectedType: ExpectedTypeHint = "",
) {
  const scores = new Map<RankedCompletion, number>(
    items.map((item) => [item, completionScore(item, query, intent, expectedType)]),
  );
  // Only a proposal the server actually ranked has a place in its order. One
  // without a sortText — a template, something read from the buffer, or a
  // server that sent none — has no such place, and treating the order it
  // happened to arrive in as a ranking would be inventing one.
  const ranked = items.filter((item) => item.source === "jdt" && item.sortText);
  const serverOrder = new Map<RankedCompletion, number>();
  [...ranked]
    .sort((left, right) => String(left.sortText).localeCompare(String(right.sortText)))
    .forEach((item, index) => serverOrder.set(item, index));

  // Everything the server did not rank is ordered by what is known here, and
  // sits behind what it did rank.
  const unranked = items.filter((item) => !serverOrder.has(item));
  const ownOrder = new Map<RankedCompletion, number>();
  [...unranked]
    .sort((left, right) => (scores.get(left) as number) - (scores.get(right) as number))
    .forEach((item, index) => ownOrder.set(item, ranked.length + index));

  const placed = items.map((item, index) => {
    const base = serverOrder.has(item)
      ? serverOrder.get(item) as number
      : ownOrder.get(item) as number;
    const score = scores.get(item) as number;
    // A lower score is a better match, so it lifts an entry toward the front.
    const shift = Math.max(-MAX_RANK_SHIFT, Math.min(MAX_RANK_SHIFT, -score / POINTS_PER_PLACE));
    return { item, index, rank: base - shift };
  });

  return placed
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }, position) => ({
      ...item,
      // Monaco sorts by this string, so the position has to survive as one.
      sortText: String(position).padStart(5, "0"),
    }));
}



export function expectedTypeFromSignature(signatureHelp: any) {
  return parameterTypesFromSignature(signatureHelp)[0] || "";
}

/**
 * The types every applicable overload wants at the position being typed.
 *
 * Only the chosen overload used to be read, so at `format(` — where the server
 * offers `format(String, Object...)` and `format(Locale, String, Object...)` —
 * a Locale was ranked as though it did not belong. The one the server put
 * first stays first here; the rest follow it.
 */
export function parameterTypesFromSignature(signatureHelp: any): string[] {
  const signatures: any[] = Array.isArray(signatureHelp?.signatures) ? signatureHelp.signatures : [];
  if (!signatures.length) return [];
  const active = Number(signatureHelp.activeSignature) || 0;
  // The chosen overload first, because it is the server's own answer.
  const ordered = [signatures[active], ...signatures.filter((_, index) => index !== active)]
    .filter(Boolean);
  const types: string[] = [];
  for (const signature of ordered) {
    const index = Number(signature?.activeParameter ?? signatureHelp.activeParameter) || 0;
    const parameter = signature?.parameters?.[index];
    if (!parameter) continue;
    const label = Array.isArray(parameter.label)
      ? String(signature?.label || "").slice(parameter.label[0], parameter.label[1])
      : String(parameter.label || "");
    const type = label
      .replace(/\bfinal\s+/g, "")
      .replace(/\s+[A-Za-z_$][\w$]*\s*$/, "")
      .trim();
    if (type && !types.includes(type)) types.push(type);
  }
  return types;
}

export class CompletionRequestGate {
  private sequence = 0;
  private lastBasicAt = 0;
  private intent: CompletionIntent = "basic";

  setIntent(intent: CompletionIntent) {
    if (intent === "basic") {
      const now = Date.now();
      this.intent = now - this.lastBasicAt < 1200 ? "broaden" : "basic";
      this.lastBasicAt = now;
    } else {
      this.intent = intent;
    }
    return this.intent;
  }

  begin() {
    return { id: ++this.sequence, intent: this.intent };
  }

  isCurrent(id: number) {
    return id === this.sequence;
  }
}
