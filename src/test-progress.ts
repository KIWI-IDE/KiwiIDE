/**
 * What the tests are doing, while they are doing it.
 *
 * Results came from the XML the build writes when it is finished, so a suite
 * that takes four minutes showed nothing for four minutes and then everything
 * at once. The one thing somebody watching a test run wants to know — is it
 * still going, and has anything failed yet — was the one thing not on screen.
 *
 * Both build tools already say it on their output; nobody was reading it.
 * Maven's surefire announces each class as it starts and sums it up as it
 * ends; Gradle names each test as it finishes. This reads whichever arrives
 * and says nothing where the tool says nothing — a progress display that
 * invents progress is worse than none.
 */

export type TestOutcome = "passed" | "failed" | "skipped";

export interface TestProgressEvent {
  kind: "suite-start" | "suite-end" | "test";
  /** The fully qualified class. */
  suite: string;
  /** The method, where the tool named one. */
  test?: string;
  outcome?: TestOutcome;
  counts?: { run: number; failures: number; errors: number; skipped: number };
}

export interface TestProgressState {
  /** The tail of the last chunk, which may have stopped mid-line. */
  partial: string;
}

export const NO_TEST_PROGRESS: TestProgressState = { partial: "" };

/** Output arrives coloured; none of these patterns want to know about that. */
function withoutAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-?]*[ -/]*[@-~]/g, "");
}

const MAVEN_RUNNING = /^\[[A-Z]+\]\s+Running\s+([\w$.]+)\s*$/;
const MAVEN_SUMMARY = /^\[[A-Z]+\]\s+Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)(?:,[^-]*)?-\s*in\s+([\w$.]+)\s*$/;
const MAVEN_FAILURE = /^\[[A-Z]+\]\s+([\w$]+)(?:\([\w$.]+\))?\s+.*<<<\s*(FAILURE|ERROR)!/;
const GRADLE_TEST = /^([\w$.]+)\s+>\s+(.+?)\s+(PASSED|FAILED|SKIPPED)\s*$/;

/**
 * Reads whatever has arrived since last time.
 *
 * The chunk may stop in the middle of a line — that is what a stream is — so
 * the tail is kept and prepended next time. Reading each chunk on its own
 * split every second line in half and lost both halves.
 */
export function readTestProgress(
  state: TestProgressState,
  chunk: string,
): { state: TestProgressState; events: TestProgressEvent[] } {
  const text = `${state?.partial || ""}${withoutAnsi(String(chunk || ""))}`;
  const lines = text.split(/\r?\n/);
  // The last piece has no newline after it yet, so it is not a line.
  const partial = lines.pop() ?? "";
  const events: TestProgressEvent[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const running = line.match(MAVEN_RUNNING);
    if (running) {
      events.push({ kind: "suite-start", suite: running[1] });
      continue;
    }
    const summary = line.match(MAVEN_SUMMARY);
    if (summary) {
      events.push({
        kind: "suite-end",
        suite: summary[5],
        counts: {
          run: Number(summary[1]),
          failures: Number(summary[2]),
          errors: Number(summary[3]),
          skipped: Number(summary[4]),
        },
      });
      continue;
    }
    const failure = line.match(MAVEN_FAILURE);
    if (failure) {
      events.push({ kind: "test", suite: "", test: failure[1], outcome: "failed" });
      continue;
    }
    const gradle = line.match(GRADLE_TEST);
    if (gradle) {
      events.push({
        kind: "test",
        suite: gradle[1],
        test: gradle[2].trim(),
        outcome: gradle[3] === "PASSED" ? "passed" : gradle[3] === "FAILED" ? "failed" : "skipped",
      });
    }
  }
  return { state: { partial }, events };
}

export interface TestRunProgress {
  /** The class currently being run, where one has been announced. */
  current: string;
  /** How many tests have finished, and how they went. */
  passed: number;
  failed: number;
  skipped: number;
  /** The classes that have finished, in the order they finished. */
  finished: string[];
  /** The names that failed, for the line under the counter. */
  failures: string[];
}

export const NO_TEST_RUN: TestRunProgress = {
  current: "",
  passed: 0,
  failed: 0,
  skipped: 0,
  finished: [],
  failures: [],
};

/**
 * Folds the events into what a person watching wants to see.
 *
 * Counts come from Maven's per-class summary where there is one and from
 * Gradle's per-test lines where there is not, and the two are never added
 * together: one run is reported by one tool.
 */
export function applyTestProgress(
  progress: TestRunProgress,
  events: TestProgressEvent[],
): TestRunProgress {
  let next = { ...progress, finished: [...progress.finished], failures: [...progress.failures] };
  for (const event of events) {
    if (event.kind === "suite-start") {
      next.current = event.suite;
      continue;
    }
    if (event.kind === "suite-end" && event.counts) {
      const { run, failures, errors, skipped } = event.counts;
      const bad = failures + errors;
      next.failed += bad;
      next.skipped += skipped;
      next.passed += Math.max(0, run - bad - skipped);
      if (!next.finished.includes(event.suite)) next.finished.push(event.suite);
      if (next.current === event.suite) next.current = "";
      continue;
    }
    if (event.kind === "test" && event.outcome) {
      // A Maven failure line names the method but not the class; the class it
      // belongs to is already counted by that class's summary, so only the
      // name is kept.
      if (!event.suite) {
        if (event.test && !next.failures.includes(event.test)) next.failures.push(event.test);
        continue;
      }
      if (event.outcome === "passed") next.passed += 1;
      if (event.outcome === "skipped") next.skipped += 1;
      if (event.outcome === "failed") {
        next.failed += 1;
        const name = event.test ? `${simpleName(event.suite)}.${event.test}` : simpleName(event.suite);
        if (!next.failures.includes(name)) next.failures.push(name);
      }
      next.current = event.suite;
    }
  }
  return next;
}

function simpleName(qualified: string): string {
  return String(qualified || "").split(".").at(-1) || qualified;
}

/** The one line shown while a run is going. */
export function describeTestProgress(progress: TestRunProgress): string {
  const done = progress.passed + progress.failed + progress.skipped;
  if (!done && !progress.current) return "";
  const counts = [
    `${progress.passed} bestanden`,
    progress.failed ? `${progress.failed} fehlgeschlagen` : "",
    progress.skipped ? `${progress.skipped} übersprungen` : "",
  ].filter(Boolean).join(" · ");
  return progress.current ? `${simpleName(progress.current)} … ${counts}` : counts;
}
