import { describe, expect, it } from "vitest";
import {
  checkContrast,
  contrastRatio,
  contrastVerdict,
  formatRatio,
  parseHexColor,
  readableAgainst,
  relativeLuminance,
} from "../src/theme-contrast";

/**
 * The swatch shows a colour alone; what matters is the pair. Dark grey
 * comments on a dark background look fine in the picker and vanish in the code.
 */
describe("measuring contrast", () => {
  it("puts black on white at the top of the scale", () => {
    expect(Math.round(contrastRatio("000000", "FFFFFF"))).toBe(21);
    expect(Math.round(contrastRatio("FFFFFF", "000000"))).toBe(21);
  });

  it("puts a colour against itself at the bottom", () => {
    expect(contrastRatio("74CB35", "74CB35")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the pair is given", () => {
    expect(contrastRatio("74CB35", "111410")).toBeCloseTo(contrastRatio("111410", "74CB35"), 10);
  });

  it("says nothing about something that is not a colour", () => {
    // A half-typed hex value is not a contrast problem.
    expect(contrastRatio("74CB3", "111410")).toBe(0);
    expect(contrastRatio("", "111410")).toBe(0);
    expect(parseHexColor("#74CB35")).toEqual([116, 203, 53]);
    expect(parseHexColor("nope")).toBeNull();
  });

  it("reads a leading hash and a stray capital the same way", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(contrastRatio("000000", "FFFFFF"), 10);
  });

  it("measures luminance, not brightness", () => {
    // Green carries most of the luminance, blue almost none — which is why a
    // blue that looks bright can still be unreadable.
    expect(relativeLuminance("00FF00")).toBeGreaterThan(relativeLuminance("FF0000"));
    expect(relativeLuminance("FF0000")).toBeGreaterThan(relativeLuminance("0000FF"));
  });
});

describe("what a ratio means", () => {
  it("calls the readable range good", () => {
    expect(contrastVerdict(21)).toBe("gut");
    expect(contrastVerdict(4.5)).toBe("gut");
  });

  it("calls the middle tight rather than broken", () => {
    // Visible, but takes effort at a glance — which for something read all day
    // is the number that actually matters.
    expect(contrastVerdict(4.4)).toBe("knapp");
    expect(contrastVerdict(3)).toBe("knapp");
  });

  it("calls the bottom unreadable", () => {
    expect(contrastVerdict(2.9)).toBe("unlesbar");
    expect(contrastVerdict(1)).toBe("unlesbar");
  });

  it("says nothing when there is no ratio", () => {
    expect(contrastVerdict(0)).toBe("");
  });

  it("writes a ratio the way it is spoken about", () => {
    expect(formatRatio(3.24)).toBe("3,2:1");
    expect(formatRatio(21)).toBe("21,0:1");
  });
});

/**
 * A list that warns about everything is a list nobody reads.
 */
describe("which pairs are worth mentioning", () => {
  const pairs = [
    { id: "comment", label: "Kommentare", foreground: "1A1D19", background: "111410" },
    // 3,8:1 — visible, and tiring to read all day.
    { id: "keyword", label: "Schlüsselwörter", foreground: "6A7364", background: "111410" },
    { id: "string", label: "Zeichenketten", foreground: "FFFFFF", background: "111410" },
  ];

  it("keeps quiet about a pair that reads fine", () => {
    expect(checkContrast(pairs).map((finding) => finding.id)).not.toContain("string");
  });

  it("calls a tiring pair tight rather than broken", () => {
    expect(checkContrast(pairs).find((entry) => entry.id === "keyword")?.verdict).toBe("knapp");
  });

  it("names the one that vanishes", () => {
    const finding = checkContrast(pairs).find((entry) => entry.id === "comment");
    expect(finding?.verdict).toBe("unlesbar");
    expect(finding?.message).toContain("Kommentare");
    expect(finding?.message).toContain("kaum");
  });

  it("puts the worst first", () => {
    // If only one warning is read, it should be the one that matters.
    const findings = checkContrast(pairs);
    expect(findings[0].id).toBe("comment");
    expect(findings[0].ratio).toBeLessThan(findings[1].ratio);
  });

  it("warns once per colour, not once per token that inherits it", () => {
    // Most tokens inherit their colour, so one unreadable comment colour
    // produced three identical warnings for one cause and one fix.
    const inheriting = [
      { id: "comment", label: "Kommentare", foreground: "1A1D19", background: "111410" },
      { id: "javadoc", label: "Javadoc", foreground: "1A1D19", background: "111410" },
      { id: "javadocTag", label: "Javadoc-Tags", foreground: "1A1D19", background: "111410" },
    ];
    const findings = checkContrast(inheriting);
    expect(findings).toHaveLength(1);
    // Named after the anchor, which is where the fix belongs.
    expect(findings[0].id).toBe("comment");
    expect(findings[0].message).toContain("2 weitere");
  });

  it("still keeps two different bad colours apart", () => {
    const findings = checkContrast([
      { id: "comment", label: "Kommentare", foreground: "1A1D19", background: "111410" },
      { id: "keyword", label: "Schlüsselwörter", foreground: "6A7364", background: "111410" },
    ]);
    expect(findings.map((entry) => entry.id)).toEqual(["comment", "keyword"]);
  });

  it("says nothing about a colour it cannot read", () => {
    expect(checkContrast([{ id: "x", label: "X", foreground: "zz", background: "111410" }])).toEqual([]);
  });
});

/**
 * Somebody who picked purple wanted purple. A repair that changes the colour
 * is not a repair.
 */
describe("making a colour readable", () => {
  it("lifts a dark colour on a dark surface until it can be read", () => {
    const fixed = readableAgainst("1A1D19", "111410");
    expect(contrastRatio(fixed, "111410")).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens on a light surface instead", () => {
    const fixed = readableAgainst("EEEEEE", "FFFFFF");
    expect(contrastRatio(fixed, "FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(fixed)).toBeLessThan(relativeLuminance("EEEEEE"));
  });

  it("keeps the hue rather than reaching for grey", () => {
    const fixed = readableAgainst("2A0F0F", "111410");
    const [red, green, blue] = [fixed.slice(0, 2), fixed.slice(2, 4), fixed.slice(4, 6)].map((part) => parseInt(part, 16));
    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);
  });

  it("answers nothing for something that is not a colour", () => {
    expect(readableAgainst("nope", "111410")).toBe("");
    expect(readableAgainst("1A1D19", "nope")).toBe("");
  });
});
