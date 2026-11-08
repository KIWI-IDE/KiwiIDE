import type { CustomTemplate } from "./custom-templates";

/**
 * Where a proposal came from, in one word.
 *
 * A list mixes four quite different things — the JDK, the project's own code,
 * a library it depends on, and text Kiwi made up — and they were all shown the
 * same way. Which one a name comes from is most of what decides whether it is
 * the one wanted, and it was left to be guessed from a package prefix in the
 * detail line.
 */
export type CompletionOrigin = "JDK" | "Projekt" | "Maven" | "Gradle" | "Bibliothek" | "lokal" | "Template" | "";

export interface OriginContext {
  /** "Maven", "Gradle" or anything else, from the project model. */
  projectType?: string;
  /** The package prefixes the project itself declares, e.g. ["dev.kiwi"]. */
  projectPackages?: string[];
  /** The Java release the project compiles for. */
  languageLevel?: number;
  /** Templates the project keeps in .kiwi/templates.json. */
  customTemplates?: CustomTemplate[];
}

/** Packages that ship with the platform rather than with anything. */
const JDK_PREFIXES = ["java.", "javax.", "jdk.", "sun.", "com.sun.", "org.w3c.", "org.xml."];

/**
 * Classifies one proposal.
 *
 * The qualified name is the evidence: everything else in a completion item is
 * free text that differs between server versions. Where there is none — a
 * template, a member read out of the buffer — the source says it instead.
 */
export function completionOrigin(
  item: { source?: string; qualifiedName?: string; detail?: string },
  context: OriginContext = {},
): CompletionOrigin {
  if (item.source === "postfix" || item.source === "template") return "Template";
  if (item.source === "live") return "lokal";
  const qualified = String(item.qualifiedName || "") || qualifiedNameFrom(String(item.detail || ""));
  // Nothing to read the origin from, so nothing is said about it. This used to
  // answer "Projekt", which put that label on `getClass()`, `equals(Object)`
  // and `containsKey(Object)` — the most used members in the language, none of
  // them anybody's project. A label is a claim, and a wrong one is worse than
  // an empty column.
  if (!qualified) return "";
  if (JDK_PREFIXES.some((prefix) => qualified.startsWith(prefix))) return "JDK";
  const own = (context.projectPackages || []).filter(Boolean);
  if (own.some((prefix) => qualified === prefix || qualified.startsWith(`${prefix}.`))) return "Projekt";
  // Not the platform and not this project, so it arrived with a dependency —
  // and the build tool is the honest name for where that came from.
  if (context.projectType === "Maven") return "Maven";
  if (context.projectType === "Gradle") return "Gradle";
  return "Bibliothek";
}

/** The last fully qualified type name in a detail line, if there is one. */
export function qualifiedNameFrom(detail: string): string {
  const matches = String(detail || "").match(/\b(?:[a-z_$][\w$]*\.)+[A-Za-z_$][\w$]*/g);
  return matches?.at(-1) || "";
}

export interface OverloadGroup<T> {
  /** The proposal shown for the group: the one the server ranked highest. */
  item: T;
  /** How many proposals share this name, the shown one included. */
  count: number;
  /** The ones folded away, in the order they arrived. */
  hidden: T[];
}

/**
 * Folds a method's overloads into one entry.
 *
 * Six entries reading `add` differing only in a parameter list is six lines of
 * a list spent on one decision, and it pushes everything else off the screen.
 * The first — which is the one the server ranked highest, since the list
 * arrives in its order — stands for the set, and the others are counted.
 *
 * Only methods, and only within one origin: `List.add` and `Set.add` are not
 * overloads of each other, and folding them together would hide a name rather
 * than tidy one.
 */
export function groupOverloads<T>(
  items: T[],
  describe: (item: T) => { name: string; owner: string; isMethod: boolean },
): OverloadGroup<T>[] {
  const groups: OverloadGroup<T>[] = [];
  const byKey = new Map<string, OverloadGroup<T>>();
  for (const item of items) {
    const { name, owner, isMethod } = describe(item);
    if (!isMethod || !name) {
      groups.push({ item, count: 1, hidden: [] });
      continue;
    }
    const key = `${owner}\u0000${name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.hidden.push(item);
      continue;
    }
    const group: OverloadGroup<T> = { item, count: 1, hidden: [] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
}

/**
 * What a folded group is labelled with.
 *
 * Says how many there are rather than which, because the parameter lists are
 * what the signature help shows once one is chosen.
 */
export function overloadLabel(count: number): string {
  if (count < 2) return "";
  return `${count} Überladungen`;
}

/**
 * The import a proposal would add, before it is accepted.
 *
 * Accepting a name can quietly add an import, and which one it adds is
 * occasionally the wrong one — two classes with the same name in different
 * packages is exactly when a list is being used to choose between them.
 */
export function importPreview(additionalTextEdits: Array<{ newText?: string }> | undefined): string[] {
  return (additionalTextEdits || [])
    .map((edit) => String(edit?.newText || "").match(/\bimport\s+(?:static\s+)?([^;]+);/)?.[1]?.trim() || "")
    .filter(Boolean);
}

/**
 * Whether two proposals would resolve to different types under one name.
 *
 * When they would, importing is a choice rather than a detail: the fully
 * qualified name is the other way to say which one was meant, and it is the
 * one that does not change what every other line of the file refers to.
 */
export function hasImportConflict(
  candidates: Array<{ name: string; qualifiedName: string }>,
): boolean {
  const byName = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.name || !candidate.qualifiedName) continue;
    const seen = byName.get(candidate.name) || new Set<string>();
    seen.add(candidate.qualifiedName);
    byName.set(candidate.name, seen);
  }
  return [...byName.values()].some((qualified) => qualified.size > 1);
}
