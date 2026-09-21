import type { BookRecord } from "./types";

function pickGlossary(glossary: string, selected: string) {
  if (!glossary.trim() || !selected.trim()) return "";
  const lines = glossary.split("\n").filter((line) => line.trim());
  const hits = lines.filter((line) =>
    selected.split(/\s+/).some((word) => word.length > 1 && line.toLowerCase().includes(word.toLowerCase())),
  );
  return hits.slice(0, 12).join("\n");
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
  const glossaryHits = pickGlossary(opts.book.glossary, opts.selected);
  const recent = (opts.sessionLog ?? "").trim().slice(-1800);
  const job =
    opts.intent === "translate"
      ? "请把选中原文译成流畅的简体中文。专业术语先给译法，再给一句解释。不要翻译上下文，不要扩写全书。"
      : opts.intent === "explain"
        ? "请用中文解释选中原文在当前语境里的意思，点破难点即可，不要复述整段或整本书。"
        : `用户提问：${opts.extra ?? ""}`;

  return [
    "你是 Pageg 的阅读伙伴。只完成本次明确请求。原文 PDF 是只读的，不要要求用户粘贴全书。",
    `书名：${opts.book.title}`,
    `页码：${opts.page}`,
    `这本书的本地笔记库：${opts.book.vaultPath}`,
    "需要术语或前文时，先读同目录的 glossary.md、notes.md、session.md。",
    opts.selected ? `选中原文：\n${opts.selected}` : "",
    opts.context && opts.context !== opts.selected ? `附近上下文（仅供消歧，不要整段翻译）：\n${opts.context}` : "",
    glossaryHits ? `已命中的术语：\n${glossaryHits}` : "",
    recent ? `最近几轮（供连贯，不要重复）：\n${recent}` : "",
    job,
    "若值得记下，用简短 Markdown；先直接回答用户。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sessionBlock(intent: string, page: number, quote: string, answer: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `## ${today} · ${intent} · p.${page}\n\n> ${quote}\n\n${answer}\n`;
}
