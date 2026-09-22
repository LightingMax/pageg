import type { BookRecord } from "./types";
import { tidyQuote } from "./answer";

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
}) {
  const quote = tidyQuote(opts.selected);
  const nearby = tidyQuote(opts.context);
  const glossaryHits = pickGlossary(opts.book.glossary, quote);
  const recent = tidyQuote((opts.sessionLog ?? "").slice(-600));
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
            "只输出 2～5 句。不要复述整段，不要读文件，不要写代码。",
          ].join("\n")
        : `任务：用中文回答用户关于这段阅读的问题。\n问题：${tidyQuote(opts.extra ?? "")}\n只回答问题本身。不要读文件，不要写代码。`;

  return [
    "你现在是阅读助手，不是编程助手。禁止调用工具、读仓库、改文件、列 TODO。",
    `书名：${opts.book.title}　页码：${opts.page}`,
    quote ? `原文：\n${quote}` : "",
    nearby && nearby !== quote ? `附近上下文（只用来消歧，不要翻译整段）：\n${nearby}` : "",
    glossaryHits ? `这本书里已确认的术语：\n${glossaryHits}` : "",
    recent && !/jsonrpc|tool_call|I'll /i.test(recent) ? `最近回答（不要重复）：\n${recent}` : "",
    job,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sessionBlock(intent: string, page: number, quote: string, answer: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `## ${today} · ${intent} · p.${page}\n\n> ${tidyQuote(quote)}\n\n${answer.trim()}\n`;
}
