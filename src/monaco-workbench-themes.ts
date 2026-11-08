/**
 * A Kiwi theme, told to Monaco.
 *
 * Monaco keeps its own registry of themes and its own vocabulary for them, so
 * every Kiwi theme has to be defined into it once and redefined whenever the
 * colours change. What it produces is entirely determined by what it is
 * handed, which is what makes it worth reading on its own.
 */
import type * as Monaco from "monaco-editor";
import { javaKeywordScope, javaKeywords } from "./language/java-keywords";
import { monacoThemeId, resolveTokenColors, resolveWorkbenchColors, themes } from "./themes";
import { translucent } from "./utils";

export function defineMonacoThemes(
  monaco: typeof import("monaco-editor"),
  wallpaper: boolean,
  tokenOverrides: Record<string, string> = {},
  colorScheme = "theme",
  surfaceOverrides: Record<string, string> = {},
) {
  const clear = wallpaper ? "#00000000" : undefined;
  for (const theme of themes) {
    const token = resolveTokenColors(theme, tokenOverrides, colorScheme);
    const surface = resolveWorkbenchColors(theme, surfaceOverrides);
    const picked = (id: keyof typeof surface, fallback: string) => surfaceOverrides[id] ? `#${surface[id]}` : fallback;
    monaco.editor.defineTheme(monacoThemeId(theme.id), {
      base: theme.base,
      inherit: true,
      // Monaco resolves a token against the longest matching rule, so the
      // specific scopes below win over their more general prefixes.
      rules: [
        { token: "keyword", foreground: token.keyword, fontStyle: "bold" },
        { token: "keyword.control", foreground: token.controlKeyword, fontStyle: "bold" },
        { token: "keyword.modifier", foreground: token.modifier, fontStyle: "bold" },
        { token: "keyword.literal", foreground: token.literal, fontStyle: "bold" },
        { token: "keyword.primitive", foreground: token.primitiveType, fontStyle: "bold" },
        ...javaKeywords.map((word) => ({
          token: javaKeywordScope(word),
          foreground: token[`javaKeyword:${word}`],
          fontStyle: "bold",
        })),
        { token: "annotation", foreground: token.annotation },
        { token: "type", foreground: token.type },
        { token: "type.identifier", foreground: token.type },
        { token: "method", foreground: token.method },
        { token: "field", foreground: token.field },
        { token: "constant", foreground: token.constant },
        { token: "identifier", foreground: token.identifier },
        { token: "string", foreground: token.string },
        { token: "string.escape", foreground: token.escape },
        { token: "string.invalid", foreground: token.error, fontStyle: "underline" },
        { token: "string.escape.invalid", foreground: token.error, fontStyle: "underline" },
        { token: "number", foreground: token.number },
        { token: "operator", foreground: token.operator },
        { token: "delimiter", foreground: token.bracket },
        { token: "comment", foreground: token.comment, fontStyle: "italic" },
        { token: "comment.task", foreground: token.taskComment, fontStyle: "italic bold" },
        { token: "comment.region", foreground: token.region, fontStyle: "bold" },
        { token: "comment.doc", foreground: token.javadoc, fontStyle: "italic" },
        { token: "comment.doc.tag", foreground: token.javadocTag, fontStyle: "italic bold" },
        { token: "invalid", foreground: token.error, fontStyle: "underline" },

        // Semantic tokens from JDT LS. Monaco matches them by joining the type
        // with its modifiers, so "property.static.readonly" falls back through
        // "property.static" to "property" — which is why only the meaningful
        // combinations need a rule of their own.
        { token: "namespace", foreground: token.identifier },
        // The four kinds of type used to share one colour. They still do until
        // somebody gives one of them its own, because each inherits from
        // "type" — so nothing changes for anybody who has not asked for it.
        { token: "class", foreground: token.class },
        { token: "interface", foreground: token.interface },
        { token: "enum", foreground: token.enum },
        { token: "record", foreground: token.record },
        { token: "annotation", foreground: token.annotation },
        { token: "typeParameter", foreground: token.typeParameter, fontStyle: "italic" },
        { token: "enumMember", foreground: token.enumMember },
        { token: "method", foreground: token.method },
        { token: "function", foreground: token.method },
        { token: "property", foreground: token.field },
        { token: "recordComponent", foreground: token.field },
        { token: "property.static", foreground: token.constant },
        { token: "property.readonly", foreground: token.constant },
        { token: "variable", foreground: token.localVariable },
        { token: "variable.readonly", foreground: token.constant },
        { token: "parameter", foreground: token.parameter },
        { token: "modifier", foreground: token.modifier, fontStyle: "bold" },
      ],
      colors: {
        "editor.background": clear ?? picked("editorBackground", theme.editor.background),
        "editor.foreground": picked("editorForeground", theme.editor.foreground),
        "editorGutter.background": clear ?? picked("editorBackground", theme.editor.background),
        "minimap.background": clear ?? picked("editorBackground", theme.editor.background),
        "editorLineNumber.foreground": picked("editorLineNumber", theme.editor.lineNumber),
        "editorLineNumber.activeForeground": picked("editorLineNumberActive", theme.editor.lineNumberActive),
        "editorCursor.foreground": picked("editorCursor", theme.editor.cursor),
        "editor.selectionBackground": picked("editorSelection", theme.editor.selection),
        "editor.lineHighlightBackground": wallpaper
          ? translucent(picked("editorLineHighlight", theme.editor.lineHighlight))
          : picked("editorLineHighlight", theme.editor.lineHighlight),
        // Monaco outlines the current line by default, in a colour of its own
        // choosing. A filled band with a hard edge around it reads as a
        // selection; the fill alone reads as "the caret is here".
        "editor.lineHighlightBorder": "#00000000",
        "editorIndentGuide.background1": theme.editor.indentGuide,
        "editorIndentGuide.activeBackground1": theme.editor.indentGuideActive,
        "editorWidget.background": picked("editorWidgetBackground", theme.editor.widgetBackground),
        "editorSuggestWidget.background": picked("editorWidgetBackground", theme.editor.widgetBackground),
        "editorSuggestWidget.border": picked("editorWidgetBorder", theme.editor.widgetBorder),
        "editorSuggestWidget.selectedBackground": picked("editorSuggestSelected", theme.editor.suggestSelected),
      },
    });
  }
}
