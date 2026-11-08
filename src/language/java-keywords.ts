/**
 * Java words which can be coloured independently.
 *
 * This includes reserved words as well as the contextual/module-system words
 * understood by current Java releases.  The setting id deliberately uses a
 * colon rather than a dot: older Kiwi settings used dots to scope colours to a
 * theme, and the settings migration correctly discards those retired keys.
 */
export const javaKeywordGroups = [
  {
    id: "declarations",
    label: "Deklarationen & Typen",
    words: [
      "class", "interface", "enum", "record", "extends", "implements", "permits",
      "package", "import", "new", "throws", "instanceof", "var", "goto", "const", "_",
    ],
    inherits: "keyword",
  },
  {
    id: "control",
    label: "Kontrollfluss",
    words: [
      "if", "else", "for", "while", "do", "switch", "case", "default", "break",
      "continue", "return", "try", "catch", "finally", "throw", "yield", "assert", "when",
    ],
    inherits: "controlKeyword",
  },
  {
    id: "modifiers",
    label: "Modifizierer",
    words: [
      "public", "protected", "private", "static", "final", "abstract", "native",
      "synchronized", "transient", "volatile", "strictfp", "sealed", "non-sealed",
    ],
    inherits: "modifier",
  },
  {
    id: "literals",
    label: "Literale & Referenzen",
    words: ["true", "false", "null", "this", "super"],
    inherits: "literal",
  },
  {
    id: "primitives",
    label: "Primitive Typen",
    words: ["boolean", "byte", "char", "short", "int", "long", "float", "double", "void"],
    inherits: "primitiveType",
  },
  {
    id: "modules",
    label: "Java-Module",
    words: ["module", "open", "opens", "exports", "requires", "transitive", "to", "uses", "provides", "with"],
    inherits: "keyword",
  },
] as const;

export type JavaKeyword = typeof javaKeywordGroups[number]["words"][number];
export type JavaKeywordTokenId = `javaKeyword:${JavaKeyword}`;

export const javaKeywords = javaKeywordGroups.flatMap((group) => [...group.words]) as JavaKeyword[];

export function javaKeywordTokenId(word: JavaKeyword): JavaKeywordTokenId {
  return `javaKeyword:${word}`;
}

export function isJavaKeywordTokenId(value: string): value is JavaKeywordTokenId {
  return value.startsWith("javaKeyword:")
    && javaKeywords.includes(value.slice("javaKeyword:".length) as JavaKeyword);
}

/** A Monarch scope safe for words such as `non-sealed` and `_`. */
export function javaKeywordScope(word: JavaKeyword): string {
  const suffix = word === "_" ? "underscore" : word.replace(/-/g, "_");
  return `keyword.java.${suffix}`;
}

