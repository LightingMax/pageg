import type { PaperCandidate } from "./types";

export type ShelfTaskPaper = {
  title: string;
  hint: string;
};

export type ShelfTaskRequest = {
  shelfName: string;
  papers: ShelfTaskPaper[];
};

function cleanTitle(value: string) {
  return value
    .replace(/^\s*[*_`]+|[*_`]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1));
}

/** Parse a natural-language batch request such as “新建 X 书架，我要读 ①… ②…”. */
export function parseShelfTask(input: string): ShelfTaskRequest | null {
  const value = input.trim();
  const shelfMatch = value.match(/(?:新建|创建|建立)\s*(?:一个|一组)?\s*(?:名为|叫(?:做)?)?\s*([^，。,\.\n]{1,40}?)\s*(?:的)?\s*书架/i);
  if (!shelfMatch) return null;
  const shelfName = cleanTitle(shelfMatch[1]);
  if (!shelfName) return null;

  const lines = value.split(/\r?\n/);
  const marker = /^\s*(?:[*_`]+\s*)?(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d{1,2}\s*[.)、:])\s*(.+?)\s*[*_`]*\s*$/;
  const papers: ShelfTaskPaper[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(marker);
    if (!match) continue;
    const title = cleanTitle(match[1]);
    if (!title || papers.some((paper) => normalize(paper.title) === normalize(title))) continue;
    const details: string[] = [];
    for (let next = index + 1; next < lines.length && !marker.test(lines[next]); next += 1) {
      const detail = cleanTitle(lines[next]);
      if (detail) details.push(detail);
    }
    papers.push({ title, hint: details.join(" ") });
  }
  return papers.length > 0 ? { shelfName, papers } : null;
}

export function pickBestPaperCandidate(query: string, candidates: PaperCandidate[]) {
  if (!candidates.length) return undefined;
  const needle = normalize(query);
  const queryTokens = tokens(query);
  return [...candidates]
    .map((candidate, index) => {
      const title = normalize(candidate.title);
      const titleTokens = tokens(candidate.title);
      const overlap = [...queryTokens].filter((token) => titleTokens.has(token)).length;
      const score =
        (title === needle ? 1000 : 0) +
        (title.includes(needle) || needle.includes(title) ? 300 : 0) +
        overlap * 20 -
        index;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.candidate;
}
