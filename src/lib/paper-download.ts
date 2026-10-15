export type PaperDownload = {
  url: string;
  filename?: string;
  title?: string;
};

const DOWNLOAD_HINTS = /下载|下.{0,2}(论文|pdf)|帮我(找|搜|下载)|找.{0,8}(论文|pdf)|论文.{0,8}(下载|pdf)|pdf.{0,8}(下载|找)|\b(?:download|fetch|get|find)\b.{0,24}\b(?:paper|pdf|article)\b/i;

export function wantsPaperDownload(question: string) {
  return DOWNLOAD_HINTS.test(question.trim());
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
