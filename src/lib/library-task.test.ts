import { describe, expect, it } from "vitest";
import { parseShelfTask, pickBestPaperCandidate } from "./library-task";
import type { PaperCandidate } from "./types";

describe("library tasks", () => {
  it("extracts a shelf and numbered papers from a natural request", () => {
    const task = parseShelfTask(`新建一个计算机视觉的书架，我要读这三本书
① TubeR: Tubelet Transformer for Video Action Detection
CVPR 2022
② End-to-End Spatio-Temporal Action Localisation with Video Transformers
CVPR 2024 · 建议重点阅读
③ TQRFormer: Tubelet Query Recollection Transformer for Action Detection
Image and Vision Computing · 2024`);
    expect(task?.shelfName).toBe("计算机视觉");
    expect(task?.papers.map((paper) => paper.title)).toEqual([
      "TubeR: Tubelet Transformer for Video Action Detection",
      "End-to-End Spatio-Temporal Action Localisation with Video Transformers",
      "TQRFormer: Tubelet Query Recollection Transformer for Action Detection",
    ]);
    expect(task?.papers[1].hint).toContain("建议重点阅读");
  });

  it("does not turn an ordinary shelf request into a batch task", () => {
  expect(parseShelfTask("新建一个计算机视觉的书架")).toEqual({ shelfName: "计算机视觉", papers: [] });
  });

  it("chooses the candidate whose title best matches the requested paper", () => {
    const candidates: PaperCandidate[] = [
      { id: "a", title: "Tubelet Transformers for Video", authors: [], year: "2022", summary: "", url: "", pdfUrl: "", source: "OpenAlex" },
      { id: "b", title: "TubeR: Tubelet Transformer for Video Action Detection", authors: [], year: "2022", summary: "", url: "", pdfUrl: "", source: "OpenAlex" },
    ];
    expect(pickBestPaperCandidate("TubeR: Tubelet Transformer for Video Action Detection", candidates)?.id).toBe("b");
  });
});
