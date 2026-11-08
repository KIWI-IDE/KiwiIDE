/**
 * What a guest may ask the host's machine to do.
 *
 * The permissions have existed for a while — build, debug, terminal, git —
 * and until now none of them did anything. The host could grant "build" to
 * somebody and nothing changed for them: output flowed one way, and starting
 * a build was the host's alone. A permission that grants nothing is worse than
 * no permission, because it reads like a promise.
 *
 * So a guest can ask, and the host decides. The deciding happens on the host
 * and nowhere else — a guest is a program on another machine, and whatever its
 * interface shows, this is the side that owns the disk and the processes.
 */

/** The things a guest can ask for, each behind its own permission. */
export const SHARED_ACTIONS = ["build", "test", "run", "debug"] as const;

export type SharedAction = (typeof SHARED_ACTIONS)[number];

/**
 * The permission an action needs.
 *
 * Running and testing are builds in every way that matters here: they compile
 * the host's code and start a process on the host's machine. Debugging is
 * separate because it also stops that process wherever it likes.
 */
export function permissionForAction(action: string): "build" | "debug" | "" {
  const candidate = String(action || "").trim().toLowerCase();
  if (candidate === "debug") return "debug";
  if (candidate === "build" || candidate === "test" || candidate === "run") return "build";
  return "";
}

/** Whether a value names something a guest may ask for at all. */
export function isSharedAction(action: unknown): action is SharedAction {
  return SHARED_ACTIONS.includes(String(action || "").trim().toLowerCase() as SharedAction);
}

/**
 * What the host is told when a guest starts something.
 *
 * Named, and in German: a build starting by itself on your own machine is
 * alarming, and the one thing that makes it not alarming is knowing who.
 */
export function describeSharedRequest(name: string, action: string): string {
  const who = String(name || "").trim() || "Ein Gast";
  const what = {
    build: "baut das Projekt",
    test: "führt die Tests aus",
    run: "führt die Anwendung aus",
    debug: "startet den Debugger",
  }[String(action || "").trim().toLowerCase()] || "startet etwas";
  return `${who} ${what}.`;
}

/** Why an action was refused, in the words the guest needs. */
export function refusalFor(action: string): string {
  const permission = permissionForAction(action);
  if (!permission) return "Das kann in einer Sitzung nicht gestartet werden.";
  return permission === "debug"
    ? "Du darfst in dieser Sitzung nicht debuggen."
    : "Du darfst in dieser Sitzung nichts bauen oder ausführen.";
}
