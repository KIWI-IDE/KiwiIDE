/**
 * The state behind the Tailer tool window.
 *
 * Kept outside React on purpose: the main process keeps following the file even
 * while another tab is in front, so the buffer and the subscription have to
 * outlive the view that draws them. The component reads this through
 * `useSyncExternalStore`; switching tabs and coming back finds the log intact.
 */

export type TailerLevel = "error" | "warn" | "info" | "debug" | "none";

export type TailerLine = {
  /** Stable identity for React keys; never reused. */
  seq: number;
  text: string;
  level: TailerLevel;
};

export type TailerSnapshot = {
  file: string;
  available: boolean;
  error: string;
  follow: boolean;
  paused: boolean;
  wrap: boolean;
  filter: string;
  regex: boolean;
  caseSensitive: boolean;
  lines: readonly TailerLine[];
  pendingCount: number;
};

const MAX_LINES = 5000;

const ERROR_RE = /\b(error|severe|fatal|exception)\b/i;
const WARN_RE = /\b(warn|warning)\b/i;
const DEBUG_RE = /\b(debug|trace|fine|finer|finest|verbose)\b/i;
const INFO_RE = /\b(info|config)\b/i;

/** Rough level for colouring — the head of the line is enough and stays fast. */
export function detectLevel(line: string): TailerLevel {
  if (!line) return "none";
  const head = line.length > 160 ? line.slice(0, 160) : line;
  if (ERROR_RE.test(head)) return "error";
  if (WARN_RE.test(head)) return "warn";
  if (DEBUG_RE.test(head)) return "debug";
  if (INFO_RE.test(head)) return "info";
  return "none";
}

const listeners = new Set<() => void>();
let seq = 0;
let buffer: TailerLine[] = [];
let pending: TailerLine[] = [];
let disposers: Array<() => void> = [];
let initialized = false;

let snapshot: TailerSnapshot = {
  file: "",
  available: false,
  error: "",
  follow: true,
  paused: false,
  wrap: false,
  filter: "",
  regex: false,
  caseSensitive: false,
  lines: buffer,
  pendingCount: 0,
};

function commit(patch: Partial<TailerSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function makeLine(text: string): TailerLine {
  return { seq: seq++, text, level: detectLevel(text) };
}

function appendLines(incoming: TailerLine[]): void {
  let next = buffer.length ? buffer.concat(incoming) : incoming.slice();
  if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES);
  buffer = next;
  commit({ lines: buffer });
}

function onLines(texts: string[]): void {
  const made = texts.map(makeLine);
  if (snapshot.paused) {
    pending = pending.concat(made);
    if (pending.length > MAX_LINES) pending = pending.slice(pending.length - MAX_LINES);
    commit({ pendingCount: pending.length });
    return;
  }
  appendLines(made);
}

function resetBuffer(): void {
  buffer = [];
  pending = [];
  commit({ lines: buffer, pendingCount: 0 });
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  const api = typeof window !== "undefined" ? window.kiwi?.tailer : undefined;
  if (!api) return;
  disposers.push(api.onLines((payload) => onLines(payload?.lines ?? [])));
  disposers.push(api.onReset((payload) => {
    commit({ file: payload.path, error: "" });
    resetBuffer();
  }));
  disposers.push(api.onStatus((payload) => commit({ available: Boolean(payload?.available) })));
  disposers.push(api.onError((payload) => commit({ error: payload?.message || "Unbekannter Fehler." })));
}

export const tailerStore = {
  subscribe(listener: () => void): () => void {
    ensureInitialized();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): TailerSnapshot {
    return snapshot;
  },

  async choose(defaultPath?: string): Promise<void> {
    const api = window.kiwi?.tailer;
    if (!api) return;
    try {
      const chosen = await api.choose(defaultPath);
      if (chosen) await tailerStore.openPath(chosen);
    } catch (error) {
      commit({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async openPath(path: string): Promise<void> {
    const api = window.kiwi?.tailer;
    if (!api || !path) return;
    resetBuffer();
    commit({ file: path, error: "" });
    try {
      await api.open(path, { lastLines: 500 });
    } catch (error) {
      commit({ error: error instanceof Error ? error.message : String(error), available: false });
    }
  },

  close(): void {
    void window.kiwi?.tailer?.close().catch(() => undefined);
    resetBuffer();
    commit({ file: "", available: false, error: "" });
  },

  /** Empties the view without stopping the follow. */
  clear(): void {
    resetBuffer();
  },

  setFollow(value: boolean): void {
    if (snapshot.follow !== value) commit({ follow: value });
  },

  setPaused(value: boolean): void {
    if (snapshot.paused === value) return;
    if (!value && pending.length) {
      const drained = pending;
      pending = [];
      commit({ paused: false, pendingCount: 0 });
      appendLines(drained);
    } else {
      commit({ paused: value });
    }
  },

  setWrap(value: boolean): void {
    if (snapshot.wrap !== value) commit({ wrap: value });
  },

  setFilter(value: string): void {
    if (snapshot.filter !== value) commit({ filter: value });
  },

  setRegex(value: boolean): void {
    if (snapshot.regex !== value) commit({ regex: value });
  },

  setCaseSensitive(value: boolean): void {
    if (snapshot.caseSensitive !== value) commit({ caseSensitive: value });
  },
};
