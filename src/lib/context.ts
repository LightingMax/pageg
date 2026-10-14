import type { AskScope, BookRecord } from "./types";
import { tidyQuote } from "./answer";

const BOOK_SCOPE_HINTS = /整本|全书|全文|整篇|这本书|这篇文章|这篇论文|本文的|文章整体|全文脉络|从头到尾|whole\s+book|entire\s+(book|paper|article)|this\s+(paper|article)|overall/i;
const PAGE_SCOPE_HINTS = /当前页|本页|这一页|这页|该页|第\s*\d+\s*页|this\s+page|on\s+this\s+page/i;
const BROAD_QUESTION_HINTS = /总结|概括|主要思想|核心观点|章节|论证|摘要|作者|贡献|研究问题|研究内容|方法|结论|主题|意义|局限|讲了什么|summary|summarize|main\s+idea|argument/i;

/** Pick a reading range from the user's wording while preserving a live selection. */
export function inferAskScope(question: string, hasSelection: boolean): AskScope {
  const value = question.trim();
  if (BOOK_SCOPE_HINTS.test(value)) return "book";
  if (PAGE_SCOPE_HINTS.test(value)) return "page";
  if (hasSelection) return "selection";
  return BROAD_QUESTION_HINTS.test(value) ? "book" : "page";
}

export function pickGlossary(glossary: string, selected: string) {
  if (!glossary.trim() || !selected.trim()) return "";
  const hay = selected.toLowerCase();
  const lines = glossary.split("\n").filter((line) => line.trim());
  const hits = lines.filter((line) => {
    const term = line.replace(/^[-*]\s*/, "").split(/[：:=]/)[0]?.trim() ?? "";
    if (term.length < 2) return false;
    return hay.includes(term.toLowerCase()) || selected.includes(term);
  });
  return hits.slice(0, 8).join("\n");
}

export function assemblePrompt(opts: {
  intent: "translate" | "explain" | "ask";
  book: BookRecord;
  page: number;
  selected: string;
  context: string;
  extra?: string;
  sessionLog?: string;
  scope?: AskScope;
  sourceText?: string;
  bookDigest?: string;
  relevantText?: string;
}) {
  const quote = tidyQuote(opts.selected);
  const nearby = tidyQuote(opts.context);
  const glossaryHits = pickGlossary(opts.book.glossary, quote);
  const recent = tidyQuote((opts.sessionLog ?? "").slice(-6000));
  const job =
    opts.intent === "translate"
      ? [
          "任务：把「原文」译成流畅的简体中文。",
          "只输出下面两行，不要有任何前言、计划、工具或代码：",
          "译：<译文>",
          "注：<最多一句；没有则省略这一行>",
        ].join("\n")
      : opts.intent === "explain"
        ? [
            "任务：用中文解释「原文」在当前语境里的意思。",
            "只输出 2～5 句。不要复述整段，不要调用工具，不要写代码。",
          ].join("\n")
        : [
            "任务：用中文回答用户关于 PDF 阅读内容的问题。",
            `问题：${tidyQuote(opts.extra ?? "")}`,
            "Pageg 已经从 PDF 中提取并在本提示中提供正文。请直接依据所提供的正文或全书压缩上下文回答，不要声称无法读取正文。",
            "给出清楚的结论和必要依据；引用内容时标出页码。资料确实没有覆盖问题时，再明确指出缺口，不要猜测。",
          ].join("\n");

  const scopeLabel =
    opts.scope === "book" ? "整本书" : opts.scope === "selection" ? "当前选区" : "当前页";
  const source = opts.sourceText?.trim() ?? "";
  const digest = opts.bookDigest?.trim() ?? "";
  const relevant = opts.relevantText?.trim() ?? "";

  return [
    "你现在是阅读助手，不是编程助手。禁止调用工具、读仓库、改文件、列 TODO。",
    `书名：${opts.book.title}　页码：${opts.page}`,
    opts.intent === "ask" ? `阅读范围：${scopeLabel}` : "",
    quote ? `原文：\n${quote}` : "",
    nearby && nearby !== quote ? `附近上下文（只用来消歧，不要翻译整段）：\n${nearby}` : "",
    source ? `${opts.scope === "page" ? `当前页正文（第 ${opts.page} 页）` : "PDF正文"}：\n${source}` : "",
    digest ? `全书压缩上下文（覆盖 ${opts.book.pageCount ?? "全部"} 页）：\n${digest}` : "",
    relevant ? `与问题相关的原文页：\n${relevant}` : "",
    glossaryHits ? `这本书里已确认的术语：\n${glossaryHits}` : "",
    recent && !/jsonrpc|tool_call|I'll /i.test(recent) ? `当前会话的最近问答（承接上下文，不要机械重复）：\n${recent}` : "",
    job,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sessionBlock(intent: string, page: number, quote: string, answer: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `## ${today} · ${intent} · p.${page}\n\n> ${tidyQuote(quote)}\n\n${answer.trim()}\n`;
}
