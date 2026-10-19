export type PaperDownload = {
  url: string;
  filename?: string;
  title?: string;
};

const DOWNLOAD_HINTS = /下载|下.{0,2}(论文|pdf)|帮我(找|搜|下载)|找.{0,8}(论文|pdf)|论文.{0,8}(下载|pdf)|pdf.{0,8}(下载|找)|\b(?:download|fetch|get|find)\b.{0,24}\b(?:paper|pdf|article)\b/i;
const PAPER_LOOKUP_HINTS = /(?:想看|想看看|看一下|阅读|查一下|查找|搜索|找一下|介绍一下|read|look\s+at|show\s+me).{0,100}(?:论文|paper|article|pdf)|(?:论文|paper|article).{0,100}(?:想看|想看看|看一下|阅读|查一下|查找|搜索|找一下|介绍一下|read|look\s+at)/i;

export function wantsPaperDownload(question: string) {
  return DOWNLOAD_HINTS.test(question.trim());
}

export function wantsPaperLookup(question: string) {
  const value = question.trim();
  return wantsPaperDownload(value) || PAPER_LOOKUP_HINTS.test(value);
}

export function paperSearchQuery(question: string) {
  return question
    .trim()
    .replace(/^(?:请|帮我|我(?:今天|现在|想)?|可以|能不能)\s*/i, "")
    .replace(/^(?:想看看|想要|想(?:要)?|看看|看一下|阅读|读一下|查一下|查找|搜索|找一下|介绍一下|download|find|get|fetch|read|look\s+at)\s*/i, "")
    .replace(/(?:这篇|这份|相关)?\s*(?:论文|paper|article|pdf)\s*(?:可以吗|好吗|吧)?\s*$/i, "")
    .replace(/[“”"'，。？！?!：:、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  let url = value.trim().replace(/^[<([{'"`]+|[>\])},.;:'"`]+$/g, "");
  if (!/^https:\/\//i.test(url)) return "";
  if (/^https:\/\/(?:export\.)?arxiv\.org\/abs\//i.test(url)) {
    url = url.replace(/\/abs\//i, "/pdf/");
    if (!/\.pdf(?:[?#]|$)/i.test(url)) url = `${url}.pdf`;
  } else if (/^https:\/\/(?:export\.)?arxiv\.org\/pdf\//i.test(url) && !/\.pdf(?:[?#]|$)/i.test(url)) {
    url = `${url}.pdf`;
  }
  return url;
}

function candidateFromValue(value: unknown): PaperDownload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const url = normalizeUrl(item.url);
  if (!url) return undefined;
  return {
    url,
    filename: typeof item.filename === "string" ? item.filename.trim() || undefined : undefined,
    title: typeof item.title === "string" ? item.title.trim() || undefined : undefined,
  };
}

export function extractPaperDownload(raw: string, allowLooseUrl = false) {
  const marker = raw.match(/(?:^|\n)\s*PAGEG_DOWNLOAD\s*:\s*(\{[\s\S]*?\})(?=\s*(?:\n|$))/i);
  let candidate: PaperDownload | undefined;
  if (marker) {
    try {
      candidate = candidateFromValue(JSON.parse(marker[1]));
    } catch {
      candidate = undefined;
    }
  }
  if (!candidate && allowLooseUrl) {
    const urls = [...raw.matchAll(/https:\/\/[^\s<>\])},;"']+/gi)].map((match) => normalizeUrl(match[0]));
    const paperUrl = urls.find((url) => /\.pdf(?:[?#]|$)/i.test(url) || /arxiv\.org\/(?:abs|pdf)\//i.test(url));
    if (paperUrl) candidate = { url: paperUrl };
  }
  const text = marker
    ? raw.replace(marker[0], "").replace(/^\s*```(?:json)?\s*$/gim, "").trim()
    : raw;
  return { text, candidate };
}
