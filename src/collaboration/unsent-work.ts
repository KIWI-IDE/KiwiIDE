/**
 * What a guest had typed when the connection went.
 *
 * A dropped connection threw the buffer away: the file closed, the tree
 * emptied, and whatever had been typed but not yet saved to the host was gone
 * with no way back. On a flaky network that is the difference between a
 * session and a session worth joining.
 *
 * Keeping it is the easy half. The hard half is what to do on return, and the
 * answer is: never decide silently. Re-applying a stale buffer over a file the
 * host has since changed loses somebody else's work instead of your own, which
 * is worse than the problem. So the kept text is offered, with what happened
 * to the file said plainly, and a person decides.
 */

export interface UnsentWork {
  /** Project-relative, the way the session speaks about files. */
  path: string;
  /** What the guest had, unsent. */
  text: string;
  /** The host revision it was built on, so a later one is recognisable. */
  version: number;
  /** When the connection went, for saying how old this is. */
  at: number;
}

/**
 * Whether a buffer is worth keeping through a disconnect.
 *
 * A buffer identical to the host's is not unsent work — offering it back would
 * be a question about nothing. Neither is an empty path.
 */
export function worthKeeping(path: string, text: string, hostText: string): boolean {
  if (!String(path || "").trim()) return false;
  return String(text ?? "") !== String(hostText ?? "");
}

export type ReturnVerdict = "arrived" | "restorable" | "conflict";

/**
 * What became of the kept work while the guest was away.
 *
 * - `arrived`: the host already has this text. The edit got through before the
 *   connection went, and there is nothing to ask about.
 * - `restorable`: the file is where it was left, so putting the kept text back
 *   takes nothing away from anybody.
 * - `conflict`: somebody else has changed the file since. The kept text is
 *   still offered, but as a choice rather than as a repair.
 */
export function verdictOnReturn(kept: UnsentWork | null, current: {
  text: string;
  version: number;
}): ReturnVerdict | "" {
  if (!kept?.path) return "";
  if (String(current?.text ?? "") === kept.text) return "arrived";
  // A version that has not moved means nothing happened to the file while the
  // guest was gone — whatever else changed, this did not.
  return Number(current?.version) === Number(kept.version) ? "restorable" : "conflict";
}

/** What the guest is told about kept work, in German like the rest of it. */
export function describeUnsentWork(kept: UnsentWork | null, verdict: ReturnVerdict | ""): string {
  if (!kept || !verdict || verdict === "arrived") return "";
  const name = kept.path.split("/").at(-1) || kept.path;
  return verdict === "restorable"
    ? `Ungesendete Änderungen an ${name} von vorhin. Die Datei ist unverändert.`
    : `Ungesendete Änderungen an ${name} von vorhin. Die Datei wurde inzwischen von jemand anderem geändert.`;
}

/**
 * Forgets kept work once it can no longer be about the open file.
 *
 * Opening a different file does not discard it — somebody may well go back —
 * but restoring it, or the host confirming the same text, does.
 */
export function stillPending(kept: UnsentWork | null, hostText: string, forPath: string): boolean {
  if (!kept?.path) return false;
  if (forPath && kept.path !== forPath) return true;
  return kept.text !== String(hostText ?? "");
}
