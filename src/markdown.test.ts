/**
 * The Markdown subset, and the one thing it must never do.
 *
 * A README arrives with somebody else's repository. The parser produces a tree
 * rather than HTML precisely so that nothing in such a file can execute, and
 * the link tests below are the part of this file that matters most.
 */
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref, type Block, type Inline } from "./markdown";

/** The plain text of a run of inline nodes, for comparing shapes quickly. */
function flatten(nodes: Inline[]): string {
  return nodes.map((node) => {
    if (node.kind === "text" || node.kind === "code") return node.text;
    if (node.kind === "image") return node.alt;
    return flatten(node.children);
  }).join("");
}

describe("links a preview may follow", () => {
  it("refuses a scheme that would run something", () => {
    /**
     * The attack this whole design exists to prevent: a link in a readme that
     * executes in the workbench's own context when somebody clicks it.
     */
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("JavaScript:alert(1)")).toBe("");
    expect(safeHref("data:text/html,<script>")).toBe("");
    expect(safeHref("vbscript:msgbox")).toBe("");
    expect(safeHref("file:///C:/Windows")).toBe("");
  });

  it("keeps the ones that mean somewhere else, and relative paths", () => {
    expect(safeHref("https://kiwi.example/doc")).toBe("https://kiwi.example/doc");
    expect(safeHref("mailto:robin@example.de")).toBe("mailto:robin@example.de");
    // Relative is a path inside the project, which is the common case in a
    // README and carries no scheme to abuse.
    expect(safeHref("./CONTRIBUTING.md")).toBe("./CONTRIBUTING.md");
    expect(safeHref("docs/build.md#gradle")).toBe("docs/build.md#gradle");
  });

  it("strips the scheme out of an image too", () => {
    const [node] = parseInline("![logo](javascript:alert(1))");
    expect(node).toEqual({ kind: "image", src: "", alt: "logo" });
  });
});

describe("inline forms", () => {
  it("reads code spans before anything inside them", () => {
    // `**` inside backticks is two asterisks, not emphasis.
    const nodes = parseInline("Nutze `mvn **clean**` zum Bauen");
    expect(nodes[1]).toEqual({ kind: "code", text: "mvn **clean**" });
  });

  it("reads bold, italic, struck-through and links", () => {
    expect(parseInline("**fett**")[0].kind).toBe("strong");
    expect(parseInline("_kursiv_")[0].kind).toBe("emphasis");
    expect(parseInline("~~weg~~")[0].kind).toBe("strike");
    const [link] = parseInline("[Kiwi](https://kiwi.example)");
    expect(link).toMatchObject({ kind: "link", href: "https://kiwi.example" });
  });

  it("leaves an escaped character as itself", () => {
    expect(flatten(parseInline("\\*kein Stern\\*"))).toBe("*kein Stern*");
  });

  it("does not take a lone asterisk for emphasis", () => {
    expect(flatten(parseInline("3 * 4 * 5"))).toBe("3 * 4 * 5");
  });
});

describe("blocks", () => {
  it("reads both ways of writing a heading", () => {
    const blocks = parseMarkdown("# Kiwi IDE\n\nTitel\n=====\n\n## Bauen");
    const headings = blocks.filter((block): block is Extract<Block, { kind: "heading" }> => block.kind === "heading");
    expect(headings.map((block) => block.level)).toEqual([1, 1, 2]);
    expect(flatten(headings[1].children)).toBe("Titel");
  });

  it("keeps a fenced block exactly as written", () => {
    /**
     * Everything inside a fence is text: a `#` there is a comment in the code,
     * not a heading, and indentation is the whole point of showing it.
     */
    const [block] = parseMarkdown("```java\npublic class A {\n    # nicht\n}\n```");
    expect(block).toEqual({
      kind: "code",
      language: "java",
      text: "public class A {\n    # nicht\n}",
    });
  });

  it("reads a list, and the text that belongs under an item", () => {
    const [block] = parseMarkdown("- erstens\n  noch dazu\n- zweitens");
    expect(block.kind).toBe("list");
    if (block.kind !== "list") return;
    expect(block.ordered).toBe(false);
    expect(block.items).toHaveLength(2);
    expect(flatten((block.items[0][0] as Extract<Block, { kind: "paragraph" }>).children)).toBe("erstens\nnoch dazu");
  });

  it("remembers where a numbered list starts", () => {
    const [block] = parseMarkdown("3. drei\n4. vier");
    expect(block).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("reads a table with its column alignment", () => {
    const [block] = parseMarkdown("| Name | Zahl |\n|:-----|-----:|\n| eins | 1 |");
    expect(block.kind).toBe("table");
    if (block.kind !== "table") return;
    expect(block.align).toEqual(["left", "right"]);
    expect(flatten(block.header[0])).toBe("Name");
    expect(flatten(block.rows[0][1])).toBe("1");
  });

  it("reads a quote as blocks of its own", () => {
    const [block] = parseMarkdown("> ## Achtung\n> Nicht im Produktivbetrieb.");
    expect(block.kind).toBe("quote");
    if (block.kind !== "quote") return;
    expect(block.blocks[0].kind).toBe("heading");
  });

  it("reads a horizontal rule, and does not mistake a list for one", () => {
    expect(parseMarkdown("---")[0]).toEqual({ kind: "rule" });
    expect(parseMarkdown("***")[0]).toEqual({ kind: "rule" });
    expect(parseMarkdown("- eins")[0].kind).toBe("list");
  });

  it("separates paragraphs on a blank line", () => {
    const blocks = parseMarkdown("Erster Absatz.\n\nZweiter Absatz.");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.kind === "paragraph")).toBe(true);
  });

  it("survives an unterminated fence instead of losing the rest", () => {
    // A README with a typo in it still has to render; everything after the
    // opening fence is simply code.
    const blocks = parseMarkdown("Vorher\n\n```java\nkein Ende");
    expect(blocks[1]).toMatchObject({ kind: "code", text: "kein Ende" });
  });

  it("handles an empty document", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});
