import { describe, expect, it } from "vitest";
import {
  EXPRESSION_PLACEHOLDER,
  expandPostfixTemplate,
  isProjectTemplateFile,
  mergeCustomTemplates,
  parseCustomTemplates,
  templateFileExample,
  type CustomTemplate,
} from "../src/language/custom-templates";
import { javaTemplates } from "../src/language/completion-controller";

const file = (templates: unknown[]) => JSON.stringify({ version: 1, templates });

const live = (over: Record<string, unknown> = {}) => ({
  key: "logd",
  source: "live",
  detail: "Debug-Log",
  insertText: "log.debug(\"x\");",
  ...over,
});

const postfix = (over: Record<string, unknown> = {}) => ({
  key: "opt",
  source: "postfix",
  detail: "In ein Optional verpacken",
  insertText: `Optional.ofNullable(${EXPRESSION_PLACEHOLDER})`,
  ...over,
});

/**
 * Reading a file somebody typed by hand.
 *
 * The rule throughout: forgiving about the file, unforgiving about one entry.
 * A template with a typo in it must not take the other nine with it, and it
 * must not disappear quietly either — a template that is not offered and says
 * nothing about why looks like the feature is broken.
 */
describe("reading a project's templates", () => {
  it("reads the documented shape", () => {
    const report = parseCustomTemplates(file([live(), postfix()]));
    expect(report.problems).toEqual([]);
    expect(report.templates.map((template) => template.key)).toEqual(["logd", ".opt"]);
  });

  it("reads a bare array, because that is what people write", () => {
    const report = parseCustomTemplates(JSON.stringify([live()]));
    expect(report.templates).toHaveLength(1);
    expect(report.problems).toEqual([]);
  });

  it("treats an empty file as no templates rather than as a problem", () => {
    expect(parseCustomTemplates("")).toEqual({ templates: [], problems: [] });
    expect(parseCustomTemplates("   \n")).toEqual({ templates: [], problems: [] });
  });

  it("keeps the good entries when one is broken", () => {
    const report = parseCustomTemplates(file([live(), { key: "kaputt" }, postfix()]));
    expect(report.templates.map((template) => template.key)).toEqual(["logd", ".opt"]);
    expect(report.problems).toHaveLength(1);
  });

  it("says which entry it could not read", () => {
    const report = parseCustomTemplates(file([live({ key: "mit leerzeichen" })]));
    expect(report.problems[0]).toContain("mit leerzeichen");
    expect(report.templates).toEqual([]);
  });

  it("explains a broken file instead of losing it", () => {
    const report = parseCustomTemplates("{ nicht wirklich json");
    expect(report.templates).toEqual([]);
    expect(report.problems[0]).toContain("JSON");
  });

  it("refuses a postfix template that would delete the expression", () => {
    // Without the placeholder the insertion replaces `value.` with text that
    // does not contain `value` — the template eats what it was applied to.
    const report = parseCustomTemplates(file([postfix({ insertText: "Optional.empty()" })]));
    expect(report.templates).toEqual([]);
    expect(report.problems[0]).toContain(EXPRESSION_PLACEHOLDER);
  });

  it("takes a postfix key with or without its dot", () => {
    const report = parseCustomTemplates(file([postfix({ key: ".opt" }), postfix({ key: "wrap" })]));
    expect(report.templates.map((template) => template.key)).toEqual([".opt", ".wrap"]);
  });

  it("keeps the first of two entries with the same name and says so", () => {
    const report = parseCustomTemplates(file([live({ detail: "erste" }), live({ detail: "zweite" })]));
    expect(report.templates).toHaveLength(1);
    expect(report.templates[0].detail).toBe("erste");
    expect(report.problems[0]).toContain("doppelt");
  });

  it("does not confuse a live and a postfix template of the same name", () => {
    const report = parseCustomTemplates(file([live({ key: "opt" }), postfix({ key: "opt" })]));
    expect(report.templates).toHaveLength(2);
    expect(report.problems).toEqual([]);
  });

  it("fills in what was left out", () => {
    const report = parseCustomTemplates(file([{ key: "x", source: "live", insertText: "x();" }]));
    expect(report.templates[0]).toMatchObject({ label: "x", detail: "Projekt-Template" });
  });

  it("rejects a when it does not understand rather than ignoring it", () => {
    const report = parseCustomTemplates(file([postfix({ when: "vielleicht" })]));
    expect(report.templates).toEqual([]);
    expect(report.problems[0]).toContain("when");
  });

  it("reads the example it writes into a new project", () => {
    const report = parseCustomTemplates(templateFileExample());
    expect(report.problems).toEqual([]);
    expect(report.templates.length).toBeGreaterThan(0);
  });
});

describe("putting the expression into a template", () => {
  it("replaces every occurrence, so a template may use it twice", () => {
    const both = `${EXPRESSION_PLACEHOLDER} == null ? leer : ${EXPRESSION_PLACEHOLDER}`;
    expect(expandPostfixTemplate(both, "player.name()"))
      .toBe("player.name() == null ? leer : player.name()");
  });

  it("leaves a template without the placeholder alone", () => {
    expect(expandPostfixTemplate("x();", "player")).toBe("x();");
  });
});

/**
 * Which of two templates with one name wins.
 *
 * Somebody who wrote their own `sout` wants theirs. Two entries under one name
 * is a list asking a question nobody meant to ask.
 */
