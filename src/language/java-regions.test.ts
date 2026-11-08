import { describe, expect, it } from "vitest";
import { findJavaRegions, isRegionEnd, isRegionStart } from "./java-regions";

describe("java regions", () => {
  it("reads both spellings the editors in circulation use", () => {
    // Files travel between IntelliJ and the Visual Studio lineage, so a source
    // may carry either marker and neither should be the one that works.
    expect(isRegionStart("//region Fields")).toBe(true);
    expect(isRegionStart("  // region Fields")).toBe(true);
    expect(isRegionStart("//#region Fields")).toBe(true);
    expect(isRegionStart("//REGION Fields")).toBe(true);
    expect(isRegionEnd("//endregion")).toBe(true);
    expect(isRegionEnd("  // #endregion Fields")).toBe(true);
    expect(isRegionStart("// regionally scoped helper")).toBe(false);
    expect(isRegionEnd("// end of the region")).toBe(false);
  });

  it("names a region and spans it from marker to marker", () => {
    const regions = findJavaRegions([
      "class Demo {",
      "  //region Felder",
      "  private int count;",
      "  //endregion",
      "}",
    ].join("\n"));
    expect(regions).toEqual([
      { startLine: 2, endLine: 4, name: "Felder", closed: true },
    ]);
  });

  it("closes the nearest open marker so regions can nest", () => {
    const regions = findJavaRegions([
      "//region Aussen",   // 1
      "//region Innen",    // 2
      "int a;",            // 3
      "//endregion",       // 4
      "int b;",            // 5
      "//endregion",       // 6
    ].join("\n"));
    expect(regions).toEqual([
      { startLine: 1, endLine: 6, name: "Aussen", closed: true },
      { startLine: 2, endLine: 4, name: "Innen", closed: true },
    ]);
  });

  it("still folds a region nobody closed, and says so", () => {
    // Dropping it silently leaves the reader wondering why the marker they
    // just typed does nothing at all.
    const regions = findJavaRegions(["//region Offen", "int a;", "int b;"].join("\n"));
    expect(regions).toEqual([
      { startLine: 1, endLine: 3, name: "Offen", closed: false },
    ]);
  });

  it("ignores a stray end marker and an empty region", () => {
    expect(findJavaRegions(["int a;", "//endregion"].join("\n"))).toEqual([]);
    // Nothing between the markers means nothing to fold; an arrow in the
    // gutter that collapses no lines is worse than no arrow.
    expect(findJavaRegions(["//region Leer", "//endregion"].join("\n"))).toEqual([]);
  });

  it("leaves a region unnamed rather than inventing a name", () => {
    const [region] = findJavaRegions(["//region", "int a;", "//endregion"].join("\n"));
    expect(region.name).toBe("");
  });
});
