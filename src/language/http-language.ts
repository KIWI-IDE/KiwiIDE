/**
 * Monaco grammar for `.http` request files.
 *
 * Monaco brings no such language, so without this a request file is one
 * undifferentiated block of plain text. The colours follow what the parser in
 * {@link ./http-file} already treats as structure — separator, method, URL,
 * header name, variable — so what is highlighted is exactly what is understood.
 */

import type * as MonacoEditor from "monaco-editor";
import { parseHttpFile } from "./http-file";

export const HTTP_LANGUAGE_ID = "kiwi-http";

/** Command the code lens above each request triggers. */
export const HTTP_SEND_COMMAND = "kiwi.http.send";

/** Extensions that hold requests, matching what IntelliJ and VS Code use. */
export const HTTP_EXTENSIONS = [".http", ".rest"];

export function httpLanguageDefinition(): MonacoEditor.languages.IMonarchLanguage {
  return {
    defaultToken: "",
    tokenPostfix: ".http",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"],
    tokenizer: {
      root: [
        // The separator carries the request name, which is worth reading first.
        [/^###.*$/, "comment.doc"],
        [/^\s*(?:#|\/\/).*$/, "comment"],
        // `@name = value` defines a variable for everything below it.
        [/^(\s*@[A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/, ["variable", "delimiter", { token: "string", next: "@line" }]],
        [
          /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)(\s+)/,
          ["keyword", { token: "", next: "@url" }],
        ],
        [/^([A-Za-z0-9-]+)(\s*:\s*)/, ["type", { token: "delimiter", next: "@headerValue" }]],
        { include: "@variables" },
      ],
      url: [
        [/$/, "", "@pop"],
        [/\bHTTP\/[\d.]+/, "keyword"],
        { include: "@variables" },
        [/[^{\s]+/, "string.link"],
        [/./, "string.link"],
      ],
      headerValue: [
        [/$/, "", "@pop"],
        { include: "@variables" },
        [/./, "string"],
      ],
      line: [
        [/$/, "", "@pop"],
        { include: "@variables" },
        [/./, "string"],
      ],
      variables: [
        // A placeholder that no `@name` defines is still shown as a placeholder;
        // the parser leaves it in the URL too, so the editor must not hide it.
        [/\{\{\s*[A-Za-z_][\w.-]*\s*\}\}/, "variable.predefined"],
      ],
    },
  } as MonacoEditor.languages.IMonarchLanguage;
}

export function httpLanguageConfiguration(): MonacoEditor.languages.LanguageConfiguration {
  return {
    comments: { lineComment: "#" },
    brackets: [["{", "}"], ["[", "]"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
    ],
  };
}

/** Replaced on every editor mount so the lens always reaches the live handler. */
let sendHandler: (line: number) => void = () => undefined;
let installed = false;

/**
 * Registers the language, its grammar and the send lens — once per window.
 *
 * The lens command has to live in Monaco's global command registry: an action
 * added with `editor.addAction` is registered under an editor-scoped id, so a
 * code lens naming the plain id would silently resolve to nothing. Registering
 * the provider only once also keeps a second editor from doubling every lens.
 */
export function installHttpLanguage(monaco: typeof MonacoEditor, send: (line: number) => void): void {
  sendHandler = send;
  if (installed) return;
  installed = true;

  monaco.languages.register({ id: HTTP_LANGUAGE_ID, extensions: HTTP_EXTENSIONS, aliases: ["HTTP"] });
  monaco.languages.setMonarchTokensProvider(HTTP_LANGUAGE_ID, httpLanguageDefinition());
  monaco.languages.setLanguageConfiguration(HTTP_LANGUAGE_ID, httpLanguageConfiguration());
  monaco.editor.registerCommand(HTTP_SEND_COMMAND, (_accessor, line: number) => sendHandler(line));
  monaco.languages.registerCodeLensProvider(HTTP_LANGUAGE_ID, {
    provideCodeLenses: (model) => ({
      lenses: parseHttpFile(model.getValue()).map((request) => ({
        range: new monaco.Range(request.line, 1, request.line, 1),
        command: { id: HTTP_SEND_COMMAND, title: `▶ ${request.name}`, arguments: [request.line] },
      })),
      dispose: () => undefined,
    }),
  });
}

/** Test seam: lets a test install into a fresh fake Monaco. */
export function resetHttpLanguageForTests(): void {
  installed = false;
}
