import { describe, expect, it } from "vitest";
import {
  expressionKind,
  javaReleaseNumber,
  normalizeTemplateName,
  SURROUND_KINDS,
  SURROUND_LABELS,
  surroundSelection,
  postfixTargetAt,
  templateFitsExpression,
  templateFitsLanguageLevel,
  withoutServerDuplicates,
} from "../src/language/postfix-templates";

/**
 * Finding where the expression begins.
 *
 * It used to be matched with one character class, so a string, a comma or a
 * space ended it: `players.get("server").stream().` was read as `stream`, and
 * a template wrapping it wrapped a method name.
 */
describe("reading the expression before the dot", () => {
  it("takes a plain name", () => {
    expect(postfixTargetAt("    player.")).toEqual({ expression: "player", typed: "" });
    expect(postfixTargetAt("    player.if")).toEqual({ expression: "player", typed: "if" });
  });

  it("takes a whole method chain, arguments and all", () => {
    expect(postfixTargetAt('    players.get("server").stream().')?.expression)
      .toBe('players.get("server").stream()');
    expect(postfixTargetAt("    map.getOrDefault(key, List.of()).")?.expression)
      .toBe("map.getOrDefault(key, List.of())");
  });

  it("is not confused by a dot inside a string", () => {
    expect(postfixTargetAt('    name.replace("a.b", "c").')?.expression)
      .toBe('name.replace("a.b", "c")');
    expect(postfixTargetAt('    text.split("\\\\.").')?.expression)
      .toBe('text.split("\\\\.")');
  });

  it("follows a chain written over several lines", () => {
    const chain = ["    players.get(\"server\")", "        .stream()", "        ."].join("\n");
    expect(postfixTargetAt(chain)?.expression)
      .toBe('players.get("server")\n        .stream()');
  });

  it("stops where the expression does", () => {
    // What precedes is a statement, not part of what is being reached through.
    expect(postfixTargetAt("    int size = list.")?.expression).toBe("list");
    expect(postfixTargetAt("    if (player.")?.expression).toBe("player");
    expect(postfixTargetAt("    call(a, b.")?.expression).toBe("b");
    expect(postfixTargetAt("    return value.")?.expression).toBe("value");
  });

  it("answers nothing where there is no expression", () => {
    expect(postfixTargetAt("    int x = 1")).toBeNull();
    expect(postfixTargetAt("")).toBeNull();
    // A number with a dot is a literal being written.
    expect(postfixTargetAt("    double d = 42.")).toBeNull();
  });
});

/**
 * What a template may be offered for.
 *
 * Syntactic and deliberately unsure of itself: the language server is not
 * asked, because a template has to be offered while the character after the
 * dot is still being typed. "unknown" allows everything — hiding a template
 * somebody wanted looks broken, offering one they did not is a line further
 * down a list.
 */
describe("deciding which templates fit", () => {
  it("reads the obvious booleans", () => {
    expect(expressionKind("isReady()")).toBe("boolean");
    expect(expressionKind("player.hasPermission(\"a\")")).toBe("boolean");
    expect(expressionKind("a == b")).toBe("boolean");
    expect(expressionKind("!done")).toBe("boolean");
    expect(expressionKind("list.isEmpty()")).toBe("boolean");
  });

  it("reads the obvious sequences", () => {
    expect(expressionKind("players")).toBe("iterable");
    expect(expressionKind("map.values()")).toBe("iterable");
    expect(expressionKind("list.stream()")).toBe("iterable");
    expect(expressionKind("playerList")).toBe("iterable");
  });

  it("admits when it does not know", () => {
    expect(expressionKind("player")).toBe("unknown");
    expect(expressionKind("compute(a, b)")).toBe("unknown");
    expect(expressionKind("")).toBe("unknown");
  });

  it("offers .if only where it makes sense", () => {
    expect(templateFitsExpression(".if", "boolean")).toBe(true);
    expect(templateFitsExpression(".if", "iterable")).toBe(false);
    expect(templateFitsExpression(".if", "string")).toBe(false);
    // Not knowing is not a reason to hide it.
    expect(templateFitsExpression(".if", "unknown")).toBe(true);
  });

  it("offers .for only over something with more than one of anything", () => {
    expect(templateFitsExpression(".for", "iterable")).toBe(true);
    expect(templateFitsExpression(".for", "boolean")).toBe(false);
    expect(templateFitsExpression(".for", "number")).toBe(false);
  });

  it("does not offer a null check on a primitive", () => {
    expect(templateFitsExpression(".null", "number")).toBe(false);
    expect(templateFitsExpression(".nn", "boolean")).toBe(false);
    expect(templateFitsExpression(".null", "string")).toBe(true);
  });
});

