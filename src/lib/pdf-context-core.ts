import type { DocumentContext, PdfPageText } from "./types";

export const DOCUMENT_CONTEXT_VERSION = 1;

export type TextPiece = {
  str?: string;
  hasEOL?: boolean;
};

function needsSpace(left: string, right: string) {
  if (!left || !right) return false;
  if (/[-/([{“‘]$/.test(left) || /^[,.;:!?%)\]}，。；：！？、”’]/.test(right)) return false;
  if (/\p{Script=Han}$/u.test(left) && /^\p{Script=Han}/u.test(right)) return false;
  return true;
}

export function textItemsToLines(items: TextPiece[]) {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    const value = String(item.str ?? "").replace(/[\u0000-\u001f]+/g, " ").trim();
    if (value) line += `${needsSpace(line, value) ? " " : ""}${value}`;
    if (item.hasEOL && line.trim()) {
      lines.push(line.trim());
      line = "";
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function marginKey(line: string) {
  return line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

export function cleanExtractedPages(rawPages: Array<{ page: number; lines: string[] }>): PdfPageText[] {
  const counts = new Map<string, number>();
  for (const page of rawPages) {
    const margins = [...page.lines.slice(0, 1), ...page.lines.slice(-1)];
    for (const key of new Set(margins.map(marginKey).filter((key) => key.length >= 4))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const repeatThreshold = Math.max(3, Math.ceil(rawPages.length * 0.3));
  return rawPages.map(({ page, lines }) => {
    const filtered = lines.filter((line, index) => {
      const atMargin = index === 0 || index === lines.length - 1;
      if (atMargin && /^(?:page\s*)?\d+(?:\s*\/\s*\d+)?$/i.test(line.trim())) return false;
      return !atMargin || (counts.get(marginKey(line)) ?? 0) < repeatThreshold;
    });
    const text = filtered
      .join("\n")
      .replace(/([\p{L}\p{N}])[-‐‑]\s*\n\s*(?=[\p{Ll}])/gu, "$1")
      .replace(/(?<![.!?。！？:：;；])\n(?=\S)/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { page, text };
  });
}

export function validDocumentContext(value: unknown, pageCount?: number): value is DocumentContext {
  if (!value || typeof value !== "object") return false;
  const context = value as DocumentContext;
  return (
    context.version === DOCUMENT_CONTEXT_VERSION &&
    Array.isArray(context.pages) &&
    context.pages.length === context.pageCount &&
    (!pageCount || context.pageCount === pageCount) &&
    context.pages.every((item, index) => item.page === index + 1 && typeof item.text === "string")
  );
}
