import { describe, expect, it } from "vitest";
import {
  applyLspWorkspaceEdit,
  completionFallbackRange,
  completionItemDetail,
  completionItemLabel,
  completionItemName,
  completionItemOrigin,
  fileUri,
  installJavaLanguageProviders,
  readMembers,
  previewLspWorkspaceEdit,
} from "./monaco-lsp";

const SEP = "\\";
const p = (...parts: string[]) => parts.join(SEP);

describe("Monaco Java completion presentation", () => {
  it("keeps JDT signature, return type and declaring class in the suggestion label", () => {
    const item = {
      label: "getProperty",
      labelDetails: {
        detail: "(String key) : String",
        description: "java.lang.System",
      },
      detail: "String java.lang.System.getProperty(String key)",
    };

    expect(completionItemName(item)).toBe("getProperty");
    expect(completionItemOrigin(item)).toBe("java.lang.System");
    expect(completionItemLabel(item)).toEqual({
      label: "getProperty",
      detail: "(String key) : String",
      description: "java.lang.System",
    });
    expect(completionItemDetail(item)).toContain("String java.lang.System.getProperty(String key)");
  });

  it("derives the project or library type from legacy JDT detail data", () => {
    const item = {
      label: "version",
      detail: "String dev.kiwi.library.ExternalApi.version()",
      tags: [1],
    };

    expect(completionItemOrigin(item)).toBe("dev.kiwi.library.ExternalApi");
    expect(completionItemLabel(item)).toEqual({
      label: "version",
      description: "dev.kiwi.library.ExternalApi",
    });
    expect(completionItemDetail(item)).toContain("Veraltet");
  });

  it("creates a real file URI for Windows editor models", () => {
    expect(fileUri("C:\\workspace\\src\\Main.java")).toBe("file:///C:/workspace/src/Main.java");
  });

  it("previews multi-line workspace edits without writing files", async () => {
    const source = "class Main {\r\n    int value;\r\n}\r\n";
    const monaco = {
      Uri: { parse: () => ({ fsPath: "C:\\workspace\\Main.java" }) },
      editor: { getModel: () => ({ getValue: () => source }) },
    } as any;
    const api = { file: { read: async () => source } } as any;
    const preview = await previewLspWorkspaceEdit(monaco, api, {
      changes: {
        "file:///C:/workspace/Main.java": [{
          range: { start: { line: 1, character: 8 }, end: { line: 1, character: 13 } },
          newText: "count",
        }],
      },
    });
    expect(preview[0].before).toBe(source);
    expect(preview[0].after).toContain("int count;");
  });
});

