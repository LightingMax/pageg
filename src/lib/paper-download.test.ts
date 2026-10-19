import { describe, expect, it } from "vitest";
import { extractPaperDownload, paperSearchQuery, wantsPaperDownload, wantsPaperLookup } from "./paper-download";

describe("paper download requests", () => {
  it("recognizes Chinese and English download requests", () => {
    expect(wantsPaperDownload("帮我下载 mem0 的论文")).toBe(true);
    expect(wantsPaperDownload("find and download the paper about memory")).toBe(true);
    expect(wantsPaperDownload("这篇文章的核心观点是什么？")).toBe(false);
  });

  it("recognizes paper lookup requests and keeps the title as the search query", () => {
    const question = "我今天想看看 cortex: consolidating context 这篇论文";
    expect(wantsPaperLookup(question)).toBe(true);
    expect(paperSearchQuery(question)).toBe("cortex consolidating context");
  });

  it("extracts and removes the structured agent marker", () => {
    const parsed = extractPaperDownload(
      "我找到了相关论文。\nPAGEG_DOWNLOAD: {\"url\":\"https://arxiv.org/abs/2504.19413\",\"filename\":\"mem0.pdf\"}",
      true,
    );
    expect(parsed.text).toBe("我找到了相关论文。");
    expect(parsed.candidate).toMatchObject({
      url: "https://arxiv.org/pdf/2504.19413.pdf",
      filename: "mem0.pdf",
    });
  });

  it("finds a direct PDF URL when the agent omits the marker", () => {
    const parsed = extractPaperDownload("论文地址：https://example.org/papers/mem0.pdf?download=1", true);
    expect(parsed.candidate?.url).toBe("https://example.org/papers/mem0.pdf?download=1");
  });
});
