export type JavaGenerationKind =
  | "constructor" | "accessors" | "getters" | "setters" | "equalsHashCode" | "toString";

export type JavaField = { name: string; type: string; isFinal: boolean };

export interface JavaGenerationOptions {
  /** Field names to generate for. Omitted or empty means every field. */
  fields?: string[];
}

/**
 * Narrows the parsed fields to the requested selection, keeping declaration
 * order so generated members follow the class layout.
 */
/**
 * No selection means every field; a selection is a filter, even an empty one.
 *
 * An empty list used to mean "everything" as well, which made "generate a
 * constructor over no fields" impossible to express.
 */
function selectFields(fields: JavaField[], selection?: string[]): JavaField[] {
  if (!selection) return fields;
  const wanted = new Set(selection);
  return fields.filter((field) => wanted.has(field.name));
}

export function generateJavaMembers(
  source: string,
  kind: JavaGenerationKind,
  options: JavaGenerationOptions = {},
) {
  const className = source.match(/\b(?:class|record)\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!className) throw new Error("In der aktuellen Datei wurde keine Klasse gefunden.");
  const allFields = parseJavaFields(source);
  // A constructor is the one member worth having without any field: frameworks,
  // serialization and JPA all want a parameterless one, and a class that has no
  // fields at all could not get a constructor generated any other way.
  const allowsNoFields = kind === "constructor";
  // Deliberately empty: either the class has no fields, or the caller passed an
  // empty selection. A selection that names only unknown fields is neither —
  // that stays an error, or a stale name would quietly change what is written.
  const noneWanted = allFields.length === 0 || options.fields?.length === 0;
  if (!allFields.length && !allowsNoFields) throw new Error("Die Klasse besitzt keine geeigneten Instanzfelder.");
  const fields = selectFields(allFields, options.fields);
  if (!fields.length && !(allowsNoFields && noneWanted)) throw new Error("Es wurde kein Feld ausgewählt.");
  const members = kind === "constructor"
    ? constructorMember(className, fields, source)
    : kind === "accessors"
      ? accessorMembers(fields, source, "both")
      : kind === "getters"
        ? accessorMembers(fields, source, "getters")
        : kind === "setters"
          ? accessorMembers(fields, source, "setters")
          : kind === "equalsHashCode"
            ? equalsHashCodeMembers(className, fields, source)
            : toStringMember(className, fields, source);
  if (!members.length) throw new Error("Die ausgewählten Member sind bereits vorhanden.");
  const closingBrace = source.lastIndexOf("}");
  if (closingBrace < 0) throw new Error("Der Klassenrumpf ist unvollständig.");
  const prefix = source.slice(0, closingBrace).trimEnd();
  return `${prefix}\n\n${members.join("\n\n")}\n${source.slice(closingBrace)}`;
}

export function parseJavaFields(source: string): JavaField[] {
  const fields: JavaField[] = [];
  const pattern = /^\s*(?:private|protected|public)\s+(?!static\b)(final\s+)?([A-Za-z_$][\w$<>, ?.[\]]*)\s+([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/gm;
  let match;
  while ((match = pattern.exec(source))) {
    fields.push({ name: match[3], type: match[2].trim(), isFinal: Boolean(match[1]) });
  }
  return fields;
}

function constructorMember(className: string, fields: JavaField[], source: string) {
  const body = source.replace(new RegExp(`\\b(?:class|record)\\s+${escapeRegExp(className)}\\b[^\\{]*`), "");
  // Without fields only an existing parameterless constructor is in the way — a
  // class that already takes arguments is exactly where a no-arg one usually
  // gets added. With fields the broader check stays, because a second
  // all-field constructor would not compile.
  const clash = fields.length
    ? new RegExp(`\\b${escapeRegExp(className)}\\s*\\(`)
    : new RegExp(`\\b${escapeRegExp(className)}\\s*\\(\\s*\\)`);
  if (clash.test(body)) return [];
  if (!fields.length) return [`    public ${className}() {\n    }`];
  const parameters = fields.map((field) => `${field.type} ${field.name}`).join(", ");
  const assignments = fields.map((field) => `        this.${field.name} = ${field.name};`).join("\n");
  return [`    public ${className}(${parameters}) {\n${assignments}\n    }`];
}

function accessorMembers(fields: JavaField[], source: string, mode: "both" | "getters" | "setters") {
  const result: string[] = [];
  for (const field of fields) {
    const suffix = `${field.name[0].toUpperCase()}${field.name.slice(1)}`;
    if (mode !== "setters") {
      const getter = field.type === "boolean" ? `is${suffix}` : `get${suffix}`;
      if (!new RegExp(`\\b${escapeRegExp(getter)}\\s*\\(`).test(source)) {
        result.push(`    public ${field.type} ${getter}() {\n        return ${field.name};\n    }`);
      }
    }
    if (mode !== "getters") {
      const setter = `set${suffix}`;
      // A final field cannot be reassigned, so it never gets a setter.
      if (!field.isFinal && !new RegExp(`\\b${escapeRegExp(setter)}\\s*\\(`).test(source)) {
        result.push(`    public void ${setter}(${field.type} ${field.name}) {\n        this.${field.name} = ${field.name};\n    }`);
      }
    }
  }
  return result;
}

function equalsHashCodeMembers(className: string, fields: JavaField[], source: string) {
  const result: string[] = [];
  if (!/\bboolean\s+equals\s*\(\s*(?:java\.lang\.)?Object\b/.test(source)) {
    const comparisons = fields.map((field) =>
      primitiveTypes.has(field.type)
        ? `${field.name} == other.${field.name}`
        : `java.util.Objects.equals(${field.name}, other.${field.name})`,
    ).join("\n            && ");
    result.push(
      `    @Override\n    public boolean equals(Object value) {\n`
      + `        if (this == value) return true;\n`
      + `        if (value == null || getClass() != value.getClass()) return false;\n`
      + `        ${className} other = (${className}) value;\n`
      + `        return ${comparisons};\n`
      + "    }",
    );
  }
  if (!/\bint\s+hashCode\s*\(\s*\)/.test(source)) {
    result.push(
      `    @Override\n    public int hashCode() {\n`
      + `        return java.util.Objects.hash(${fields.map((field) => field.name).join(", ")});\n`
      + "    }",
    );
  }
  return result;
}

function toStringMember(className: string, fields: JavaField[], source: string) {
  if (/\bString\s+toString\s*\(\s*\)/.test(source)) return [];
  const expression = fields.map((field, index) =>
    `${index ? "\", " : "\""}${field.name}=" + ${field.name}`,
  ).join(" + ");
  return [
    `    @Override\n    public String toString() {\n`
    + `        return "${className}{" + ${expression} + '}';\n`
    + "    }",
  ];
}

const primitiveTypes = new Set(["byte", "short", "int", "long", "float", "double", "boolean", "char"]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
