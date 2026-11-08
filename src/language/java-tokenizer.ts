import { taskMarkers } from "../utils";
import {
  javaKeywordGroups,
  javaKeywords,
  javaKeywordScope,
  type JavaKeyword,
} from "./java-keywords";

/**
 * A Java grammar for Monaco that separates far more than the stock one.
 *
 * Monaco's bundled Java tokenizer emits a single `keyword` and a single
 * `identifier`, so a theme cannot tell `if` from `public`, a class from a
 * local variable, or a Javadoc block from an ordinary comment — the editor
 * colour settings had nothing to attach to. This grammar splits those apart
 * lexically, which needs no language server and stays instant while typing.
 *
 * Java's naming conventions carry the rest: a name in UpperCamelCase is a
 * type, an ALL_CAPS name is a constant, a name directly before "(" is a call,
 * and a name after "." is a member. That is the same heuristic the JetBrains
 * editors fall back to before their index is warm.
 */

/**
 * Task markers, spelled so Monarch matches them in any casing.
 *
 * Monarch recompiles every rule regex with only the language-level flags, so a
 * per-rule `/…/i` is silently dropped — and turning on `ignoreCase` for the
 * whole language would make `Public` a keyword. Explicit character classes are
 * what actually survives compilation, and building them from `taskMarkers`
 * keeps the colouring on the same list the TODO tool window scans for.
 */
const taskMarkerPattern = taskMarkers
  .map((marker) => [...marker].map((character) => `[${character.toUpperCase()}${character.toLowerCase()}]`).join(""))
  .join("|");

/** Everything that steers control flow. */
const controlKeywords = [
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "try", "catch", "finally", "throw", "yield", "assert",
];

/** Everything that only qualifies a declaration. */
const modifierKeywords = [
  "public", "protected", "private", "static", "final", "abstract", "native",
  "synchronized", "transient", "volatile", "strictfp", "sealed", "non-sealed",
];

/** Declaration and structural keywords. */
const declarationKeywords = [
  "class", "interface", "enum", "record", "extends", "implements", "permits",
  "package", "import", "new", "throws", "instanceof", "var", "goto", "const",
];

/** Values that are keywords rather than identifiers. */
const literalKeywords = ["true", "false", "null", "this", "super"];

const primitiveTypes = [
  "boolean", "byte", "char", "short", "int", "long", "float", "double", "void",
];

const keywordTokenCases = Object.fromEntries(
  javaKeywords.map((word) => [word, javaKeywordScope(word)]),
);

/**
 * Classifies a bare word the way the tokenizer does.
 *
 * Exported because the conventions encoded here are worth testing directly;
 * the Monarch tables themselves only ever run inside Monaco.
 */
export function classifyJavaWord(word: string): string {
  // "default" belongs to control flow only: as a switch label it is what a
  // reader scans for, and the interface-method sense is far rarer.
  if (controlKeywords.includes(word)) return "keyword.control";
  if (modifierKeywords.includes(word)) return "keyword.modifier";
  if (declarationKeywords.includes(word)) return "keyword";
  if (literalKeywords.includes(word)) return "keyword.literal";
  if (primitiveTypes.includes(word)) return "keyword.primitive";
  const contextual = javaKeywordGroups.find((group) => (group.words as readonly string[]).includes(word));
  if (contextual?.inherits === "controlKeyword") return "keyword.control";
  if (contextual?.inherits === "modifier") return "keyword.modifier";
  if (contextual?.inherits === "literal") return "keyword.literal";
  if (contextual?.inherits === "primitiveType") return "keyword.primitive";
  if (contextual) return "keyword";
  if (/^[A-Z][A-Z0-9_]*$/.test(word) && word.length > 1) return "constant";
  if (/^[A-Z]/.test(word)) return "type.identifier";
  return "identifier";
}

