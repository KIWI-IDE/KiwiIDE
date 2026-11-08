import type * as Monaco from "monaco-editor";
import { findJavaRegions } from "./java-regions";
import { isLibraryUri } from "./library-source";
import { isCacheEntryUsable, withoutStalePositions } from "./completion-cache";
import {
  pruneUsage,
  readUsageStore,
  recordUsage,
  usageKey as buildUsageKey,
  usageScore as decayedUsageScore,
  type UsageStore,
} from "./completion-usage";
import {
  completionOrigin,
  groupOverloads,
  importPreview,
  overloadLabel,
  type OriginContext,
} from "./completion-presentation";
import type { CompletionSettings, KiwiApi } from "../types";
import { monacoCompletionKind } from "./completion-kinds";
import {
  expectedTypeAt,
  functionalResultType,
  insideLambdaBody,
  type ExpectedType,
} from "./expected-type";
import { QUALIFIED_NOTE, qualifiedAlternatives, qualifiedNameOf } from "./import-choice";
import {
  isBatchableFix,
  mergeFixEdits,
  type FixCandidate,
  type MergedFixes,
} from "./fix-all";
import {
  CompletionRequestGate,
  completionLabel,
  dedupeAndRankCompletions,
  improveArgumentDefaults,
  parameterTypesFromSignature,
  javaTemplates,
  type CompletionIntent,
  type RankedCompletion,
} from "./completion-controller";
import {
  completeNewExpression,
  memberAccessReceiver,
  genericArity,
  localMemberCompletions,
  methodNameProposals,
  parseJavaMembers,
} from "./java-completion";

type MonacoApi = typeof import("monaco-editor");

export interface JavaLanguageController extends Monaco.IDisposable {
  setCompletionIntent(intent: CompletionIntent): CompletionIntent;
  organizeImports(model: Monaco.editor.ITextModel): Promise<string[]>;
  /** Hands over the legend from the server's initialize result. */
  setSemanticTokenLegend(legend: SemanticTokenLegend | null): void;
  /**
   * What the call accepted from the suggestion list on this line returns.
   *
   * Empty when nothing was accepted there, which the caller reads as not
   * knowing rather than as void.
   */
  acceptedCallReturnType(uri: string, lineNumber: number): string;
  /**
   * Collects every quick fix in the file into one edit and applies it once
   * the caller has confirmed the change.
   */
  fixAll(
    model: Monaco.editor.ITextModel,
    diagnostics: Array<{ range: unknown }>,
  ): Promise<MergedFixes & { confirmed: boolean }>;
}

/**
 * The return type written in a completion's detail.
 *
 * JDT writes it two ways — `void println(String x)` and `println(String x) :
 * void` — and the detail may carry the declaring class after a middle dot.
 * Answers "" for anything else, which callers read as not knowing.
 */
export function returnTypeFromDetail(detail: string): string {
  const text = String(detail || "").split("·")[0].trim();
  if (!text) return "";
  const trailing = text.match(/\)\s*:\s*([A-Za-z_$][\w$.<>,\[\] ?]*)\s*$/);
  if (trailing) return trailing[1].trim();
  const leading = text.match(/^([A-Za-z_$][\w$.<>,\[\] ?]*?)\s+[A-Za-z_$][\w$.]*\s*\(/);
  return leading ? leading[1].trim() : "";
}

/** What the server calls its token types and modifiers, in its own order. */
export interface SemanticTokenLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

/**
 * Routes the Java CodeLens through the workbench when one is available.
 *
 * Starting the main-process debugger directly from a Monaco command bypassed
 * saving dirty editors, opening the Debug panel and, most importantly, the
 * workbench's error handling. Keep the fallback for isolated provider users,
 * but the desktop workbench always supplies `onDebugFile`.
 */
export async function runDebugCodeLens(
  file: string,
  onDebugFile: ((file: string) => void | Promise<void>) | undefined,
  api: KiwiApi,
  getRoot: () => string,
) {
  if (onDebugFile) {
    await onDebugFile(file);
    return true;
  }
  const root = getRoot();
  if (!root) return false;
  await api.debug.start({ root, file, breakpoints: await api.debug.listBreakpoints(root) });
  return true;
}

export type WorkspaceEditPreviewItem = {
  path: string;
  targetPath?: string;
  kind: "edit" | "create" | "rename" | "delete";
  before: string;
  after: string;
};

type LspCompletionItem = {
  label?: string | { label?: string; detail?: string; description?: string };
  labelDetails?: { detail?: string; description?: string };
  detail?: string;
  documentation?: unknown;
  tags?: number[];
};

/**
 * How long the first list may wait for the language server.
 *
 * Past this the buffer's own members and the templates are shown on their own
 * and the list is marked incomplete, which makes Monaco ask again a moment
 * later — by then the server has usually answered and its results join the
 * same list. A tenth of a second is about the point at which a list stops
 * feeling like it appeared and starts feeling like it was fetched.
 */
const FIRST_PAINT_BUDGET_MS = 140;

/** Returned by withBudget when the promise did not arrive in time. */
const TOO_SLOW = Symbol("zu langsam");

/**
 * The value, or TOO_SLOW if it takes longer than allowed.
 *
 * The promise is not cancelled here — it is still wanted, just not yet. It
 * keeps running and the next call for the same caret picks it up.
 */
function withBudget<T>(promise: Promise<T>, milliseconds: number): Promise<T | typeof TOO_SLOW> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => resolve(TOO_SLOW), milliseconds);
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      () => {
        globalThis.clearTimeout(timer);
        // A failure is the caller's to handle; awaiting the promise again gives
        // it the rejection.
        resolve(promise as Promise<T>);
      },
    );
  });
}

/**
 * How long a completion asked for by hand may wait for the server.
 *
 * Somebody who pressed Ctrl+Space is waiting on purpose and wants the whole
 * answer. Half a second is the point past which they will have concluded that
 * nothing is going to happen — and past it the list appears anyway, with
 * whatever the buffer knows, and fills in when the server answers.
 */
const MANUAL_BUDGET_MS = 500;

/**
 * How often a manual completion asks again while the index is still building,
 * and how long it waits between attempts. Four attempts covers the few seconds
 * a first index takes without asking forever at a caret nobody is at any more.
 */
const INDEXING_RETRIES = 4;
const INDEXING_RETRY_DELAY_MS = 400;

/** Manual completions that came back empty, by caret. */
const indexingRetries = new Map<string, number>();

/** Completion requests still running, by the caret they were asked for. */
const pendingCompletions = new Map<string, { promise: Promise<any>; requestId: string }>();
let completionRequestCounter = 0;

const completionUsageStorageKey = "kiwi.java.completionUsage.v2";
// v3: an entry now records the question it answers, not only the answer.
const completionCacheStorageKey = "kiwi.java.completionCache.v3";

function readCompletionUsage(): UsageStore {
  try {
    // Also reads the flat counts written before choices had a date, so an
    // existing habit starts fading rather than being thrown away.
    return readUsageStore(
      JSON.parse(globalThis.localStorage?.getItem(completionUsageStorageKey) || "{}"),
      Date.now(),
    );
  } catch {
    return {};
  }
}

function writeCompletionUsage(usage: UsageStore) {
  try {
    globalThis.localStorage?.setItem(
      completionUsageStorageKey,
      JSON.stringify(pruneUsage(usage, Date.now())),
    );
  } catch {
    // Completion learning is optional when browser storage is unavailable.
  }
}

function readPersistentCompletionCache() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(completionCacheStorageKey) || "[]");
    return new Map<string, any>(Array.isArray(parsed) ? parsed.slice(-60) : []);
  } catch {
    return new Map<string, any>();
  }
}

function writePersistentCompletionCache(cache: Map<string, any>) {
  try {
    const recent = [...cache.entries()].slice(-60);
    while (recent.length > 8 && JSON.stringify(recent).length > 1_500_000) recent.shift();
    globalThis.localStorage?.setItem(completionCacheStorageKey, JSON.stringify(recent));
  } catch {
    // The live JDT result remains available when persistent browser storage is full.
  }
}

function findUsableCachedCompletion(
  cache: Map<string, any>,
  now: { uri: string; line: number; column: number; prefix: string; lineCount: number; at: number },
): any | undefined {
  const entries = Array.from(cache.values());
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (isCacheEntryUsable(entry, now)) {
      return entry;
    }
  }
  return undefined;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Narrows the server's commit characters to the ones somebody asked for.
 *
 * The server says which characters may accept each proposal — "(" on a method,
 * "." on a type — and typing one of those when it was not meant to commit is
 * the most irritating way for a list to be wrong: the name is taken, the
 * character is swallowed, and what was being typed is gone.
 *
 * Narrowed rather than replaced. Offering a character the server did not
 * propose for an item would accept it in places where the server knows that
 * makes no sense.
 */
