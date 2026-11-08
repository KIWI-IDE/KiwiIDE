/**
 * Templates a project brings with it.
 *
 * The built-in templates are the ones everybody writing Java wants. A project
 * has its own: the logger it uses, the assertion style its tests are written
 * in, the way it wraps a value. Those belong to the project rather than to the
 * machine, so they live in `.kiwi/templates.json` and travel with it.
 *
 * Everything here is deliberately forgiving about the file and unforgiving
 * about a single entry: one template with a typo in it must not take the other
 * nine with it, and it must not fail silently either — a template that is not
 * offered and says nothing about why looks like the feature is broken.
 */
import type { JavaTemplate } from "./completion-controller";
import type { ExpressionKind } from "./postfix-templates";

/** Where the expression goes in a postfix template, spelled as IntelliJ does. */
export const EXPRESSION_PLACEHOLDER = "$EXPR$";

export interface CustomTemplate extends JavaTemplate {
  /** Restricts a postfix template to expressions that look like this. */
  when?: ExpressionKind;
}

export interface TemplateFileReport {
  templates: CustomTemplate[];
  /** What could not be read, in German, naming the entry it came from. */
  problems: string[];
}

const KEY = /^[A-Za-z_$][\w$]*$/;
const KINDS: ExpressionKind[] = ["boolean", "iterable", "number", "string", "unknown"];

/**
 * Reads a templates file.
 *
 * Accepts both the documented shape (`{ "templates": [...] }`) and a bare
 * array, because the bare array is what people write.
 */
export function parseCustomTemplates(text: string): TemplateFileReport {
  const source = String(text ?? "").trim();
  if (!source) return { templates: [], problems: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { templates: [], problems: [`Die Datei ist kein gültiges JSON: ${(error as Error).message}`] };
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { templates?: unknown })?.templates)
      ? (parsed as { templates: unknown[] }).templates
      : null;
  if (!entries) {
    return { templates: [], problems: ['Erwartet wird ein Array oder ein Objekt mit dem Feld "templates".'] };
  }

  const templates: CustomTemplate[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const result = readTemplate(entry, index);
    if ("problem" in result) {
      problems.push(result.problem);
      return;
    }
    const identity = `${result.template.source}:${result.template.key.toLowerCase()}`;
    if (seen.has(identity)) {
      // Kept as it stands rather than replaced, so the list somebody is
      // looking at does not reorder itself while they fix the duplicate.
      problems.push(`"${result.template.key}" ist doppelt vergeben — nur der erste Eintrag wird verwendet.`);
      return;
    }
    seen.add(identity);
    templates.push(result.template);
  });
  return { templates, problems };
}

function readTemplate(entry: unknown, index: number): { template: CustomTemplate } | { problem: string } {
  const position = `Eintrag ${index + 1}`;
  if (!entry || typeof entry !== "object") return { problem: `${position}: kein Objekt.` };
  const raw = entry as Record<string, unknown>;

  const source = raw.source === "postfix" ? "postfix" : raw.source === "live" ? "live" : null;
  if (!source) return { problem: `${position}: "source" muss "live" oder "postfix" sein.` };

  // A postfix key is written with or without its dot; both mean the same one.
  const key = String(raw.key ?? "").trim().replace(/^\./, "");
  if (!key) return { problem: `${position}: "key" fehlt.` };
  if (!KEY.test(key)) {
    return { problem: `${position}: "${key}" ist kein gültiger Kürzel — erlaubt sind Buchstaben, Ziffern, _ und $.` };
  }

  const insertText = typeof raw.insertText === "string" ? raw.insertText : "";
  if (!insertText.trim()) return { problem: `"${key}": "insertText" fehlt.` };

  if (source === "postfix" && !insertText.includes(EXPRESSION_PLACEHOLDER)) {
    // Without the placeholder the insertion replaces the expression with text
    // that does not contain it — the template would delete what it was applied
    // to, which is worse than not being offered.
    return { problem: `"${key}": Postfix-Templates brauchen ${EXPRESSION_PLACEHOLDER} als Platzhalter für den Ausdruck.` };
  }

  const when = KINDS.includes(raw.when as ExpressionKind) ? (raw.when as ExpressionKind) : undefined;
  if (raw.when !== undefined && !when) {
    return { problem: `"${key}": "when" muss eines von ${KINDS.join(", ")} sein.` };
  }

  return {
    template: {
      key: source === "postfix" ? `.${key}` : key,
      label: String(raw.label ?? "").trim() || (source === "postfix" ? `.${key}` : key),
      detail: String(raw.detail ?? "").trim() || "Projekt-Template",
      insertText,
      source,
      ...(when ? { when } : {}),
    },
  };
}

/**
 * Puts the expression into a postfix template.
 *
 * Every occurrence is replaced, so a template may use the expression twice —
 * `$EXPR$ == null ? … : $EXPR$` is a reasonable thing to want.
 */
export function expandPostfixTemplate(insertText: string, expression: string): string {
  return String(insertText ?? "").split(EXPRESSION_PLACEHOLDER).join(String(expression ?? ""));
}

/**
 * The project's templates in front of the built-in ones.
 *
 * A project template with the same name replaces the built-in rather than
 * joining it: somebody who wrote their own `sout` wants theirs, and two
 * entries under one name is a list asking a question nobody meant to ask.
 */
export function mergeCustomTemplates<T extends { key: string; source: string }>(
  builtIn: T[],
  custom: T[],
): T[] {
  const replaced = new Set(custom.map((template) => templateIdentity(template)));
  return [...custom, ...builtIn.filter((template) => !replaced.has(templateIdentity(template)))];
}

function templateIdentity(template: { key: string; source: string }): string {
  return `${template.source}:${String(template.key).replace(/^\./, "").toLowerCase()}`;
}

/** The file a project keeps its templates in, relative to its root. */
export const TEMPLATE_FILE = ".kiwi/templates.json";

/**
 * Whether a path is this project's templates file.
 *
 * Compared without case and with either separator: the same file arrives from
 * the tree, from Monaco and from the workbench spelled three ways, and one of
 * those spells the Windows drive letter in lower case.
 */
export function isProjectTemplateFile(root: string, filePath: string): boolean {
  if (!root || !filePath) return false;
  const normalize = (value: string) => String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(filePath) === `${normalize(root)}/${TEMPLATE_FILE}`;
}

/** What is written into a project that has no templates file yet. */
export function templateFileExample(): string {
  return `${JSON.stringify({
    version: 1,
    templates: [
      {
        key: "logd",
        source: "live",
        detail: "Debug-Log",
        insertText: "log.debug(\"${1:Nachricht}\");${0}",
      },
      {
        key: "opt",
        source: "postfix",
        detail: "In ein Optional verpacken",
        insertText: `Optional.ofNullable(${EXPRESSION_PLACEHOLDER})`,
      },
    ],
  }, null, 2)}\n`;
}