describe("applying a JDT rename refactoring", () => {
  const BOOTSTRAP = p("C:", "ws", "src", "Bootstrap.java");
  const MAIN = p("C:", "ws", "src", "Main.java");

  /** Minimal Monaco/Kiwi doubles that record what reaches the file system. */
  function harness() {
    const files = new Map<string, string>([[BOOTSTRAP, "public class Bootstrap {}\n"]]);
    const models = new Map<string, { value: string }>([
      [BOOTSTRAP.toLowerCase(), { value: "public class Bootstrap {}\n" }],
    ]);
    const toPath = (uri: string) =>
      decodeURIComponent(uri.replace(/^file:\/\/\//, "")).split("/").join(SEP);
    const monaco = {
      Uri: { parse: (uri: string) => ({ fsPath: toPath(uri), toString: () => uri }) },
      editor: {
        getModels: () => [],
        createModel: () => undefined,
        getModel: (parsed: { fsPath: string }) => {
          const model = models.get(parsed.fsPath.toLowerCase());
          if (!model) return null;
          return {
            getValue: () => model.value,
            applyEdits: (edits: Array<{ text: string }>) => {
              for (const edit of edits) model.value = model.value.replace("Bootstrap", edit.text);
            },
          };
        },
      },
    } as any;
    const api = {
      workspace: { beginOperation: async () => "op", endOperation: async () => true },
      file: {
        read: async (file: string) => files.get(file) ?? "",
        write: async (file: string, content: string) => { files.set(file, content); return true; },
        create: async () => true,
        transfer: async (file: string) => file,
        delete: async (file: string) => { files.delete(file); return true; },
        rename: async (file: string, name: string) => {
          const target = p(file.slice(0, file.lastIndexOf(SEP)), name);
          files.set(target, files.get(file) ?? "");
          files.delete(file);
          const model = models.get(file.toLowerCase());
          if (model) {
            models.set(target.toLowerCase(), model);
            models.delete(file.toLowerCase());
          }
          return target;
        },
      },
    } as any;
    return { monaco, api, files };
  }

  const textEdit = (uri: string) => ({
    textDocument: { uri, version: 1 },
    edits: [{
      range: { start: { line: 0, character: 13 }, end: { line: 0, character: 22 } },
      newText: "Main",
    }],
  });
  const rename = {
    kind: "rename",
    oldUri: "file:///C:/ws/src/Bootstrap.java",
    newUri: "file:///C:/ws/src/Main.java",
  };

  it("does not leave the old class file behind when the type is renamed", async () => {
    const { monaco, api, files } = harness();
    // JDT LS sends the edit for the old file first, then the rename.
    const touched = await applyLspWorkspaceEdit(
      monaco,
      api,
      { documentChanges: [textEdit("file:///C:/ws/src/Bootstrap.java"), rename] },
      p("C:", "ws"),
    );

    expect([...files.keys()]).toEqual([MAIN]);
    expect(files.get(MAIN)).toContain("class Main");
    expect(touched).toEqual([MAIN]);
  });

  it("writes an edit that arrives after a rename to the new path", async () => {
    const { monaco, api, files } = harness();
    await applyLspWorkspaceEdit(
      monaco,
      api,
      { documentChanges: [rename, textEdit("file:///C:/ws/src/Main.java")] },
      p("C:", "ws"),
    );

    expect([...files.keys()]).toEqual([MAIN]);
    expect(files.get(MAIN)).toContain("class Main");
  });
});

describe("completion range when a suggestion brings no edit", () => {
  // Caret between "get" and "Name" in "getName", i.e. word 1..8, cursor at 4.
  const range = completionFallbackRange(3, 4, 1, 8);

  it("stops the insert range at the caret so the tail survives", () => {
    expect(range.insert).toEqual({ startLineNumber: 3, endLineNumber: 3, startColumn: 1, endColumn: 4 });
  });

  it("keeps the full word available as the replace range", () => {
    expect(range.replace).toEqual({ startLineNumber: 3, endLineNumber: 3, startColumn: 1, endColumn: 8 });
  });

  it("never builds an inverted range when the caret sits before the word", () => {
    // Monaco reports an empty word at a trigger character, where endColumn can
    // land before the caret; an inverted range would delete in the wrong place.
    const atTrigger = completionFallbackRange(1, 12, 12, 12);
    expect(atTrigger.insert.startColumn).toBeLessThanOrEqual(atTrigger.insert.endColumn);
    expect(atTrigger.replace.startColumn).toBeLessThanOrEqual(atTrigger.replace.endColumn);

    const behind = completionFallbackRange(1, 20, 25, 30);
    expect(behind.insert.startColumn).toBe(20);
    expect(behind.replace.endColumn).toBe(30);
  });
});

describe("providers survive a language server that does not answer", () => {
  /** Captures the providers Monaco would have registered. */
  const fakeMonaco = () => {
    const providers: Record<string, any> = {};
    const noop = () => ({ dispose: () => undefined });
    const capture = (key: string) => (_language: string, provider: any) => {
      providers[key] = provider;
      return { dispose: () => undefined };
    };
    return {
      providers,
      monaco: {
        Range: class { constructor(public a: number, public b: number, public c: number, public d: number) {} },
        Uri: { parse: (value: string) => ({ fsPath: value }) },
        languages: {
          registerInlayHintsProvider: capture("inlayHints"),
          registerHoverProvider: capture("hover"),
          registerCompletionItemProvider: capture("completion"),
          registerSignatureHelpProvider: capture("signatureHelp"),
          registerDefinitionProvider: capture("definition"),
          registerReferenceProvider: capture("references"),
          registerRenameProvider: capture("rename"),
          registerDocumentFormattingEditProvider: capture("format"),
          registerDocumentSymbolProvider: capture("symbols"),
          registerDocumentSemanticTokensProvider: capture("semanticTokens"),
          registerCodeActionProvider: capture("codeActions"),
          registerCodeLensProvider: capture("codeLens"),
          registerFoldingRangeProvider: capture("foldingRanges"),
          registerOnTypeFormattingEditProvider: noop,
          registerDocumentRangeFormattingEditProvider: noop,
          InlayHintKind: { Type: 1, Parameter: 2 },
          CompletionItemKind: { Property: 9, Module: 8, Value: 12 },
          CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
          CompletionTriggerKind: { Invoke: 0 },
          SignatureHelpTriggerKind: { Invoke: 1 },
          CodeActionKind: {},
          FoldingRangeKind: { Region: 3 },
        },
        editor: {
          registerCommand: () => ({ dispose: () => undefined }),
          getModelMarkers: () => [],
          setModelMarkers: () => undefined,
          getModels: () => [],
          getModel: () => null,
        },
      } as never,
    };
  };

  const model = {
    uri: { fsPath: "C:\project\src\Main.java" },
    getValue: () => "class Main {}",
    getWordUntilPosition: () => ({ word: "", startColumn: 1, endColumn: 1 }),
    getOffsetAt: () => 0,
    getLineContent: () => "class Main {}",
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 14 }),
    getLanguageId: () => "java",
  } as never;

  const failingApi = () => ({
    language: {
      request: async () => {
        throw new Error("JDT-LS-Anfrage textDocument/inlayHint hat nach 15000 ms nicht geantwortet.");
      },
      change: async () => undefined,
    },
    debug: { listBreakpoints: async () => [], start: async () => undefined },
  }) as never;

  it("returns no inlay hints instead of throwing at Monaco", async () => {
    // Monaco calls this provider while scrolling and does not catch what it
    // throws, so a timed-out request used to surface as an unhandled rejection
    // and took the whole session down with it.
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(monaco, failingApi(), () => "C:\project");
    const hints = await providers.inlayHints.provideInlayHints(
      model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 5, endColumn: 1 },
      {},
    );
    expect(hints.hints).toEqual([]);
  });

  it("folds regions without asking the language server", async () => {
    // The markers are a comment convention Java itself knows nothing about, so
    // these ranges have to come from the editor even when the server is down —
    // and Monaco merges providers, so the server's own folds are untouched.
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(monaco, failingApi(), () => "C:\project");
    const source = `class Demo {
  //region Felder
  private int count;
  private int total;
  //endregion
}`;
    const ranges = providers.foldingRanges.provideFoldingRanges(
      { getValue: () => source },
      {},
      {},
    );
    // Folding stops above the closing marker so it stays readable when the
    // region is collapsed.
    expect(ranges).toEqual([{ start: 2, end: 4, kind: 3 }]);
  });

  it("keeps hover and definition quiet when the server is unavailable", async () => {
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(monaco, failingApi(), () => "C:\project");
    await expect(providers.hover.provideHover(model, { lineNumber: 1, column: 1 })).resolves.toBeFalsy();
    await expect(providers.definition.provideDefinition(model, { lineNumber: 1, column: 1 })).resolves.toBeFalsy();
  });
});

