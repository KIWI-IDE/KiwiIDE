import { describe, expect, it } from "vitest";
import {
  applyTestProgress,
  describeTestProgress,
  NO_TEST_PROGRESS,
  NO_TEST_RUN,
  readTestProgress,
} from "../src/test-progress";

const read = (chunks: string[]) => {
  let state = NO_TEST_PROGRESS;
  let progress = NO_TEST_RUN;
  for (const chunk of chunks) {
    const result = readTestProgress(state, chunk);
    state = result.state;
    progress = applyTestProgress(progress, result.events);
  }
  return progress;
};

const MAVEN = [
  "[INFO] Running de.beispiel.SpielerTest\n",
  "[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.05 s - in de.beispiel.SpielerTest\n",
  "[INFO] Running de.beispiel.WeltTest\n",
  "[ERROR] istVoll  Time elapsed: 0.01 s  <<< FAILURE!\n",
  "[ERROR] Tests run: 4, Failures: 1, Errors: 0, Skipped: 1, Time elapsed: 0.2 s - in de.beispiel.WeltTest\n",
];

/**
 * Results came from the XML the build writes when it is finished, so a suite
 * that takes four minutes showed nothing for four minutes and then everything
 * at once. Both tools say it on their output; nobody was reading it.
 */
describe("reading Maven's test output", () => {
  it("counts what each class reported", () => {
    const progress = read(MAVEN);
    // 3 passed in the first class; 4 run in the second with one failure and
    // one skipped leaves two passed.
    expect(progress).toMatchObject({ passed: 5, failed: 1, skipped: 1 });
  });

  it("names the class that is running now", () => {
    const progress = read(MAVEN.slice(0, 3));
    expect(progress.current).toBe("de.beispiel.WeltTest");
  });

  it("clears the current class when it finishes", () => {
    expect(read(MAVEN).current).toBe("");
  });

  it("keeps the classes that finished, in order", () => {
    expect(read(MAVEN).finished).toEqual(["de.beispiel.SpielerTest", "de.beispiel.WeltTest"]);
  });

  it("names the test that failed", () => {
    expect(read(MAVEN).failures).toEqual(["istVoll"]);
  });
});

describe("reading Gradle's test output", () => {
  const GRADLE = [
    "de.beispiel.SpielerTest > istLeer PASSED\n",
    "de.beispiel.SpielerTest > istVoll FAILED\n",
    "de.beispiel.WeltTest > laedt SKIPPED\n",
  ];

  it("counts each test as it is named", () => {
    expect(read(GRADLE)).toMatchObject({ passed: 1, failed: 1, skipped: 1 });
  });

  it("names a failure with its class", () => {
    expect(read(GRADLE).failures).toEqual(["SpielerTest.istVoll"]);
  });

  it("reads a test name that has spaces in it", () => {
    // JUnit 5 display names are sentences more often than not.
    const spoken = ["de.beispiel.SpielerTest > eine leere Welt hat keine Spieler PASSED\n"];
    expect(read(spoken).passed).toBe(1);
  });
});

/**
 * A chunk may stop in the middle of a line — that is what a stream is.
 */
describe("output that arrives in pieces", () => {
  it("joins a line that was split across two chunks", () => {
    const split = read(["[INFO] Running de.beispiel.Spie", "lerTest\n"]);
    expect(split.current).toBe("de.beispiel.SpielerTest");
  });

  it("waits for the newline before believing a line", () => {
    // Reading each chunk on its own split every second line in half and lost
    // both halves.
    const { events } = readTestProgress(NO_TEST_PROGRESS, "[INFO] Running de.beispiel.SpielerTest");
    expect(events).toEqual([]);
  });

  it("survives a line arriving one character at a time", () => {
    const line = "[INFO] Running de.beispiel.SpielerTest\n";
    expect(read([...line]).current).toBe("de.beispiel.SpielerTest");
  });

  it("is not confused by colour codes", () => {
    const coloured = ["[1m[INFO][0m Running de.beispiel.SpielerTest\n"];
    expect(read(coloured).current).toBe("de.beispiel.SpielerTest");
  });

  it("says nothing about output that says nothing", () => {
    // A progress display that invents progress is worse than none.
    const noise = read([
      "[INFO] --- maven-surefire-plugin:3.2.5:test (default-test) @ serverplugin ---\n",
      "Download from central: https://repo.maven.apache.org/maven2/x.jar\n",
      "\n",
    ]);
    expect(noise).toEqual(NO_TEST_RUN);
  });
});

describe("the line shown while it runs", () => {
  it("says what is running and how it is going", () => {
    expect(describeTestProgress(read(MAVEN.slice(0, 3))))
      .toBe("WeltTest … 3 bestanden");
  });

  it("names failures and skips only when there are some", () => {
    expect(describeTestProgress(read(MAVEN))).toBe("5 bestanden · 1 fehlgeschlagen · 1 übersprungen");
    expect(describeTestProgress(read(MAVEN.slice(0, 2)))).toBe("3 bestanden");
  });

  it("says nothing before anything has happened", () => {
    expect(describeTestProgress(NO_TEST_RUN)).toBe("");
  });
});
