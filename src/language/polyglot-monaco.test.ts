import { afterEach, describe, expect, it, vi } from "vitest";
import { completionFromLsp, fallbackSuggestions, languageModelPathKey, localSymbols, registerPolyglotLanguageProviders } from "./polyglot-monaco";

describe("offline language completion", () => {
  it.each([
    ["python", "def greet(name):\n    message = name\n", "greet", "print"],
    ["kotlin", "fun greet(name: String) {}\nval message = 1", "greet", "println"],
    ["rust", "fn greet(name: &str) {}\nlet message = 1;", "greet", "println!"],
    ["php", "<?php function greet($name) {}", "greet", "strlen"],
    ["lua", "local function greet(name) end", "greet", "print"],
    ["go", "package main\nfunc greet(name string) {}", "greet", "append"],
    ["c", "void greet(int value) {}", "greet", "printf"],
    ["cpp", "void greet(int value) {}", "greet", "vector"],
    ["csharp", "class App { public void Greet(string name) {} }", "Greet", "Console"],
    ["objective-c", "@interface Person : NSObject\n@end", "Person", "NSLog"],
    ["objective-cpp", "class Person {};", "Person", "vector"],
  ])("offers declarations, language builtins and snippets for %s", (id, source, symbol, builtin) => {
    const suggestions = fallbackSuggestions(id, source, "");
    expect(suggestions.some(({ label }) => label === symbol)).toBe(true);
    expect(suggestions.some(({ label }) => label === builtin)).toBe(true);
    expect(suggestions.some(({ snippet }) => snippet)).toBe(true);
  });

  it("does not turn comments or literal text into declared symbols", () => {
    expect(localSymbols("python", '# def fake():\ntext = "def pretend():"\ndef actual(): pass').map(({ label }) => label)).toEqual(["actual", "text"]);
    expect(localSymbols("go", '// func fake() {}\nvar text = "func pretend() {}"\nfunc actual() {}').map(({ label }) => label)).not.toContain("pretend");
  });

  it.each([
    ["python", 'name = "Kiwi"', "name.up", "upper"],
    ["python", "items = []", "items.ap", "append"],
    ["python", "import os", "os.ge", "getcwd"],
    ["go", 'import "fmt"', "fmt.Pr", "Println"],
    ["lua", "", "string.su", "sub"],
    ["rust", 'let name = String::from("Kiwi");', "name.tr", "trim"],
    ["rust", "", "Vec::ne", "new"],
    ["cpp", "", "std::ve", "vector"],
    ["kotlin", 'val name = "Kiwi"', "name.up", "uppercase"],
    ["csharp", "", "Console.Wri", "WriteLine"],
  ])("offers known members for %s %s %s", (id, source, before, expected) => {
    expect(fallbackSuggestions(id, source, before).map(({ label }) => label)).toContain(expected);
  });

  it("leaves unknown receiver types to the language server", () => {
    expect(fallbackSuggestions("python", "", "unknown.")).toEqual([]);
    expect(fallbackSuggestions("java", "class Main {}", "")).toEqual([]);
  });
});

const kinds = { Text: 18, Method: 0, Function: 1, Class: 5, Variable: 4, Keyword: 17, Snippet: 27, Module: 8, Property: 9 };
const mappingMonaco = { languages: { CompletionItemKind: kinds, CompletionItemInsertTextRule: { InsertAsSnippet: 4 } } } as any;
const fallbackRange = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 5 };

describe("standard LSP completion mapping", () => {
  it("matches Windows model paths while preserving case-sensitive POSIX files", () => {
    expect(languageModelPathKey("c:\\Project\\main.py")).toBe(languageModelPathKey("C:/project/main.py"));
    expect(languageModelPathKey("/project/Main.py")).not.toBe(languageModelPathKey("/project/main.py"));
  });
  it("preserves snippets, import edits and InsertReplaceEdit ranges", () => {
    const mapped = completionFromLsp(mappingMonaco, {
      label: "greet", kind: 3, insertTextFormat: 2,
      textEdit: { insert: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } }, replace: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }, newText: "greet(${1:name})" },
      additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import greet\n" }],
      documentation: { kind: "markdown", value: "**Greeting**" },
    }, {}, fallbackRange)!;
    expect(mapped.kind).toBe(kinds.Function);
    expect(mapped.insertText).toBe("greet(${1:name})");
    expect(mapped.insertTextRules).toBe(4);
    expect(mapped.range).toEqual({ insert: fallbackRange, replace: { ...fallbackRange, endColumn: 9 } });
    expect(mapped.additionalTextEdits?.[0]).toEqual({ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: "import greet\n" });
    expect(mapped.documentation).toMatchObject({ value: "**Greeting**", isTrusted: false });
  });

  it("applies CompletionList itemDefaults without losing the replacement text", () => {
    const mapped = completionFromLsp(mappingMonaco, { label: "hello", textEditText: "hello($1)" }, { insertTextFormat: 2, editRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } } }, fallbackRange)!;
    expect(mapped.insertText).toBe("hello($1)");
    expect(mapped.insertTextRules).toBe(4);
    expect(mapped.range).toEqual(fallbackRange);
  });
});