describe("scanning the open file for its own members", () => {
  /** Just enough of a Monaco model for the scan and its cache. */
  const model = (uri: string, text: string) => {
    let version = 1;
    let value = text;
    let reads = 0;
    return {
      uri: { toString: () => uri },
      getVersionId: () => version,
      getValue: () => { reads += 1; return value; },
      edit: (next: string) => { value = next; version += 1; },
      reads: () => reads,
    };
  };

  it("finds what the file declares", () => {
    const buffer = model("file:///A.java", ["class A {", "    public String name(){}", "}"].join("\n"));
    expect(readMembers(buffer as never).methods.map((method) => method.name)).toEqual(["name"]);
  });

  it("reads the buffer once per version, not once per keystroke", () => {
    // Completion asks on every keystroke; rescanning a few thousand lines each
    // time is paid for in the editor's responsiveness.
    const buffer = model("file:///B.java", ["class B {", "    void run(){}", "}"].join("\n"));
    readMembers(buffer as never);
    readMembers(buffer as never);
    readMembers(buffer as never);
    expect(buffer.reads()).toBe(1);
  });

  it("scans again as soon as the file changes", () => {
    const buffer = model("file:///C.java", ["class C {", "    void run(){}", "}"].join("\n"));
    expect(readMembers(buffer as never).methods.map((method) => method.name)).toEqual(["run"]);
    buffer.edit(["class C {", "    void run(){}", "    void stop(){}", "}"].join("\n"));
    expect(readMembers(buffer as never).methods.map((method) => method.name)).toEqual(["run", "stop"]);
    expect(buffer.reads()).toBe(2);
  });

  it("keeps two files apart", () => {
    const first = model("file:///D.java", ["class D {", "    void eins(){}", "}"].join("\n"));
    const second = model("file:///E.java", ["class E {", "    void zwei(){}", "}"].join("\n"));
    expect(readMembers(first as never).methods[0].name).toBe("eins");
    expect(readMembers(second as never).methods[0].name).toBe("zwei");
    expect(readMembers(first as never).methods[0].name).toBe("eins");
  });
});

