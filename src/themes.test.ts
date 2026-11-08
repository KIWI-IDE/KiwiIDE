import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accentPalette, colorSchemes, findTheme, personalizationVariables, resolveTokenColors, resolveWorkbenchColors, themeAdjustment, themes, tokenGroupOf, tokenGroups, tokenLabels, workbenchColorVariables } from "./themes";
import { classifyJavaWord, javaLanguageDefinition, javaKeywords, javaKeywordScope } from "./language/java-tokenizer";
import { javaKeywordTokenId } from "./language/java-keywords";
import { taskMarkers } from "./utils";

describe("editor colours independent of the workbench theme", () => {
  it("applies the same override to every theme", () => {
    for (const theme of themes) {
      expect(resolveTokenColors(theme, { keyword: "FF0000" }).keyword).toBe("FF0000");
    }
  });

  it("keeps the chosen preset when the theme changes", () => {
    const preset = colorSchemes.find((scheme) => scheme.id !== "theme")!;
    const dark = resolveTokenColors(findTheme("kiwi-new-dark"), {}, preset.id);
    const light = resolveTokenColors(findTheme("kiwi-light"), {}, preset.id);
    for (const id of Object.keys(preset.tokens!) as Array<keyof typeof dark>) {
      expect(dark[id]).toBe(light[id]);
      expect(dark[id]).toBe(preset.tokens![id]!.toUpperCase());
    }
  });

  it("lets a single override win over the preset without touching the rest", () => {
    const preset = colorSchemes.find((scheme) => scheme.id !== "theme")!;
    const base = resolveTokenColors(findTheme("kiwi-new-dark"), {}, preset.id);
    const result = resolveTokenColors(findTheme("kiwi-new-dark"), { string: "123456" }, preset.id);
    expect(result.string).toBe("123456");
    for (const { id } of tokenLabels) {
      // Only "escape" derives from the string colour, so it is allowed to move.
      if (id === "string" || id === "escape") continue;
      expect(result[id], id).toBe(base[id]);
    }
  });

  it("ignores malformed values and the retired theme-scoped keys", () => {
    const base = findTheme("kiwi-new-dark");
    expect(resolveTokenColors(base, { keyword: "nope" }).keyword).toBe(base.tokens.keyword);
    // Settings written before the colours were decoupled used "<theme>.<token>";
    // those must not resurface as a token of their own.
    const legacy = resolveTokenColors(base, { "kiwi-new-dark.keyword": "FF0000" });
    expect(legacy.keyword).toBe(base.tokens.keyword);
    expect(legacy).not.toHaveProperty("kiwi-new-dark.keyword");
  });

  it("gives every token of every theme a usable colour", () => {
    for (const theme of themes) {
      const resolved = resolveTokenColors(theme);
      for (const { id } of tokenLabels) {
        expect(resolved[id], `${theme.id}.${id}`).toMatch(/^[0-9A-F]{6}$/);
      }
    }
  });

  it("lets every Java keyword keep its own colour", () => {
    const theme = findTheme("kiwi-new-dark");
    const result = resolveTokenColors(theme, {
      [javaKeywordTokenId("class")]: "FF44AA",
      [javaKeywordTokenId("package")]: "FFD84A",
      [javaKeywordTokenId("new")]: "FFFFFF",
    });
    expect(result[javaKeywordTokenId("class")]).toBe("FF44AA");
    expect(result[javaKeywordTokenId("package")]).toBe("FFD84A");
    expect(result[javaKeywordTokenId("new")]).toBe("FFFFFF");
    expect(result[javaKeywordTokenId("interface")]).toBe(result.keyword);
  });

  it("derives the finer tokens from their anchor until one is set", () => {
    // A theme that only defines the anchors, so nothing masks the fallbacks.
    const theme = themes.find((entry) => !entry.accents)!;
    const plain = resolveTokenColors(theme);
    expect(plain.controlKeyword).toBe(plain.keyword);
    expect(plain.javadocTag).toBe(plain.comment);
    expect(plain.method).toBe(plain.identifier);

    const tuned = resolveTokenColors(theme, { controlKeyword: "ABCDEF" });
    expect(tuned.controlKeyword).toBe("ABCDEF");
    expect(tuned.keyword).toBe(plain.keyword);
  });

  it("offers every preset colour as a valid hex value", () => {
    for (const scheme of colorSchemes) {
      for (const [id, value] of Object.entries(scheme.tokens || {})) {
        expect(tokenLabels.some((token) => token.id === id), `${scheme.id}.${id}`).toBe(true);
        expect(value, `${scheme.id}.${id}`).toMatch(/^[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

describe("theme catalogue", () => {
  it("backs every theme with a stylesheet block", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const blocks = new Set([...css.matchAll(/\[data-theme="([^"]+)"\]/g)].map((match) => match[1]));
    for (const theme of themes) {
      // The default theme is the :root ramp itself and needs no override block.
      if (theme.id === "kiwi-new-dark") continue;
      expect(blocks.has(theme.id), theme.id).toBe(true);
    }
  });

  it("keeps ids and labels unique and both groups populated", () => {
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
    expect(new Set(themes.map((theme) => theme.label)).size).toBe(themes.length);
    expect(themes.filter((theme) => theme.group === "Hell").length).toBeGreaterThan(3);
    expect(themes.filter((theme) => theme.group === "Dunkel").length).toBeGreaterThan(3);
  });

  it("uses well-formed colours everywhere", () => {
    for (const theme of themes) {
      for (const [key, value] of Object.entries(theme.editor)) {
        expect(value, `${theme.id}.${key}`).toMatch(/^#[0-9a-fA-F]{6,8}$/);
      }
      for (const [key, value] of Object.entries({ ...theme.tokens, ...(theme.accents || {}) })) {
        expect(value, `${theme.id}.${key}`).toMatch(/^[0-9A-Fa-f]{6}$/);
        expect(tokenLabels.some((token) => token.id === key), `${theme.id}.${key}`).toBe(true);
      }
    }
  });
});

describe("Java syntax tokens", () => {
  it("separates control flow, modifiers, literals and primitives", () => {
    expect(classifyJavaWord("if")).toBe("keyword.control");
    expect(classifyJavaWord("return")).toBe("keyword.control");
    expect(classifyJavaWord("public")).toBe("keyword.modifier");
    expect(classifyJavaWord("static")).toBe("keyword.modifier");
    expect(classifyJavaWord("class")).toBe("keyword");
    expect(classifyJavaWord("module")).toBe("keyword");
    expect(classifyJavaWord("when")).toBe("keyword.control");
    expect(classifyJavaWord("null")).toBe("keyword.literal");
    expect(classifyJavaWord("int")).toBe("keyword.primitive");
  });

  it("follows Java naming conventions for names", () => {
    expect(classifyJavaWord("MAX_VALUE")).toBe("constant");
    expect(classifyJavaWord("EventBus")).toBe("type.identifier");
    // A single uppercase letter is a type parameter, not a constant.
    expect(classifyJavaWord("T")).toBe("type.identifier");
    expect(classifyJavaWord("player")).toBe("identifier");
  });

  it("colours task markers in any casing and on every marker", () => {
    const definition = javaLanguageDefinition();
    const rules = definition.tokenizer.whitespace.concat(definition.tokenizer.comment) as Array<[RegExp, string]>;
    const taskRules = rules.filter(([, token]) => token === "comment.task");
    expect(taskRules.length).toBe(2);
    for (const marker of taskMarkers) {
      for (const spelling of [marker, marker.toLowerCase(), `${marker[0]}${marker.slice(1).toLowerCase()}`]) {
        // Both the line-comment and the block-comment rule have to accept it.
        expect(taskRules[0][0].test(`// ${spelling}: aufraeumen`), spelling).toBe(true);
        expect(taskRules[0][0].test(`//${spelling}:ohne Leerzeichen`), spelling).toBe(true);
        expect(taskRules[1][0].test(` * ${spelling} im Block`), spelling).toBe(true);
      }
    }
    // A word that merely contains a marker must stay an ordinary comment.
    expect(taskRules[0][0].test("// todos werden woanders gepflegt")).toBe(false);
    expect(taskRules[0][0].test("// mastodon")).toBe(false);
  });

  it("emits a token for everything the themes can colour", () => {
    const definition = javaLanguageDefinition();
    const emitted = new Set<string>();
    const collect = (value: unknown) => {
      if (typeof value === "string") emitted.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(definition.tokenizer);
    collect(definition.brackets);
    for (const scope of [
      "keyword", "keyword.control", "keyword.modifier", "keyword.literal", "keyword.primitive",
      "annotation", "type.identifier", "method", "field", "constant", "identifier",
      "string", "string.escape", "string.invalid", "number", "operator",
      "delimiter", "comment", "comment.task", "comment.doc", "comment.doc.tag",
    ]) {
      expect(emitted.has(scope), scope).toBe(true);
    }
  });

  it("emits a distinct scope for every Java keyword", () => {
    const definition = javaLanguageDefinition();
    for (const word of javaKeywords) {
      expect(definition.keywordTokenCases[word], word).toBe(javaKeywordScope(word));
      expect(tokenLabels.some((entry) => entry.id === javaKeywordTokenId(word)), word).toBe(true);
    }
    expect(new Set(Object.values(definition.keywordTokenCases)).size).toBe(javaKeywords.length);
  });
});

describe("accent palette", () => {
  it("derives every accent token from the one colour a user picks", () => {
    // The workbench used to override --green only, while the stylesheet writes
    // most of its rules against --accent — so half the surfaces kept the
    // theme's colour and the two sat side by side in one window.
    const palette = accentPalette("#7ad83b");
    expect(palette["--accent"]).toBe("#7ad83b");
    expect(palette["--accent-bright"]).toContain("#7ad83b");
    expect(palette["--accent-bright"]).toContain("#ffffff");
    expect(palette["--accent-dim"]).toContain("#000000");
    // The stylesheet still writes rules against the older --green names, and
    // those resolve at the root before the workbench sets its accent, so they
    // are written out rather than left derived.
    expect(palette["--green"]).toBe(palette["--accent"]);
    expect(palette["--green-bright"]).toBe(palette["--accent-bright"]);
    expect(Object.keys(palette).sort()).toEqual([
      "--accent", "--accent-bright", "--accent-dim", "--accent-on",
      "--green", "--green-bright", "--green-dim",
    ]);
  });

  it("puts readable text on the accent whether it is light or dark", () => {
    // A filled button carries text; yellow needs dark letters where navy needs
    // light ones, and brightness is what decides that, not the hue.
    expect(accentPalette("#ffe600")["--accent-on"]).toBe("#0b1408");
    expect(accentPalette("#10214d")["--accent-on"]).toBe("#f4fbef");
  });

  it("falls back rather than passing nonsense into a stylesheet", () => {
    expect(accentPalette("nicht-einmal-eine-farbe")["--accent"]).toBe("#7ad83b");
    expect(accentPalette("#ABCDEF")["--accent"]).toBe("#abcdef");
  });
});

describe("theme adjustment", () => {
  it("moves surfaces and text in opposite directions", () => {
    // Lightening a theme by lightening everything eats the contrast it was
    // designed with, so the ink goes the other way.
    const lighter = themeAdjustment(20, 0);
    expect(lighter["--theme-shade"]).toBe("20%");
    expect(lighter["--theme-shade-surface"]).toBe("#ffffff");
    expect(lighter["--theme-shade-ink"]).toBe("#000000");
    const darker = themeAdjustment(-20, 0);
    expect(darker["--theme-shade"]).toBe("20%");
    expect(darker["--theme-shade-surface"]).toBe("#000000");
    expect(darker["--theme-shade-ink"]).toBe("#ffffff");
  });

  it("keeps the nudge a nudge", () => {
    expect(themeAdjustment(999, 999)["--theme-shade"]).toBe("40%");
    expect(themeAdjustment(999, 999)["--theme-tint"]).toBe("30%");
    expect(themeAdjustment(Number.NaN, Number.NaN)["--theme-shade"]).toBe("0%");
  });

  it("clamps contrast and scales all accent surfaces", () => {
    const adjusted = themeAdjustment(0, 0, 999, 50, true);
    expect(adjusted["--theme-contrast"]).toBe("30%");
    expect(adjusted["--theme-contrast-surface"]).toBe("#ffffff");
    expect(adjusted["--theme-contrast-ink"]).toBe("#000000");
    expect(adjusted["--accent-surface-1"]).toContain("4%");
    expect(adjusted["--accent-surface-8"]).toContain("25%");
  });
});

describe("workbench colour adjustment", () => {
  it("resolves surface colours and only emits valid overrides", () => {
    const theme = findTheme("kiwi-new-dark");
    const resolved = resolveWorkbenchColors(theme, { panelBackground: "123456", danger: "AABBCC" });
    expect(resolved.panelBackground).toBe("123456");
    expect(resolved.danger).toBe("AABBCC");
    expect(resolved.editorCursor).toMatch(/^[0-9A-F]{6}$/);
    expect(workbenchColorVariables({ panelBackground: "123456", editorCursor: "ABCDEF", warning: "nope" }))
      .toEqual({ "--panel-base-source": "#123456" });
  });

  it("builds the same personalization variables used by standalone windows", () => {
    const values = personalizationVariables({
      theme: "kiwi-light",
      accentColor: "#112233",
      themeShade: 5,
      themeTint: 2,
      themeContrast: 6,
      accentIntensity: 120,
      themeColorOverrides: { chromeBackground: "AABBCC" },
      uiRoundness: 140,
      borderStrength: 80,
      shadowStrength: 60,
      uiFont: "Segoe UI",
    });
    expect(values["--accent"]).toBe("#112233");
    expect(values["--chrome-base-source"]).toBe("#AABBCC");
    expect(values["--theme-contrast-surface"]).toBe("#ffffff");
    expect(values["--roundness"]).toBe("1.4");
    expect(values["--ui-font"]).toContain("Segoe UI");
  });
});

describe("token groups", () => {
  it("puts every token in the family it inherits from", () => {
    // Twenty-two colours in a flat list is a list nobody reads; the families
    // already exist in the inheritance chain, so they are used rather than a
    // second grouping invented beside them.
    expect(tokenGroupOf("controlKeyword")).toBe("keyword");
    expect(tokenGroupOf("javadocTag")).toBe("comment");
    expect(tokenGroupOf("taskComment")).toBe("error");
    // `type` is an anchor a theme defines, so what inherits from it belongs to
    // that family and not to the identifiers `type` itself falls back to.
    expect(tokenGroupOf("typeParameter")).toBe("type");
    const grouped = tokenGroups.flatMap((group) => [group.id, ...group.members]);
    expect([...grouped].sort()).toEqual(tokenLabels.map((entry) => entry.id).sort());
    expect(new Set(grouped).size).toBe(tokenLabels.length);
  });
});

/**
 * Colouring a family, and colouring one thing in it.
 *
 * A theme gives every token its own colour, so it used to take an explicit
 * colour on all seventy-eight keywords to make "keywords" mean anything — and
 * that threw away every keyword somebody had deliberately made different.
 */
describe("a family colour and a colour of one's own", () => {
  const theme = findTheme("kiwi-new-dark");
  const keywords = tokenGroups.find((group) => group.id === "keyword")!;

  it("carries the family colour to everything in the family", () => {
    const resolved = resolveTokenColors(theme, { keyword: "FF0000" });
    expect(resolved.keyword).toBe("FF0000");
    for (const member of keywords.members) {
      expect(resolved[member], member).toBe("FF0000");
    }
  });

  it("leaves a colour of its own alone when the family changes", () => {
    // This is the whole request: all of them together, and this one apart.
    const resolved = resolveTokenColors(theme, {
      keyword: "FF0000",
      [javaKeywordTokenId("class")]: "00FF00",
      controlKeyword: "0000FF",
    });
    expect(resolved.keyword).toBe("FF0000");
    expect(resolved[javaKeywordTokenId("class")]).toBe("00FF00");
    expect(resolved.controlKeyword).toBe("0000FF");
    expect(resolved[javaKeywordTokenId("package")]).toBe("FF0000");
  });

  it("puts one back in the family when its own colour is cleared", () => {
    const apart = resolveTokenColors(theme, { keyword: "FF0000", controlKeyword: "0000FF" });
    const back = resolveTokenColors(theme, { keyword: "FF0000" });
    expect(apart.controlKeyword).toBe("0000FF");
    expect(back.controlKeyword).toBe("FF0000");
  });

  it("keeps the families apart", () => {
    const resolved = resolveTokenColors(theme, { keyword: "FF0000" });
    for (const group of tokenGroups) {
      if (group.id === "keyword") continue;
      expect(resolved[group.id], group.id).not.toBe("FF0000");
    }
  });

  it("ignores a malformed family colour rather than spreading it", () => {
    const resolved = resolveTokenColors(theme, { keyword: "nicht-hex" });
    expect(resolved.keyword).toBe(theme.tokens.keyword.toUpperCase());
    for (const member of keywords.members) {
      expect(resolved[member], member).toMatch(/^[0-9A-F]{6}$/);
    }
  });
});
