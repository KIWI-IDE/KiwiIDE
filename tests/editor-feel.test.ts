import { describe, expect, it } from "vitest";
import {
  defaultEditorFeel,
  describeLineHighlight,
  editorFeelOptions,
  editorFeelVariables,
  editorFontStack,
  ligatureSetting,
  normalizeColor,
  revealScrollType,
  tokenClassForColor,
} from "../src/editor-feel";

const base = { ...defaultEditorFeel };

/**
 * A monospace face missing one glyph substitutes a proportional one for it,
 * and a single wrong-width character moves everything after it on the line.
 */
describe("the font stack", () => {
  it("puts the chosen face first and keeps a monospace floor", () => {
    const stack = editorFontStack("Fira Code", "");
    expect(stack.startsWith('"Fira Code"')).toBe(true);
    expect(stack.endsWith("monospace")).toBe(true);
  });

  it("quotes a name with a space and leaves one without alone", () => {
    expect(editorFontStack("Fira Code", "Consolas")).toContain('"Fira Code"');
    expect(editorFontStack("Menlo", "")).toContain("Menlo");
    expect(editorFontStack("Menlo", "")).not.toContain('"Menlo"');
  });

  it("takes the fallbacks in the order they were given", () => {
    const stack = editorFontStack("Fira Code", "Noto Sans Mono, Symbola");
    expect(stack.indexOf("Noto Sans Mono")).toBeLessThan(stack.indexOf("Symbola"));
  });

  it("names a face once even when it is repeated", () => {
    const stack = editorFontStack("Consolas", "Consolas, consolas");
    expect(stack.split("Consolas").length - 1).toBe(1);
  });

  it("still answers when nothing was chosen", () => {
    expect(editorFontStack("", "")).toBe('"JetBrains Mono", "Cascadia Code", Consolas, monospace');
  });
});

/**
 * A feature string is what makes "the arrows but not the equals ligature"
 * possible at all.
 */
describe("ligatures", () => {
  it("takes the two words as the booleans they mean", () => {
    expect(ligatureSetting("on")).toBe(true);
    expect(ligatureSetting("off")).toBe(false);
    expect(ligatureSetting("")).toBe(false);
  });

  it("passes a feature string through", () => {
    expect(ligatureSetting("'calt', 'ss01'")).toBe("'calt', 'ss01'");
  });
});

/**
 * Somebody who asked the system for less movement did not mean "except here".
 */
describe("what Monaco is told", () => {
  it("stops the caret blinking when the speed is zero", () => {
    expect(editorFeelOptions({ ...base, cursorBlinkMs: 0 }, false).cursorBlinking).toBe("solid");
    expect(editorFeelOptions(base, false).cursorBlinking).toBe("blink");
  });

  it("lets reduced motion win over every animation", () => {
    const still = editorFeelOptions({ ...base, cursorAnimation: true, smoothScrolling: true }, true);
    expect(still.cursorSmoothCaretAnimation).toBe("off");
    expect(still.smoothScrolling).toBe(false);
  });

  it("passes the line highlight through as Monaco spells it", () => {
    expect(editorFeelOptions({ ...base, lineHighlight: "gutter" }, false).renderLineHighlight).toBe("gutter");
    expect(editorFeelOptions({ ...base, lineHighlight: "none" }, false).renderLineHighlight).toBe("none");
  });

  it("glides to a definition unless asked not to", () => {
    expect(revealScrollType(base, false)).toBe(1);
    expect(revealScrollType({ ...base, revealMotion: "instant" }, false)).toBe(0);
    expect(revealScrollType(base, true)).toBe(0);
  });
});

