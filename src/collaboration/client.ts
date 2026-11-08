import type { CollabEdit } from "../types";

/**
 * A reset-aware serial queue for collaboration requests.
 *
 * IPC calls are promises and therefore otherwise race each other when Monaco
 * emits several changes in quick succession. The epoch makes queued work from
 * a file that was closed or reset harmless without pretending an already sent
 * network request can be cancelled.
 */
export interface CollabSerialQueue {
  current(): number;
  invalidate(): number;
  isCurrent(epoch: number): boolean;
  enqueue<T>(epoch: number, task: () => Promise<T>): Promise<T | undefined>;
  idle(): Promise<void>;
}

export function createCollabSerialQueue(): CollabSerialQueue {
  let epoch = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    current: () => epoch,
    invalidate: () => {
      epoch += 1;
      return epoch;
    },
    isCurrent: (candidate) => candidate === epoch,
    enqueue: <T,>(candidate: number, task: () => Promise<T>) => {
      const result = tail.then(() => candidate === epoch ? task() : undefined);
      // A failed request must not poison every edit entered afterwards.
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    idle: () => tail,
  };
}

/**
 * Appends work to one hosted file's stream.
 *
 * Saves and Monaco edits use the same stream, so a full snapshot can never be
 * followed by an older incremental edit that was still waiting in IPC.
 */
export function enqueueCollabFileTask(
  queues: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<void>,
): Promise<void> {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }).catch(() => undefined);
  return next;
}

export interface CollabSnapshotStamp {
  epoch: number;
  path: string;
  localRevision: number;
}

/** A server snapshot is safe only while the user has typed nothing newer. */
export function isCurrentCollabSnapshot(
  expected: CollabSnapshotStamp,
  current: CollabSnapshotStamp,
): boolean {
  return expected.epoch === current.epoch
    && expected.path === current.path
    && expected.localRevision === current.localRevision;
}

/** Converts one Monaco event into edits valid against its pre-change text. */
export function collabEditsFromChanges(changes: Array<{
  rangeOffset: number;
  rangeLength: number;
  text: string;
}>): CollabEdit[] {
  return [...changes]
    .sort((left, right) => right.rangeOffset - left.rangeOffset)
    .map((change) => ({
      start: change.rangeOffset,
      end: change.rangeOffset + change.rangeLength,
      text: change.text,
    }));
}

/** Applies the host-authoritative edit to the text currently shown by a client. */
export function applyCollabEdit(text: string, edit: CollabEdit): string {
  const start = Math.max(0, Math.min(Number(edit?.start) || 0, text.length));
  const end = Math.max(start, Math.min(Number(edit?.end) || 0, text.length));
  return text.slice(0, start) + String(edit?.text ?? "") + text.slice(end);
}

export interface CollabHostEditResult {
  ok: boolean;
  applied?: boolean;
  /** True when the service transformed the requested offsets over newer work. */
  rebased?: boolean;
  version?: number;
  edit?: CollabEdit;
}

/**
 * A host may keep its optimistic Monaco text only when the service applied the
 * exact edit to the exact revision it was created for. Anything transformed,
 * skipped or separated by a revision gap needs one authoritative snapshot.
 */
export function collabHostEditNeedsSnapshot(
  baseVersion: number | undefined,
  requested: CollabEdit,
  result: CollabHostEditResult,
): boolean {
  if (!result.ok || result.applied === false || result.rebased === true
    || !Number.isInteger(result.version)) return true;
  if (baseVersion !== undefined && result.version !== baseVersion + 1) return true;
  return Boolean(result.edit && (
    result.edit.start !== requested.start
    || result.edit.end !== requested.end
    || result.edit.text !== requested.text
  ));
}

/** A remote offset edit is safe only when it is the next known revision. */
export function canApplyCollabRemoteEdit(
  knownVersion: number | undefined,
  incomingVersion: number,
  localWorkPending: boolean,
): boolean {
  return !localWorkPending
    && Number.isInteger(knownVersion)
    && incomingVersion === (knownVersion as number) + 1;
}

/** The wire only ever carries forward-slash paths relative to the hosted root. */
export function collabRelativePath(root: string, absolutePath: string): string {
  if (!root || !absolutePath) return "";
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const rootKey = normalizedRoot.replace(/\\/g, "/").toLocaleLowerCase();
  const normalizedPath = absolutePath.replace(/\\/g, "/");
  const lowerPath = normalizedPath.toLocaleLowerCase();
  if (lowerPath !== rootKey && !lowerPath.startsWith(`${rootKey}/`)) return "";
  return normalizedPath.slice(rootKey.length).replace(/^\/+/, "");
}

/** Compares host roots in the same case-insensitive spelling Windows uses. */
export function collabRootsEqual(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  return Boolean(left && right) && normalize(left) === normalize(right);
}

/** Guest events must never be mistaken for edits to the local workspace. */
export function isActiveCollabHost(hosting: boolean, hostedRoot: string, workspaceRoot: string): boolean {
  return hosting && collabRootsEqual(hostedRoot, workspaceRoot);
}

/** Opening the same tool again must not reset all already shared documents. */
export function shouldInitializeCollabHost(
  hosting: boolean,
  hostedRoot: string,
  nextRoot: string,
): boolean {
  return Boolean(nextRoot) && !isActiveCollabHost(hosting, hostedRoot, nextRoot);
}

/** Resolves a wire path for an already registered project without Node's path API. */
export function collabAbsolutePath(root: string, relativePath: string): string {
  if (!root || !relativePath || /^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith("/")) return "";
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part === ".")) return "";
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${parts.join(separator)}`;
}