/** Monarch language definition for Java, in Monaco's own shape. */
export function javaLanguageDefinition() {
  return {
    defaultToken: "",
    tokenPostfix: ".java",
    keywords: [
      ...controlKeywords,
      ...modifierKeywords,
      ...declarationKeywords,
      ...literalKeywords,
      ...primitiveTypes,
    ],
    controlKeywords,
    modifierKeywords,
    declarationKeywords,
    literalKeywords,
    primitiveTypes,
    keywordTokenCases,
    brackets: [
      { open: "{", close: "}", token: "delimiter.curly" },
      { open: "[", close: "]", token: "delimiter.square" },
      { open: "(", close: ")", token: "delimiter.parenthesis" },
    ],
    digits: /\d+(_+\d+)*/,
    escapes: /\\(?:[abfnrtv\\"'0]|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,
    tokenizer: {
      root: [
        { include: "@whitespace" },

        // Annotations, including their qualified form.
        [/@\s*[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*/, "annotation"],

        // A name directly in front of "(" is a call or a declaration; "new"
        // makes it a constructor and therefore a type.
        [/(new)(\s+)([a-zA-Z_$][\w$]*)/, [javaKeywordScope("new"), "", "type.identifier"]],
        [/[a-zA-Z_$][\w$]*(?=\s*\()/, {
          cases: {
            ...keywordTokenCases,
            "@controlKeywords": "keyword.control",
            "@modifierKeywords": "keyword.modifier",
            "@declarationKeywords": "keyword",
            "@literalKeywords": "keyword.literal",
            "@primitiveTypes": "keyword.primitive",
            "@default": "method",
          },
        }],

        // The target of a method reference is a method, not a field: without
        // this "String::valueOf" coloured valueOf like an ordinary name.
        [/(::)(\s*)(new)(?![\w$])/, ["operator", "", javaKeywordScope("new")]],
        [/(::)(\s*)([a-zA-Z_$][\w$]*)/, ["operator", "", "method"]],

        // A lowercase name right after "." is a field read; anything starting
        // uppercase is left to the convention rules further down.
        [/(\.)(\s*)([a-z_$][\w$]*)/, ["delimiter", "", "field"]],

        [/non-sealed(?![\w$-])/, javaKeywordScope("non-sealed")],
        // Keywords are all lowercase, so the two convention rules can go first
        // and the keyword table only has to decide the remaining words.
        [/[A-Z][A-Z0-9_]+(?![\w$])/, "constant"],
        [/[A-Z][\w$]*/, "type.identifier"],
        [/[a-zA-Z_$][\w$]*/, {
          cases: {
            ...keywordTokenCases,
            "@controlKeywords": "keyword.control",
            "@modifierKeywords": "keyword.modifier",
            "@declarationKeywords": "keyword",
            "@literalKeywords": "keyword.literal",
            "@primitiveTypes": "keyword.primitive",
            "@default": "identifier",
          },
        }],

        [/[{}()[\]]/, "@brackets"],
        [/[;,.]/, "delimiter"],
        [/[=+\-*/%!&|^~?:<>]+/, "operator"],

        // Numbers before the "." delimiter so 3.14 stays one token.
        [/(@digits)[eE]([-+]?(@digits))?[fFdD]?/, "number.float"],
        [/(@digits)\.(@digits)([eE][-+]?(@digits))?[fFdD]?/, "number.float"],
        [/0[xX][0-9a-fA-F]+(_+[0-9a-fA-F]+)*[lL]?/, "number.hex"],
        [/0[bB][01]+(_+[01]+)*[lL]?/, "number.binary"],
        [/0[0-7]+(_+[0-7]+)*[lL]?/, "number.octal"],
        [/(@digits)[fFdDlL]?/, "number"],

        [/"""/, "string", "@textblock"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string"],
        [/'[^\\']'/, "string"],
        [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
        [/'/, "string.invalid"],
      ],

      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*\*(?!\/)/, "comment.doc", "@javadoc"],
        [/\/\*/, "comment", "@comment"],
        // TODO and friends get their own token so they stand out in the file
        // the same way they do in the TODO tool window.
        [new RegExp(`//[^\\n]*\\b(?:${taskMarkerPattern})\\b[^\\n]*`), "comment.task"],
        // A region marker structures the file rather than commenting on it,
        // so it is read before the ordinary comment rule and carries its own
        // token instead of disappearing into the muted comment colour.
        [/\/\/\s*#?(?:end)?region\b[^\n]*/i, "comment.region"],
        [/\/\/[^\n]*/, "comment"],
      ],

      comment: [
        [new RegExp(`[^/*]*\\b(?:${taskMarkerPattern})\\b[^/*]*`), "comment.task"],
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],

      javadoc: [
        [/@[a-zA-Z]+/, "comment.doc.tag"],
        [/[^/*@]+/, "comment.doc"],
        [/\*\//, "comment.doc", "@pop"],
        [/[/*@]/, "comment.doc"],
      ],

      string: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],

      textblock: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/"""/, "string", "@pop"],
        [/"/, "string"],
      ],
    },
  };
}

/** Exposed for settings/tests without duplicating the Java vocabulary. */
export { javaKeywordGroups, javaKeywords, javaKeywordScope };
export type { JavaKeyword };
