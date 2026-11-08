/**
 * One configuration that starts several.
 *
 * A server and its client. A build, then the thing it built. A suite split
 * across three modules. Each of those was two or three trips to the run
 * dropdown, in an order that had to be remembered, and the second one started
 * only once somebody noticed the first had finished.
 *
 * The whole risk here is a compound that contains itself. Directly is obvious
 * and nobody writes it; through two others is not, and it is an editor that
 * hangs on a click with no way back. So nothing is ever run before the chain
 * has been walked to its end.
 */

export interface CompoundMember {
  /** The id of the configuration to start. */
  id: string;
}

export interface CompoundConfiguration {
  id?: string;
  name: string;
  type: string;
  /** The configurations this one starts, in order. */
  members?: CompoundMember[];
  /** Whether they run one after another or all at once. */
  compoundMode?: "sequential" | "parallel";
}

export interface ResolvedCompound {
  /** What to start, in the order it should be started. */
  steps: CompoundConfiguration[];
  /** Whether the steps wait for one another. */
  mode: "sequential" | "parallel";
  /** What could not be resolved, in German, naming what was wrong. */
  problems: string[];
}

/** Whether a configuration is one that starts others. */
export function isCompound(configuration: { type?: string } | null | undefined): boolean {
  return configuration?.type === "compound";
}

/**
 * The configurations a compound would start, flattened.
 *
 * A compound may hold another compound, and that one is expanded rather than
 * started as a unit — what matters at the end is the list of things that
 * actually run.
 *
 * A cycle is reported and cut, never followed. A member that no longer exists
 * is reported too: a compound quietly starting four of its five parts is worse
 * than one that says the fifth is gone.
 */
export function resolveCompound(
  configurations: CompoundConfiguration[],
  rootId: string,
): ResolvedCompound {
  const byId = new Map<string, CompoundConfiguration>();
  for (const configuration of configurations || []) {
    if (configuration?.id) byId.set(configuration.id, configuration);
  }
  const root = byId.get(String(rootId || ""));
  if (!root) return { steps: [], mode: "sequential", problems: ["Diese Run-Konfiguration gibt es nicht mehr."] };
  if (!isCompound(root)) return { steps: [root], mode: "sequential", problems: [] };

  const steps: CompoundConfiguration[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  const walk = (configuration: CompoundConfiguration, path: string[]) => {
    const id = String(configuration.id || "");
    if (path.includes(id)) {
      // Named with the whole chain, because "es hängt" says nothing about
      // which of five configurations to open.
      problems.push(`"${configuration.name}" enthält sich selbst: ${[...path, configuration.name].join(" → ")}`);
      return;
    }
    for (const member of configuration.members || []) {
      const target = byId.get(String(member?.id || ""));
      if (!target) {
        problems.push(`Eine Konfiguration in "${configuration.name}" gibt es nicht mehr.`);
        continue;
      }
      if (isCompound(target)) {
        walk(target, [...path, id]);
        continue;
      }
      // The same configuration named twice runs once: a compound is a set of
      // things to start, and starting one of them twice is never the intent.
      if (seen.has(String(target.id))) continue;
      seen.add(String(target.id));
      steps.push(target);
    }
  };

  walk(root, []);
  if (!steps.length && !problems.length) {
    problems.push(`"${root.name}" startet nichts.`);
  }
  return { steps, mode: root.compoundMode === "parallel" ? "parallel" : "sequential", problems };
}

/**
 * Whether adding this member would make a compound contain itself.
 *
 * Asked before the member is added rather than before it is run, so the
 * configuration cannot be saved in a broken state at all.
 */
export function wouldCycle(
  configurations: CompoundConfiguration[],
  compoundId: string,
  memberId: string,
): boolean {
  if (!compoundId || !memberId) return false;
  if (compoundId === memberId) return true;
  const byId = new Map<string, CompoundConfiguration>();
  for (const configuration of configurations || []) {
    if (configuration?.id) byId.set(configuration.id, configuration);
  }
  const reaches = (fromId: string, path: Set<string>): boolean => {
    if (fromId === compoundId) return true;
    if (path.has(fromId)) return false;
    path.add(fromId);
    const configuration = byId.get(fromId);
    if (!isCompound(configuration)) return false;
    return (configuration?.members || []).some((member) => reaches(String(member?.id || ""), path));
  };
  return reaches(memberId, new Set());
}

/** The configurations a compound may name: anything but itself and a cycle. */
export function eligibleMembers(
  configurations: CompoundConfiguration[],
  compoundId: string,
): CompoundConfiguration[] {
  return (configurations || []).filter((configuration) =>
    configuration?.id
    && configuration.id !== compoundId
    && !wouldCycle(configurations, compoundId, configuration.id));
}

/** What a compound will do, in one line. */
export function describeCompound(resolved: ResolvedCompound): string {
  if (!resolved.steps.length) return resolved.problems[0] || "Startet nichts.";
  const order = resolved.mode === "parallel" ? "gleichzeitig" : "nacheinander";
  const names = resolved.steps.map((step) => step.name).join(", ");
  return `${resolved.steps.length} ${resolved.steps.length === 1 ? "Konfiguration" : "Konfigurationen"} ${order}: ${names}`;
}
