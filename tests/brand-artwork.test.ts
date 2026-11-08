/**
 * The artwork is drawn three times and written down once.
 *
 * The splash screen and the installer's panel both build from
 * brand-artwork.cjs. The stylesheet cannot: it is static CSS with no build step
 * of its own, so the Project Hub keeps a hand-written copy of the same numbers.
 * These tests are what stops that copy drifting, and what pins the property
 * that makes the shapes shapes at all.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const {
  ARTWORK_SHAPES,
  ARTWORK_GROUND,
  artworkCss,
  artworkMarkup,
  blobPath,
  gradientRule,
  radiusRule,
  scaledRadii,
  shapeBox,
} = require("../electron/services/brand-artwork.cjs");

const stylesheet = fs.readFileSync(path.join(process.cwd(), "src", "styles.css"), "utf8");

/** The declarations inside one rule, by selector, with the whitespace flattened. */
function ruleBody(selector: string): string {
  const start = stylesheet.indexOf(`\n${selector} {`);
  expect(start, `${selector} steht nicht im Stylesheet`).toBeGreaterThan(-1);
  const end = stylesheet.indexOf("}", start);
  return stylesheet.slice(start, end).replace(/\s+/g, " ");
}

describe("Kiwi's artwork", () => {
  it("shrinks the radii of the one shape that asks for more edge than it has", () => {
    /**
     * Two of the shapes have pairs adding to exactly 100% along every edge, so
     * their arcs meet in the middle of each side and no straight piece is left.
     * The third asks for 102% down its left edge, and CSS answers by shrinking
     * every one of its eight radii by the worst ratio -- here 100/102. Drawing
     * it without that was the difference between the installer's third shape
     * and the splash's, so it is checked rather than assumed.
     */
    const [one, two, three] = ARTWORK_SHAPES;
    expect(scaledRadii(200, 300, one.radius).factor).toBe(1);
    expect(scaledRadii(200, 300, two.radius).factor).toBe(1);

    const drei = scaledRadii(200, 300, three.radius);
    expect(drei.factor).toBeCloseTo(100 / 102, 10);
    // Shrunk together: the proportions between the eight survive.
    expect(drei.vertical[0] / drei.vertical[3]).toBeCloseTo(42 / 60, 10);
  });

  it("draws a path that closes", () => {
    /**
     * Four arcs with whatever is left of each side between them. An unclosed or
     * mis-cornered path still renders -- as a slightly different picture, which
     * is exactly the failure that goes unnoticed.
     */
    for (const shape of ARTWORK_SHAPES) {
      const box = shapeBox(shape, 258, 362);
      const path = blobPath(box.x, box.y, box.width, box.height, shape.radius);
      expect(path.startsWith("M "), `${shape.name}: Anfang`).toBe(true);
      expect(path.endsWith(" Z"), `${shape.name}: Schluss`).toBe(true);
      expect((path.match(/A /g) || []).length, `${shape.name}: vier Ecken`).toBe(4);
      // Three sides are written out; the fourth is what `Z` closes.
      expect((path.match(/L /g) || []).length, `${shape.name}: drei Kanten`).toBe(3);
      expect(path, `${shape.name}: keine kaputte Zahl`).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it("puts every shape outside the frame that clips it", () => {
    /**
     * A shape whose box sits inside the frame would show its own edges, and the
     * artwork would read as three blobs on a background rather than as colour
     * running off the sides. At least one inset per axis has to be negative.
     */
    for (const shape of ARTWORK_SHAPES) {
      const [top, right, bottom, left] = shape.inset;
      expect(Math.min(left, right), `${shape.name}: waagerecht`).toBeLessThan(0);
      expect(Math.min(top, bottom), `${shape.name}: senkrecht`).toBeLessThan(0);
    }
  });

  it("hands the Project Hub's stylesheet the same numbers it hands the splash", () => {
    /**
     * The hub's copy is written by hand. Rather than compare formatting, this
     * checks the declarations the generator would produce actually stand in the
     * matching rule -- so a colour, an angle or a drift changed in one place
     * and not the other fails here instead of in somebody's eyes.
     */
    expect(ruleBody(".hub-art i")).toContain(`border-radius: ${radiusRule(ARTWORK_SHAPES[0].radius)};`);

    for (const shape of ARTWORK_SHAPES) {
      const body = ruleBody(`.hub-art .${shape.name}`);
      expect(body, `${shape.name}: inset`).toContain(`inset: ${shape.inset.map((value: number) => `${value}%`).join(" ")};`);
      expect(body, `${shape.name}: Verlauf`).toContain(`background: ${gradientRule(shape)};`);
      expect(body, `${shape.name}: Drift`).toContain(
        `animation: hub-drift ${shape.drift.seconds}s ease-in-out infinite${shape.drift.reverse ? " reverse" : ""};`,
      );
      if (shape.radius !== ARTWORK_SHAPES[0].radius) {
        expect(body, `${shape.name}: eigene Rundung`).toContain(`border-radius: ${radiusRule(shape.radius)};`);
      }
      if (shape.opacity !== 1) {
        expect(body, `${shape.name}: Deckkraft`).toContain(`opacity: ${String(shape.opacity).replace(/^0/, "")};`);
      }
    }
  });

  it("stacks the shapes in one order everywhere", () => {
    // The markup order is the paint order: lime first, deep blue-green last.
    expect(artworkMarkup()).toBe('<i class="one"></i><i class="two"></i><i class="three"></i>');
    expect(ARTWORK_SHAPES.map((shape: { name: string }) => shape.name)).toEqual(["one", "two", "three"]);
  });

  it("writes rules a browser will take", () => {
    const css = artworkCss(".art", "drift");
    expect(css).toContain(".art i {");
    expect(css).toContain(".art .three {");
    // Balanced braces: an unclosed rule in a data: URL fails silently.
    expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
    expect(css).not.toContain("undefined");
  });

  it("keeps the splash and the installer on this file rather than on copies", () => {
    /**
     * The point of the module is that neither side carries its own table of
     * numbers. If one grows a copy again the artwork can drift without any of
     * the checks above noticing, because they would still agree with the file.
     */
    const splash = fs.readFileSync(path.join(process.cwd(), "electron", "main.cjs"), "utf8");
    const installer = fs.readFileSync(path.join(process.cwd(), "scripts", "build-installer-art.mjs"), "utf8");
    expect(splash).toContain('artworkCss(".art", "drift")');
    expect(installer).toContain("ARTWORK_SHAPES");

    for (const source of [splash, installer]) {
      for (const shape of ARTWORK_SHAPES) {
        for (const [, colour] of shape.stops) {
          expect(source, `${colour} steht wieder als Literal da`).not.toContain(colour);
        }
      }
    }
    expect(ARTWORK_GROUND).toBe("#071a24");
  });
});
