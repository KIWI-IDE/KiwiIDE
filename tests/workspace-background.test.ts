import { describe, expect, it } from "vitest";
import {
  anchorPosition,
  animationWarning,
  backgroundFor,
  backgroundVariables,
  currentBackgroundImage,
  defaultBackgroundSettings,
  fitRepeat,
  fitSize,
  isAnimatedBackground,
  surfaceOpacity,
} from "../src/workspace-background";

const base = { ...defaultBackgroundSettings, image: "C:/bilder/wald.png", opacity: 40 };

/**
 * Three sliders that all start at the same number are three sliders somebody
 * has to keep in step by hand.
 */
describe("how strong the picture is on each surface", () => {
  it("follows the overall strength until a surface is given its own", () => {
    expect(surfaceOpacity(base, -1)).toBe(40);
  });

  it("takes a surface's own value once it has one", () => {
    expect(surfaceOpacity(base, 5)).toBe(5);
    expect(surfaceOpacity(base, 0)).toBe(0);
  });

  it("keeps a value inside the range it can mean", () => {
    expect(surfaceOpacity(base, 400)).toBe(100);
    expect(surfaceOpacity({ ...base, opacity: 900 }, -1)).toBe(100);
  });
});

describe("where the picture sits and how big it is", () => {
  it("turns a corner into what CSS understands", () => {
    expect(anchorPosition("bottom-right")).toBe("right bottom");
    expect(anchorPosition("center")).toBe("center center");
    expect(anchorPosition("oben" as never)).toBe("center center");
  });

  it("says the fit in one word when the scale is untouched", () => {
    expect(fitSize("contain", 100)).toBe("contain");
    expect(fitSize("cover", 100)).toBe("cover");
    expect(fitSize("stretch", 100)).toBe("100% 100%");
  });

  it("lets a scale win over the fit", () => {
    // "contain at 140%" is not something background-size can say in one word.
    expect(fitSize("contain", 140)).toBe("140% auto");
    expect(fitSize("cover", 60)).toBe("60% auto");
  });

  it("keeps the scale inside what is usable", () => {
    expect(fitSize("contain", 5)).toBe("10% auto");
    expect(fitSize("contain", 9000)).toBe("400% auto");
  });

  it("repeats only when tiling", () => {
    expect(fitRepeat("tile")).toBe("repeat");
    expect(fitRepeat("contain")).toBe("no-repeat");
  });
});

/**
 * The playlist turns over on a clock rather than on a render, so the picture
 * does not change every time something else does.
 */
describe("which image is showing", () => {
  const list = { ...base, playlist: ["a.png", "b.png", "c.png"], rotateSeconds: 60 };

  it("shows the single image when there is no list", () => {
    expect(currentBackgroundImage(base, 999)).toBe("C:/bilder/wald.png");
  });

  it("moves through the list on the clock", () => {
    expect(currentBackgroundImage(list, 0)).toBe("a.png");
    expect(currentBackgroundImage(list, 59)).toBe("a.png");
    expect(currentBackgroundImage(list, 60)).toBe("b.png");
    expect(currentBackgroundImage(list, 120)).toBe("c.png");
  });

  it("comes back round to the first", () => {
    expect(currentBackgroundImage(list, 180)).toBe("a.png");
  });

  it("stays on the first when the rotation is off", () => {
    expect(currentBackgroundImage({ ...list, rotateSeconds: 0 }, 5_000)).toBe("a.png");
  });

  it("ignores empty entries in the list", () => {
    expect(currentBackgroundImage({ ...base, playlist: ["", ""], rotateSeconds: 60 }, 0))
      .toBe("C:/bilder/wald.png");
  });
});

/**
 * A laptop on battery redrawing a video behind an editor is a real cost, and
 * somebody who wants it anyway should be told once rather than stopped.
 */
