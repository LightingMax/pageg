import type { ElementType, ReactNode } from "react";
import { renderToString } from "katex";
import "katex/dist/katex.min.css";

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | {
      kind: "table";
      headers: string[];
      align: Array<"left" | "center" | "right">;
      rows: string[][];
    }
  | { kind: "code"; language: string; text: string }
  | { kind: "rule" }
  | { kind: "math"; text: string };

function mathNode(source: string, display: boolean, key: string): ReactNode {
  try {
    const html = renderToString(source.trim(), {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
    return (
      <span
        key={key}
        className={display ? "md-math md-math-display" : "md-math"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return <code key={key}>{source}</code>;
  }
}

function findClosing(text: string, marker: string, from: number) {
  let at = from;
  while ((at = text.indexOf(marker, at)) >= 0) {
    let slashes = 0;
    for (let i = at - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1;
    if (slashes % 2 === 0) return at;
    at += marker.length;
  }
  return -1;
}

function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  let index = 0;
  let key = 0;
  const flush = () => {
    if (!plain) return;
    nodes.push(plain);
    plain = "";
  };
  const add = (node: ReactNode) => {
    flush();
    nodes.push(node);
    key += 1;
  };

  while (index < text.length) {
    if (text[index] === "\n") {
      flush();
      nodes.push(<br key={`${prefix}-br-${key++}`} />);
      index += 1;
      continue;
    }

    if (text.startsWith("$$", index)) {
      const end = findClosing(text, "$$", index + 2);
      if (end > index + 2) {
        add(mathNode(text.slice(index + 2, end), true, `${prefix}-math-${key}`));
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith("\\(", index)) {
      const end = findClosing(text, "\\)", index + 2);
      if (end > index + 2) {
        add(mathNode(text.slice(index + 2, end), false, `${prefix}-math-${key}`));
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "$" && text[index + 1] !== "$" && !/\s/.test(text[index + 1] ?? "")) {
      const end = findClosing(text, "$", index + 1);
      if (end > index + 1 && !/\s/.test(text[end - 1] ?? "")) {
        add(mathNode(text.slice(index + 1, end), false, `${prefix}-math-${key}`));
        index = end + 1;
        continue;
      }
    }

    const codeEnd = text[index] === "`" && !text.startsWith("``", index) ? text.indexOf("`", index + 1) : -1;
    if (codeEnd > index + 1) {
      add(<code key={`${prefix}-code-${key}`}>{text.slice(index + 1, codeEnd)}</code>);
      index = codeEnd + 1;
      continue;
    }

    const styles = [
      ["**", "**", "strong"],
      ["__", "__", "strong"],
      ["~~", "~~", "del"],
      ["*", "*", "em"],
      ["_", "_", "em"],
    ] as const;
    let styled = false;
    for (const [open, close, kind] of styles) {
      if (!text.startsWith(open, index) || (open.length === 1 && text[index + 1] === " ")) continue;
      const end = text.indexOf(close, index + open.length);
      if (end <= index + open.length) continue;
      const content = renderInline(text.slice(index + open.length, end), `${prefix}-${key}`);
      const Tag = kind === "strong" ? "strong" : kind === "del" ? "del" : "em";
      add(<Tag key={`${prefix}-style-${key}`}>{content}</Tag>);
      index = end + close.length;
      styled = true;
      break;
    }
    if (styled) continue;

    if (text[index] === "[") {
      const labelEnd = text.indexOf("](", index + 1);
      const urlEnd = labelEnd >= 0 ? text.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd > index + 1 && urlEnd > labelEnd + 2) {
        const url = text.slice(labelEnd + 2, urlEnd).trim();
        if (/^(https?:\/\/|#)/i.test(url)) {
          add(
            <a key={`${prefix}-link-${key}`} href={url} target="_blank" rel="noreferrer">
              {renderInline(text.slice(index + 1, labelEnd), `${prefix}-${key}`)}
            </a>,
          );
          index = urlEnd + 1;
          continue;
        }
      }
    }

    plain += text[index];
    index += 1;
  }
  flush();
  return nodes;
}

function isBlockStart(line: string) {
  return (
    /^\s*(```|~~~)/.test(line) ||
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
  );
}

function splitTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const withoutEdges = trimmed.replace(/^\|\s*/, "").replace(/\s*\|$/, "");
  const cells = withoutEdges.split("|").map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function tableAlignment(cell: string): "left" | "center" | "right" | null {
  const value = cell.trim();
  if (!/^:?-{3,}:?$/.test(value)) return null;
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
}

function parseBlocks(value: string): Block[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const fence = lines[index].match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language: fence[2], text: code.join("\n") });
      continue;
    }
    const heading = lines[index].match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^\s*>/.test(lines[index])) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }
    const unordered = lines[index].match(/^\s*[-*+]\s+(.+)$/);
    const ordered = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const match = orderedList
          ? lines[index].match(/^\s*\d+[.)]\s+(.+)$/)
          : lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: orderedList, items });
      continue;
    }
    if (/^\s*\$\$/.test(lines[index]) && lines[index].trim().endsWith("$$")) {
      blocks.push({ kind: "math", text: lines[index].trim().slice(2, -2) });
      index += 1;
      continue;
    }
    const tableHeader = splitTableRow(lines[index]);
    const tableDivider = index + 1 < lines.length ? splitTableRow(lines[index + 1]) : null;
    if (tableHeader && tableDivider && tableDivider.length === tableHeader.length && tableDivider.every((cell) => tableAlignment(cell) !== null)) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = splitTableRow(lines[index]);
        if (!row || row.length !== tableHeader.length) break;
        rows.push(row);
        index += 1;
      }
      blocks.push({
        kind: "table",
        headers: tableHeader,
        align: tableDivider.map((cell) => tableAlignment(cell) ?? "left"),
        rows,
      });
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[index])) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

export default function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="md-content">
      {parseBlocks(text).map((block, index) => {
        const key = `block-${index}`;
        if (block.kind === "heading") {
          const Tag = `h${block.level}` as ElementType;
          return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
        }
        if (block.kind === "quote") return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return <Tag key={key}>{block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</Tag>;
        }
        if (block.kind === "code") {
          return (
            <pre key={key}>
              {block.language && <span className="md-code-language">{block.language}</span>}
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "table") {
          return (
            <div key={key} className="md-table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, column) => (
                      <th key={`${key}-head-${column}`} style={{ textAlign: block.align[column] }}>
                        {renderInline(header, `${key}-head-${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${rowIndex}`}>
                      {row.map((cell, column) => (
                        <td key={`${key}-cell-${rowIndex}-${column}`} style={{ textAlign: block.align[column] }}>
                          {renderInline(cell, `${key}-${rowIndex}-${column}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === "math") return <div key={key} className="md-math-block">{mathNode(block.text, true, key)}</div>;
        if (block.kind === "rule") return <hr key={key} />;
        return <p key={key}>{renderInline(block.text, key)}</p>;
      })}
    </div>
  );
}
