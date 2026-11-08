/**
 * Where a file was left: the caret, the scroll, the selection, the folds.
 *
 * One record per file per project. Kept when the tab closes, because a closed
 * tab means the file is not open — not that where you were working in it is
 * worth forgetting. Reopening it should land where you left it.
 */
export interface EditorFileState {
  /** Absolute path of the file, which already carries the project it is in. */
  path: string;
  cursorLine: number;
  cursorColumn: number;
  scrollTop: number;
  scrollLeft: number;
  /** The selection, when there is one worth restoring. */
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  /** First lines of the regions that were folded, as Monaco reports them. */
  folds?: number[];
  /** When it was last left, which is also what decides who is dropped first. */
  lastOpened: number;
}

/**
 * How many files are remembered per project.
 *
 * A session that visits a thousand files should not carry a thousand records
 * into the next one. The oldest visit goes first, so the files somebody is
 * actually working in stay.
 */
export const MAX_REMEMBERED_FILES = 300;

/** The key one file is remembered under, unique across projects. */
export function stateKey(projectRoot: string, filePath: string): string {
  const project = normalizePath(projectRoot);
  const file = normalizePath(filePath);
  // Two projects can hold `src/Main.java`, and those are different files that
  // were left in different places. The project is part of the key even though
  // an absolute path usually carries it already — a file opened from outside
  // the project does not.
  return [project, file].join("::");
}

function normalizePath(value: string): string {
  const text = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows paths differ in case between callers and mean the same file.
  return text.toLocaleLowerCase();
}

/**
 * Whether a stored state is worth putting back.
 *
 * Line 1, column 1, no scroll and no selection is where a file opens anyway.
 * Storing it is harmless; restoring it means doing work to arrive where the
 * editor already was, and every one of those is a chance to arrive somewhere
 * else instead.
 */
export function isRestorable(state: EditorFileState | undefined | null): state is EditorFileState {
  if (!state) return false;
  if (state.selection || (state.folds || []).length) return true;
  return state.cursorLine > 1 || state.cursorColumn > 1 || state.scrollTop > 0 || state.scrollLeft > 0;
}

/**
 * The records worth keeping, newest visit first.
 *
 * Sorting before the cut is what makes it a least-recently-used list rather
 * than a first-in-first-out one: without it the file somebody opened first and
 * has been working in all day is the first to be dropped.
 */
export function trimStates(states: EditorFileState[], limit = MAX_REMEMBERED_FILES): EditorFileState[] {
  return [...states]
    .filter((state) => state && typeof state.path === "string" && state.path)
    .sort((left, right) => (right.lastOpened || 0) - (left.lastOpened || 0))
    .slice(0, Math.max(0, limit));
}

/** Reads back what was stored, ignoring anything that is not a state. */
export function parseStates(raw: unknown): EditorFileState[] {
  if (!Array.isArray(raw)) return [];
  const states: EditorFileState[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<EditorFileState>;
    if (typeof candidate.path !== "string" || !candidate.path) continue;
    states.push({
      path: candidate.path,
      cursorLine: positive(candidate.cursorLine, 1),
      cursorColumn: positive(candidate.cursorColumn, 1),
      scrollTop: Math.max(0, Number(candidate.scrollTop) || 0),
      scrollLeft: Math.max(0, Number(candidate.scrollLeft) || 0),
      selection: parseSelection(candidate.selection),
      folds: Array.isArray(candidate.folds)
        ? candidate.folds.map((line) => positive(line, 0)).filter((line) => line > 0)
        : undefined,
      lastOpened: Math.max(0, Number(candidate.lastOpened) || 0),
    });
  }
  return states;
}

function parseSelection(raw: EditorFileState["selection"]): EditorFileState["selection"] {
  if (!raw || typeof raw !== "object") return undefined;
  const selection = {
    startLine: positive(raw.startLine, 1),
    startColumn: positive(raw.startColumn, 1),
    endLine: positive(raw.endLine, 1),
    endColumn: positive(raw.endColumn, 1),
  };
  // An empty selection is just the caret, which is stored separately.
  if (selection.startLine === selection.endLine && selection.startColumn === selection.endColumn) return undefined;
  return selection;
}

function positive(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * Every file's last place, held for the whole session and written to disk.
 *
 * One store rather than a map here and a ref there: scroll and caret used to
 * be remembered in one place, the session's cursor in another, and neither
 * knew about folds or selections at all.
 */
export class EditorStateStore {
  private readonly states = new Map<string, EditorFileState>();
  private projectRoot = "";

  /** Points the store at a project and fills it with what was stored for it. */
  adopt(projectRoot: string, states: EditorFileState[]): void {
    this.projectRoot = projectRoot;
    this.states.clear();
    for (const state of trimStates(states)) {
      this.states.set(stateKey(projectRoot, state.path), state);
    }
  }

  get root(): string {
    return this.projectRoot;
  }

  get size(): number {
    return this.states.size;
  }

  read(filePath: string): EditorFileState | undefined {
    return this.states.get(stateKey(this.projectRoot, filePath));
  }

  write(state: EditorFileState): void {
    this.states.set(stateKey(this.projectRoot, state.path), state);
    if (this.states.size <= MAX_REMEMBERED_FILES) return;
    // Over the limit: keep the most recent visits and let the rest go.
    const kept = trimStates([...this.states.values()]);
    this.states.clear();
    for (const entry of kept) this.states.set(stateKey(this.projectRoot, entry.path), entry);
  }

  /** Everything worth writing down, newest first. */
  snapshot(): EditorFileState[] {
    return trimStates([...this.states.values()]);
  }

  /** Forgets one file, for a file that was deleted rather than closed. */
  forget(filePath: string): void {
    this.states.delete(stateKey(this.projectRoot, filePath));
  }
}
