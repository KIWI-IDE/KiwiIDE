/**
 * One list for everything that can be started.
 *
 * Running something meant knowing first what kind of thing it was: a run
 * configuration lives in a dropdown, a Maven goal in the Maven tool window, a
 * Gradle task in the Gradle one, and a command in the terminal. Four places,
 * four ways in, and the answer to "just run the tests" depends on which of
 * them the project happens to use.
 *
 * This is the one list. Type what you want to run and the entries come from
 * wherever they live; type something none of them matches and it goes to the
 * terminal, because that is what somebody typing an unknown word into a run
 * box means.
 */

export type RunTargetKind = "config" | "build" | "shell";

export interface RunTarget {
  kind: RunTargetKind;
  /** What the entry is called, and what is matched against. */
  label: string;
  /** Where it comes from, shown beside the label. */
  detail: string;
  /** The run configuration's id, the task's name, or the command line. */
  value: string;
  /** Marked as a favourite where it came from. */
  favorite?: boolean;
}

export interface RunAnythingSources {
  configurations?: Array<{ id?: string; name: string; type?: string; favorite?: boolean }>;
  tasks?: Array<{ name: string; description?: string; group?: string }>;
  /** What the build tasks are, for the line under them. */
  buildTool?: string;
}

/**
 * How well an entry answers what was typed.
 *
 * Lower is better, and -1 means it does not answer at all. The order is the
 * one a person expects from a name: the whole thing, then the start of it,
 * then the start of a word inside it, then anywhere.
 */
export function runTargetScore(label: string, query: string): number {
  const name = String(label || "").toLowerCase();
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return 50;
  if (!name) return -1;
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 10 + (name.length - needle.length);
  // A word inside the name: "test" should find "gradle :app:test" and
  // "mvn surefire:test".
  const words = name.split(/[\s:._/-]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(needle))) return 40 + (name.length - needle.length);
  if (name.includes(needle)) return 70 + (name.length - needle.length);
  return -1;
}

/** What a kind is worth when two entries match equally well. */
const KIND_ORDER: Record<RunTargetKind, number> = { config: 0, build: 1, shell: 2 };

/**
 * Everything that can be started, best answer first.
 *
 * The shell entry is last and only appears once something has been typed:
 * offering "run this in the terminal" against an empty box is an invitation
 * to run nothing.
 */
export function collectRunTargets(sources: RunAnythingSources, query: string): RunTarget[] {
  const typed = String(query || "").trim();
  const targets: RunTarget[] = [];

  for (const configuration of sources.configurations || []) {
    if (!configuration?.name) continue;
    targets.push({
      kind: "config",
      label: configuration.name,
      detail: configuration.type ? `Run-Konfiguration · ${configuration.type}` : "Run-Konfiguration",
      value: configuration.id || configuration.name,
      favorite: Boolean(configuration.favorite),
    });
  }

  const tool = sources.buildTool || "Build";
  for (const task of sources.tasks || []) {
    if (!task?.name) continue;
    targets.push({
      kind: "build",
      label: task.name,
      detail: [tool, task.group, task.description].filter(Boolean).join(" · "),
      value: task.name,
    });
  }

  const scored = targets
    .map((target) => ({ target, score: runTargetScore(target.label, typed) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) =>
      left.score - right.score
      // A favourite is one somebody marked; it goes first among equals.
      || Number(Boolean(right.target.favorite)) - Number(Boolean(left.target.favorite))
      || KIND_ORDER[left.target.kind] - KIND_ORDER[right.target.kind]
      || left.target.label.localeCompare(right.target.label))
    .map((entry) => entry.target);

  if (typed) {
    scored.push({
      kind: "shell",
      label: typed,
      detail: "Im Terminal ausführen",
      value: typed,
    });
  }
  return scored;
}

/**
 * Whether what was typed is more a command than a name.
 *
 * Used to put the terminal entry first rather than last. Somebody who typed
 * `git status` or `mvn -q test` did not mean a run configuration, and making
 * them scroll past three near-misses to reach the obvious reading is the kind
 * of small rudeness that adds up.
 */
export function looksLikeCommand(query: string): boolean {
  const text = String(query || "").trim();
  if (!text) return false;
  // A flag, a path, a pipe or a redirect: none of those name a task.
  if (/(^|\s)-{1,2}\w|[|><]|(^|\s)[.~]?[\\/]/.test(text)) return true;
  const [first] = text.split(/\s+/);
  return ["git", "mvn", "gradle", "gradlew", "npm", "java", "javac", "cmd", "powershell", "pwsh"].includes(first.toLowerCase())
    && text.includes(" ");
}

/** The list with the terminal entry where the typed text says it belongs. */
export function orderRunTargets(targets: RunTarget[], query: string): RunTarget[] {
  if (!looksLikeCommand(query)) return targets;
  const shell = targets.filter((target) => target.kind === "shell");
  return [...shell, ...targets.filter((target) => target.kind !== "shell")];
}
