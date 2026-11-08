/**
 * Two types with one name.
 *
 * `List` is java.util.List and it is also java.awt.List, and a list offering
 * both showed them as two identical rows. Picking one added an import, and
 * which of the two you got depended on which row you happened to be on — a
 * choice that changes what every other line in the file refers to, made by
 * accident.
 *
 * So where a name means more than one type, the fully qualified form is
 * offered beside it as its own entry. It says which type outright, adds no
 * import, and leaves the rest of the file alone.
 */

export interface ImportCandidate {
  /** The simple name as it would be written, e.g. "List". */
  name: string;
  /** The whole name, e.g. "java.util.List". Empty when it cannot be read. */
  qualifiedName: string;
  /** Whether accepting it would add an import line. */
  addsImport: boolean;
}

/** The simple names in this list that stand for more than one type. */
export function conflictingNames(candidates: ImportCandidate[]): Set<string> {
  const byName = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.name || !candidate.qualifiedName) continue;
    const seen = byName.get(candidate.name) || new Set<string>();
    seen.add(candidate.qualifiedName);
    byName.set(candidate.name, seen);
  }
  const conflicting = new Set<string>();
  for (const [name, qualified] of byName) {
    if (qualified.size > 1) conflicting.add(name);
  }
  return conflicting;
}

/**
 * The whole name of the type a proposal stands for.
 *
 * The language server writes the package in the description beside the label,
 * and sometimes writes the whole name there instead. Both are accepted, and
 * anything else answers "" — a qualified alternative that cannot say what it
 * qualifies to would be worse than no alternative at all.
 */
export function qualifiedNameOf(name: string, description: string): string {
  const simple = String(name || "").trim().replace(/\(.*$/, "");
  const owner = String(description || "").trim();
  if (!simple || !owner) return "";
  // Not a package or a type name — JDT also writes signatures in here.
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(owner)) return "";
  if (owner === simple) return "";
  if (owner.endsWith(`.${simple}`)) return owner;
  return `${owner}.${simple}`;
}

export interface QualifiedAlternative<T> {
  /** The proposal it stands beside. */
  original: T;
  /** The whole name, which is what it inserts. */
  qualifiedName: string;
}

/**
 * A second entry for every proposal whose name is ambiguous here.
 *
 * Only for one that would add an import: a type the file already imports is
 * unambiguous by definition, and spelling it out would be noise.
 */
export function qualifiedAlternatives<T>(
  items: T[],
  describe: (item: T) => ImportCandidate,
): Array<QualifiedAlternative<T>> {
  const candidates = items.map((item) => describe(item));
  const conflicting = conflictingNames(candidates);
  if (!conflicting.size) return [];
  const alternatives: Array<QualifiedAlternative<T>> = [];
  items.forEach((item, index) => {
    const candidate = candidates[index];
    if (!conflicting.has(candidate.name)) return;
    if (!candidate.addsImport || !candidate.qualifiedName) return;
    alternatives.push({ original: item, qualifiedName: candidate.qualifiedName });
  });
  return alternatives;
}

/** What the alternative says about itself in the list. */
export const QUALIFIED_NOTE = "vollqualifiziert, ohne Import";
