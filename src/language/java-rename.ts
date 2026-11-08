/**
 * Guard rails for renaming Java elements.
 *
 * The language server happily produces an edit for a name that will not
 * compile, and Monaco's rename box accepts anything typed into it. A rename
 * that lands is expensive to undo — it touches every file that referenced the
 * old name — so the cheap checks belong in front of it, not after.
 */

/** Reserved words a Java identifier may never be. */
const reserved = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while",
  // Not reserved words, but a name no source file should carry.
  "true", "false", "null",
]);

export type RenameKind = "type" | "method" | "field" | "package" | "unknown";

export interface RenameConflict {
  severity: "error" | "warning";
  message: string;
}

/**
 * Checks a proposed name before the rename is sent anywhere.
 *
 * `siblingNames` are the names already in scope at the target — the files in
 * the directory for a type, the members of the class for a method or field.
 */
export function checkJavaRename(
  newName: string,
  options: { kind?: RenameKind; currentName?: string; siblingNames?: string[] } = {},
): RenameConflict[] {
  const { kind = "unknown", currentName = "", siblingNames = [] } = options;
  const name = String(newName || "").trim();
  const conflicts: RenameConflict[] = [];

  if (!name) {
    return [{ severity: "error", message: "Der neue Name darf nicht leer sein." }];
  }
  if (name === currentName) {
    return [{ severity: "error", message: "Der neue Name ist der alte." }];
  }

  const identifier = /^[A-Za-z_$][\w$]*$/;
  if (kind === "package") {
    const segments = name.split(".");
    if (!segments.every((segment) => identifier.test(segment))) {
      conflicts.push({ severity: "error", message: "Ein Paketname besteht aus gültigen Bezeichnern, getrennt durch Punkte." });
    }
    if (segments.some((segment) => reserved.has(segment))) {
      conflicts.push({ severity: "error", message: "Ein Paketsegment darf kein Java-Schlüsselwort sein." });
    }
  } else if (!identifier.test(name)) {
    conflicts.push({ severity: "error", message: `„${name}“ ist kein gültiger Java-Bezeichner.` });
  } else if (reserved.has(name)) {
    conflicts.push({ severity: "error", message: `„${name}“ ist ein Java-Schlüsselwort.` });
  }

  // A collision does not always break compilation — an overload is legal — so
  // the caller decides, but it must not happen unnoticed.
  const collides = siblingNames.some((sibling) => sibling === name);
  if (collides) {
    conflicts.push(kind === "type" || kind === "package"
      ? { severity: "error", message: `„${name}“ existiert an dieser Stelle bereits.` }
      : { severity: "warning", message: `„${name}“ gibt es hier schon — das ergibt eine Überladung oder eine Verdeckung.` });
  }

  // Conventions, reported so a rename does not quietly produce odd-looking code.
  if (conflicts.length === 0) {
    if (kind === "type" && !/^[A-Z]/.test(name)) {
      conflicts.push({ severity: "warning", message: "Typen beginnen üblicherweise mit einem Großbuchstaben." });
    }
    if ((kind === "method" || kind === "field") && /^[A-Z]/.test(name) && name !== name.toUpperCase()) {
      conflicts.push({ severity: "warning", message: "Methoden und Felder beginnen üblicherweise mit einem Kleinbuchstaben." });
    }
    if (kind === "package" && name !== name.toLowerCase()) {
      conflicts.push({ severity: "warning", message: "Paketnamen werden klein geschrieben." });
    }
  }

  return conflicts;
}

/** True when nothing blocks the rename; warnings alone do not. */
export function renameIsSafe(conflicts: RenameConflict[]): boolean {
  return !conflicts.some((conflict) => conflict.severity === "error");
}

/**
 * Describes what a workspace edit is about to do, for the confirmation step.
 *
 * A rename that also moves files is the one worth reading before it happens:
 * renaming a public type renames its file, and that is invisible in a plain
 * list of text edits.
 */
export function summarizeRenameEdit(edit: any): { files: number; renames: string[]; edits: number } {
  const changed = new Set<string>();
  const renames: string[] = [];
  let edits = 0;

  for (const [uri, changes] of Object.entries(edit?.changes || {})) {
    changed.add(uri);
    edits += Array.isArray(changes) ? changes.length : 0;
  }
  for (const change of edit?.documentChanges || []) {
    if (change?.textDocument?.uri && Array.isArray(change.edits)) {
      changed.add(change.textDocument.uri);
      edits += change.edits.length;
    }
    if (change?.kind === "rename" && change.oldUri && change.newUri) {
      const from = String(change.oldUri).split("/").pop() || change.oldUri;
      const to = String(change.newUri).split("/").pop() || change.newUri;
      renames.push(`${from} → ${to}`);
    }
  }
  return { files: changed.size, renames, edits };
}
