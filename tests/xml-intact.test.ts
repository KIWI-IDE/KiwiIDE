import { describe, expect, it } from "vitest";

const { xmlLooksIntact } = require("../electron/services/source-text.cjs");

const pom = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
${inner}
</project>
`;

describe("whether a pom is intact enough to read", () => {
  it("accepts one that closes everything it opens", () => {
    expect(xmlLooksIntact(pom("  <artifactId>demo</artifactId>"))).toBe(true);
  });

  it("refuses one that was cut off mid-file", () => {
    // Kiwi read one of these, found the goals it always offers and reported
    // the project ready to build. Maven then refused the pom outright.
    expect(xmlLooksIntact("<project><artifactId>offen\n")).toBe(false);
    expect(xmlLooksIntact("<project><modelVersion>4.0.0</modelVersion>")).toBe(false);
  });

  it("refuses one whose tags close in the wrong order", () => {
    expect(xmlLooksIntact("<project><groupId>a</project></groupId>")).toBe(false);
  });

  it("refuses a tag that never ends", () => {
    expect(xmlLooksIntact("<project><artifactId")).toBe(false);
  });

  it("is not confused by the declaration or a doctype", () => {
    expect(xmlLooksIntact('<?xml version="1.0"?><project></project>')).toBe(true);
    expect(xmlLooksIntact("<!DOCTYPE project><project></project>")).toBe(true);
  });

  it("counts a self-closing element as complete", () => {
    expect(xmlLooksIntact("<project><modules/></project>")).toBe(true);
    expect(xmlLooksIntact('<project><module name="a" /></project>')).toBe(true);
  });

  it("leaves comments and CDATA out of it", () => {
    expect(xmlLooksIntact("<project><!-- <nie> --></project>")).toBe(true);
    expect(xmlLooksIntact("<project><a><![CDATA[<b>]]></a></project>")).toBe(true);
  });

  it("says no to nothing at all", () => {
    expect(xmlLooksIntact("")).toBe(false);
    expect(xmlLooksIntact("   ")).toBe(false);
    expect(xmlLooksIntact(null)).toBe(false);
  });
});
