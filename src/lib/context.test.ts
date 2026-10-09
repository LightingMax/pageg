import { describe, expect, it } from "vitest";
import { assemblePrompt, pickGlossary, sessionBlock } from "./context";
import type { BookRecord } from "./types";

const book: BookRecord = {
  id: "b1",
  title: "Plant Physiology",
  authors: [],
  keywords: [],
  originalFilename: "plant.pdf",
  metadataStatus: "ready",
  onDesk: true,
  sourcePath: "C:/books/plant.pdf",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastPage: 3,
  notes: "",
  highlights: [],
  glossary: "- light reaction：光反应\n- Calvin cycle：卡尔文循环\n- mitochondria：线粒体",
  vaultPath: "C:/Users/ROG/AppData/pageg/vault/books/b1",
};

describe("pickGlossary", () => {
  it("only keeps terms that appear in the selection", () => {
    const hits = pickGlossary(book.glossary, "The light reaction produces ATP.");
    expect(hits).toContain("light reaction");
    expect(hits).not.toContain("mitochondria");
  });

  it("returns empty when nothing matches", () => {
    expect(pickGlossary(book.glossary, "Hello")).toBe("");
  });
});

describe("assemblePrompt", () => {
  it("asks for a labeled Chinese translation and never mentions the vault path", () => {
    const prompt = assemblePrompt({
      intent: "translate",
      book,
      page: 12,
      selected: "The light reaction produces ATP.",
      context: "In chloroplasts, the light reaction produces ATP and NADPH.",
    });
    expect(prompt).toContain("原文：");
    expect(prompt).toContain("The light reaction produces ATP.");
    expect(prompt).toContain("译：<译文>");
    expect(prompt).toContain("不是编程助手");
    expect(prompt).toContain("light reaction：光反应");
    expect(prompt).not.toContain(book.vaultPath);
    expect(prompt).not.toContain("glossary.md");
    expect(prompt).not.toContain("notes.md");
  });

  it("keeps explain prompts short and tool-free", () => {
    const prompt = assemblePrompt({
      intent: "explain",
      book,
      page: 2,
      selected: "null hypothesis",
      context: "We reject the null hypothesis.",
    });
    expect(prompt).toContain("解释");
    expect(prompt).toContain("不要写代码");
    expect(prompt).not.toContain("vault");
  });
});

describe("sessionBlock", () => {
  it("stores the quote and cleaned answer", () => {
    const block = sessionBlock("translate", 4, "ATP", "译：腺苷三磷酸");
    expect(block).toContain("p.4");
    expect(block).toContain("> ATP");
    expect(block).toContain("译：腺苷三磷酸");
  });
});