export function narrowCommitCharacters(
  proposed: string[] | undefined,
  allowed: string,
): string[] | undefined {
  if (!proposed?.length) return undefined;
  const wanted = new Set(String(allowed ?? "").split(""));
  if (!wanted.size) return [];
  const kept = proposed.filter((character) => wanted.has(character));
  return kept.length ? kept : [];
}

/**
 * The range used when a suggestion carries no edit of its own.
 *
 * Two ranges rather than one: given a single range Monaco always overwrites the
 * whole word, so accepting a suggestion in the middle of an identifier ate
 * everything after the caret. The insert range stops at the caret and is the one
 * the editor's "insert" mode picks; the replace range stays available for anyone
 * who deliberately wants the old behaviour.
 */
export function completionFallbackRange(line: number, column: number, wordStart: number, wordEnd: number) {
  const start = Math.min(wordStart, column);
  return {
    insert: { startLineNumber: line, endLineNumber: line, startColumn: start, endColumn: column },
    replace: { startLineNumber: line, endLineNumber: line, startColumn: start, endColumn: Math.max(wordEnd, column) },
  };
}

export function completionItemName(item: LspCompletionItem) {
  return typeof item.label === "string" ? item.label : nonEmpty(item.label?.label);
}

export function completionItemOrigin(item: LspCompletionItem) {
  const embedded = typeof item.label === "object" ? item.label?.description : "";
  const explicit = nonEmpty(item.labelDetails?.description) || nonEmpty(embedded);
  if (explicit) return explicit;

  // Older JDT-LS versions encode the declaring type only in `detail`.
  // Extract it so library and project members still show their provenance.
  const qualifiedTypes = nonEmpty(item.detail).match(/\b(?:[a-z_$][\w$]*\.)+[A-Z_$][\w$]*/g);
  return qualifiedTypes?.at(-1) || "";
}

export function completionItemLabel(item: LspCompletionItem) {
  const name = completionItemName(item);
  const embedded = typeof item.label === "object" ? item.label : undefined;
  const detail = nonEmpty(item.labelDetails?.detail) || nonEmpty(embedded?.detail);
  const description = completionItemOrigin(item);
  if (!detail && !description) return name;
  return {
    label: name,
    ...(detail ? { detail } : {}),
    ...(description ? { description } : {}),
  };
}

export function completionItemDetail(item: LspCompletionItem) {
  const importPreview = ((item as any).additionalTextEdits || [])
    .map((edit: any) => nonEmpty(edit?.newText).match(/\bimport\s+(?:static\s+)?([^;]+);/)?.[1] || "")
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const parts = [
    nonEmpty(item.detail),
    nonEmpty(item.labelDetails?.detail),
    completionItemOrigin(item),
    item.tags?.includes(1) ? "Veraltet" : "",
    importPreview ? `Import: ${importPreview}` : "",
  ].filter((part, index, all) =>
    Boolean(part) && !all.slice(0, index).some((existing) => existing === part || existing.includes(part)),
  );
  return parts.join(" · ");
}

/**
 * The file's own members, scanned once per version of the buffer.
 *
 * Completion asks on every keystroke, and scanning a few thousand lines each
 * time would be paid for in the editor's responsiveness rather than anywhere
 * visible. The version id changes with every edit, so the answer is never
 * stale.
 */
const memberScans = new Map<string, { version: number; members: ReturnType<typeof parseJavaMembers> }>();

export function readMembers(model: Monaco.editor.ITextModel) {
  const key = model.uri.toString();
  const version = model.getVersionId();
  const cached = memberScans.get(key);
  if (cached?.version === version) return cached.members;
  const members = parseJavaMembers(model.getValue());
  // One entry per open editor is the working set; anything beyond that is a
  // model nobody is typing in any more.
  if (memberScans.size > 24) memberScans.clear();
  memberScans.set(key, { version, members });
  return members;
}