/**
 * Syntax the project cannot compile.
 *
 * Offering `var` to a project on Java 8 produces a line that does not compile,
 * and whoever accepted it has to work out why.
 */
describe("respecting the language level", () => {
  it("keeps var out of an older project", () => {
    expect(templateFitsLanguageLevel("for (var item : items) {}", 8)).toBe(false);
    expect(templateFitsLanguageLevel("for (var item : items) {}", 11)).toBe(true);
    expect(templateFitsLanguageLevel("for (var item : items) {}", 21)).toBe(true);
  });

  it("keeps the arrow switch out of one older than fourteen", () => {
    const arrow = "switch (value) {\n\tcase 1 -> x;\n}";
    expect(templateFitsLanguageLevel(arrow, 11)).toBe(false);
    expect(templateFitsLanguageLevel(arrow, 17)).toBe(true);
  });

  it("assumes a current language when it is not told", () => {
    expect(templateFitsLanguageLevel("for (var item : items) {}", 0)).toBe(true);
    expect(templateFitsLanguageLevel("for (var item : items) {}", Number.NaN)).toBe(true);
  });

  it("leaves ordinary syntax alone at any level", () => {
    expect(templateFitsLanguageLevel("System.out.println(x);", 8)).toBe(true);
  });
});

describe("not saying the same thing twice", () => {
  it("drops a template the server already offers", () => {
    const kiwi = [{ label: "sout" }, { label: ".if" }];
    const kept = withoutServerDuplicates(kiwi, ["sout", "fori"], (item) => item.label);
    expect(kept.map((item) => item.label)).toEqual([".if"]);
  });

  it("compares names the way a person would", () => {
    expect(normalizeTemplateName(".If ")).toBe("if");
    expect(normalizeTemplateName("sout")).toBe("sout");
    const kept = withoutServerDuplicates([{ label: ".if" }], ["If"], (item) => item.label);
    expect(kept).toHaveLength(0);
  });

  it("keeps everything when the server has proposed nothing", () => {
    const kiwi = [{ label: "sout" }, { label: "fori" }];
    expect(withoutServerDuplicates(kiwi, [], (item) => item.label)).toHaveLength(2);
  });
});

describe("reading a Java version", () => {
  it("understands the three ways Java writes its own", () => {
    expect(javaReleaseNumber("21")).toBe(21);
    expect(javaReleaseNumber("17.0.9")).toBe(17);
    // The old scheme, where 1.8 is Java 8.
    expect(javaReleaseNumber("1.8")).toBe(8);
    expect(javaReleaseNumber("1.8.0_402")).toBe(8);
  });

  it("answers nothing rather than guessing low", () => {
    // Callers read 0 as "assume current": refusing modern syntax to a project
    // whose version simply could not be read is the more annoying mistake.
    expect(javaReleaseNumber("")).toBe(0);
    expect(javaReleaseNumber("unbekannt")).toBe(0);
    expect(templateFitsLanguageLevel("for (var x : xs) {}", javaReleaseNumber(""))).toBe(true);
  });
});

/**
 * Wrapping what is selected.
 *
 * The selection keeps its own shape: every line moves one step in and nothing
 * inside is reformatted. Wrapping code in a try block is not an invitation to
 * re-lay-out it, and a wrap that also reformats has to be read in full before
 * it can be trusted.
 */
describe("surrounding a selection", () => {
  it("indents what it wraps by one step", () => {
    const wrapped = surroundSelection("    doWork();", "try");
    expect(wrapped.split("\n")[0]).toBe("    try {");
    expect(wrapped).toContain("        doWork();");
  });

  it("gives a try the catch it needs to compile", () => {
    const wrapped = surroundSelection("    doWork();", "try");
    expect(wrapped).toContain("} catch (");
  });

  it("puts the block where the code already was", () => {
    const wrapped = surroundSelection("\t\tvalue++;", "if");
    expect(wrapped.startsWith("\t\tif (")).toBe(true);
    expect(wrapped.trimEnd().endsWith("\t\t}")).toBe(true);
  });

  it("keeps the shape of what it wrapped", () => {
    const selection = ["    first();", "", "    if (x) {", "        second();", "    }"].join("\n");
    const wrapped = surroundSelection(selection, "synchronized");
    // Relative indentation inside the selection is untouched, and a blank line
    // stays blank rather than becoming an indented empty one.
    expect(wrapped).toContain("        first();");
    expect(wrapped).toContain("            second();");
    expect(wrapped.split("\n")).toContain("");
  });

  it("offers every way it can wrap", () => {
    for (const kind of SURROUND_KINDS) {
      expect(surroundSelection("    x();", kind)).toContain("    x();".trim());
      expect(SURROUND_LABELS[kind]).toBeTruthy();
    }
  });

  it("survives an empty selection", () => {
    expect(() => surroundSelection("", "if")).not.toThrow();
  });
});
