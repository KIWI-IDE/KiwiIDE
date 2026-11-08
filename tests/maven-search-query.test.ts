import { describe, expect, it } from "vitest";

const { mavenSearchQuery } = require("../electron/services/dependency-service.cjs");

/**
 * Solr reads `q` as query syntax, so the text somebody types cannot go into it
 * untouched. A colon is the field separator there — which is why the most
 * natural thing a Java developer can type came back empty.
 */
describe("Maven Central search query", () => {
  it("asks by field for a coordinate", () => {
    // Typed on the way to finding a version, and previously the one input the
    // dialog refused to search for at all.
    expect(mavenSearchQuery("com.google.guava:guava"))
      .toBe('g:"com.google.guava" AND a:"guava"');
    expect(mavenSearchQuery("junit:junit:4.13.2"))
      .toBe('g:"junit" AND a:"junit" AND v:"4.13.2"');
  });

  it("treats a dotted name as a group id", () => {
    expect(mavenSearchQuery("org.springframework.boot")).toBe('g:"org.springframework.boot"');
    // Two segments is as likely to be a product name as a group id, so it stays
    // a plain search rather than a field nothing will match.
    expect(mavenSearchQuery("spring.boot")).toBe('"spring.boot"');
  });

  it("quotes free text so punctuation cannot be syntax", () => {
    expect(mavenSearchQuery("guava")).toBe('"guava"');
    expect(mavenSearchQuery("jackson databind")).toBe('"jackson" AND "databind"');
    // Each of these answered 400 or matched nothing when passed through raw.
    for (const text of ["c++ parser", "log4j (core)", "foo && bar", "a^2", "why?"]) {
      const query = mavenSearchQuery(text);
      expect(query.startsWith('"')).toBe(true);
      expect(query.endsWith('"')).toBe(true);
    }
  });

  it("escapes what would end a quoted term early", () => {
    const backslash = String.fromCharCode(92);
    expect(mavenSearchQuery('a"b')).toBe(`"a${backslash}"b"`);
    expect(mavenSearchQuery(`a${backslash}b`)).toBe(`"a${backslash}${backslash}b"`);
  });

  it("has nothing to ask for when nothing was typed", () => {
    for (const text of ["", "   ", null, undefined]) {
      expect(mavenSearchQuery(text as never)).toBe("");
    }
  });
});
