import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { BookMetadataPatch } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfInfo = Record<string, unknown>;
type TextPiece = { str?: string; transform?: number[]; width?: number; height?: number };
export type MetadataLine = { text: string; y: number; size: number };

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function baseName(filename: string) {
  return filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function plausibleTitle(value: string, filename: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const file = baseName(filename).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return (
    value.length >= 6 &&
    value.length <= 320 &&
    normalized !== file &&
    !/^(untitled|document|microsoftword|adobeacrobat|arxiv\d+)$/i.test(normalized) &&
    !/^\d{4}[._-]\d{4,6}(v\d+)?$/i.test(baseName(value))
  );
}

function splitAuthors(value: string) {
  const cleaned = value
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡]+/g, "")
    .replace(/\s+(and|&|、)\s+/gi, ";")
    .replace(/\s*;\s*/g, ";");
  const parts = cleaned.includes(";") ? cleaned.split(";") : cleaned.split(/,\s*(?=[A-Z\p{L}])/u);
  return parts.map((part) => clean(part)).filter((part) => part.length >= 2 && part.length <= 90).slice(0, 80);
}

function linesFromPieces(items: TextPiece[]) {
  const rows = new Map<number, Array<{ text: string; x: number; size: number }>>();
  for (const item of items) {
    const text = clean(item.str);
    const transform = item.transform;
    if (!text || !transform || transform.length < 6) continue;
    const y = Math.round(transform[5] / 3) * 3;
    const x = transform[4];
    const size = Math.max(Math.abs(transform[0]), Math.abs(transform[3]), item.height ?? 0);
    const row = rows.get(y) ?? [];
    row.push({ text, x, size });
    rows.set(y, row);
  }
  return [...rows.entries()]
    .map(([y, row]) => ({
      y,
      text: clean(row.sort((a, b) => a.x - b.x).map((piece) => piece.text).join(" ")),
      size: Math.max(...row.map((piece) => piece.size)),
    }))
    .filter((line) => line.text)
    .sort((a, b) => b.y - a.y);
}

function inferredTitle(lines: MetadataLine[], filename: string, pageHeight: number) {
  const candidates = lines.filter(
    (line) =>
      line.y > pageHeight * 0.48 &&
      line.text.length >= 6 &&
      line.text.length <= 220 &&
      !/^(abstract|摘要|contents|arxiv|doi\b|http|www\.)/i.test(line.text),
  );
  if (candidates.length === 0) return "";
  const best = [...candidates].sort((a, b) => b.size * 8 + Math.min(b.text.length, 100) / 20 - (a.size * 8 + Math.min(a.text.length, 100) / 20))[0];
  const titleLines = candidates
    .filter((line) => Math.abs(line.y - best.y) < 85 && line.size >= best.size * 0.82)
    .sort((a, b) => b.y - a.y)
    .slice(0, 3);
  const title = clean(titleLines.map((line) => line.text).join(" "));
  return plausibleTitle(title, filename) ? title : "";
}

function inferredAuthors(lines: MetadataLine[], title: string) {
  if (!title) return [];
  const titleParts = new Set(title.split(/\s+/));
  const likely = lines.filter((line) => {
    const overlap = line.text.split(/\s+/).filter((word) => titleParts.has(word)).length;
    return (
      overlap < Math.max(2, line.text.split(/\s+/).length * 0.6) &&
      line.text.length >= 4 &&
      line.text.length <= 260 &&
      !/(abstract|摘要|university|institute|laboratory|department|school|college|@|doi\b|http)/i.test(line.text)
    );
  });
  const titleLine = lines.find((line) => title.includes(line.text.slice(0, 24)));
  const below = titleLine
    ? likely.filter((line) => line.y < titleLine.y && titleLine.y - line.y < 115)
    : likely.slice(1, 3);
  return splitAuthors(below.slice(0, 2).map((line) => line.text).join(";"));
}

function findDoi(value: string) {
  const found = value.match(/10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0] ?? "";
  return found.replace(/[),.;]+$/g, "");
}

function findYear(value: string) {
  return value.match(/(?:19|20)\d{2}/)?.[0] ?? "";
}

export function deriveMetadata(
  info: PdfInfo,
  lines: MetadataLine[],
  filename: string,
  pageCount: number,
  pageHeight: number,
): BookMetadataPatch {
  const embeddedTitle = clean(info.Title);
  const title = plausibleTitle(embeddedTitle, filename) ? embeddedTitle : inferredTitle(lines, filename, pageHeight) || baseName(filename);
  const embeddedAuthors = splitAuthors(clean(info.Author));
  const fullText = lines.map((line) => line.text).join(" ");
  const subject = clean(info.Subject);
  const keywordText = clean(info.Keywords);
  return {
    title,
    authors: embeddedAuthors.length > 0 ? embeddedAuthors : inferredAuthors(lines, title),
    year: findYear(clean(info.CreationDate)) || findYear(fullText) || undefined,
    doi: findDoi(`${subject} ${keywordText} ${fullText}`) || undefined,
    subject: subject || undefined,
    keywords: keywordText ? keywordText.split(/[,;]+/).map(clean).filter(Boolean).slice(0, 20) : [],
    pageCount,
    metadataStatus: "ready",
  };
}

export async function extractPdfMetadata(buffer: ArrayBuffer, filename: string): Promise<BookMetadataPatch> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const [metadata, page] = await Promise.all([pdf.getMetadata().catch(() => null), pdf.getPage(1)]);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const info = (metadata?.info ?? {}) as unknown as PdfInfo;
    return deriveMetadata(info, linesFromPieces(content.items as TextPiece[]), filename, pdf.numPages, viewport.height);
  } finally {
    await pdf.destroy();
  }
}
