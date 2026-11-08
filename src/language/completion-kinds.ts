/**
 * The icon beside a proposal.
 *
 * Monaco and the language-server protocol both number completion kinds, and
 * they do not number them the same way: Monaco has no Text at the front and
 * puts Struct where the protocol puts Class. They were converted by subtracting
 * one, which happens to be right from Interface onward and wrong for
 * everything before it — so a local variable was drawn with a class icon, an
 * enum constant with a colour swatch, and a constant with a file icon.
 *
 * The mapping is written as Monaco's own names rather than as numbers, and
 * resolved against the enumeration Monaco actually ships. Numbers copied into
 * a table here would be a second place for them to drift apart.
 */

/** Language-server completion kind → the name of Monaco's matching kind. */
export const MONACO_COMPLETION_KIND_NAMES: Record<number, string> = {
  1: "Text",
  2: "Method",
  3: "Function",
  4: "Constructor",
  5: "Field",
  6: "Variable",
  7: "Class",
  8: "Interface",
  9: "Module",
  10: "Property",
  11: "Unit",
  12: "Value",
  13: "Enum",
  14: "Keyword",
  15: "Snippet",
  16: "Color",
  17: "File",
  18: "Reference",
  19: "Folder",
  20: "EnumMember",
  21: "Constant",
  22: "Struct",
  23: "Event",
  24: "Operator",
  25: "TypeParameter",
};

/**
 * What Monaco calls the kind a language server sent.
 *
 * Falls back to Property, which is what Monaco itself uses for a kind it does
 * not recognise — a wrong icon is a smaller mistake than no proposal.
 */
export function monacoCompletionKindName(lspKind: unknown): string {
  const kind = Number(lspKind);
  return MONACO_COMPLETION_KIND_NAMES[kind] || "Property";
}

/**
 * The kind itself, resolved against the enumeration passed in.
 *
 * Takes the enumeration rather than importing Monaco so this stays usable from
 * the parts of the language layer that must not depend on the editor.
 */
export function monacoCompletionKind(
  lspKind: unknown,
  kinds: Record<string, unknown>,
): number {
  const named = kinds?.[monacoCompletionKindName(lspKind)];
  if (typeof named === "number") return named;
  const property = kinds?.Property;
  return typeof property === "number" ? property : 9;
}

/**
 * Kinds that name something already in scope where the caret is.
 *
 * Reaching one costs nothing: no import, no qualification, and it was declared
 * within sight of the caret. Named rather than numbered for the same reason as
 * the table above.
 */
export const IN_SCOPE_KIND_NAMES = ["Variable", "Constant"];

/** Kinds that name a member of some type — near, but not as near. */
export const MEMBER_KIND_NAMES = ["Field", "Property", "Method", "EnumMember"];
