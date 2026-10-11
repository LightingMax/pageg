import { describe, expect, it } from "vitest";
import { cleanExtractedPages, textItemsToLines, validDocumentContext } from "./pdf-context-core";

describe("PDF text context", () => {
  it("rebuilds lines and joins hyphenated words", () => {
    const lines = textItemsToLines([
      { str: "Long-term memo-", hasEOL: true },
      { str: "ry matters.", hasEOL: true },
    ]);
    const pages = cleanExtractedPages([{ page: 1, lines }]);
    expect(pages[0].text).toContain("Long-term memory matters.");
  });

  it("removes repeating page headers and footers", () => {
    const pages = cleanExtractedPages(
      [1, 2, 3, 4].map((page) => ({ page, lines: ["Memory in AI Agents", `Unique content ${page}.`, `${page}`] })),
    );
    expect(pages.every((page) => !page.text.includes("Memory in AI Agents"))).toBe(true);
    expect(pages.every((page) => !/^\d+$/m.test(page.text))).toBe(true);
    expect(pages[2].text).toContain("Unique content 3");
  });

  it("rejects stale or partial caches", () => {
    expect(validDocumentContext({ version: 1, pageCount: 2, pages: [{ page: 1, text: "a" }] })).toBe(false);
  });
});
