import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { useMemo } from "react";
import { parseMarkdown, type Block, type Inline } from "../markdown";
import { t } from "../i18n";

/**
 * A README, rendered.
 *
 * The tree comes from the parser and is turned into React elements here —
 * never into a string of HTML. That is what makes a readme from somebody
 * else's repository safe to look at: there is no point in this file where
 * text from the document could become markup.
 *
 * Pictures are deliberately not loaded. A remote one is a request to whoever
 * hosts it the moment a preview opens, which turns reading a readme into
 * telling a stranger that you did; a local one would need the renderer to be
 * allowed to read arbitrary files. Both are shown as what they are instead.
 */
export function MarkdownPreview({
  text,
  onOpenRelative,
}: {
  text: string;
  /** A link inside the project. Without it such links are shown, not followed. */
  onOpenRelative?: (target: string) => void;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  return (
    <div className="markdown-preview">
      {blocks.length === 0 && <p className="markdown-empty">{t("Das Dokument ist leer.")}</p>}
      {blocks.map((block, index) => renderBlock(block, `b${index}`, onOpenRelative))}
    </div>
  );
}

function renderBlock(block: Block, key: string, onOpenRelative?: (target: string) => void): JSX.Element {
  switch (block.kind) {
    case "heading": {
      // The level is a number from the document, so the tag is chosen rather
      // than built: `h${level}` would take whatever a malformed file said.
      const children = renderInline(block.children, key, onOpenRelative);
      const level = Math.min(6, Math.max(1, block.level));
      if (level === 1) return <h1 key={key}>{children}</h1>;
      if (level === 2) return <h2 key={key}>{children}</h2>;
      if (level === 3) return <h3 key={key}>{children}</h3>;
      if (level === 4) return <h4 key={key}>{children}</h4>;
      if (level === 5) return <h5 key={key}>{children}</h5>;
      return <h6 key={key}>{children}</h6>;
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.children, key, onOpenRelative)}</p>;
    case "code":
      return (
        <pre key={key} className="markdown-code" data-language={block.language || undefined}>
          {block.language && <span className="markdown-code-language">{block.language}</span>}
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key}>
          {block.blocks.map((inner, index) => renderBlock(inner, `${key}-${index}`, onOpenRelative))}
        </blockquote>
      );
    case "rule":
      return <hr key={key} />;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={`${key}-${index}`}>
          {item.map((inner, position) => renderBlock(inner, `${key}-${index}-${position}`, onOpenRelative))}
        </li>
      ));
      return block.ordered
        ? <ol key={key} start={block.start}>{items}</ol>
        : <ul key={key}>{items}</ul>;
    }
    case "table":
      return (
        /* Its own scroller: a wide table must not push the document sideways. */
        <div key={key} className="markdown-table-scroll">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} style={{ textAlign: block.align[index] || undefined }}>
                    {renderInline(cell, `${key}-h${index}`, onOpenRelative)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={{ textAlign: block.align[index] || undefined }}>
                      {renderInline(cell, `${key}-${rowIndex}-${index}`, onOpenRelative)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function renderInline(nodes: Inline[], key: string, onOpenRelative?: (target: string) => void): JSX.Element[] {
  return nodes.map((node, index) => {
    const own = `${key}-i${index}`;
    switch (node.kind) {
      case "text":
        return <span key={own}>{node.text}</span>;
      case "code":
        return <code key={own}>{node.text}</code>;
      case "strong":
        return <strong key={own}>{renderInline(node.children, own, onOpenRelative)}</strong>;
      case "emphasis":
        return <em key={own}>{renderInline(node.children, own, onOpenRelative)}</em>;
      case "strike":
        return <s key={own}>{renderInline(node.children, own, onOpenRelative)}</s>;
      case "image":
        return (
          <span key={own} className="markdown-image" title={node.src || undefined}>
            <ImageIcon size={12} /> {node.alt || t("Bild")}
          </span>
        );
      case "link": {
        const children = renderInline(node.children, own, onOpenRelative);
        if (!node.href) {
          // The parser refused the address. Showing the words without making
          // them clickable is more honest than hiding the link entirely.
          return <span key={own} className="markdown-dead-link" title={t("Adresse nicht erlaubt")}>{children}</span>;
        }
        const external = /^(https?|mailto):/i.test(node.href);
        return (
          <button
            key={own}
            type="button"
            className="markdown-link"
            title={node.href}
            onClick={() => {
              if (external) void window.kiwi?.app.openExternal(node.href).catch(() => undefined);
              else onOpenRelative?.(node.href);
            }}
          >
            {children}
            {external && <ExternalLink size={10} />}
          </button>
        );
      }
    }
  });
}
