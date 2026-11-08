import { describe, expect, it } from "vitest";
import { dependencyQueryIntent } from "../src/components/DependencyDialog";

/**
 * What the dialog does with what was typed into it.
 *
 * The reported symptom was that the search "does not work as it should": for
 * "groupId:artifactId" — the shape a Java developer reaches for first — the
 * dialog searched for nothing, showed no results, and asked for a version
 * while offering no way to find one.
 */
describe("what the dependency search does with a query", () => {
  it("searches for a coordinate that has no version yet", () => {
    const intent = dependencyQueryIntent("com.google.guava:guava");
    expect(intent.coordinate).toBeNull();
    expect(intent.search).toBe("com.google.guava:guava");
  });

  it("stops asking once a version is there", () => {
    const intent = dependencyQueryIntent("com.google.guava:guava:33.0.0-jre");
    expect(intent.coordinate).toEqual({
      groupId: "com.google.guava",
      artifactId: "guava",
      version: "33.0.0-jre",
    });
    // Nothing left to look up, so no request goes out.
    expect(intent.search).toBe("");
  });

  it("searches for an ordinary name", () => {
    expect(dependencyQueryIntent("guava")).toEqual({ coordinate: null, search: "guava" });
    expect(dependencyQueryIntent("  jackson databind  "))
      .toEqual({ coordinate: null, search: "jackson databind" });
  });

  it("waits for a second character", () => {
    for (const text of ["", " ", "g", "  x "]) {
      expect(dependencyQueryIntent(text).search).toBe("");
    }
    expect(dependencyQueryIntent("gu").search).toBe("gu");
  });

  it("does not mistake a version range or a path for a coordinate", () => {
    for (const text of ["com.example:", ":guava", "a:b:c:d", "C:/Users/dev"]) {
      expect(dependencyQueryIntent(text).coordinate).toBeNull();
    }
  });
});
