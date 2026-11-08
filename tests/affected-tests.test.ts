import { describe, expect, it } from "vitest";
import {
  affectedTests,
  classNameOf,
  describeAffected,
  isTestPath,
  mentionsType,
} from "../src/affected-tests";

const suites = [
  {
    id: "WeltTest",
    name: "WeltTest",
    path: "C:/projekt/src/test/java/de/beispiel/WeltTest.java",
    source: "class WeltTest { @Test void voll() { new Welt().istVoll(); } }",
  },
  {
    id: "SpielerTest",
    name: "SpielerTest",
    path: "C:/projekt/src/test/java/de/beispiel/SpielerTest.java",
    source: "class SpielerTest { @Test void punkte() { new Spieler(\"a\", 1); } }",
  },
  {
    id: "WeltkarteTest",
    name: "WeltkarteTest",
    path: "C:/projekt/src/test/java/de/beispiel/WeltkarteTest.java",
    source: "class WeltkarteTest { @Test void zeichnet() { new Weltkarte(); } }",
  },
];

/**
 * Running the whole suite after touching one class is why people stop running
 * tests before pushing. But picking the wrong subset is far worse: a green run
 * that never touched the broken test is a lie, and one that is believed.
 */
describe("which tests a change can have broken", () => {
  it("picks the tests that name the changed class", () => {
    const result = affectedTests(["C:/projekt/src/main/java/de/beispiel/Welt.java"], suites);
    expect(result.suites).toEqual(["WeltTest"]);
    expect(result.reason).toBe("");
  });

  it("does not mistake a longer name for the one that changed", () => {
    // Welt must not drag in Weltkarte, and Weltkarte must not drag in Welt.
    const result = affectedTests(["C:/projekt/src/main/java/de/beispiel/Weltkarte.java"], suites);
    expect(result.suites).toEqual(["WeltkarteTest"]);
  });

  it("runs a test whose own source changed, whatever it names", () => {
    const result = affectedTests(["C:/projekt/src/test/java/de/beispiel/SpielerTest.java"], suites);
    expect(result.suites).toEqual(["SpielerTest"]);
  });

  it("takes several changed classes together", () => {
    const result = affectedTests([
      "C:/projekt/src/main/java/de/beispiel/Welt.java",
      "C:/projekt/src/main/java/de/beispiel/Spieler.java",
    ], suites);
    expect(result.suites.sort()).toEqual(["SpielerTest", "WeltTest"]);
  });

  it("matches a path however the two sides spell it", () => {
    const result = affectedTests(["c:\\projekt\\src\\test\\java\\de\\beispiel\\SpielerTest.java"], suites);
    expect(result.suites).toEqual(["SpielerTest"]);
  });
});

/**
 * The direction to err in.
 *
 * A false positive costs one test too many. A false negative costs a green run
 * that proves nothing.
 */
describe("when it refuses to narrow anything", () => {
  it("runs everything when a file outside the Java code changed", () => {
    // A pom, a resource or a build script can move any test.
    const result = affectedTests(["C:/projekt/pom.xml"], suites);
    expect(result.suites).toHaveLength(suites.length);
    expect(result.reason).toContain("außerhalb des Java-Codes");
  });

  it("runs everything when no test names the change", () => {
    // A change nothing mentions may still break something through a supertype
    // or through reflection.
    const result = affectedTests(["C:/projekt/src/main/java/de/beispiel/Unbekannt.java"], suites);
    expect(result.suites).toHaveLength(suites.length);
    expect(result.reason).toContain("Kein Test nennt");
  });

  it("runs nothing when nothing changed", () => {
    expect(affectedTests([], suites)).toEqual({ suites: [], reason: "Es ist nichts geändert." });
  });

  it("survives a project with no tests", () => {
    expect(affectedTests(["A.java"], []).suites).toEqual([]);
  });
});

describe("reading the pieces", () => {
  it("takes the class name from the file name", () => {
    expect(classNameOf("C:/a/b/Welt.java")).toBe("Welt");
    expect(classNameOf("C:\\a\\b\\Welt.java")).toBe("Welt");
    expect(classNameOf("C:/a/b/pom.xml")).toBe("");
  });

  it("tells a test source from a main one", () => {
    expect(isTestPath("C:/p/src/test/java/A.java")).toBe(true);
    expect(isTestPath("C:/p/src/main/java/A.java")).toBe(false);
  });

  it("matches a type on a word boundary", () => {
    expect(mentionsType("new Welt()", "Welt")).toBe(true);
    expect(mentionsType("new Weltkarte()", "Welt")).toBe(false);
    expect(mentionsType("", "Welt")).toBe(false);
    expect(mentionsType("new Welt()", "")).toBe(false);
  });
});

describe("what the offer says", () => {
  it("counts the affected classes", () => {
    expect(describeAffected({ suites: ["A", "B"], reason: "" }, 9)).toBe("2 von 9 Testklassen betroffen.");
  });

  it("explains itself when it is not narrowing", () => {
    expect(describeAffected({ suites: [], reason: "Kein Test nennt die geänderten Klassen." }, 9))
      .toBe("Kein Test nennt die geänderten Klassen. Es laufen alle 9 Tests.");
  });
});

/**
 * The names the discovery already worked out.
 *
 * Reading every test file again in the workbench to answer the same question
 * would be reading them twice.
 */
describe("using the references discovery already collected", () => {
  const withReferences = [
    { id: "WeltTest", name: "WeltTest", path: "C:/p/src/test/java/WeltTest.java", references: ["Welt", "Spieler"] },
    { id: "LeerTest", name: "LeerTest", path: "C:/p/src/test/java/LeerTest.java", references: [] },
  ];

  it("prefers them over the source", () => {
    expect(affectedTests(["C:/p/src/main/java/Welt.java"], withReferences).suites).toEqual(["WeltTest"]);
  });

  it("takes an empty list as naming nothing rather than as unknown", () => {
    const result = affectedTests(["C:/p/src/main/java/Karte.java"], withReferences);
    // Nothing names Karte, so it falls back to everything and says why.
    expect(result.reason).toContain("Kein Test nennt");
  });
});
