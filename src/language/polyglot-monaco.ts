import type * as Monaco from "monaco-editor";
import type { KiwiApi } from "../types";
import { monacoCompletionKind } from "./completion-kinds";
import { isPolyglotLanguage, languageDisplayName, polyglotLanguages, sourceLanguage } from "./language-catalog";

type MonacoApi = typeof import("monaco-editor");
type PolyglotApi = KiwiApi["polyglot"];
type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } };

export interface LocalSuggestion {
  label: string;
  insertText: string;
  kind: "Keyword" | "Function" | "Class" | "Variable" | "Snippet" | "Module" | "Property";
  detail: string;
  snippet?: boolean;
}

/** Standard-library namespaces that are useful before a server is installed. */
const members: Record<string, Record<string, string>> = {
  javascript: {
    console: "log error warn info debug table time timeEnd trace dir clear",
    Math: "abs acos asin atan atan2 ceil cos exp floor log max min pow random round sin sqrt tan trunc PI E",
    JSON: "parse stringify",
    Object: "assign create defineProperty entries freeze fromEntries getOwnPropertyNames getOwnPropertySymbols getPrototypeOf hasOwn is isExtensible isFrozen isSealed keys seal setPrototypeOf values",
    Array: "from isArray of",
    Promise: "all allSettled any race resolve reject",
    process: "argv env exit cwd nextTick platform stdout stderr stdin uptime version versions",
    fs: "readFile readFileSync writeFile writeFileSync mkdir mkdirSync readdir readdirSync stat statSync existsSync unlink unlinkSync createReadStream createWriteStream",
    path: "join resolve dirname basename extname normalize relative isAbsolute delimiter sep parse format",
    http: "createServer request get",
  },
  typescript: {
    console: "log error warn info debug table time timeEnd trace dir clear",
    Math: "abs acos asin atan atan2 ceil cos exp floor log max min pow random round sin sqrt tan trunc PI E",
    JSON: "parse stringify",
    Object: "assign create defineProperty entries freeze fromEntries getOwnPropertyNames getOwnPropertySymbols getPrototypeOf hasOwn is isExtensible isFrozen isSealed keys seal setPrototypeOf values",
    Array: "from isArray of",
    Promise: "all allSettled any race resolve reject",
    process: "argv env exit cwd nextTick platform stdout stderr stdin uptime version versions",
    fs: "readFile readFileSync writeFile writeFileSync mkdir mkdirSync readdir readdirSync stat statSync existsSync unlink unlinkSync createReadStream createWriteStream",
    path: "join resolve dirname basename extname normalize relative isAbsolute delimiter sep parse format",
    http: "createServer request get",
  },
  python: {
    str: "capitalize casefold center count encode endswith expandtabs find format index isalnum isalpha isdigit islower isspace isupper join ljust lower lstrip partition removeprefix removesuffix replace rfind rjust rpartition rsplit rstrip split splitlines startswith strip swapcase title upper zfill",
    list: "append clear copy count extend index insert pop remove reverse sort",
    dict: "clear copy fromkeys get items keys pop popitem setdefault update values",
    set: "add clear copy difference discard intersection isdisjoint issubset issuperset pop remove symmetric_difference union update",
    os: "chdir environ getcwd getenv listdir makedirs mkdir path remove rename replace rmdir stat walk",
    sys: "argv executable exit path platform stderr stdin stdout version",
    math: "ceil cos degrees e exp fabs factorial floor inf isclose isnan log log10 pi pow radians sin sqrt tan trunc",
    json: "dump dumps load loads JSONDecodeError",
    pathlib: "Path PurePath PurePosixPath PureWindowsPath",
  },
  go: {
    fmt: "Errorf Fprint Fprintf Fprintln Fscan Fscanf Print Printf Println Scan Scanf Sscan Sscanf Sprint Sprintf Sprintln",
    strings: "Builder Compare Contains Count Cut EqualFold Fields HasPrefix HasSuffix Index Join Replace ReplaceAll Split SplitN ToLower ToUpper Trim TrimPrefix TrimSpace TrimSuffix",
    os: "Args Chdir Create Environ Exit Getenv Getwd Mkdir MkdirAll Open OpenFile ReadDir ReadFile Remove RemoveAll Rename Setenv Stderr Stdin Stdout WriteFile",
    errors: "As Is Join New Unwrap",
    strconv: "Atoi FormatBool FormatFloat FormatInt Itoa ParseBool ParseFloat ParseInt ParseUint Quote Unquote",
    time: "After Date Duration Hour Millisecond Minute NewTicker NewTimer Now Parse Second Since Sleep Time Until",
  },
  lua: {
    math: "abs acos asin atan ceil cos deg exp floor fmod huge log max maxinteger min mininteger modf pi rad random randomseed sin sqrt tan tointeger type ult",
    string: "byte char dump find format gmatch gsub len lower match pack packsize rep reverse sub unpack upper",
    table: "concat insert move pack remove sort unpack",
    io: "close flush input lines open output popen read stderr stdin stdout tmpfile type write",
    os: "clock date difftime execute exit getenv remove rename setlocale time tmpname",
    coroutine: "close create isyieldable resume running status wrap yield",
    utf8: "char charpattern codepoint codes len offset",
  },
  rust: {
    String: "new from from_utf8 with_capacity",
    Vec: "new with_capacity from",
    Option: "Some None",
    Result: "Ok Err",
    std: "any borrow boxed cell cmp collections convert default env error ffi fmt fs future hash io iter marker mem net num ops option os panic path pin process ptr rc result slice str string sync task thread time vec",
    str: "as_bytes chars contains ends_with find is_empty len lines parse replace split split_whitespace starts_with to_lowercase to_owned to_string to_uppercase trim",
    vec: "append capacity clear contains drain extend first get insert is_empty iter iter_mut last len pop push remove reserve retain sort truncate",
  },
  kotlin: {
    string: "contains endsWith equals first format get indexOf isBlank isEmpty last length lines lowercase replace split startsWith substring toDouble toInt toLong trim uppercase",
    list: "add addAll all any asSequence clear contains count distinct filter find first firstOrNull forEach get groupBy isEmpty joinToString last map remove removeAt reversed size sorted take toList",
  },
  csharp: {
    Console: "BackgroundColor Clear Error ForegroundColor In KeyAvailable Out Read ReadKey ReadLine ResetColor SetCursorPosition Title Write WriteLine",
    Math: "Abs Acos Asin Atan Ceiling Clamp Cos E Exp Floor Log Log10 Max Min PI Pow Round Sign Sin Sqrt Tan Truncate",
    string: "Compare Concat Empty Equals Format IsNullOrEmpty IsNullOrWhiteSpace Join",
    String: "Compare Concat Empty Equals Format IsNullOrEmpty IsNullOrWhiteSpace Join",
    Task: "CompletedTask Delay FromResult Run WhenAll WhenAny Yield",
    Enumerable: "Empty Range Repeat",
    stringValue: "Contains EndsWith Equals IndexOf Insert Length PadLeft PadRight Remove Replace Split StartsWith Substring ToLower ToUpper Trim TrimEnd TrimStart",
    list: "Add AddRange Clear Contains Count Find FindAll ForEach GetEnumerator IndexOf Insert Remove RemoveAt Reverse Sort ToArray",
  },
  c: {
    FILE: "read write seek tell close eof error flush",
    string: "strlen strcmp strncmp strcpy strncpy strcat strncat strchr strrchr strstr strtok memcpy memmove memset memcmp",
  },
  cpp: {
    std: "array begin cerr cin copy cout deque endl end exception find forward function getline make_shared make_unique map max min move optional pair printf set shared_ptr sort span string string_view swap tuple unique_ptr unordered_map unordered_set variant vector weak_ptr",
    string: "size length empty c_str substr find rfind replace compare starts_with ends_with contains append push_back pop_back clear at front back",
    vector: "size empty push_back pop_back emplace_back clear at front back data begin end rbegin rend resize reserve capacity shrink_to_fit insert erase",
  },
  php: {
    DateTime: "createFromFormat getLastErrors diff format getOffset getTimestamp getTimezone modify setDate setISODate setTime setTimestamp setTimezone sub add",
    PDO: "beginTransaction commit rollBack inTransaction exec query prepare lastInsertId quote getAttribute setAttribute getAvailableDrivers",
    PDOStatement: "execute fetch fetchAll fetchColumn fetchObject rowCount closeCursor bindParam bindValue bindColumn getColumnMeta",
    Exception: "getMessage getCode getFile getLine getTrace getTraceAsString getPrevious",
    Response: "getStatusCode getHeaders getBody withStatus withHeader withBody",
    Request: "getMethod getUri getHeaders getQueryParams getParsedBody getBody withMethod withUri",
  },
  "objective-c": {
    NSString: "string stringWithFormat stringWithUTF8String length characterAtIndex substringFromIndex substringToIndex substringWithRange hasPrefix hasSuffix isEqualToString stringByAppendingString UTF8String",
    NSArray: "array arrayWithObject arrayWithObjects count objectAtIndex containsObject indexOfObject firstObject lastObject",
    NSDictionary: "dictionary dictionaryWithObject dictionaryWithObjects count objectForKey allKeys allValues",
  },
};

