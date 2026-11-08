import type { WorkspaceProject, WorkspaceState } from "../types";

/**
 * Every project Kiwi knows about, in the order they belong in.
 *
 * There are three places a project can be named — the workspace's own list,
 * the resumable list a restart leaves behind, and the recent paths in the
 * settings — and each of them knows something the others do not. The Project
 * Hub merged all three; the quick switcher in the title bar read only the
 * first, so a project opened yesterday and closed since was in one list and
 * not the other.
 *
 * One function, used by both. A project that shows in the hub is a project
 * that can be switched to.
 */
export function mergeProjectList(workspace: WorkspaceState, recentProjects: string[] = []): WorkspaceProject[] {
  // The resumable list is the fuller one after a restart; before there has
  // been one it is empty and the workspace's own list is all there is.
  const known = workspace.resumableProjects?.length ? workspace.resumableProjects : (workspace.projects || []);
  const seen = new Set(known.map((project) => normalizeRoot(project.root)));
  const fromRecents: WorkspaceProject[] = [];
  for (const root of recentProjects) {
    const key = normalizeRoot(root);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fromRecents.push({
      root,
      name: root.split(/[\\/]/).filter(Boolean).at(-1) || root,
      addedAt: "",
      lastOpenedAt: "",
      // Nothing here says whether it is still there. The hub finds out when it
      // is opened, and refusing to list it would hide a project somebody could
      // still relocate.
      pinned: false,
      exists: true,
    });
  }
  return [...known, ...fromRecents].sort((left, right) =>
    Number(right.pinned) - Number(left.pinned)
    || String(right.lastOpenedAt || "").localeCompare(String(left.lastOpenedAt || ""))
    || left.name.localeCompare(right.name));
}

/** Whether two paths name the same project, spelled however they were spelled. */
export function sameProjectRoot(left: string, right: string): boolean {
  const a = normalizeRoot(left);
  return Boolean(a) && a === normalizeRoot(right);
}

function normalizeRoot(root: string): string {
  return String(root || "").replace(/[\\/]+$/, "").toLocaleLowerCase();
}

/**
 * How far a project has been prepared.
 *
 * The switcher shows every project the moment it opens and says beside each
 * one how ready it is. None of these ever stops somebody opening a project:
 * a project that failed to prepare is a project that opens the slow way.
 */
export type ProjectReadiness = "not-loaded" | "preloading" | "ready" | "outdated" | "error";

/** What to put beside a project in the list, or "" when there is nothing to say. */
export function readinessLabel(state: ProjectReadiness): string {
  switch (state) {
    case "preloading": return "Wird vorbereitet";
    case "ready": return "Bereit";
    case "outdated": return "Aktualisierung erforderlich";
    case "error": return "Fehler";
    default: return "";
  }
}
