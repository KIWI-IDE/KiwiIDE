/**
 * Which tests a change can possibly have broken.
 *
 * Running the whole suite after touching one class is the reason people stop
 * running tests before pushing: four minutes for a change that could only have
 * affected two of them. But picking the wrong subset is far worse than running
 * everything — a green run that never touched the broken test is a lie, and
 * one that is believed.
 *
 * So the rule here is deliberately generous. A test is affected if it names
 * the changed class anywhere in its source, or if the test itself changed, or
 * if anything that is not a Java file changed at all — a pom, a resource, a
 * build script can move any test, and this cannot tell which.
 *
 * The result is a suggestion. It is offered, never substituted: whoever asked
 * for "all tests" gets all tests.
 */

export interface TestSuiteLike {
  id: string;
  /** The test class's own name. */
  name: string;
  /** Where it lives, to notice when the test itself is what changed. */
  path?: string;
  /** Its source, to see which classes it names. */
  source?: string;
  /**
   * The types it names, where whoever discovered it already worked them out.
   *
   * Cheaper than the source and the same question: reading every test file
   * again in the workbench to answer it would be reading them twice.
   */
  references?: string[];
}

export interface AffectedTestsResult {
  /** The suite ids worth running. */
  suites: string[];
  /**
   * Why it is not narrowing anything, when it is not.
   *
   * Empty when the selection is a real narrowing; a reason otherwise, so the
   * offer to run everything explains itself.
   */
  reason: string;
}

/** The class a Java file declares, by its file name. */
export function classNameOf(filePath: string): string {
  const file = String(filePath || "").replace(/\\/g, "/").split("/").at(-1) || "";
  return file.toLowerCase().endsWith(".java") ? file.slice(0, -".java".length) : "";
}

/** Whether a path is a test source rather than a main one. */
export function isTestPath(filePath: string): boolean {
  return /[\\/]src[\\/]test[\\/]/i.test(String(filePath || ""));
}

/**
 * Whether a source names a type.
 *
 * Matched on a word boundary so `Welt` does not match `Weltkarte`, and only
 * outside strings and comments would be better still — but a false positive
 * here costs one test too many, which is the direction to err in.
 */
export function mentionsType(source: string, typeName: string): boolean {
  if (!source || !typeName) return false;
  return new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(source);
}

export function affectedTests(
  changedFiles: string[],
  suites: TestSuiteLike[],
): AffectedTestsResult {
  const changed = (changedFiles || []).filter(Boolean);
  const all = (suites || []).map((suite) => suite.id);
  if (!changed.length) return { suites: [], reason: "Es ist nichts geändert." };

  // Anything that is not Java can move any test, and this cannot tell which.
  const nonJava = changed.filter((file) => !file.toLowerCase().endsWith(".java"));
  if (nonJava.length) {
    return { suites: all, reason: `${nonJava.length === 1 ? "Eine Datei" : `${nonJava.length} Dateien`} außerhalb des Java-Codes hat sich geändert.` };
  }

  const changedTypes = changed.map((file) => classNameOf(file)).filter(Boolean);
  const chosen = new Set<string>();
  for (const suite of suites || []) {
    // The test itself changed: it runs, whatever it names.
    if (suite.path && changed.some((file) => samePath(file, suite.path as string))) {
      chosen.add(suite.id);
      continue;
    }
    const names = suite.references;
    const mentions = (type: string) =>
      (names ? names.includes(type) : mentionsType(suite.source || "", type));
    if (changedTypes.some((type) => type === suite.name || mentions(type))) {
      chosen.add(suite.id);
    }
  }

  if (!chosen.size) {
    // Nothing found is not the same as nothing to run: a change nothing
    // mentions may still break something through a supertype or reflection.
    return { suites: all, reason: "Kein Test nennt die geänderten Klassen." };
  }
  return { suites: [...chosen], reason: "" };
}

function samePath(left: string, right: string): boolean {
  const normalise = (value: string) => String(value || "").replace(/\\/g, "/").toLowerCase();
  return normalise(left) === normalise(right);
}

/** What the offer says. */
export function describeAffected(result: AffectedTestsResult, total: number): string {
  if (result.reason) return `${result.reason} Es laufen alle ${total} Tests.`;
  return `${result.suites.length} von ${total} Testklassen betroffen.`;
}