describe("a project template against a built-in one", () => {
  const builtIn = [
    { key: "sout", source: "live", label: "sout", detail: "eingebaut", insertText: "a" },
    { key: "psvm", source: "live", label: "psvm", detail: "eingebaut", insertText: "b" },
  ];

  it("replaces the built-in of the same name", () => {
    const merged = mergeCustomTemplates(builtIn, [
      { key: "sout", source: "live", label: "sout", detail: "eigen", insertText: "c" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((template) => template.key === "sout")?.detail).toBe("eigen");
  });

  it("puts the project's own first", () => {
    const merged = mergeCustomTemplates(builtIn, [
      { key: "logd", source: "live", label: "logd", detail: "eigen", insertText: "c" },
    ]);
    expect(merged[0].key).toBe("logd");
    expect(merged).toHaveLength(3);
  });

  it("matches a postfix name with its dot against one without", () => {
    const merged = mergeCustomTemplates(
      [{ key: ".if", source: "postfix", label: ".if", detail: "eingebaut", insertText: "a" }],
      [{ key: ".if", source: "postfix", label: ".if", detail: "eigen", insertText: "b" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].detail).toBe("eigen");
  });
});

/**
 * The templates as the completion list sees them.
 */
describe("offering a project's templates", () => {
  const custom = parseCustomTemplates(file([
    live(),
    postfix(),
    postfix({ key: "each", when: "iterable", insertText: `for (var item : ${EXPRESSION_PLACEHOLDER}) {}` }),
  ])).templates as CustomTemplate[];

  it("offers a live template where a live template belongs", () => {
    const offered = javaTemplates("    ", { customTemplates: custom });
    expect(offered.map((template) => template.key)).toContain("logd");
  });

  it("offers a postfix template after a dot, with the expression in it", () => {
    const offered = javaTemplates("    player.", { customTemplates: custom });
    const found = offered.find((template) => template.key === ".opt");
    expect(found?.insertText).toBe("Optional.ofNullable(player)");
  });

  it("narrows to what has been typed after the dot", () => {
    const keys = javaTemplates("    player.op", { customTemplates: custom }).map((item) => item.key);
    expect(keys).toContain(".opt");
    expect(keys).not.toContain(".if");
  });

  it("hides a template whose expression kind does not match", () => {
    // `.each` said it is for sequences, and a boolean is not one.
    const keys = javaTemplates("    isReady().", { customTemplates: custom }).map((item) => item.key);
    expect(keys).not.toContain(".each");
    const overList = javaTemplates("    players.", { customTemplates: custom }).map((item) => item.key);
    expect(overList).toContain(".each");
  });

  it("still offers it when Kiwi cannot tell what the expression is", () => {
    // The same bias the built-ins have: hiding a template somebody wrote
    // themselves is the more confusing mistake.
    const keys = javaTemplates("    player.", { customTemplates: custom }).map((item) => item.key);
    expect(keys).toContain(".each");
  });

  it("takes the language level as seriously as it does for a built-in", () => {
    const modern = parseCustomTemplates(file([
      live({ key: "vloop", insertText: "for (var item : items) {}" }),
    ])).templates as CustomTemplate[];
    expect(javaTemplates("  ", { customTemplates: modern, languageLevel: 8 }).map((item) => item.key))
      .not.toContain("vloop");
    expect(javaTemplates("  ", { customTemplates: modern, languageLevel: 17 }).map((item) => item.key))
      .toContain("vloop");
  });

  it("does not repeat a template the language server already offers", () => {
    const offered = javaTemplates("  ", { customTemplates: custom, serverLabels: ["logd"] });
    expect(offered.map((template) => template.key)).not.toContain("logd");
  });

  it("behaves exactly as before when the project has none", () => {
    expect(javaTemplates("    player.", { customTemplates: [] }).map((item) => item.key))
      .toEqual(javaTemplates("    player.").map((item) => item.key));
  });
});

/**
 * Recognising the file after it has been saved.
 *
 * The same file reaches the workbench spelled three ways, and one of those
 * spells the Windows drive letter in lower case — which is what made
 * breakpoints and syntax markers vanish before this was compared properly.
 */
describe("recognising the templates file", () => {
  const root = "C:\\Projekte\\Server";

  it("knows it whichever separator the path uses", () => {
    expect(isProjectTemplateFile(root, "C:\\Projekte\\Server\\.kiwi\\templates.json")).toBe(true);
    expect(isProjectTemplateFile(root, "C:/Projekte/Server/.kiwi/templates.json")).toBe(true);
  });

  it("is not fooled by the drive letter's case", () => {
    expect(isProjectTemplateFile(root, "c:/projekte/server/.kiwi/templates.json")).toBe(true);
  });

  it("says no to anything else", () => {
    expect(isProjectTemplateFile(root, "C:/Projekte/Server/src/Main.java")).toBe(false);
    expect(isProjectTemplateFile(root, "C:/Projekte/Anderes/.kiwi/templates.json")).toBe(false);
    expect(isProjectTemplateFile(root, "C:/Projekte/Server/.kiwi/breakpoints.json")).toBe(false);
    expect(isProjectTemplateFile("", "C:/Projekte/Server/.kiwi/templates.json")).toBe(false);
    expect(isProjectTemplateFile(root, "")).toBe(false);
  });

  it("survives a root written with a trailing separator", () => {
    expect(isProjectTemplateFile("C:/Projekte/Server/", "C:/Projekte/Server/.kiwi/templates.json")).toBe(true);
  });
});
