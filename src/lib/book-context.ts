import { sanitizeAnswer } from "./answer";
import type { BookDigest, BookRecord, DocumentContext, PdfPageText } from "./types";

export const BOOK_DIGEST_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 18_000;

export type PageChunk = { startPage: number; endPage: number; text: string };

function splitLongPage(page: PdfPageText, maxChars: number) {
  const pieces: PageChunk[] = [];
  let rest = page.text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = Math.max(window.lastIndexOf("。"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
    const at = cut > maxChars * 0.55 ? cut + 1 : maxChars;
    pieces.push({ startPage: page.page, endPage: page.page, text: rest.slice(0, at).trim() });
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push({ startPage: page.page, endPage: page.page, text: rest });
  return pieces;
}

export function chunkDocument(pages: PdfPageText[], maxChars = DEFAULT_CHUNK_SIZE): PageChunk[] {
  const chunks: PageChunk[] = [];
  let current: PageChunk | null = null;
  const append = (part: PageChunk) => {
    const labeled = `【第 ${part.startPage}${part.endPage === part.startPage ? "" : `–${part.endPage}`} 页】\n${part.text}`;
    if (!current) {
      current = { ...part, text: labeled };
    } else if (current.text.length + labeled.length + 2 <= maxChars) {
      current.endPage = part.endPage;
      current.text += `\n\n${labeled}`;
    } else {
      chunks.push(current);
      current = { ...part, text: labeled };
    }
  };
  for (const page of pages) {
    if (!page.text.trim()) continue;
    for (const part of splitLongPage(page, Math.max(32, maxChars - 40))) append(part);
  }
  if (current) chunks.push(current);
  return chunks;
}

export function compressionPrompt(book: BookRecord, chunk: PageChunk, index: number, total: number) {
  return [
    "你是 Pageg 的长文压缩器。下面是 PDF 正文的一段，不要调用工具，也不要讨论代码。",
    `书名：${book.title}`,
    `范围：第 ${chunk.startPage}–${chunk.endPage} 页（第 ${index + 1}/${total} 段）`,
    "请用简体中文输出一份信息密集、可供后续全书问答使用的段落摘要，保留：主题、核心论点、推理或证据、关键术语/人物/数据、与全书结构的关系。不要杜撰；最多 1200 个汉字。",
    `PDF正文：\n${chunk.text}`,
  ].join("\n\n");
}

export function synthesisPrompt(book: BookRecord, summaries: PageChunk[]) {
  const source = summaries
    .map((item) => `【第 ${item.startPage}–${item.endPage} 页摘要】\n${item.text}`)
    .join("\n\n");
  return [
    "你是 Pageg 的全书结构压缩器。以下内容覆盖整本 PDF 的全部分页摘要。不要调用工具，不要讨论代码。",
    `书名：${book.title}`,
    "请生成一份可复用的全书中文知识地图，必须包括：中心思想、章节/论证脉络、主要概念、方法与证据、关键结论、作者的假设或局限。保留页码线索，信息不足就明确说不足。最多 6000 个汉字。",
    `全书分页摘要：\n${source}`,
  ].join("\n\n");
}

function terms(question: string) {
  const latin = question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const cjk = question.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...new Set([...latin, ...cjk])];
}

export function relevantPages(pages: PdfPageText[], question: string, maxChars = 12_000) {
  const needles = terms(question);
  if (needles.length === 0) return "";
  const scored = pages
    .map((page) => ({
      page,
      score: needles.reduce((sum, term) => sum + (page.text.toLowerCase().split(term.toLowerCase()).length - 1), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.page.page - b.page.page);
  let result = "";
  for (const { page } of scored.slice(0, 8)) {
    const next = `【第 ${page.page} 页】\n${page.text}\n\n`;
    if (result && result.length + next.length > maxChars) break;
    result += next.slice(0, Math.max(0, maxChars - result.length));
  }
  return result.trim();
}

export function validBookDigest(value: unknown, context: DocumentContext): value is BookDigest {
  if (!value || typeof value !== "object") return false;
  const digest = value as BookDigest;
  return (
    digest.version === BOOK_DIGEST_VERSION &&
    digest.pageCount === context.pageCount &&
    typeof digest.summary === "string" &&
    digest.summary.trim().length > 0 &&
    Array.isArray(digest.chunkSummaries)
  );
}

export async function buildBookDigest(
  book: BookRecord,
  context: DocumentContext,
  prompt: (text: string) => Promise<string>,
  progress: (done: number, total: number, label: string) => void,
): Promise<BookDigest> {
  const chunks = chunkDocument(context.pages);
  const summaries: PageChunk[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    progress(index, chunks.length + 1, `正在压缩全文 ${index + 1}/${chunks.length}`);
    const raw = await prompt(compressionPrompt(book, chunks[index], index, chunks.length));
    const text = sanitizeAnswer(raw).trim();
    if (!text) throw new Error(`第 ${index + 1} 段没有得到可用摘要`);
    summaries.push({ ...chunks[index], text });
  }
  progress(chunks.length, chunks.length + 1, "正在合并全书思想");
  const summary = sanitizeAnswer(await prompt(synthesisPrompt(book, summaries))).trim();
  if (!summary) throw new Error("没有得到可用的全书摘要");
  progress(chunks.length + 1, chunks.length + 1, "全书上下文已就绪");
  return {
    version: BOOK_DIGEST_VERSION,
    pageCount: context.pageCount,
    createdAt: new Date().toISOString(),
    summary,
    chunkSummaries: summaries.map(({ startPage, endPage, text }) => ({ startPage, endPage, text })),
  };
}
