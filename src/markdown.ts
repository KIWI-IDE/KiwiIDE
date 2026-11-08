/**
 * Enough Markdown to read a README with.
 *
 * Not a complete CommonMark implementation and not trying to be: what a Java
 * project's documentation actually uses is headings, paragraphs, lists, fenced
 * code, tables, quotes, rules and the four inline forms. That is a few hundred
 * lines, which is cheaper than a dependency and leaves nothing to keep updated.
 *
 * It produces a tree, never a string of HTML. A README is a file like any
 * other, often one that arrived with somebody else's repository, and handing
 * its contents to `innerHTML` would make `<img onerror=…>` in a readme a way
 * into the workbench. Rendering the tree as React elements makes that
 * impossible rather than merely unlikely.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "emphasis"; children: Inline[] }
  | { kind: "strike"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; src: string; alt: string };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][]; align: Array<"left" | "center" | "right" | null> }
  | { kind: "rule" };

/** A fence opening or closing: ``` or ~~~, with an optional language. */
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`]*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])\s*(?:\1\s*){2,}$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** The cells of one table row, without the pipes that separate them. */
function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

/** `:---`, `:---:` and `---:` say which way a column is set. */
function columnAlignment(cell: string): "left" | "center" | "right" | null {
  const left = cell.trim().startsWith(":");
  const right = cell.trim().endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * An address a preview may follow.
 *
 * A README in a repository nobody wrote can carry `javascript:` in a link, and
 * a preview that renders it hands the workbench's own context to whoever wrote
 * the file. Only the schemes that mean "somewhere else" are kept; anything
 * relative stays as it is, because it points inside the project.
 */
export function safeHref(href: string): string {
  const value = href.trim();
  if (/^(https?|mailto):/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
  return value;
}

/** The inline forms, innermost last: code first so nothing inside it is read. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;

  const push = (value: string) => {
    if (!value) return;
    const previous = out[out.length - 1];
    if (previous?.kind === "text") previous.text += value;
    else out.push({ kind: "text", text: value });
  };

  while (rest.length) {
    const code = /^`+/.exec(rest);
    if (code) {
      const ticks = code[0];
      const end = rest.indexOf(ticks, ticks.length);
      if (end > 0) {
        out.push({ kind: "code", text: rest.slice(ticks.length, end) });
        rest = rest.slice(end + ticks.length);
        continue;
      }
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/.exec(rest);
    if (image) {
      out.push({ kind: "image", src: safeHref(image[2]), alt: image[1] });
      rest = rest.slice(image[0].length);
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]*)[^)]*\)/.exec(rest);
    if (link) {
      out.push({ kind: "link", href: safeHref(link[2]), children: parseInline(link[1]) });
      rest = rest.slice(link[0].length);
      continue;
    }

    const strong = /^(\*\*|__)([\s\S]+?)\1/.exec(rest);
    if (strong) {
      out.push({ kind: "strong", children: parseInline(strong[2]) });
      rest = rest.slice(strong[0].length);
      continue;
    }

    const strike = /^~~([\s\S]+?)~~/.exec(rest);
    if (strike) {
      out.push({ kind: "strike", children: parseInline(strike[1]) });
      rest = rest.slice(strike[0].length);
      continue;
    }

    const emphasis = /^(\*|_)([^\s*_][\s\S]*?)\1/.exec(rest);
    if (emphasis) {
      out.push({ kind: "emphasis", children: parseInline(emphasis[2]) });
      rest = rest.slice(emphasis[0].length);
      continue;
    }

    const bare = /^<((?:https?|mailto):[^>\s]+)>/.exec(rest);
    if (bare) {
      out.push({ kind: "link", href: safeHref(bare[1]), children: [{ kind: "text", text: bare[1] }] });
      rest = rest.slice(bare[0].length);
      continue;
    }

    if (rest.startsWith("\\") && rest.length > 1) {
      push(rest[1]);
      rest = rest.slice(2);
      continue;
    }

    push(rest[0]);
    rest = rest.slice(1);
  }

  return out;
}

/** The document, as blocks. */
export function parseMarkdown(source: string): Block[] {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  const paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    // Two trailing spaces are Markdown's hard break; the renderer keeps the
    // newline and the stylesheet does the rest.
    const text = paragraph.join("\n").replace(/ {2,}\n/g, "\n");
    paragraph.length = 0;
    blocks.push({ kind: "paragraph", children: parseInline(text) });
  };

  while (index < lines.length) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[2][0];
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closing = FENCE.exec(lines[index]);
        if (closing && closing[2][0] === marker && closing[2].length >= fence[2].length && !closing[3].trim()) {
          index += 1;
          break;
        }
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[3].trim(), text: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }

    // Setext: a line of === or --- under text is a heading, which is how most
    // generated READMEs write their title.
    const underline = /^ {0,3}(=+|-+)\s*$/.exec(lines[index + 1] || "");
    if (underline && paragraph.length === 0 && line.trim() && !BULLET.test(line) && !ORDERED.test(line)) {
      blocks.push({ kind: "heading", level: underline[1][0] === "=" ? 1 : 2, children: parseInline(line.trim()) });
      index += 2;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body: string[] = [];
      while (index < lines.length) {
        const inner = QUOTE.exec(lines[index]);
        if (!inner) break;
        body.push(inner[1]);
        index += 1;
      }
      blocks.push({ kind: "quote", blocks: parseMarkdown(body.join("\n")) });
      continue;
    }

    if (TABLE_DIVIDER.test(lines[index + 1] || "") && line.includes("|")) {
      flush();
      const header = tableCells(line).map(parseInline);
      const align = tableCells(lines[index + 1]).map(columnAlignment);
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = Boolean(ordered);
      const start = ordered ? Number(ordered[2]) : 1;
      const items: Block[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const entry = isOrdered ? ORDERED.exec(current) : BULLET.exec(current);
        if (!entry) {
          // A blank line inside a list keeps the list going; two end it.
          if (!current.trim() && (lines[index + 1] || "").trim()
            && (isOrdered ? ORDERED.test(lines[index + 1]) : BULLET.test(lines[index + 1]))) {
            index += 1;
            continue;
          }
          break;
        }
        const indent = entry[1].length;
        const body = [entry[3]];
        index += 1;
        // Continuation lines belong to the item: indented further, or plain
        // text under it that is not the start of the next item.
        while (index < lines.length) {
          const next = lines[index];
          if (!next.trim()) break;
          const nextIndent = /^\s*/.exec(next)![0].length;
          if ((BULLET.test(next) || ORDERED.test(next)) && nextIndent <= indent) break;
          body.push(next.replace(new RegExp(`^ {0,${indent + 2}}`), ""));
          index += 1;
        }
        items.push(parseMarkdown(body.join("\n")));
      }
      blocks.push({ kind: "list", ordered: isOrdered, start, items });
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }

  flush();
  return blocks;
}