export function installJavaLanguageProviders(
  monaco: MonacoApi,
  api: KiwiApi,
  getRoot: () => string,
  getSettings: () => CompletionSettings = () => ({
    autoPopup: true,
    caseSensitive: false,
    insertImports: true,
    showDocumentation: true,
    prioritizeRecent: true,
    liveTemplates: true,
    postfixTemplates: true,
    finishStatements: true,
    localMembers: true,
    hoverDocumentation: false,
  }),
  _confirmWorkspaceEdit: (edit: any) => Promise<boolean> = async () => true,
  onDebugFile?: (file: string) => void | Promise<void>,
  /**
   * What the project is built with and what it calls itself.
   *
   * Only used to say where a proposal came from. Without it the origin still
   * separates the platform from everything else — it just cannot tell the
   * project's own code from a library's.
   */
  getProjectContext: () => OriginContext = () => ({}),
): JavaLanguageController {
  let semanticLegend: SemanticTokenLegend | null = null;
  /** The last call taken from the suggestion list, and where it was written. */
  let acceptedCall: { uri: string; line: number; returnType: string } | null = null;

  const rememberAcceptedCall = (usageKey: string) => {
    const returnType = returnTypeFromDetail(usageKey.split("\u0000")[1] || "");
    const editor = monaco.editor.getEditors().find((candidate) => candidate.hasTextFocus());
    const model = editor?.getModel();
    const at = editor?.getPosition();
    acceptedCall = returnType && model && at
      ? { uri: model.uri.toString(), line: at.lineNumber, returnType }
      : null;
  };

  const request = (
    model: Monaco.editor.ITextModel,
    method: string,
    params: Record<string, unknown>,
    /** Names this request so it can be cancelled while it is still running. */
    requestId = "",
  ) => {
    const root = getRoot();
    if (!root) return Promise.resolve(null);
    return api.language.request(root, method, {
      // A class out of a jar keeps its own address. Running it through
      // `fsPath` made `file:///C:/jdt:/contents/…`, which JDT could only
      // answer with an InvalidPathException.
      textDocument: { uri: isLibraryUri(model.uri.toString()) ? model.uri.toString() : fileUri(model.uri.fsPath) },
      ...params,
    }, requestId);
  };
  /**
   * A request whose failure is not the user's problem.
   *
   * Monaco calls these providers by itself — while typing, while scrolling —
   * and does not catch what they throw, so a single timed-out request surfaced
   * as an unhandled rejection. For a decoration the honest answer is "nothing
   * to show"; the operations someone explicitly asked for, rename and
   * formatting, keep reporting their failures.
   */
  const optionalRequest = async (
    model: Monaco.editor.ITextModel,
    method: string,
    params: Record<string, unknown>,
  ) => {
    try {
      return await request(model, method, params);
    } catch {
      return null;
    }
  };

  /**
   * The text last handed to the language server, per file.
   *
   * The workbench already sends the buffer on a debounce as somebody types,
   * and every request here sent the whole of it again before asking anything.
   * On a large file that is the document serialised, crossed the process
   * boundary and parsed twice for one keystroke — and the second copy was
   * usually identical to the first.
   */
  const lastSyncedText = new Map<string, string>();

  const allowedCommitCharacters = (proposed: string[] | undefined) =>
    narrowCommitCharacters(proposed, getSettings().commitCharacters ?? "(.;");

  const syncDocument = async (model: Monaco.editor.ITextModel) => {
    const root = getRoot();
    if (!root) return;
    // A class opened out of a jar is not a document to send anywhere: the
    // server already has the class file, and its address is not a path.
    if (isLibraryUri(model.uri.toString())) return;
    const file = model.uri.fsPath;
    const text = model.getValue();
    if (lastSyncedText.get(file) === text) return;
    lastSyncedText.set(file, text);
    try {
      await api.language.change({ root, file, text });
    } catch (error) {
      // A send that failed was not received, so it must not be remembered as
      // the server's copy — the next request has to try again.
      lastSyncedText.delete(file);
      throw error;
    }
  };

  const position = (value: Monaco.Position) => ({ line: value.lineNumber - 1, character: value.column - 1 });
  const range = (value: any): Monaco.IRange => ({
    startLineNumber: value.start.line + 1,
    startColumn: value.start.character + 1,
    endLineNumber: value.end.line + 1,
    endColumn: value.end.character + 1,
  });
  const markdown = (value: any): Monaco.IMarkdownString[] => {
    if (!value) return [];
    if (typeof value === "string") return [{ value }];
    if (Array.isArray(value)) return value.flatMap(markdown);
    if (typeof value.value === "string") return [{ value: value.kind === "markdown" ? value.value : `\`\`\`\n${value.value}\n\`\`\`` }];
    if (typeof value.language === "string") return [{ value: `\`\`\`${value.language}\n${value.value}\n\`\`\`` }];
    return [];
  };
  const completionDocumentation = (item: LspCompletionItem): Monaco.IMarkdownString | undefined => {
    if (!getSettings().showDocumentation) return undefined;
    const name = completionItemName(item);
    const label = completionItemLabel(item);
    const signatureSuffix = typeof label === "string" ? "" : label.detail || "";
    const origin = completionItemOrigin(item);
    const metadata = [
      name ? `\`\`\`java\n${name}${signatureSuffix}\n\`\`\`` : "",
      origin ? `**Deklariert in:** \`${origin}\`` : "",
      item.tags?.includes(1) ? "**Veraltet**" : "",
    ].filter(Boolean);
    const documentation = markdown(item.documentation).map((part) => part.value).filter(Boolean);
    const value = [...metadata, ...documentation].join("\n\n");
    return value ? { value } : undefined;
  };
  const textEdit = (edit: any): Monaco.languages.TextEdit => ({ range: range(edit.range), text: edit.newText });
  const location = (item: any): Monaco.languages.Location => {
    const target = item.targetUri
      ? { uri: item.targetUri, range: item.targetSelectionRange || item.targetRange }
      : { uri: item.uri, range: item.range };
    return { uri: monaco.Uri.parse(target.uri), range: range(target.range) };
  };
  const markerDiagnostic = (marker: Monaco.editor.IMarker | Monaco.editor.IMarkerData) => ({
    range: {
      start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
      end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
    },
    message: marker.message,
    severity: marker.severity === monaco.MarkerSeverity.Error ? 1 : 2,
    code: marker.code,
    source: marker.source || "JDT LS",
  });
  const requestCodeActions = async (
    model: Monaco.editor.ITextModel,
    targetRange: Monaco.IRange,
    markers: Array<Monaco.editor.IMarker | Monaco.editor.IMarkerData>,
  ) => request(model, "textDocument/codeAction", {
    range: {
      start: { line: targetRange.startLineNumber - 1, character: targetRange.startColumn - 1 },
      end: { line: targetRange.endLineNumber - 1, character: targetRange.endColumn - 1 },
    },
    context: { diagnostics: markers.map(markerDiagnostic), triggerKind: 1 },
  });

  const disposables: Monaco.IDisposable[] = [];
  const completionGate = new CompletionRequestGate();
  const completionCache = readPersistentCompletionCache();
  // Typed as the return of whichever setTimeout is in scope: the browser's
  // number and Node's Timeout are both stored here, and the module runs under
  // both — the editor in Electron, and the provider tests in Node.
  let completionCacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
  const rememberCompletionResult = (key: string, result: any, asked: {
    uri: string;
    line: number;
    column: number;
    prefix: string;
    lineCount: number;
    at: number;
  }) => {
    completionCache.delete(key);
    // Stored with the question it answers. Without that a remembered answer
    // could be shown for a different line — carrying import edits measured
    // against a file that has since changed.
    completionCache.set(key, { ...asked, items: result });
    while (completionCache.size > 250) {
      const oldest = completionCache.keys().next().value;
      if (!oldest) break;
      completionCache.delete(oldest);
    }
    if (completionCacheWriteTimer !== null) globalThis.clearTimeout(completionCacheWriteTimer);
    completionCacheWriteTimer = globalThis.setTimeout(() => {
      completionCacheWriteTimer = null;
      writePersistentCompletionCache(completionCache);
    }, 400);
  };
  let completionUsage = readCompletionUsage();
  const applyCodeAction = async (rawAction: any) => {
    let action = rawAction;
    if (!action?.edit && action?.data) {
      action = await api.language.request(getRoot(), "codeAction/resolve", action).catch(() => action);
    }
    let touched: string[] = [];
    if (action?.edit) {
      touched = await applyLspWorkspaceEdit(monaco, api, action.edit, getRoot());
      for (const file of touched) {
        const model = monaco.editor.getModels().find((candidate) =>
          candidate.uri.fsPath.toLowerCase() === file.toLowerCase(),
        );
        if (model) {
          await api.language.change({ root: getRoot(), file, text: model.getValue() }).catch(() => false);
        }
      }
    }
    if (action?.command) {
      const result = await api.language.request(getRoot(), "workspace/executeCommand", action.command);
      if (result?.changes || result?.documentChanges) {
        touched = [...new Set([...touched, ...await applyLspWorkspaceEdit(monaco, api, result, getRoot())])];
      }
    }
    return touched;
  };
  disposables.push(monaco.editor.registerCommand("kiwi.applyJavaCodeAction", (_accessor, action) =>
    applyCodeAction(action),
  ));

  /**
   * Every quick fix in a file, taken in one go.
   *
   * Forty missing imports after a paste is forty trips to the lightbulb. The
   * fixes already exist — one per problem — and what was missing is a way to
   * take them together.
   *
   * Each problem is asked about separately, because a code action request is
   * answered for the diagnostics it is given and a batch of them comes back
   * as a batch nobody can attribute. The answers are then merged into one
   * edit, which is shown in full before a character of it is written: nothing
   * here decides that a fix is safe, the preview does.
   */
  const fixAllInModel = async (
    model: Monaco.editor.ITextModel,
    diagnostics: Array<{ range: any; [key: string]: unknown }>,
  ): Promise<MergedFixes> => {
    await syncDocument(model);
    const candidates: FixCandidate[] = [];
    // Bounded on purpose: a file with three hundred problems is a file with
    // one problem, and three hundred round trips would freeze the window.
    for (const diagnostic of (diagnostics || []).slice(0, 60)) {
      if (!diagnostic?.range) continue;
      // Handed back exactly as the server sent it. Rebuilding one from an
      // editor marker loses the `data` the server attaches, and a code action
      // request carrying a reconstruction gets an empty answer — which reads
      // from the outside as a file with nothing to fix.
      const actions = await optionalRequest(model, "textDocument/codeAction", {
        range: diagnostic.range,
        context: { diagnostics: [diagnostic], only: ["quickfix"] },
      }).catch(() => null);
      const first = (Array.isArray(actions) ? actions : []).find((action: FixCandidate) => isBatchableFix(action));
      if (!first) continue;
      // A resolved action is the one that carries the edit; an unresolved one
      // carries only the promise of it.
      const resolved = first.edit
        ? first
        : await api.language.request(getRoot(), "codeAction/resolve", first).catch(() => first);
      candidates.push(resolved as FixCandidate);
    }
    return mergeFixEdits(candidates);
  };
  disposables.push(monaco.editor.registerCommand("kiwi.recordJavaCompletion", async (_accessor, key, originalCommand) => {
    const chosen = String(key || "");
    if (chosen) {
      completionUsage = recordUsage(completionUsage, chosen, Date.now());
      writeCompletionUsage(completionUsage);
      // What the accepted call returns, and where it was written.
      //
      // Enter has to decide there and then whether the line is finished, and a
      // call that returns something can always be continued with another `.`
      // on the next line. The language server cannot be asked inside a key
      // handler, so the answer is kept from the moment the proposal was taken.
      rememberAcceptedCall(chosen);
    }
    if (originalCommand?.command) {
      await api.language.request(getRoot(), "workspace/executeCommand", originalCommand).catch(() => undefined);
    }
  }));
  /**
   * Asks the suggest widget to come back for an answer that has now arrived.
   *
   * Only while the widget is still open at the same caret in the same file:
   * re-opening one somebody has dismissed, or moving a list out from under a
   * caret that has gone elsewhere, would be worse than being late.
   */
  const retriggerSuggest = (
    model: Monaco.editor.ITextModel,
    cursor: Monaco.Position,
    requestId: number,
  ) => {
    if (!completionGate.isCurrent(requestId)) return;
    const editor = monaco.editor.getEditors().find((candidate) => candidate.getModel() === model);
    const at = editor?.getPosition();
    if (!editor || !at) return;
    if (at.lineNumber !== cursor.lineNumber || at.column !== cursor.column) return;
    if (!editor.hasTextFocus()) return;
    editor.trigger("kiwi.completion", "editor.action.triggerSuggest", {});
  };

  disposables.push(monaco.languages.registerCompletionItemProvider("java", {
    triggerCharacters: [".", "@", "#", ":"],
    resolveCompletionItem: async (item) => {
      if (!(item as any)._lsp) return item;
      const resolved = await api.language.request(getRoot(), "completionItem/resolve", (item as any)._lsp).catch(() => null);
      if (!resolved) return item;
      const completed = { ...(item as any)._lsp, ...resolved };
      const resolvedEdit = resolved.textEdit;
      const resolvedRange = resolvedEdit?.insert && resolvedEdit?.replace
        ? { insert: range(resolvedEdit.insert), replace: range(resolvedEdit.replace) }
        : resolvedEdit?.range
          ? range(resolvedEdit.range)
          : item.range;
      // The key the item was given when it was proposed, which is the one that
      // knows the receiver and the prefix. Resolving happens without either, so
      // the fallback records what it can rather than a shape nothing reads back.
      const usageKey = (item.command as any)?.arguments?.[0]
        || buildUsageKey({ root: getRoot(), name: completionItemName(completed) });
      const originalCommand = resolved.command || (item.command as any)?.arguments?.[1];
      const shapedInsertText = (item.insertTextRules === monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet && resolved.insertTextFormat !== 2)
        ? item.insertText
        : improveArgumentDefaults(
            String(resolvedEdit?.newText || resolved.insertText || item.insertText || ""),
            String(completed.detail || ""),
          );
      return {
        ...item,
        label: completionItemLabel(completed),
        detail: completionItemDetail(completed) || item.detail,
        documentation: completionDocumentation(completed),
        insertText: shapedInsertText,
        insertTextRules: resolved.insertTextFormat === 2
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : item.insertTextRules,
        range: resolvedRange,
        additionalTextEdits: getSettings().insertImports ? resolved.additionalTextEdits?.map(textEdit) : undefined,
        commitCharacters: allowedCommitCharacters(resolved.commitCharacters || (item.commitCharacters as string[] | undefined)),
        command: {
          id: "kiwi.recordJavaCompletion",
          title: "Completion-Auswahl merken",
          arguments: [usageKey, originalCommand],
        },
      };
    },
    provideCompletionItems: async (model, cursor, context, cancellationToken) => {
      const completionRequest = completionGate.begin();
      const word = model.getWordUntilPosition(cursor);
      const currentLine = model.getLineContent(cursor.lineNumber);
      const lineBeforeCursor = currentLine.slice(0, cursor.column - 1);
      const lineAfterCursor = currentLine.slice(cursor.column - 1);
      const cacheKey = [
        getRoot(),
        model.uri.toString(),
        cursor.lineNumber,
        cursor.column,
        lineBeforeCursor.slice(-180),
        completionRequest.intent,
      ].join("\u0000");
      // Where this choice is being made. The receiver and the typed prefix are
      // part of what makes a choice the right one — "get" after a Map is a
      // different decision from "get" after an Optional — so they are part of
      // what is remembered about it.
      const usageReceiver = memberAccessReceiver(lineBeforeCursor) || "";
      const keyFor = (name: string) => buildUsageKey({
        root: getRoot(),
        receiverType: usageReceiver,
        prefix: word.word,
        name,
      });
      const scoreFor = (name: string) =>
        decayedUsageScore(completionUsage, keyFor(name), Date.now());

      const triggerKind = context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter
        ? 2
        : context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions
          ? 3
          : 1;

      /**
       * Asks the language server, once per question.
       *
       * Kept in a map so the second call for the same caret — which is what
       * Monaco makes when the first answer came back marked incomplete — waits
       * for the request already running instead of starting another. Asking
       * twice is how a slow answer becomes two slow answers.
       */
      const askServer = () => {
        const running = pendingCompletions.get(cacheKey);
        if (running) return running.promise;
        const requestId = `completion:${++completionRequestCounter}`;
        const promise = (async () => {
          await syncDocument(model);
          return request(model, "textDocument/completion", {
            position: position(cursor),
            context: { triggerKind, triggerCharacter: context.triggerCharacter },
          }, requestId);
        })();
        const record = { promise, requestId };
        pendingCompletions.set(cacheKey, record);
        void promise.catch(() => undefined).finally(() => {
          if (pendingCompletions.get(cacheKey) === record) pendingCompletions.delete(cacheKey);
        });
        return promise;
      };

      // Everything asked for a caret that is no longer where the caret is, is
      // work the server is doing for nobody — and it is the work the next
      // question waits behind. Cancelling reaches JDT LS, not just this side.
      for (const [key, record] of [...pendingCompletions]) {
        if (key === cacheKey) continue;
        pendingCompletions.delete(key);
        void api.language.cancel(record.requestId).catch(() => false);
      }

      let result: any = null;
      let usedCache = false;
      let complete = true;
      try {
        // The first answer must not wait on the server. Whatever the buffer
        // itself can offer is ready now, and a list that appears in a tenth of
        // a second and grows is worth more than a complete one that arrives
        // after the next keystroke.
        // Asked for by hand, the wait is worth more: somebody who pressed
        // Ctrl+Space wants the answer, not the half of it the buffer knows.
        // Typing has the shorter budget because another keystroke is never far
        // away and a list that lags behind the caret is worse than a partial one.
        const budget = triggerKind === 1 ? MANUAL_BUDGET_MS : FIRST_PAINT_BUDGET_MS;
        const pending = askServer();
        const cacheContext = {
          uri: model.uri.toString(),
          line: cursor.lineNumber,
          column: cursor.column,
          prefix: lineBeforeCursor,
          lineCount: model.getLineCount(),
          at: Date.now(),
        };
        result = await withBudget(pending, budget);
        if (result === TOO_SLOW) {
          result = null;
          complete = false;
          // An incomplete list only brings Monaco back when more is typed, and
          // somebody who pressed Ctrl+Space may well type nothing at all. So
          // the widget is asked again once the answer actually arrives — which
          // is what puts the server's results into the list already on screen.
          void pending.then(
            (late) => {
              if (!late) return;
              rememberCompletionResult(cacheKey, late, cacheContext);
              retriggerSuggest(model, cursor, completionRequest.id);
            },
            () => undefined,
          );
        } else if (result) {
          rememberCompletionResult(cacheKey, result, cacheContext);
        }
        if (!result) {
          const remembered = completionCache.get(cacheKey) || findUsableCachedCompletion(completionCache, cacheContext);
          if (isCacheEntryUsable(remembered, cacheContext)) {
            result = remembered?.items ?? null;
            usedCache = true;
          }
        }
      } catch {
        // Reached now. This used to sit behind a helper that turned every
        // failure into null, so the remembered answer below was unreachable
        // and a server that errored simply showed nothing.
        const cacheContext = {
          uri: model.uri.toString(),
          line: cursor.lineNumber,
          column: cursor.column,
          prefix: lineBeforeCursor,
          lineCount: model.getLineCount(),
          at: Date.now(),
        };
        const remembered = completionCache.get(cacheKey) || findUsableCachedCompletion(completionCache, cacheContext);
        if (isCacheEntryUsable(remembered, cacheContext)) {
          result = remembered?.items ?? null;
          usedCache = true;
        }
      }
      if (cancellationToken.isCancellationRequested || !completionGate.isCurrent(completionRequest.id)) {
        return { suggestions: [] };
      }
      const items = Array.isArray(result) ? result : result?.items || [];
      /**
       * A server that answered, but with nothing.
       *
       * A freshly unpacked build reports "ready" while JDT LS is still
       * publishing its first classpath index, and until that lands every
       * completion comes back empty rather than failing. Somebody pressing
       * Ctrl+Space then sees "no suggestions" and no reason to believe that
       * will ever change.
       *
       * So the widget is asked again shortly, a few times. Nothing waits on
       * this: the list on screen is whatever the buffer knows, and the server's
       * answer joins it when it exists.
       */
      if (triggerKind === 1 && !items.length) {
        const attempts = indexingRetries.get(cacheKey) || 0;
        if (attempts < INDEXING_RETRIES) {
          indexingRetries.set(cacheKey, attempts + 1);
          complete = false;
          globalThis.setTimeout(
            () => retriggerSuggest(model, cursor, completionRequest.id),
            INDEXING_RETRY_DELAY_MS,
          );
        }
      } else if (items.length) {
        indexingRetries.delete(cacheKey);
      }
      const defaultRange = completionFallbackRange(cursor.lineNumber, cursor.column, word.startColumn, word.endColumn);
      /**
       * Finishes a type name into the expression it was going to become.
       *
       * `new ArrayList` accepted as-is left the diamond, the parentheses and
       * the semicolon to be typed by hand every time.
       */
      const shapeInsert = (item: any, insertText: string) => {
        if (!getSettings().finishStatements) return { insertText, snippet: false };
        // Only a type may be finished into a constructor call. After `new
        // java.` JDT proposes packages too, and `util<>()` is not a thing.
        // LSP kinds: 4 constructor, 7 class, 13 enum, 22 struct.
        if (![4, 7, 13, 22].includes(Number(item.kind))) return { insertText, snippet: false };
        const shaped = completeNewExpression(insertText, {
          lineBeforeCursor,
          lineAfterCursor,
          arity: genericArity(completionItemName(item), String(item.detail || "")),
          finishStatements: true,
        });
        return { insertText: shaped, snippet: shaped !== insertText };
      };
      const jdtSuggestions: RankedCompletion[] = items.map((raw: any) => {
          // An answer that came out of the cache keeps its names and loses its
          // offsets: the ranges and the import edits in it were measured
          // against the file as it stood, and applying them now would insert
          // an import on a line that holds something else.
          const item = usedCache ? withoutStalePositions(raw, defaultRange) : raw;
          const completionEdit = item.textEdit;
          const completionRange = completionEdit?.insert && completionEdit?.replace
            ? { insert: range(completionEdit.insert), replace: range(completionEdit.replace) }
            : completionEdit?.range
              ? range(completionEdit.range)
              : defaultRange;
          const usageKey = `${completionItemName(item)}\u0000${completionItemDetail(item)}`;
          const shaped = shapeInsert(item, improveArgumentDefaults(
            String(completionEdit?.newText || item.insertText || completionItemName(item)),
            String(item.detail || ""),
          ));
          return {
            label: completionItemLabel(item),
            // Monaco numbers its kinds differently from the protocol, and the
            // subtraction that used to stand here drew a local variable with a
            // class icon.
            kind: monacoCompletionKind(item.kind, monaco.languages.CompletionItemKind) as Monaco.languages.CompletionItemKind,
            detail: completionItemDetail(item),
            documentation: completionDocumentation(item),
            sortText: item.sortText,
            filterText: item.filterText,
            insertText: shaped.insertText,
            insertTextRules: item.insertTextFormat === 2 || shaped.snippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range: completionRange,
            additionalTextEdits: getSettings().insertImports ? item.additionalTextEdits?.map(textEdit) : undefined,
            // Narrowed to what the setting allows: a character the server's
            // item commits on is only honoured if it is one somebody asked for.
            commitCharacters: allowedCommitCharacters(item.commitCharacters),
            preselect: item.preselect,
            tags: item.tags,
            command: {
              id: "kiwi.recordJavaCompletion",
              title: "Completion-Auswahl merken",
              arguments: [usageKey, item.command],
            },
            source: "jdt",
            usageScore: getSettings().prioritizeRecent ? scoreFor(completionItemName(item)) : 0,
            _lsp: item,
          };
        });
      const completionSettings = getSettings();
      const templates: RankedCompletion[] = javaTemplates(
        // The whole buffer up to the caret, not the line: a method chain
        // written over several lines is one expression, and reading only the
        // last line of it reads a fragment.
        model.getValueInRange({
          startLineNumber: Math.max(1, cursor.lineNumber - 6),
          startColumn: 1,
          endLineNumber: cursor.lineNumber,
          endColumn: cursor.column,
        }),
        {
          languageLevel: Number(getProjectContext().languageLevel) || undefined,
          // What the project itself defines, which replaces a built-in of the
          // same name rather than joining it.
          customTemplates: getProjectContext().customTemplates,
          // What the server already proposed, so the same snippet is not
          // offered twice under two names.
          serverLabels: jdtSuggestions.map((item) => completionLabel(item)),
        },
      )
        .filter((template) => template.source === "live" ? completionSettings.liveTemplates : completionSettings.postfixTemplates)
        .map((template) => {
        const exprLines = template.expression ? template.expression.split("\n") : [];
        const startLineNumber = exprLines.length > 1
          ? Math.max(1, cursor.lineNumber - (exprLines.length - 1))
          : cursor.lineNumber;
        const startColumn = template.source === "postfix" && template.expression
          ? (exprLines.length > 1
              ? Math.max(1, (model.getLineContent(startLineNumber).lastIndexOf(exprLines[0]) + 1) || 1)
              : Math.max(1, cursor.column - `${template.expression}.${template.typedSuffix || ""}`.length))
          : word.startColumn;
        const usageKey = `${template.key}\u0000${template.detail}`;
        return {
          label: template.label,
          kind: template.source === "postfix"
            ? monaco.languages.CompletionItemKind.Operator
            : monaco.languages.CompletionItemKind.Snippet,
          detail: template.detail,
          insertText: template.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: {
            startLineNumber,
            endLineNumber: cursor.lineNumber,
            startColumn,
            endColumn: cursor.column,
          },
          filterText: template.source === "postfix" && template.key.startsWith(".")
            ? `${template.key.slice(1)} ${template.key}`
            : template.key,
          source: template.source,
          usageScore: completionSettings.prioritizeRecent ? scoreFor(template.key) : 0,
          command: {
            id: "kiwi.recordJavaCompletion",
            title: "Completion-Auswahl merken",
            arguments: [usageKey],
          },
        };
        });
      /**
       * What kind of value belongs here.
       *
       * Read from the whole construct the caret sits in rather than from the
       * current line: a return knows its method's return type, an assignment
       * knows where the variable was declared, and an argument list is left to
       * the language server, which has resolved the overload and can say what
       * the parameter at this position is.
       */
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: cursor.lineNumber,
        endColumn: cursor.column,
      });
      let expected: ExpectedType | null = expectedTypeAt({
        textBeforeCursor,
        line: cursor.lineNumber,
        members: readMembers(model),
      });
      if (completionRequest.intent === "smart") {
        const signature = await optionalRequest(model, "textDocument/signatureHelp", {
          position: position(cursor),
          context: { triggerKind: 1, isRetrigger: false },
        }).catch(() => null);
        const [parameter, ...overloads] = parameterTypesFromSignature(signature);
        // The server resolved the call, so where it answers it is believed
        // over anything read out of the buffer here. Every applicable overload
        // counts: fitting the second is as right as fitting the first.
        if (parameter) {
          // Except inside a lambda, where the parameter is the interface and
          // what is being written is what its method gives back. At
          // `filter(spieler -> spieler.` the call wants a Predicate; the caret
          // wants a boolean.
          const results = insideLambdaBody(textBeforeCursor)
            ? [parameter, ...overloads].map((type) => functionalResultType(type)).filter(Boolean)
            : [];
          const [first, ...rest] = results.length ? results : [parameter, ...overloads];
          expected = { type: first, source: "argument", confidence: 1, alternatives: rest };
        }
      }
      /**
       * What the file itself declares.
       *
       * Two things the language server cannot answer: the method that was
       * typed a second ago and has not been indexed yet, and the name a
       * declaration that does not exist should be given. Both are read
       * straight out of the buffer, and both stay behind JDT in the ranking,
       * so a resolved answer is never pushed aside by a guessed one.
       */
      const localSuggestions: RankedCompletion[] = [];
      if (completionSettings.localMembers) {
        const members = readMembers(model);
        // Once the server has indexed the file it knows these members better
        // than a scan does, and two entries for one method is worse than none.
        const alreadyProposed = new Set(jdtSuggestions.map((item) =>
          completionLabel(item).replace(/\(.*$/, "")));
        const wordRange = {
          startLineNumber: cursor.lineNumber,
          endLineNumber: cursor.lineNumber,
          startColumn: word.startColumn,
          endColumn: cursor.column,
        };
        for (const proposal of methodNameProposals({
          lineBeforeCursor,
          fields: members.fields,
          methods: members.methods,
        })) {
          if (alreadyProposed.has(proposal.name)) continue;
          localSuggestions.push({
            label: proposal.name,
            kind: monaco.languages.CompletionItemKind.Method,
            detail: proposal.detail,
            insertText: proposal.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: wordRange,
            filterText: proposal.name,
            source: "live",
          });
        }
        if (!localSuggestions.length) {
          for (const completion of localMemberCompletions(members, {
            lineBeforeCursor,
            line: cursor.lineNumber,
          })) {
            if (alreadyProposed.has(completion.label.replace(/\(.*$/, ""))) continue;
            localSuggestions.push({
              label: completion.label,
              kind: completion.kind === "method"
                ? monaco.languages.CompletionItemKind.Method
                : monaco.languages.CompletionItemKind.Field,
              detail: completion.detail,
              insertText: completion.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: wordRange,
              filterText: completion.label.replace(/\(.*$/, ""),
              source: "live",
            });
          }
        }
      }
      const ranked = dedupeAndRankCompletions(
        [...jdtSuggestions, ...templates, ...localSuggestions],
        word.word,
        completionRequest.intent,
        expected,
      );
      const filtered = getSettings().caseSensitive && word.word
        ? ranked.filter((item) => (item.filterText || completionLabel(item)).includes(word.word))
        : ranked;
      const projectContext = getProjectContext();
      /**
       * What each entry says about itself before it is chosen.
       *
       * Six entries reading "add" that differ only in a parameter list are six
       * lines spent on one decision, and the parameter lists are what the
       * signature help shows once one is picked. Where a name comes from is
       * the other half: the JDK, this project, a dependency and a template all
       * looked alike, and which it is decides most of whether it is wanted.
       */
      const suggestions: RankedCompletion[] = groupOverloads(filtered, (item) => ({
        name: completionLabel(item).replace(/\(.*$/, ""),
        owner: String((item as any)._lsp?.detail || item.detail || ""),
        isMethod: item.kind === monaco.languages.CompletionItemKind.Method
          || item.kind === monaco.languages.CompletionItemKind.Function,
      })).map(({ item, count }) => {
        const origin = completionOrigin({
          source: item.source,
          detail: String(item.detail || ""),
        }, projectContext);
        const imports = importPreview((item as any)._lsp?.additionalTextEdits);
        const notes = [
          origin,
          overloadLabel(count),
          // Said before it is accepted, because accepting it is what adds it.
          imports.length ? `Import: ${imports.join(", ")}` : "",
          // A remembered answer is worth showing and worth admitting to.
          (item as any)._lsp?._fromCache ? "aus dem Cache" : "",
        ].filter(Boolean);
        const label = completionLabel(item);
        return {
          ...item,
          label: {
            label,
            ...(typeof item.label === "object" && item.label.detail ? { detail: item.label.detail } : {}),
            description: notes.join(" · "),
          },
        };
      });
      /**
       * Two types with one name, and the choice between them.
       *
       * `List` is java.util.List and it is also java.awt.List. Both were shown
       * as identical rows, and picking one added an import — which decides
       * what every other `List` in the file refers to. Where the name is
       * ambiguous the fully qualified form now stands beside it as its own
       * entry: it says which type outright and adds no import.
       */
      for (const alternative of qualifiedAlternatives(suggestions, (candidate) => ({
        name: completionLabel(candidate).replace(/\(.*$/, ""),
        qualifiedName: qualifiedNameOf(
          completionLabel(candidate),
          completionItemOrigin((candidate as any)._lsp || {}),
        ),
        addsImport: Boolean((candidate as any)._lsp?.additionalTextEdits?.length),
      }))) {
        const original = alternative.original as RankedCompletion;
        suggestions.push({
          ...original,
          label: {
            label: completionLabel(original),
            description: `${alternative.qualifiedName} · ${QUALIFIED_NOTE}`,
          },
          insertText: alternative.qualifiedName,
          insertTextRules: undefined,
          // Typed against the simple name, because that is what is being
          // typed; sorted immediately after the entry it stands beside.
          filterText: completionLabel(original),
          sortText: `${original.sortText || completionLabel(original)} q`,
          additionalTextEdits: undefined,
          command: undefined,
        } as RankedCompletion);
      }
      return {
        // Incomplete when the server has not answered yet, which is what makes
        // Monaco come back for the rest a moment later. Without it the list
        // somebody sees in the first tenth of a second would be the only list
        // they ever got.
        incomplete: !complete || Boolean(result?.isIncomplete),
        suggestions: suggestions as unknown as Monaco.languages.CompletionItem[],
      };
    },
  }));

  disposables.push(monaco.languages.registerHoverProvider("java", {
    provideHover: async (model, cursor) => {
      /*
       * The explanation of a name, which is what most of a hover is.
       *
       * Off by default, because a bubble covering the code every time the
       * pointer crosses a name is in the way more often than it helps. What
       * stays is the part that is not documentation: the message on an error
       * and the quick fixes for it, which Monaco and the block below draw
       * from the markers rather than from this request.
       */
      const wantsDocumentation = getSettings().hoverDocumentation !== false;
      await syncDocument(model);
      const result = wantsDocumentation
        ? await optionalRequest(model, "textDocument/hover", { position: position(cursor) })
        : null;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri }).filter((marker) =>
        cursor.lineNumber >= marker.startLineNumber
        && cursor.lineNumber <= marker.endLineNumber
        && (cursor.lineNumber !== marker.startLineNumber || cursor.column >= marker.startColumn)
        && (cursor.lineNumber !== marker.endLineNumber || cursor.column <= marker.endColumn),
      );
      const hoverRange = result?.range ? range(result.range) : markers[0]
        ? {
          startLineNumber: markers[0].startLineNumber,
          startColumn: markers[0].startColumn,
          endLineNumber: markers[0].endLineNumber,
          endColumn: markers[0].endColumn,
        }
        : new monaco.Range(cursor.lineNumber, cursor.column, cursor.lineNumber, cursor.column);
      const quickFixes = markers.length
        ? await requestCodeActions(model, hoverRange, markers).catch(() => [])
        : [];
      const contents = markdown(result?.contents);
      const actionable = (quickFixes || []).filter((action: any) =>
        !action.disabled && (action.edit || action.command || action.data),
      ).slice(0, 5);
      if (actionable.length) {
        const links = actionable.map((action: any) => {
          const title = String(action.title || "Quick Fix").replace(/([\\[\]()*_])/g, "\\$1");
          const argument = encodeURIComponent(JSON.stringify([action]));
          return `[💡 ${title}](command:kiwi.applyJavaCodeAction?${argument} "Quick Fix anwenden")`;
        });
        contents.push({
          value: `---\n**Quick Fixes**\n\n${links.join("  \n")}`,
          isTrusted: true,
        });
      }
      if (!contents.length) return null;
      return { range: hoverRange, contents };
    },
  }));

  disposables.push(monaco.languages.registerDefinitionProvider("java", {
    provideDefinition: async (model, cursor) => {
      const result = await optionalRequest(model, "textDocument/definition", { position: position(cursor) });
      if (!result) return null;
      return (Array.isArray(result) ? result : [result]).map(location);
    },
  }));

  disposables.push(monaco.languages.registerReferenceProvider("java", {
    provideReferences: async (model, cursor, context) => {
      const result = await optionalRequest(model, "textDocument/references", {
        position: position(cursor),
        context: { includeDeclaration: context.includeDeclaration },
      });
      return result?.map(location) || [];
    },
  }));

  disposables.push(monaco.languages.registerRenameProvider("java", {
    resolveRenameLocation: async (model, cursor) => {
      const result = await optionalRequest(model, "textDocument/prepareRename", { position: position(cursor) });
      if (!result) return { range: new monaco.Range(cursor.lineNumber, cursor.column, cursor.lineNumber, cursor.column), text: "", rejectReason: "Symbol kann nicht umbenannt werden." };
      const targetRange = result.range || result;
      return { range: range(targetRange), text: result.placeholder || model.getValueInRange(range(targetRange)) };
    },
    provideRenameEdits: async (model, cursor, newName) => {
      const result = await request(model, "textDocument/rename", { position: position(cursor), newName });
      if (!result) return { edits: [] };
      await ensureModels(monaco, api, Object.keys(result.changes || {}));
      const edits = Object.entries(result.changes || {}).flatMap(([uri, changes]: [string, any]) =>
        changes.map((edit: any) => ({ resource: monaco.Uri.parse(uri), textEdit: textEdit(edit), versionId: undefined })),
      );
      return { edits };
    },
  }));

  disposables.push(monaco.languages.registerDocumentFormattingEditProvider("java", {
    provideDocumentFormattingEdits: async (model, options) => {
      const result = await request(model, "textDocument/formatting", {
        options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
      });
      return result?.map(textEdit) || [];
    },
  }));

  disposables.push(monaco.languages.registerDocumentSymbolProvider("java", {
    provideDocumentSymbols: async (model) => {
      const result = await optionalRequest(model, "textDocument/documentSymbol", {});
      if (!result) return [];
      const mapSymbol = (item: any): Monaco.languages.DocumentSymbol => ({
        name: item.name,
        detail: item.detail || "",
        kind: Math.max(0, (item.kind || 1) - 1) as Monaco.languages.SymbolKind,
        range: range(item.range || item.location.range),
        selectionRange: range(item.selectionRange || item.range || item.location.range),
        tags: item.tags,
        children: item.children?.map(mapSymbol),
      });
      return result.map(mapSymbol);
    },
  }));

  /**
   * Inlay hints — parameter names and inferred types shown inline.
   *
   * The setting for these existed and was even forwarded to JDT LS, but no
   * provider was ever registered, so Monaco had nothing to display.
   */
  disposables.push(monaco.languages.registerInlayHintsProvider("java", {
    provideInlayHints: async (model, visible) => {
      const result = await optionalRequest(model, "textDocument/inlayHint", {
        range: {
          start: { line: visible.startLineNumber - 1, character: visible.startColumn - 1 },
          end: { line: visible.endLineNumber - 1, character: visible.endColumn - 1 },
        },
      });
      return {
        hints: (result || []).map((hint: any) => ({
          position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
          label: typeof hint.label === "string"
            ? hint.label
            : (hint.label || []).map((part: any) => part.value).join(""),
          // 1 = type, 2 = parameter in both protocols.
          kind: hint.kind === 1
            ? monaco.languages.InlayHintKind.Type
            : monaco.languages.InlayHintKind.Parameter,
          paddingLeft: hint.paddingLeft,
          paddingRight: hint.paddingRight,
          tooltip: typeof hint.tooltip === "string" ? hint.tooltip : hint.tooltip?.value,
        })),
        dispose: () => undefined,
      };
    },
  }));

  /**
   * Semantic tokens, so colouring stops being a guess.
   *
   * The lexical grammar has to infer from Java's naming conventions that an
   * UpperCamelCase word is a type; the server actually knows. Monaco resolves
   * a semantic token against the theme by joining its type and modifiers with
   * dots, so "class.static" falls back to the "class" rule and finally to the
   * ones the Monarch grammar already uses.
   */
  disposables.push(monaco.languages.registerDocumentSemanticTokensProvider("java", {
    getLegend: () => ({
      tokenTypes: semanticLegend?.tokenTypes || [],
      tokenModifiers: semanticLegend?.tokenModifiers || [],
    }),
    provideDocumentSemanticTokens: async (model) => {
      // Without a legend Monaco cannot decode the numbers the server sends.
      if (!semanticLegend?.tokenTypes?.length) return null;
      const result = await optionalRequest(model, "textDocument/semanticTokens/full", {});
      if (!result?.data?.length) return null;
      return { resultId: result.resultId, data: Uint32Array.from(result.data) };
    },
    releaseDocumentSemanticTokens: () => undefined,
  }));

  disposables.push(monaco.languages.registerSignatureHelpProvider("java", {
    signatureHelpTriggerCharacters: ["(", ","],
    provideSignatureHelp: async (model, cursor, _token, context) => {
      const result = await optionalRequest(model, "textDocument/signatureHelp", {
        position: position(cursor),
        context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger },
      });
      if (!result) return null;
      return {
        value: {
          activeParameter: result.activeParameter || 0,
          activeSignature: result.activeSignature || 0,
          signatures: result.signatures.map((signature: any) => ({
            label: signature.label,
            documentation: markdown(signature.documentation)[0],
            parameters: signature.parameters?.map((parameter: any) => ({
              label: parameter.label,
              documentation: markdown(parameter.documentation)[0],
            })),
          })),
        },
        dispose: () => {},
      };
    },
  }));

  disposables.push(monaco.languages.registerCodeActionProvider("java", {
    provideCodeActions: async (model, selection, context) => {
      await syncDocument(model);
      const result = await requestCodeActions(model, selection, context.markers);
      const actions = (result || []).filter((action: any) =>
        !action.disabled && (action.edit || action.command || action.data),
      ).map((action: any) => ({
        title: action.title,
        kind: action.kind,
        diagnostics: context.markers,
        command: {
          id: "kiwi.applyJavaCodeAction",
          title: action.title,
          arguments: [action],
        },
        isPreferred: action.isPreferred,
      }));
      actions.push(
        {
          title: "Konstruktor generieren",
          kind: "source.generate.kiwi.constructor",
          diagnostics: context.markers,
          command: { id: "kiwi.generateConstructor", title: "Konstruktor generieren" },
          isPreferred: false,
        },
        {
          title: "Getter und Setter generieren",
          kind: "source.generate.kiwi.accessors",
          diagnostics: context.markers,
          command: { id: "kiwi.generateJavaMembers", title: "Getter und Setter generieren" },
          isPreferred: false,
        },
        {
          title: "equals() und hashCode() generieren",
          kind: "source.generate.kiwi.equalsHashCode",
          diagnostics: context.markers,
          command: { id: "kiwi.generateEqualsHashCode", title: "equals() und hashCode() generieren" },
          isPreferred: false,
        },
        {
          title: "toString() generieren",
          kind: "source.generate.kiwi.toString",
          diagnostics: context.markers,
          command: { id: "kiwi.generateToString", title: "toString() generieren" },
          isPreferred: false,
        },
        {
          title: "JUnit-Testklasse für diesen Typ erstellen",
          kind: "source.generate.kiwi.test",
          diagnostics: context.markers,
          command: { id: "kiwi.createTestClass", title: "JUnit-Testklasse erstellen" },
          isPreferred: false,
        },
      );
      return { actions, dispose: () => {} };
    },
  }));

  disposables.push(monaco.editor.registerCommand("kiwi.runJavaLens", async (_accessor, file: string) => {
    const root = getRoot();
    if (root) await api.java.execute({ root, file, action: "run" });
  }));
  disposables.push(monaco.editor.registerCommand("kiwi.debugJavaLens", async (_accessor, file: string) => {
    await runDebugCodeLens(file, onDebugFile, api, getRoot);
  }));
  disposables.push(monaco.editor.registerCommand("kiwi.runTestLens", async (_accessor, target: string) => {
    const root = getRoot();
    if (root) await api.tests.run(root, target);
  }));
  // JDT LS reports the folds Java's own syntax implies. A region marker is a
  // comment convention it knows nothing about, so the ranges are contributed
  // here — and Monaco merges providers, which means the language server's folds
  // stay exactly as they were.
  disposables.push(monaco.languages.registerFoldingRangeProvider("java", {
    provideFoldingRanges: (model) => findJavaRegions(model.getValue()).map((region) => ({
      start: region.startLine,
      end: region.endLine - (region.closed ? 1 : 0),
      kind: monaco.languages.FoldingRangeKind.Region,
    })),
  }));
  disposables.push(monaco.languages.registerCodeLensProvider("java", {
    provideCodeLenses: (model) => {
      const source = model.getValue();
      const lenses: Monaco.languages.CodeLens[] = [];
      const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
      const className = source.match(/\b(?:class|record|enum)\s+([A-Za-z_$][\w$]*)/)?.[1]
        || model.uri.path.split("/").at(-1)?.replace(/\.java$/i, "")
        || "";
      for (const match of source.matchAll(/\bpublic\s+static\s+void\s+main\s*\(\s*String(?:\[\]|\.\.\.)/g)) {
        const line = model.getPositionAt(match.index || 0).lineNumber;
        const targetRange = new monaco.Range(line, 1, line, 1);
        lenses.push(
          { range: targetRange, command: { id: "kiwi.runJavaLens", title: "▶ Run", arguments: [model.uri.fsPath] } },
          { range: targetRange, command: { id: "kiwi.debugJavaLens", title: "🐞 Debug", arguments: [model.uri.fsPath] } },
        );
      }
      for (const match of source.matchAll(/@(?:org\.junit\.jupiter\.api\.)?(?:Test|ParameterizedTest|RepeatedTest)\b[\s\S]{0,300}?\b(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:void|[\w<>, ?.[\]]+)\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        const line = model.getPositionAt(match.index || 0).lineNumber;
        const target = `${packageName ? `${packageName}.` : ""}${className}#${match[1]}`;
        lenses.push({
          range: new monaco.Range(line, 1, line, 1),
          command: { id: "kiwi.runTestLens", title: "▶ Run Test", arguments: [target] },
        });
      }
      return { lenses, dispose: () => {} };
    },
  }));

  return {
    setCompletionIntent: (intent) => completionGate.setIntent(intent),
    setSemanticTokenLegend: (legend) => {
      semanticLegend = legend;
    },
    fixAll: async (model, diagnostics) => {
      const merged = await fixAllInModel(model, diagnostics as never);
      if (!merged.total) return { ...merged, confirmed: false };
      // The whole change is shown before a character of it is written.
      const confirmed = await _confirmWorkspaceEdit(merged.edit);
      if (!confirmed) return { ...merged, confirmed: false };
      const touched = await applyLspWorkspaceEdit(monaco, api, merged.edit, getRoot());
      for (const file of touched) {
        const changed = monaco.editor.getModels().find((candidate) =>
          candidate.uri.fsPath.toLowerCase() === file.toLowerCase(),
        );
        if (changed) {
          await api.language.change({ root: getRoot(), file, text: changed.getValue() }).catch(() => false);
        }
      }
      return { ...merged, confirmed: true };
    },
    acceptedCallReturnType: (uri, lineNumber) => (
      acceptedCall && acceptedCall.uri === uri && acceptedCall.line === lineNumber
        ? acceptedCall.returnType
        : ""
    ),
    organizeImports: async (model) => {
      await syncDocument(model);
      const fullRange = model.getFullModelRange();
      const result = await optionalRequest(model, "textDocument/codeAction", {
        range: {
          start: { line: fullRange.startLineNumber - 1, character: fullRange.startColumn - 1 },
          end: { line: fullRange.endLineNumber - 1, character: fullRange.endColumn - 1 },
        },
        context: { diagnostics: [], only: ["source.organizeImports"], triggerKind: 1 },
      });
      const action = (result || []).find((candidate: any) =>
        !candidate.disabled && candidate.kind === "source.organizeImports",
      );
      return action ? applyCodeAction(action) : [];
    },
    dispose: () => {
      if (completionCacheWriteTimer !== null) globalThis.clearTimeout(completionCacheWriteTimer);
      writePersistentCompletionCache(completionCache);
      disposables.forEach((item) => item.dispose());
    },
  };
}

export function lspDiagnosticsToMarkers(monaco: MonacoApi, diagnostics: any[]): Monaco.editor.IMarkerData[] {
  return diagnostics.map((item) => ({
    severity: item.severity === 1
      ? monaco.MarkerSeverity.Error
      : item.severity === 2
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Info,
    message: item.message,
    code: typeof item.code === "object" ? item.code.value : item.code,
    source: item.source || "JDT LS",
    startLineNumber: item.range.start.line + 1,
    startColumn: item.range.start.character + 1,
    endLineNumber: item.range.end.line + 1,
    endColumn: item.range.end.character + 1,
    tags: item.tags,
  }));
}

function workspaceEdit(monaco: MonacoApi, edit: any, convert: (edit: any) => Monaco.languages.TextEdit): Monaco.languages.WorkspaceEdit {
  return {
    edits: Object.entries(edit.changes || {}).flatMap(([uri, changes]: [string, any]) =>
      changes.map((change: any) => ({ resource: monaco.Uri.parse(uri), textEdit: convert(change), versionId: undefined })),
    ),
  };
}

async function ensureModels(monaco: MonacoApi, api: KiwiApi, uris: string[]) {
  for (const uri of uris) {
    const parsed = monaco.Uri.parse(uri);
    if (monaco.editor.getModel(parsed)) continue;
    try {
      const content = await api.file.read(parsed.fsPath);
      monaco.editor.createModel(content, "java", parsed);
    } catch {}
  }
}

export async function applyLspWorkspaceEdit(monaco: MonacoApi, api: KiwiApi, edit: any, projectRoot = "") {
  const textDocuments = new Map<string, any[]>();
  for (const [uri, changes] of Object.entries(edit?.changes || {})) {
    textDocuments.set(uri, changes as any[]);
  }
  const resourceChanges = edit?.documentChanges || [];
  for (const change of resourceChanges) {
    if (change.textDocument?.uri && Array.isArray(change.edits)) {
      textDocuments.set(change.textDocument.uri, change.edits);
    }
  }
  const transactionPaths = [
    ...[...textDocuments.keys()].map((uri) => monaco.Uri.parse(uri).fsPath),
    ...resourceChanges.flatMap((change: any) => [
      change.uri ? monaco.Uri.parse(change.uri).fsPath : "",
      change.oldUri ? monaco.Uri.parse(change.oldUri).fsPath : "",
      change.newUri ? monaco.Uri.parse(change.newUri).fsPath : "",
    ]),
  ].filter(Boolean);
  let transactionStarted = false;
  if (projectRoot && transactionPaths.length) {
    await api.workspace.beginOperation(projectRoot, "Java-Refactoring / Quick Fix", transactionPaths);
    transactionStarted = true;
  }
  try {
    await ensureModels(monaco, api, [...textDocuments.keys()]);
    const touched: string[] = [];
    // Paths that a rename operation has already moved. A class rename arrives
    // as a text edit for the old file plus a rename to the new one; writing the
    // edit back to the original URI afterwards would recreate the old file and
    // leave the class on disk twice.
    const renamed = new Map<string, string>();
    const resolvePath = (filePath: string) => renamed.get(filePath.toLowerCase()) || filePath;

    const applyTextEdits = async (uri: string, changes: any[]) => {
      const parsed = monaco.Uri.parse(uri);
      const model = monaco.editor.getModel(parsed);
      if (!model) return;
      model.applyEdits(changes.map((change) => ({
        range: {
          startLineNumber: change.range.start.line + 1,
          startColumn: change.range.start.character + 1,
          endLineNumber: change.range.end.line + 1,
          endColumn: change.range.end.character + 1,
        },
        text: change.newText,
      })));
      const target = resolvePath(parsed.fsPath);
      await api.file.write(target, model.getValue());
      if (!touched.includes(target)) touched.push(target);
    };

    const applyResourceChange = async (change: any) => {
      if (change.kind === "create") {
        const target = monaco.Uri.parse(change.uri).fsPath;
        await api.file.create(target.replace(/[\\/][^\\/]+$/, ""), target.split(/[\\/]/).at(-1) || "New.java", false);
        return;
      }
      if (change.kind === "rename") {
        const oldPath = resolvePath(monaco.Uri.parse(change.oldUri).fsPath);
        const newPath = monaco.Uri.parse(change.newUri).fsPath;
        const oldDirectory = oldPath.replace(/[\\/][^\\/]+$/, "");
        const newDirectory = newPath.replace(/[\\/][^\\/]+$/, "");
        let currentPath = oldPath;
        if (oldDirectory.toLowerCase() !== newDirectory.toLowerCase()) {
          currentPath = await api.file.transfer(oldPath, newDirectory, true);
        }
        const targetName = newPath.split(/[\\/]/).at(-1) || "";
        if ((currentPath.split(/[\\/]/).at(-1) || "") !== targetName) {
          currentPath = await api.file.rename(currentPath, targetName);
        }
        renamed.set(monaco.Uri.parse(change.oldUri).fsPath.toLowerCase(), currentPath);
        const index = touched.indexOf(oldPath);
        if (index >= 0) touched[index] = currentPath;
        return;
      }
      if (change.kind === "delete") {
        await api.file.delete(resolvePath(monaco.Uri.parse(change.uri).fsPath));
      }
    };

    // `edit.changes` carries no ordering, so it is applied before the ordered
    // documentChanges list.
    for (const [uri, changes] of Object.entries(edit?.changes || {})) {
      await applyTextEdits(uri, changes as any[]);
    }
    // documentChanges is order-significant per the LSP spec.
    for (const change of resourceChanges) {
      if (change.textDocument?.uri && Array.isArray(change.edits)) {
        await applyTextEdits(change.textDocument.uri, change.edits);
      } else {
        await applyResourceChange(change);
      }
    }
    return touched;
  } finally {
    if (transactionStarted) await api.workspace.endOperation(projectRoot);
  }
}

export async function previewLspWorkspaceEdit(
  monaco: MonacoApi,
  api: KiwiApi,
  edit: any,
): Promise<WorkspaceEditPreviewItem[]> {
  const documents = new Map<string, any[]>();
  for (const [uri, changes] of Object.entries(edit?.changes || {})) {
    documents.set(uri, changes as any[]);
  }
  const resourceChanges = edit?.documentChanges || [];
  for (const change of resourceChanges) {
    if (change.textDocument?.uri && Array.isArray(change.edits)) {
      documents.set(change.textDocument.uri, change.edits);
    }
  }
  const previews: WorkspaceEditPreviewItem[] = [];
  for (const [uri, changes] of documents) {
    const parsed = monaco.Uri.parse(uri);
    const before = monaco.editor.getModel(parsed)?.getValue()
      ?? await api.file.read(parsed.fsPath).catch(() => "");
    const sorted = [...changes].sort((left, right) =>
      positionOffset(before, right.range.start) - positionOffset(before, left.range.start),
    );
    let after = before;
    for (const change of sorted) {
      const start = positionOffset(before, change.range.start);
      const end = positionOffset(before, change.range.end);
      after = `${after.slice(0, start)}${change.newText}${after.slice(end)}`;
    }
    previews.push({ path: parsed.fsPath, kind: "edit", before, after });
  }
  for (const change of resourceChanges) {
    if (change.kind === "create") {
      previews.push({ path: monaco.Uri.parse(change.uri).fsPath, kind: "create", before: "", after: "" });
    }
    if (change.kind === "rename") {
      previews.push({
        path: monaco.Uri.parse(change.oldUri).fsPath,
        targetPath: monaco.Uri.parse(change.newUri).fsPath,
        kind: "rename",
        before: "",
        after: "",
      });
    }
    if (change.kind === "delete") {
      const target = monaco.Uri.parse(change.uri).fsPath;
      previews.push({
        path: target,
        kind: "delete",
        before: await api.file.read(target).catch(() => ""),
        after: "",
      });
    }
  }
  return previews;
}

function positionOffset(text: string, position: { line: number; character: number }) {
  let offset = 0;
  for (let line = 0; line < position.line && offset < text.length; line += 1) {
    const newline = text.indexOf("\n", offset);
    offset = newline < 0 ? text.length : newline + 1;
  }
  return Math.min(text.length, offset + Math.max(0, position.character));
}

export function fileUri(file: string) {
  const normalized = file.replace(/\\/g, "/");
  return encodeURI(normalized.match(/^[A-Za-z]:/) ? `file:///${normalized}` : `file://${normalized}`);
}

/**
 * The file a URI stands for — what fileUri did, undone.
 *
 * An editor knows its model by URI and the rest of Kiwi speaks in paths, so
 * anything the editor asks about the file it is showing has to come back
 * through here. Answers with "" for anything that is not a file URI, because a
 * guess would be a path pointing at nothing.
 */
export function fileFromUri(uri: string) {
  const text = String(uri || "");
  if (!text.toLowerCase().startsWith("file://")) return "";
  let decoded: string;
  try {
    // decodeURIComponent, not decodeURI: Monaco writes a Windows path as
    // file:///c%3A/… and decodeURI leaves the reserved colon encoded, which
    // turns the drive into part of a folder name and the whole path into one
    // that names nothing.
    decoded = decodeURIComponent(text.slice("file://".length));
  } catch {
    return "";
  }
  if (globalThis.window?.kiwi?.platform === "win32") {
    if (decoded.startsWith("//")) return decoded.replace(/\//g, "\\");
    if (!decoded.startsWith("/") && !/^[a-z]:/i.test(decoded)) {
      return `\\\\${decoded.replace(/\//g, "\\")}`;
    }
  }
  // file:///C:/… carries a slash before the drive letter that no path has.
  const withoutLeadingSlash = /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
  if (!/^[A-Za-z]:/.test(withoutLeadingSlash)) return withoutLeadingSlash;
  // Monaco writes the drive letter in lower case; the rest of Kiwi writes it
  // the way Windows does. The two spellings name one file and compared as text
  // they are two, which is how a build file could be refused as not belonging
  // to the project it was open in.
  return `${withoutLeadingSlash[0].toUpperCase()}${withoutLeadingSlash.slice(1).replace(/\//g, "\\")}`;
}