/** Comments and literals do not declare completion candidates. Keep line breaks. */
export function declarationSource(languageId: string, source: string): string {
  const preserveLines = (value: string) => value.replace(/[^\r\n]/g, " ");
  let text = source;
  if (languageId === "python") {
    text = text.replace(/(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"|#[^\r\n]*)/g, preserveLines);
  } else if (languageId === "lua") {
    text = text.replace(/--\[\[[\s\S]*?\]\]|\[\[[\s\S]*?\]\]|'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"|--[^\r\n]*/g, preserveLines);
  } else {
    text = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"/g, preserveLines);
    if (languageId === "php") text = text.replace(/#[^\r\n]*/g, preserveLines);
  }
  return text;
}

export function localSymbols(languageId: string, source: string): LocalSuggestion[] {
  const text = declarationSource(languageId, source.slice(0, 500_000));
  const result = new Map<string, LocalSuggestion>();
  const add = (label: string, kind: LocalSuggestion["kind"]) => {
    if (!label || sourceLanguage(languageId)?.keywords.includes(label)) return;
    result.set(label, { label, insertText: label, kind, detail: "Symbol in this file" });
  };
  const collect = (pattern: RegExp, kind: LocalSuggestion["kind"], group = 1) => {
    for (const match of text.matchAll(pattern)) add(match[group], kind);
  };
  if (languageId === "python") {
    collect(/\b(?:async\s+)?def\s+([A-Za-z_]\w*)/g, "Function");
    collect(/\bclass\s+([A-Za-z_]\w*)/g, "Class");
    collect(/^\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/gm, "Variable");
    collect(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g, "Variable");
    for (const match of text.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) {
      for (const parameter of match[1].split(",")) add(parameter.trim().replace(/^\*+/, "").match(/^([A-Za-z_]\w*)/)?.[1] || "", "Variable");
    }
  } else if (languageId === "kotlin") {
    collect(/\bfun\s+(?:<[^>]+>\s*)?(?:[\w<>?.]+\.)?([A-Za-z_]\w*)\s*\(/g, "Function");
    collect(/\b(?:class|interface|object|typealias)\s+([A-Za-z_]\w*)/g, "Class");
    collect(/\b(?:val|var)\s+([A-Za-z_]\w*)/g, "Variable");
    collect(/\b([A-Za-z_]\w*)\s*:\s*[A-Za-z_]/g, "Variable");
  } else if (languageId === "rust") {
    collect(/\bfn\s+([A-Za-z_]\w*)/g, "Function");
    collect(/\b(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/g, "Class");
    collect(/\b(?:let\s+(?:mut\s+)?|const\s+|static\s+(?:mut\s+)?)([A-Za-z_]\w*)/g, "Variable");
    collect(/\b([A-Za-z_]\w*)\s*:\s*(?:&\s*)?[A-Za-z_]/g, "Variable");
    collect(/\bmod\s+([A-Za-z_]\w*)/g, "Module");
  } else if (languageId === "php") {
    collect(/\bfunction\s+&?\s*([A-Za-z_]\w*)/g, "Function");
    collect(/\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/g, "Class");
    collect(/(\$[A-Za-z_]\w*)/g, "Variable");
  } else if (languageId === "lua") {
    collect(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g, "Function");
    collect(/\b(?:local\s+|for\s+)([A-Za-z_]\w*)/g, "Variable");
    collect(/^\s*([A-Za-z_]\w*)\s*=/gm, "Variable");
    for (const match of text.matchAll(/\bfunction\s*[\w.:]*\s*\(([^)]*)\)/g)) {
      for (const parameter of match[1].split(",")) if (/^[A-Za-z_]\w*$/.test(parameter.trim())) add(parameter.trim(), "Variable");
    }
  } else if (languageId === "go") {
    collect(/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g, "Function");
    collect(/\btype\s+([A-Za-z_]\w*)/g, "Class");
    collect(/\b(?:var|const)\s+([A-Za-z_]\w*)/g, "Variable");
    collect(/\b([A-Za-z_]\w*)\s*:=/g, "Variable");
    collect(/^\s*([A-Za-z_]\w*)\s+(?:\[\])?\*?[A-Za-z_][\w.]*/gm, "Variable");
  } else {
    collect(/\b(?:class|struct|enum|interface|record|namespace)\s+([A-Za-z_]\w*)/g, "Class");
    collect(/\b(?:[A-Za-z_]\w*(?:::\w+)*(?:<[^;{}\n]+>)?[\s*&]+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:\{|=>)/g, "Function");
    collect(/\b(?:var|int|char|long|short|float|double|bool|string|auto|size_t|NSInteger|NSUInteger|NSString|id)\s*[*&]?\s+([A-Za-z_]\w*)/g, "Variable");
    collect(/\b(?:[A-Za-z_]\w*(?:::\w+)*(?:<[^;{}\n]+>)?[\s*&]+)+([A-Za-z_]\w*)\s*(?:=|;|,|\))/g, "Variable");
    collect(/@(?:interface|implementation|protocol)\s+([A-Za-z_]\w*)/g, "Class");
  }
  return [...result.values()].slice(0, 600);
}

function receiverKind(languageId: string, receiver: string, source: string): string {
  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (languageId === "python") {
    if (new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*[rubf]*["']`, "i").test(source)) return "str";
    if (new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*(?:\\[|list\\()`).test(source)) return "list";
    if (new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*(?:\\{|dict\\()`).test(source)) return "dict";
  }
  if (languageId === "rust") {
    if (new RegExp(`\\b${escaped}\\s*=\\s*(?:Vec::|vec!)`).test(source)) return "vec";
    if (new RegExp(`\\b${escaped}\\s*=\\s*(?:String::|["'])`).test(source)) return "str";
  }
  if (languageId === "kotlin") {
    if (new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*"`).test(source)) return "string";
    if (new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*(?:mutableListOf|listOf)\\(`).test(source)) return "list";
  }
  if (languageId === "csharp") {
    if (new RegExp(`\\b(?:string\\s+${escaped}|${escaped}\\s*=\\s*")`).test(source)) return "stringValue";
    if (new RegExp(`\\b${escaped}\\s*=\\s*new\\s+List\\b`).test(source)) return "list";
  }
  if (languageId === "cpp") {
    if (new RegExp(`\\b(?:std::)?string\\s+${escaped}\\b`).test(source)) return "string";
    if (new RegExp(`\\b(?:std::)?vector\\s*<[^>]+>\\s+${escaped}\\b`).test(source)) return "vector";
  }
  if (languageId === "php") {
    if (new RegExp(`\\b${escaped}\\s*=\\s*new\\s+DateTime\\b`, "i").test(source)) return "DateTime";
    if (new RegExp(`\\b${escaped}\\s*=\\s*new\\s+PDO\\b`, "i").test(source)) return "PDO";
  }
  return receiver;
}

/** Local completions remain usable while a server starts or is unavailable. */
export function fallbackSuggestions(languageId: string, source: string, beforeCursor: string): LocalSuggestion[] {
  const language = sourceLanguage(languageId);
  if (!language?.externalServer) return [];
  const member = beforeCursor.match(/(\$?[A-Za-z_]\w*)\s*(?:\.|::|->|:)\s*[A-Za-z_\d]*$/);
  if (member) {
    const receiver = member[1];
    const family = languageId === "objective-cpp" ? "cpp" : languageId;
    const known = members[family]?.[receiverKind(family, receiver, source)] || "";
    const suggestions = known.split(" ").filter(Boolean).map((label): LocalSuggestion => ({ label, insertText: label, kind: "Property", detail: `${receiver} · standard library` }));
    if (["self", "this", "$this"].includes(receiver)) {
      suggestions.push(...localSymbols(languageId, source).filter((item) => item.kind === "Function"));
    }
    return suggestions;
  }
  return [
    ...localSymbols(languageId, source),
    ...language.snippets.map((item): LocalSuggestion => ({ ...item, kind: "Snippet", snippet: true })),
    ...language.builtins.map((label): LocalSuggestion => ({ label, insertText: label, kind: /^[A-Z]/.test(label) ? "Class" : "Function", detail: `${language.name} · standard library` })),
    ...language.keywords.map((label): LocalSuggestion => ({ label, insertText: label, kind: "Keyword", detail: `${language.name} · keyword` })),
  ];
}

export function lspRange(range: LspRange): Monaco.IRange {
  return { startLineNumber: range.start.line + 1, startColumn: range.start.character + 1, endLineNumber: range.end.line + 1, endColumn: range.end.character + 1 };
}

/** Windows file URIs may encode the drive colon and use another drive casing. */
export function languageModelPathKey(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/\/$/, "");
  return /^(?:[A-Za-z]:|\/\/)/.test(normalized) ? normalized.toLowerCase() : normalized;
}

const lspPosition = (cursor: Monaco.IPosition) => ({ line: cursor.lineNumber - 1, character: cursor.column - 1 });
const textEdit = (edit: { range: LspRange; newText: string }): Monaco.languages.TextEdit => ({ range: lspRange(edit.range), text: edit.newText });
const documentation = (value: any): Monaco.IMarkdownString[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(documentation);
  const text = typeof value === "string" ? value : value.value;
  if (typeof text !== "string") return [];
  return [{ value: value.language ? `\`\`\`${value.language}\n${text}\n\`\`\`` : text, isTrusted: false, supportHtml: false }];
};

/** LSP InsertReplaceEdit uses Monaco's matching insert/replace range shape. */
export function completionFromLsp(monaco: MonacoApi, item: any, defaults: any, fallbackRange: Monaco.IRange): Monaco.languages.CompletionItem | null {
  if (typeof item?.label !== "string") return null;
  const edit = item.textEdit;
  const editRange = edit?.range || defaults?.editRange;
  const replaceRange = edit?.replace || editRange?.replace;
  const insertRange = edit?.insert || editRange?.insert;
  const range = insertRange && replaceRange
    ? { insert: lspRange(insertRange), replace: lspRange(replaceRange) }
    : editRange?.start ? lspRange(editRange) : fallbackRange;
  return {
    label: item.labelDetails ? { label: item.label, ...item.labelDetails } : item.label,
    kind: monacoCompletionKind(item.kind, monaco.languages.CompletionItemKind) as Monaco.languages.CompletionItemKind,
    insertText: edit?.newText ?? item.textEditText ?? item.insertText ?? item.label,
    insertTextRules: (item.insertTextFormat ?? defaults?.insertTextFormat) === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range,
    detail: item.detail,
    documentation: documentation(item.documentation)[0],
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    commitCharacters: item.commitCharacters ?? defaults?.commitCharacters,
    tags: item.tags,
    additionalTextEdits: item.additionalTextEdits?.map(textEdit),
  };
}

type TrackedModel = {
  model: Monaco.editor.ITextModel;
  root: string;
  languageId: string;
  available: boolean;
  syncedVersion: number;
  lastAttempt: number;
  queue: Promise<boolean>;
  listeners: Monaco.IDisposable[];
  timer?: ReturnType<typeof setTimeout>;
  released: boolean;
  closing?: Promise<boolean>;
};

export interface PolyglotLanguageController extends Monaco.IDisposable {
  /** Force reopening also picks up changed server settings or a new install. */
  refreshModels(force?: boolean): void;
}

/** Installs providers and owns the complete lifecycle of non-Java documents. */
export function registerPolyglotLanguageProviders(
  monaco: MonacoApi,
  api: KiwiApi,
  getRootForModel: (model: Monaco.editor.ITextModel) => string,
): PolyglotLanguageController {
  const bridge: PolyglotApi | undefined = api.polyglot;
  const disposables: Monaco.IDisposable[] = [];
  const tracked = new Map<string, TrackedModel>();
  const resolvedItems = new WeakMap<Monaco.languages.CompletionItem, { model: Monaco.editor.ITextModel; item: any }>();
  let disposed = false;
  let requestSequence = 0;
  const owner = "kiwi-polyglot";

  // Monaco bundles Objective-C and C++ separately but has no .mm registration.
  if (!monaco.languages.getLanguages().some((language) => language.id === "objective-cpp")) {
    monaco.languages.register({ id: "objective-cpp", aliases: ["Objective-C++"], extensions: [".mm"] });
    // The language registration is window-wide, like Monaco's bundled
    // grammars; remounting an editor must not remove the .mm tokenizer.
    monaco.languages.setLanguageConfiguration("objective-cpp", {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] }, brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
      autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"', notIn: ["string"] }],
    });
    monaco.languages.setMonarchTokensProvider("objective-cpp", {
      keywords: sourceLanguage("objective-cpp")!.keywords, tokenizer: {
        root: [
          [/\/\*/, "comment", "@comment"], [/\/\/.*$/, "comment"], [/^\s*#.*/, "keyword"],
          [/@?"/, "string", "@string"], [/'(?:\\.|[^'\\])*'/, "string"],
          [/@?[A-Za-z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
          [/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uUlLfF]*/, "number"], [/[{}()[\]]/, "@brackets"],
        ],
        comment: [[/[^/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[/*]/, "comment"]],
        string: [[/[^\\"]+/, "string"], [/\\./, "string.escape"], [/"/, "string", "@pop"]],
      },
    });
  }

  const release = (state: TrackedModel) => {
    if (state.released) return state.closing || Promise.resolve(true);
    state.released = true;
    clearTimeout(state.timer);
    state.listeners.forEach((listener) => listener.dispose());
    if (tracked.get(state.model.uri.toString()) === state) tracked.delete(state.model.uri.toString());
    monaco.editor.setModelMarkers(state.model, owner, []);
    // A model can close while initialize is still in flight. Close after the
    // final synchronization, so a late open cannot leave a ghost document.
    state.closing = state.queue.catch(() => false).then(async () => {
      await bridge?.close({ root: state.root, file: state.model.uri.fsPath });
      return true;
    }).catch(() => false);
    return state.closing;
  };

  const sync = (state: TrackedModel): Promise<boolean> => {
    state.queue = state.queue.catch(() => false).then(async () => {
      if (state.released || disposed || !bridge || state.model.isDisposed()) return false;
      const version = state.model.getVersionId();
      const text = state.model.getValue();
      if (!state.available) {
        if (state.lastAttempt && Date.now() - state.lastAttempt < 3_000) return false;
        state.lastAttempt = Date.now();
        const result = await bridge.open({ root: state.root, file: state.model.uri.fsPath, text, languageId: state.languageId });
        state.available = Boolean(result.available);
        if (state.available) state.syncedVersion = version;
      } else if (version !== state.syncedVersion) {
        const changed = await bridge.change({ root: state.root, file: state.model.uri.fsPath, text });
        if (changed) state.syncedVersion = version;
        else { state.available = false; state.lastAttempt = 0; }
      }
      return state.available;
    }).catch(() => { state.available = false; return false; });
    return state.queue;
  };

  const track = (model: Monaco.editor.ITextModel, force = false): TrackedModel | undefined => {
    const key = model.uri.toString();
    const languageId = model.getLanguageId();
    const root = getRootForModel(model);
    const previous = tracked.get(key);
    if (!root || model.uri.scheme !== "file" || !isPolyglotLanguage(languageId)) {
      if (previous) release(previous);
      return undefined;
    }
    if (previous && previous.root === root && previous.languageId === languageId && !force) return previous;
    const closing = previous ? release(previous) : null;
    const state: TrackedModel = { model, root, languageId, available: false, syncedVersion: 0, lastAttempt: 0, queue: Promise.resolve(false), listeners: [], released: false };
    tracked.set(key, state);
    state.listeners.push(model.onDidChangeContent(() => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { void sync(state); }, 80);
    }), model.onWillDispose(() => release(state)));
    // Preserve close-before-reopen order when settings/root association change.
    if (closing) state.queue = closing.then(() => false);
    void sync(state);
    return state;
  };

  const request = async (model: Monaco.editor.ITextModel, method: string, params: Record<string, unknown>, token?: Monaco.CancellationToken, budget = 5_000): Promise<any> => {
    const state = track(model);
    if (!state || !bridge || token?.isCancellationRequested) return null;
    const version = model.getVersionId();
    const requestId = `polyglot-${Date.now()}-${++requestSequence}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveCancelled: (value: null) => void = () => undefined;
    const cancellation = new Promise<null>((resolve) => { resolveCancelled = resolve; });
    const cancel = () => { cancelled = true; resolveCancelled(null); void bridge.cancel(requestId).catch(() => undefined); };
    const subscription = token?.onCancellationRequested(cancel);
    try {
      const task = (async () => {
        if (!await sync(state) || cancelled || state.released) return null;
        return bridge.request({ root: state.root, file: model.uri.fsPath, languageId: state.languageId, method, params: method === "completionItem/resolve" ? params : { textDocument: { uri: model.uri.toString() }, ...params }, requestId });
      })();
      const result = await Promise.race([task, cancellation, new Promise<null>((resolve) => {
        timer = setTimeout(() => { cancel(); resolve(null); }, budget);
      })]);
      return !cancelled && !model.isDisposed() && model.getVersionId() === version && tracked.get(model.uri.toString()) === state ? result : null;
    } catch { return null; }
    finally { clearTimeout(timer); subscription?.dispose(); }
  };

  for (const language of polyglotLanguages) {
    disposables.push(monaco.languages.registerCompletionItemProvider(language.id, {
      triggerCharacters: [".", ":", ">", "$", "@"],
      provideCompletionItems: async (model, cursor, context, token) => {
        const version = model.getVersionId();
        const word = model.getWordUntilPosition(cursor);
        const range = { startLineNumber: cursor.lineNumber, startColumn: word.startColumn, endLineNumber: cursor.lineNumber, endColumn: word.endColumn };
        const before = model.getLineContent(cursor.lineNumber).slice(0, cursor.column - 1);
        const local = fallbackSuggestions(language.id, model.getValue(), before);
        const result = await request(model, "textDocument/completion", { position: lspPosition(cursor), context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter } }, token, 1_200);
        if (model.isDisposed() || model.getVersionId() !== version || token.isCancellationRequested) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result?.items || [];
        const suggestions: Monaco.languages.CompletionItem[] = [];
        const remoteNames = new Set<string>();
        for (const item of items) {
          const mapped = completionFromLsp(monaco, item, result?.itemDefaults, range);
          if (!mapped) continue;
          remoteNames.add(item.label);
          resolvedItems.set(mapped, { model, item: { ...item, data: item.data ?? result?.itemDefaults?.data } });
          suggestions.push(mapped);
        }
        const localKeys = new Set<string>();
        for (const item of local) {
          const key = `${item.label}:${item.kind}`;
          if (remoteNames.has(item.label) || localKeys.has(key)) continue;
          localKeys.add(key);
          suggestions.push({ label: item.label, insertText: item.insertText, kind: monaco.languages.CompletionItemKind[item.kind], range, detail: item.detail, insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined, sortText: `z-${item.kind === "Variable" ? "0" : item.kind === "Snippet" ? "1" : "2"}-${item.label}` });
        }
        return { suggestions, incomplete: Boolean(result?.isIncomplete) || !tracked.get(model.uri.toString())?.available };
      },
      resolveCompletionItem: async (item, token) => {
        const original = resolvedItems.get(item);
        if (!original) return item;
        const state = track(original.model);
        if (!state || !bridge || token.isCancellationRequested) return item;
        const resolved = await request(original.model, "completionItem/resolve", original.item, token, 2_000);
        if (!resolved) return item;
        return completionFromLsp(monaco, { ...original.item, ...resolved }, {}, item.range as Monaco.IRange) || item;
      },
    }));
    disposables.push(monaco.languages.registerHoverProvider(language.id, {
      provideHover: async (model, cursor, token) => {
        const result = await request(model, "textDocument/hover", { position: lspPosition(cursor) }, token);
        const contents = documentation(result?.contents);
        return contents.length ? { contents, range: result.range ? lspRange(result.range) : undefined } : null;
      },
    }));
    disposables.push(monaco.languages.registerDefinitionProvider(language.id, {
      provideDefinition: async (model, cursor, token) => {
        const result = await request(model, "textDocument/definition", { position: lspPosition(cursor) }, token);
        if (!result) return null;
        return (Array.isArray(result) ? result : [result]).flatMap((item) => {
          const uri = item.targetUri || item.uri;
          const range = item.targetSelectionRange || item.targetRange || item.range;
          return typeof uri === "string" && range ? [{ uri: monaco.Uri.parse(uri), range: lspRange(range) }] : [];
        });
      },
    }));
    disposables.push(monaco.languages.registerReferenceProvider(language.id, {
      provideReferences: async (model, cursor, context, token) => {
        const result = await request(model, "textDocument/references", { position: lspPosition(cursor), context: { includeDeclaration: context.includeDeclaration } }, token);
        return (Array.isArray(result) ? result : []).filter((item) => item.uri && item.range).map((item) => ({ uri: monaco.Uri.parse(item.uri), range: lspRange(item.range) }));
      },
    }));
    disposables.push(monaco.languages.registerDocumentFormattingEditProvider(language.id, {
      provideDocumentFormattingEdits: async (model, options, token) => {
        const result = await request(model, "textDocument/formatting", { options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } }, token, 10_000);
        return Array.isArray(result) ? result.map(textEdit) : [];
      },
    }));
    disposables.push(monaco.languages.registerDocumentSymbolProvider(language.id, {
      provideDocumentSymbols: async (model, token) => {
        const result = await request(model, "textDocument/documentSymbol", {}, token);
        const mapSymbol = (item: any): Monaco.languages.DocumentSymbol => ({ name: item.name, detail: item.detail || "", kind: Math.max(0, (item.kind || 1) - 1), tags: item.tags || [], range: lspRange(item.range || item.location.range), selectionRange: lspRange(item.selectionRange || item.range || item.location.range), children: item.children?.map(mapSymbol) });
        return Array.isArray(result) ? result.map(mapSymbol) : [];
      },
    }));
    disposables.push(monaco.languages.registerSignatureHelpProvider(language.id, {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp: async (model, cursor, token) => {
        const result = await request(model, "textDocument/signatureHelp", { position: lspPosition(cursor) }, token);
        if (!result?.signatures?.length) return null;
        return { value: { activeSignature: result.activeSignature || 0, activeParameter: result.activeParameter || 0, signatures: result.signatures.map((signature: any) => ({ label: signature.label, documentation: documentation(signature.documentation)[0], parameters: (signature.parameters || []).map((parameter: any) => ({ label: parameter.label, documentation: documentation(parameter.documentation)[0] })) })) }, dispose: () => undefined };
      },
    }));
    if (typeof monaco.languages.registerCodeLensProvider === "function") {
      disposables.push(monaco.languages.registerCodeLensProvider(language.id, {
        provideCodeLenses: (model) => {
          const lenses: Monaco.languages.CodeLens[] = [];
          const lines = model.getLinesContent();
          for (let i = 0; i < lines.length; i++) {
            const text = lines[i];
            const lineNum = i + 1;
            let isEntry = false;
            if (language.id === "python" && (/^\s*def\s+main\s*\(/.test(text) || /^\s*if\s+__name__\s*==\s*['"]__main__['"]/.test(text))) isEntry = true;
            else if (language.id === "kotlin" && /^\s*fun\s+main\s*\(/.test(text)) isEntry = true;
            else if (language.id === "rust" && /^\s*(?:pub\s+)?fn\s+main\s*\(/.test(text)) isEntry = true;
            else if (language.id === "go" && /^\s*func\s+main\s*\(/.test(text)) isEntry = true;
            else if ((language.id === "c" || language.id === "cpp") && /^\s*(?:int|void)\s+main\s*\(/.test(text)) isEntry = true;
            else if (language.id === "csharp" && (/^\s*(?:static\s+)?(?:void|int|async\s+Task(?:<int>)?)\s+Main\s*\(/.test(text) || /^\s*Console\.(?:WriteLine|Write)\s*\(/.test(text))) isEntry = true;
            else if (language.id === "lua" && (/^\s*(?:local\s+)?function\s+main\s*\(/.test(text) || /^\s*main\s*\(\s*\)/.test(text))) isEntry = true;
            else if (language.id === "php" && (/^\s*function\s+main\s*\(/.test(text) || (lineNum === 1 && /^\s*<\?php/.test(text)))) isEntry = true;

            if (isEntry) {
              lenses.push({
                range: new monaco.Range(lineNum, 1, lineNum, 1),
                command: {
                  id: "kiwi.runPolyglotLens",
                  title: "▶ Run",
                  arguments: [model.uri.fsPath, language.id],
                },
              });
            }
          }
          return { lenses, dispose: () => {} };
        },
      }));
    }
  }

  if (bridge) disposables.push({ dispose: bridge.onDiagnostics((payload) => {
    let state = tracked.get(payload.uri);
    if (!state) {
      try {
        const fileKey = languageModelPathKey(monaco.Uri.parse(payload.uri).fsPath);
        state = [...tracked.values()].find((entry) => languageModelPathKey(entry.model.uri.fsPath) === fileKey);
      } catch { return; }
    }
    if (!state || state.released || languageModelPathKey(state.root) !== languageModelPathKey(payload.root) || state.languageId !== payload.languageId) return;
    // A didChange is queued after a keystroke. Avoid reattaching old diagnostics
    // to text that the server has not seen yet.
    if (state.model.getVersionId() !== state.syncedVersion) return;
    monaco.editor.setModelMarkers(state.model, owner, (payload.diagnostics || []).map((item: any): Monaco.editor.IMarkerData => ({
      ...lspRange(item.range), message: String(item.message || ""),
      severity: item.severity === 1 ? monaco.MarkerSeverity.Error : item.severity === 2 ? monaco.MarkerSeverity.Warning : item.severity === 4 ? monaco.MarkerSeverity.Hint : monaco.MarkerSeverity.Info,
      source: item.source || languageDisplayName(payload.languageId), code: item.code === undefined ? undefined : String(item.code),
      tags: item.tags,
    })));
  }) });
  if (bridge) disposables.push({ dispose: bridge.onStatus((payload) => {
    if (payload.available || !["stopped", "error", "missing", "disabled"].includes(payload.status)) return;
    for (const state of tracked.values()) {
      if (state.root !== payload.root || state.languageId !== payload.languageId) continue;
      state.available = false;
      state.lastAttempt = payload.status === "stopped" ? 0 : Date.now();
      monaco.editor.setModelMarkers(state.model, owner, []);
    }
  }) });
  disposables.push(monaco.editor.onDidCreateModel((model) => { track(model); }));
  disposables.push(monaco.editor.onDidChangeModelLanguage(({ model }) => { track(model); }));
  monaco.editor.getModels().forEach((model) => { track(model); });

  return {
    refreshModels(force = true) { if (!disposed) monaco.editor.getModels().forEach((model) => { track(model, force); }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      [...tracked.values()].forEach(release);
      disposables.forEach((item) => item.dispose());
    },
  };
}