describe("what the completion provider hands Monaco", () => {
  /** Monaco, reduced to the parts a completion request touches. */
  const fakeMonaco = () => {
    const providers: Record<string, any> = {};
    const noop = () => ({ dispose: () => undefined });
    const capture = (key: string) => (_language: string, provider: any) => {
      providers[key] = provider;
      return { dispose: () => undefined };
    };
    return {
      providers,
      monaco: {
        Range: class { constructor(a: number, b: number, c: number, d: number) { Object.assign(this, { a, b, c, d }); } },
        Uri: { parse: (value: string) => ({ fsPath: value }) },
        languages: {
          registerInlayHintsProvider: noop,
          registerHoverProvider: noop,
          registerCompletionItemProvider: capture("completion"),
          registerSignatureHelpProvider: noop,
          registerDefinitionProvider: noop,
          registerReferenceProvider: noop,
          registerRenameProvider: noop,
          registerDocumentFormattingEditProvider: noop,
          registerDocumentSymbolProvider: noop,
          registerDocumentSemanticTokensProvider: noop,
          registerCodeActionProvider: noop,
          registerCodeLensProvider: noop,
          registerFoldingRangeProvider: noop,
          registerOnTypeFormattingEditProvider: noop,
          registerDocumentRangeFormattingEditProvider: noop,
          InlayHintKind: { Type: 1, Parameter: 2 },
          CompletionItemKind: { Property: 9, Module: 8, Value: 12, Method: 0, Field: 3, Snippet: 27, Operator: 11 },
          CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
          CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1 },
          SignatureHelpTriggerKind: { Invoke: 1 },
          CodeActionKind: {},
          FoldingRangeKind: { Region: 3 },
        },
        editor: {
          registerCommand: () => ({ dispose: () => undefined }),
          getModelMarkers: () => [],
          setModelMarkers: () => undefined,
          getModels: () => [],
          getModel: () => null,
        },
      },
    };
  };

  /** A buffer whose caret sits at the end of `line`. */
  const editorModel = (line: string, uri = "file:///Main.java") => ({
    uri: { fsPath: "C:/projekt/Main.java", toString: () => uri },
    getValue: () => line,
    getVersionId: () => 1,
    getWordUntilPosition: () => {
      const word = line.match(/[A-Za-z_$][\w$]*$/)?.[0] || "";
      return { word, startColumn: line.length + 1 - word.length, endColumn: line.length + 1 };
    },
    getOffsetAt: () => line.length,
    getLineContent: () => line,
    // The real model has this, and the cache records it so an answer is never
    // reused after an edit above the caret has moved every offset in it.
    getLineCount: () => 1,
    // The provider reads a few lines back, so a method chain written over
    // several lines is read as the one expression it is.
    getValueInRange: () => line,
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: line.length + 1 }),
    getLanguageId: () => "java",
  });

  const apiReturning = (items: any[]) => ({
    language: {
      request: async (_root: string, method: string) => (method === "textDocument/completion" ? { items } : null),
      change: async () => undefined,
    },
    debug: { listBreakpoints: async () => [], start: async () => undefined },
  });

  const settings = (over: Record<string, boolean> = {}) => () => ({
    autoPopup: true,
    caseSensitive: false,
    insertImports: true,
    showDocumentation: true,
    prioritizeRecent: false,
    liveTemplates: false,
    postfixTemplates: false,
    finishStatements: true,
    localMembers: true,
    ...over,
  });

  let buffers = 0;
  // The member scan is cached by buffer identity, so every test needs its own.
  const nextUri = () => `file:///Test${buffers += 1}.java`;

  const complete = async (line: string, items: any[], over: Record<string, boolean> = {}) => {
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(monaco as never, apiReturning(items) as never, () => "C:/projekt", settings(over) as never);
    const model = editorModel(line, nextUri());
    return providers.completion.provideCompletionItems(
      model as never,
      { lineNumber: 1, column: line.length + 1 },
      { triggerKind: 1 },
      { isCancellationRequested: false },
    );
  };

  const find = (result: any, label: string): any =>
    result.suggestions.find((item: any) => (typeof item.label === "string" ? item.label : item.label.label) === label);

  it("finishes a generic type after new into the whole expression", async () => {
    // The reported behaviour: accepting ArrayList left exactly "ArrayList",
    // and the diamond, the call and the semicolon were typed by hand.
    const result = await complete(
      "        List<String> namen = new ArrayL",
      [{ label: "ArrayList", kind: 7, detail: "java.util.ArrayList" }],
    );
    expect(find(result, "ArrayList").insertText).toBe("ArrayList<>(${0});");
    expect(find(result, "ArrayList").insertTextRules).toBe(4);
  });

  it("leaves a package proposal alone, which is not a type", async () => {
    // After "new java." JDT proposes packages too, and "util<>()" is not one.
    const result = await complete(
      "        var x = new java.",
      [{ label: "util", kind: 9, detail: "package java.util" }],
    );
    expect(find(result, "util").insertText).toBe("util");
  });

  it("offers a method the file declares and the server has not seen", async () => {
    // The gap this closes: between typing a method and the server indexing it,
    // the class could not complete its own members.
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(monaco as never, apiReturning([]) as never, () => "C:/projekt", settings() as never);
    const source = ["class Beta {", "    public String name(){}", "    void run() {", "        na", "    }", "}"].join("\n");
    const model = {
      ...editorModel("        na", nextUri()),
      getValue: () => source,
      getLineContent: () => "        na",
    };
    const result = await providers.completion.provideCompletionItems(
      model as never,
      { lineNumber: 4, column: 11 },
      { triggerKind: 1 },
      { isCancellationRequested: false },
    );
    expect(find(result, "name()")).toMatchObject({ insertText: "name()" });
  });

  it("does not offer it twice once the server knows it as well", async () => {
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(
      monaco as never,
      apiReturning([{ label: "name()", kind: 2, detail: "String Beta.name()" }]) as never,
      () => "C:/projekt",
      settings() as never,
    );
    const source = ["class Beta {", "    public String name(){}", "    void run() {", "        na", "    }", "}"].join("\n");
    const model = { ...editorModel("        na", nextUri()), getValue: () => source, getLineContent: () => "        na" };
    const result = await providers.completion.provideCompletionItems(
      model as never,
      { lineNumber: 4, column: 11 },
      { triggerKind: 1 },
      { isCancellationRequested: false },
    );
    const named = result.suggestions.filter((item: any) =>
      (typeof item.label === "string" ? item.label : item.label.label).startsWith("name"));
    expect(named).toHaveLength(1);
  });

  it("proposes a method name while a declaration is being written", async () => {
    const { providers, monaco } = fakeMonaco();
    installJavaLanguageProviders(monaco as never, apiReturning([]) as never, () => "C:/projekt", settings() as never);
    const source = ["class Person {", "    private String name;", "    public String get", "}"].join("\n");
    const line = "    public String get";
    const model = { ...editorModel(line, nextUri()), getValue: () => source, getLineContent: () => line };
    const result = await providers.completion.provideCompletionItems(
      model as never,
      { lineNumber: 3, column: line.length + 1 },
      { triggerKind: 1 },
      { isCancellationRequested: false },
    );
    expect(find(result, "getName").insertText).toContain("return name;");
  });

  /**
   * Two types with one name.
   *
   * `List` is java.util.List and it is also java.awt.List. Both arrived as
   * identical rows, and picking one added an import that decides what every
   * other `List` in the file refers to.
   */
  const importRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

  it("offers the fully qualified name where a name means two types", async () => {
    const conflicting = [
      {
        label: "List",
        kind: 7,
        labelDetails: { description: "java.util" },
        additionalTextEdits: [{ range: importRange, newText: "import java.util.List;\n" }],
      },
      {
        label: "List",
        kind: 7,
        labelDetails: { description: "java.awt" },
        additionalTextEdits: [{ range: importRange, newText: "import java.awt.List;\n" }],
      },
    ];
    const result = await complete("        Lis", conflicting);
    const qualified = result.suggestions.filter((item: any) =>
      typeof item.label === "object" && item.label.description?.includes("vollqualifiziert"));
    expect(qualified.map((item: any) => item.insertText).sort())
      .toEqual(["java.awt.List", "java.util.List"]);
    // The whole point of the alternative: it adds no import.
    expect(qualified.every((item: any) => !item.additionalTextEdits)).toBe(true);
    // And it is still found by what is being typed.
    expect(qualified.every((item: any) => item.filterText === "List")).toBe(true);
  });

  it("says nothing extra where a name means one type", async () => {
    const result = await complete("        Lis", [
      {
        label: "List",
        kind: 7,
        labelDetails: { description: "java.util" },
        additionalTextEdits: [{ range: importRange, newText: "import java.util.List;\n" }],
      },
    ]);
    expect(result.suggestions.some((item: any) =>
      typeof item.label === "object" && item.label.description?.includes("vollqualifiziert"))).toBe(false);
  });

  it("adds nothing of its own once both settings are off", async () => {
    const result = await complete(
      "        List<String> namen = new ArrayL",
      [{ label: "ArrayList", kind: 7, detail: "java.util.ArrayList" }],
      { finishStatements: false, localMembers: false },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(find(result, "ArrayList").insertText).toBe("ArrayList");
  });
});