function harness(initial = "def greet():\n    pass\npri") {
  let text = initial;
  let version = 1;
  let modelDisposed = false;
  const changes = new Set<() => void>();
  const closes = new Set<() => void>();
  const completions = new Map<string, any>();
  const model = {
    uri: { scheme: "file", fsPath: "C:\\project\\main.py", toString: () => "file:///C:/project/main.py" },
    getLanguageId: () => "python", getValue: () => text, getVersionId: () => version,
    getWordUntilPosition: () => ({ word: "pri", startColumn: 1, endColumn: 4 }),
    getLineContent: () => text.split("\n").at(-1), isDisposed: () => modelDisposed,
    onDidChangeContent: (callback: () => void) => { changes.add(callback); return { dispose: () => changes.delete(callback) }; },
    onWillDispose: (callback: () => void) => { closes.add(callback); return { dispose: () => closes.delete(callback) }; },
  } as any;
  const disposable = () => ({ dispose: () => undefined });
  const languages = {
    getLanguages: () => [{ id: "objective-cpp" }], CompletionItemKind: kinds, CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider: (id: string, provider: any) => { completions.set(id, provider); return disposable(); },
    registerHoverProvider: disposable, registerDefinitionProvider: disposable, registerReferenceProvider: disposable,
    registerDocumentFormattingEditProvider: disposable, registerDocumentSymbolProvider: disposable, registerSignatureHelpProvider: disposable,
    registerCodeLensProvider: disposable,
  };
  const monaco = {
    languages, editor: { getModels: () => [model], onDidCreateModel: disposable, onDidChangeModelLanguage: disposable, setModelMarkers: vi.fn() },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    Uri: { parse: (uri: string) => ({ fsPath: decodeURIComponent(uri.replace(/^file:\/\/\//, "")).replace(/\//g, "\\") }) },
  } as any;
  const api = {
    polyglot: {
      open: vi.fn(async () => ({ available: true, status: "ready" })), change: vi.fn(async () => true), close: vi.fn(async () => true),
      request: vi.fn(async (_payload: any): Promise<any> => ({ items: [{ label: "print", kind: 3 }] })), cancel: vi.fn(async () => true),
      onDiagnostics: vi.fn(() => () => undefined), onStatus: vi.fn(() => () => undefined),
    },
  } as any;
  const token = { isCancellationRequested: false, onCancellationRequested: disposable } as any;
  const provide = () => completions.get("python").provideCompletionItems(model, { lineNumber: text.split("\n").length, column: text.split("\n").at(-1)!.length + 1 }, { triggerKind: 0 }, token);
  const install = () => registerPolyglotLanguageProviders(monaco, api, () => "C:\\project");
  return {
    model, api, provide, install, completions, monaco, token,
    edit(next: string) { text = next; version += 1; changes.forEach((callback) => callback()); },
    close() { modelDisposed = true; closes.forEach((callback) => callback()); },
  };
}

const controllers: Array<{ dispose: () => void }> = [];
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers(); });

describe("polyglot model lifecycle", () => {
  it("accepts diagnostics with an encoded Windows drive colon and different casing", async () => {
    const h = harness();
    controllers.push(h.install());
    await h.provide();
    const diagnostics = h.api.polyglot.onDiagnostics.mock.calls[0][0];
    diagnostics({ root: "c:\\project", languageId: "python", uri: "file:///c%3A/project/main.py", diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: "Example", severity: 1 }] });
    expect(h.monaco.editor.setModelMarkers).toHaveBeenLastCalledWith(h.model, "kiwi-polyglot", [expect.objectContaining({ message: "Example", startLineNumber: 1 })]);
  });
  it("offers working local completion when no server is installed", async () => {
    const h = harness();
    h.api.polyglot.open.mockResolvedValue({ available: false, status: "missing" });
    controllers.push(h.install());
    const result = await h.provide();
    expect(result.suggestions.map((item: any) => item.label)).toContain("greet");
    expect(result.suggestions.map((item: any) => item.label)).toContain("print");
    expect(h.api.polyglot.request).not.toHaveBeenCalled();
  });

  it("sends the current text before requesting semantic completion", async () => {
    const h = harness();
    controllers.push(h.install());
    await vi.waitFor(() => expect(h.api.polyglot.open).toHaveBeenCalledTimes(1));
    h.edit("def updated(): pass\npri");
    const result = await h.provide();
    expect(h.api.polyglot.change).toHaveBeenCalledWith({ root: "C:\\project", file: "C:\\project\\main.py", text: "def updated(): pass\npri" });
    expect(h.api.polyglot.change.mock.invocationCallOrder[0]).toBeLessThan(h.api.polyglot.request.mock.invocationCallOrder[0]);
    expect(result.suggestions.filter((item: any) => item.label === "print")).toHaveLength(1);
  });

  it("closes a document even when its model disappears during server initialization", async () => {
    const h = harness();
    let opened!: (value: any) => void;
    h.api.polyglot.open.mockImplementationOnce(() => new Promise((resolve) => { opened = resolve; }));
    controllers.push(h.install());
    await vi.waitFor(() => expect(h.api.polyglot.open).toHaveBeenCalledTimes(1));
    h.close();
    expect(h.api.polyglot.close).not.toHaveBeenCalled();
    opened({ available: true, status: "ready" });
    await vi.waitFor(() => expect(h.api.polyglot.close).toHaveBeenCalledTimes(1));
  });

  it("reopens existing documents after a server install or settings change", async () => {
    const h = harness();
    h.api.polyglot.open.mockResolvedValueOnce({ available: false, status: "missing" });
    const controller = h.install();
    controllers.push(controller);
    await h.provide();
    controller.refreshModels();
    await vi.waitFor(() => expect(h.api.polyglot.open).toHaveBeenCalledTimes(2));
    expect(h.api.polyglot.close).toHaveBeenCalledTimes(1);
    expect(h.api.polyglot.close.mock.invocationCallOrder[0]).toBeLessThan(h.api.polyglot.open.mock.invocationCallOrder[1]);
    expect((await h.provide()).suggestions.some((item: any) => item.label === "print")).toBe(true);
    expect(h.api.polyglot.request).toHaveBeenCalled();
  });

  it("discards a completion response for an older document version", async () => {
    const h = harness();
    controllers.push(h.install());
    let finish!: (value: any) => void;
    h.api.polyglot.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const response = h.provide();
    await vi.waitFor(() => expect(h.api.polyglot.request).toHaveBeenCalledTimes(1));
    h.edit("def another(): pass\npri");
    finish({ items: [{ label: "old-symbol", kind: 3 }] });
    expect((await response).suggestions).toEqual([]);
  });

  it("cancels a pending semantic request immediately when Monaco cancels completion", async () => {
    const h = harness();
    let cancelled!: () => void;
    h.token.onCancellationRequested = (callback: () => void) => { cancelled = callback; return { dispose() {} }; };
    controllers.push(h.install());
    h.api.polyglot.request.mockImplementationOnce(() => new Promise(() => undefined));
    const response = h.provide();
    await vi.waitFor(() => expect(h.api.polyglot.request).toHaveBeenCalledTimes(1));
    h.token.isCancellationRequested = true;
    cancelled();
    expect((await response).suggestions).toEqual([]);
    expect(h.api.polyglot.cancel).toHaveBeenCalledWith(expect.stringMatching(/^polyglot-/));
  });

  it("resolves the original LSP item without attaching unrelated document params", async () => {
    const h = harness();
    controllers.push(h.install());
    const original = { label: "remote", kind: 3, data: { symbol: "from-library" } };
    h.api.polyglot.request.mockResolvedValueOnce({ items: [original] });
    const response = await h.provide();
    h.api.polyglot.request.mockResolvedValueOnce({ ...original, detail: "library function" });
    const resolved = await h.completions.get("python").resolveCompletionItem(response.suggestions[0], { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
    expect(resolved.detail).toBe("library function");
    expect(h.api.polyglot.request.mock.calls[1][0].params).toEqual(original);
  });
});
