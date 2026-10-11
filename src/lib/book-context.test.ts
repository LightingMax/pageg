import { describe, expect, it } from "vitest";
import { chunkDocument, relevantPages, validBookDigest } from "./book-context";

describe("whole-book context", () => {
  it("chunks by page, retains page labels, and does not drop the tail", () => {
    const chunks = chunkDocument(
      [
        { page: 1, text: "a".repeat(45) },
        { page: 2, text: "b".repeat(45) },
        { page: 3, text: "THE_END" },
      ],
      70,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain("第 1 页");
    expect(chunks.at(-1)?.text).toContain("THE_END");
    expect(chunks.at(-1)?.endPage).toBe(3);
  });

  it("retrieves source pages related to a question", () => {
    const found = relevantPages(
      [
        { page: 1, text: "This chapter introduces memory." },
        { page: 2, text: "Selective forgetting controls memory quality." },
      ],
      "How does selective forgetting work?",
    );
    expect(found).toContain("第 2 页");
    expect(found).toContain("Selective forgetting");
  });

  it("accepts a matching cache and rejects a stale version", () => {
    const context = { version: 1, pageCount: 2, extractedAt: "now", pages: [] };
    const digest = { version: 1, pageCount: 2, createdAt: "now", summary: "ok", chunkSummaries: [] };
    expect(validBookDigest(digest, context)).toBe(true);
    expect(validBookDigest({ ...digest, version: 0 }, context)).toBe(false);
  });
});