describe("the properties the stylesheet paints from", () => {
  it("turns a blink speed into a duration", () => {
    expect(editorFeelVariables({ ...base, cursorBlinkMs: 400 })["--caret-blink"]).toBe("400ms");
  });

  it("stops the animation rather than running it infinitely fast", () => {
    // A zero duration on a running animation is not "still", it is "every
    // frame", which is the opposite of what was asked for.
    expect(editorFeelVariables({ ...base, cursorBlinkMs: 0 })["--caret-blink"]).toBe("0s");
    expect(editorFeelVariables(base, { reducedMotion: true })["--caret-blink"]).toBe("0s");
  });

  it("falls back to the code font when no other was named", () => {
    const variables = editorFeelVariables(base);
    expect(variables["--comment-font"]).toBe("var(--editor-font)");
    expect(variables["--inlay-font"]).toBe("var(--editor-font)");
  });

  it("puts a chosen face in front of the code font", () => {
    const variables = editorFeelVariables({ ...base, commentFont: "Iosevka Aile" });
    expect(variables["--comment-font"]).toBe('"Iosevka Aile", var(--editor-font)');
  });

  it("scales the inlay hints against the code size", () => {
    expect(editorFeelVariables({ ...base, inlayFontScale: 80 }, { fontSize: 14 })["--inlay-font-size"])
      .toBe("11.2px");
  });

  it("measures the focus width in characters", () => {
    // A line length is a reading measure, not a pixel count.
    expect(editorFeelVariables({ ...base, focusMaxWidth: 90 })["--focus-max-width"]).toBe("90ch");
  });

  it("leaves the width alone when it is not set", () => {
    expect(editorFeelVariables(base)["--focus-max-width"]).toBe("none");
  });

  it("keeps every value inside what it can mean", () => {
    const wild = editorFeelVariables({
      ...base,
      cursorBlinkMs: 99_999,
      minimapOpacity: 400,
      focusMaxWidth: 5,
      inlayFontScale: 1_000,
    }, { fontSize: 13 });
    expect(wild["--caret-blink"]).toBe("5000ms");
    expect(wild["--minimap-opacity"]).toBe("1");
    expect(wild["--focus-max-width"]).toBe("40ch");
    expect(wild["--inlay-font-size"]).toBe("20.8px");
  });
});

/**
 * Monaco does not name its token spans. It numbers them by the position of
 * their colour in the theme, so reaching comments means finding the number.
 */
describe("finding Monaco's class for a colour", () => {
  const rules = [
    { selector: ".mtk1", color: "rgb(223, 228, 218)" },
    { selector: ".mtk2", color: "#6A7364" },
    { selector: ".mtk3", color: "#74CB35" },
  ];

  it("finds the class whose colour matches", () => {
    expect(tokenClassForColor(rules, "6A7364")).toBe(2);
    expect(tokenClassForColor(rules, "#74cb35")).toBe(3);
  });

  it("reads a colour Monaco wrote as rgb the same way", () => {
    expect(tokenClassForColor(rules, "DFE4DA")).toBe(1);
  });

  it("answers nothing when no class carries it", () => {
    // A rule aimed at the wrong number would set the wrong tokens in Georgia.
    expect(tokenClassForColor(rules, "FF0000")).toBe(0);
    expect(tokenClassForColor(rules, "")).toBe(0);
    expect(tokenClassForColor([], "6A7364")).toBe(0);
  });

  it("ignores a selector that is not a token class", () => {
    expect(tokenClassForColor([{ selector: ".monaco-editor", color: "#6A7364" }], "6A7364")).toBe(0);
  });

  it("reads both ways of writing a colour", () => {
    expect(normalizeColor("#74CB35")).toBe("74cb35");
    expect(normalizeColor("rgb(116, 203, 53)")).toBe("74cb35");
    expect(normalizeColor("rgba(116, 203, 53, 0.5)")).toBe("74cb35");
    expect(normalizeColor("gruen")).toBe("");
  });
});

describe("saying what a line-highlight choice does", () => {
  it("spells out what Monaco calls all", () => {
    // "all" is Monaco's word for the line and its number together, which is
    // not obvious from the word.
    expect(describeLineHighlight("all")).toBe("Zeile und Zeilennummer");
    expect(describeLineHighlight("gutter")).toBe("Nur die Zeilennummer");
    expect(describeLineHighlight("none")).toBe("Nichts hervorheben");
  });
});