describe("moving images", () => {
  it("recognises the expensive kinds", () => {
    expect(isAnimatedBackground("C:/bilder/regen.gif")).toBe(true);
    expect(isAnimatedBackground("C:/bilder/regen.webm")).toBe(true);
    expect(isAnimatedBackground("data:image/gif;base64,AAA")).toBe(true);
  });

  it("leaves a still picture alone", () => {
    expect(isAnimatedBackground("C:/bilder/wald.png")).toBe(false);
    expect(isAnimatedBackground("data:image/png;base64,AAA")).toBe(false);
    expect(isAnimatedBackground("")).toBe(false);
  });

  it("is not fooled by a query string", () => {
    expect(isAnimatedBackground("https://example.org/regen.gif?v=2")).toBe(true);
  });

  it("warns about the cost rather than refusing", () => {
    expect(animationWarning("regen.gif", true)).toContain("Akku");
    expect(animationWarning("regen.gif", false)).toContain("Aktiviere bewegte Hintergründe");
    expect(animationWarning("wald.png", true)).toBe("");
  });
});

describe("the properties the stylesheet paints from", () => {
  const variables = backgroundVariables(
    { ...base, blur: 6, tint: 30, editorOpacity: 8 },
    "data:image/png;base64,AAA",
  );

  it("hands over the image, the place and the size", () => {
    expect(variables["--workspace-background-image"]).toContain("data:image/png");
    expect(variables["--workspace-background-position"]).toBe("center center");
    expect(variables["--workspace-background-size"]).toBe("contain");
    expect(variables["--workspace-background-blur"]).toBe("6px");
    expect(variables["--workspace-background-tint"]).toBe("0.3");
  });

  it("gives each surface its own strength", () => {
    expect(variables["--workspace-background-opacity"]).toBe("0.4");
    expect(variables["--workspace-background-opacity-editor"]).toBe("0.08");
    // Untouched surfaces still follow the overall one.
    expect(variables["--workspace-background-opacity-terminal"]).toBe("0.4");
  });

  it("says there is no image when there is none", () => {
    expect(backgroundVariables(base, "")["--workspace-background-image"]).toBe("none");
  });

  it("scales the strength in focus mode", () => {
    const dimmed = backgroundVariables({ ...base, focusStrength: 50 }, "x", { focusMode: true });
    expect(dimmed["--workspace-background-opacity"]).toBe("0.2");
    const brighter = backgroundVariables({ ...base, focusStrength: 200 }, "x", { focusMode: true });
    expect(brighter["--workspace-background-opacity"]).toBe("0.8");
  });

  it("leaves the strength alone outside focus mode", () => {
    expect(backgroundVariables({ ...base, focusStrength: 50 }, "x")["--workspace-background-opacity"])
      .toBe("0.4");
  });

  it("drifts rather than moves", () => {
    // Pixels per thousand scrolled: anything fast enough to notice is
    // something to look at rather than work behind.
    expect(backgroundVariables({ ...base, parallax: 20 }, "x", { scrolled: 1000 })["--workspace-background-shift"])
      .toBe("20px");
    expect(backgroundVariables({ ...base, parallax: 0 }, "x", { scrolled: 5000 })["--workspace-background-shift"])
      .toBe("0px");
  });
});

/**
 * Somebody who set a photograph for one project did not mean to reset its blur.
 */
describe("a project's own picture", () => {
  it("uses the global settings when the project names nothing", () => {
    expect(backgroundFor({ image: "global.png", blur: 4 }, null).image).toBe("global.png");
    expect(backgroundFor({ image: "global.png", blur: 4 }, {}).blur).toBe(4);
  });

  it("lets the project's image win", () => {
    const merged = backgroundFor({ image: "global.png", blur: 4 }, { image: "projekt.png" });
    expect(merged.image).toBe("projekt.png");
    // And only over the image.
    expect(merged.blur).toBe(4);
  });

  it("treats an empty value as not set rather than as a choice", () => {
    expect(backgroundFor({ image: "global.png" }, { image: "" }).image).toBe("global.png");
  });

  it("fills in everything neither of them named", () => {
    expect(backgroundFor({}, null)).toEqual(defaultBackgroundSettings);
  });
});
