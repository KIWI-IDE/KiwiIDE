export type CompletionPhase = "ready" | "syncing" | "sync-error" | "catalog-missing" | "source-unreachable" | "timeout" | "no-matches" | "server-missing" | "server-starting" | "server-error";
export interface CompletionStatus { file: string; phase: CompletionPhase; detail?: string; updatedAt: number; origin: string }
const statuses = new Map<string, Map<string, CompletionStatus>>();
export const COMPLETION_STATUS_EVENT = "kiwi-completion-status";
export function completionFileKey(file: string) { const value = file.replace(/\\/g, "/"); return /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value; }
export function completionStatuses(file: string) { return [...(statuses.get(completionFileKey(file))?.values() || [])]; }
export function completionStatus(file: string) {
  const priority: CompletionPhase[] = ["catalog-missing", "sync-error", "server-error", "source-unreachable", "timeout", "syncing", "server-starting", "server-missing", "no-matches", "ready"];
  return completionStatuses(file).sort((a, b) => priority.indexOf(a.phase) - priority.indexOf(b.phase))[0];
}
export function reportCompletionStatus(file: string, phase: CompletionPhase, detail = "", origin = "build") {
  const key = completionFileKey(file);
  const previous = statuses.get(key)?.get(origin);
  if (previous?.phase === phase && previous.detail === detail) return;
  const value = { file, phase, detail, updatedAt: Date.now(), origin };
  if (statuses.size >= 100) statuses.delete(statuses.keys().next().value!);
  if (!statuses.has(key)) statuses.set(key, new Map());
  statuses.get(key)!.set(origin, value);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(COMPLETION_STATUS_EVENT, { detail: value }));
}
