import { describe, expect, it } from "vitest";
import { looksLikeGarbage, readerAnswer, sanitizeAnswer, tidyQuote } from "./answer";

const GARBAGE_STREAM = [
  "I'll read glossary.md and notes.md first.",
  '{"jsonrpc":"2.0","method":"session/update"}',
  "tool_call: fs/read_text_file",
  "Let me open the vault and inspect the PDF pipeline.",
  "译：光合作用把光能转化成化学能。",
  "注：这里的 light 指可见光。",
].join("\n");

describe("sanitizeAnswer", () => {
  it("extracts the labeled Chinese translation from an ACP coding ramble", () => {
    const text = sanitizeAnswer(GARBAGE_STREAM);
    expect(text).toContain("译：光合作用把光能转化成化学能");
    expect(text).toContain("注：这里的 light 指可见光");
    expect(text).not.toMatch(/jsonrpc/);
    expect(text).not.toMatch(/I'll read/);
    expect(text).not.toMatch(/tool_call/);
  });

  it("drops fenced json and keeps a plain Chinese paragraph", () => {
    const text = sanitizeAnswer("```json\n{\"ok\":true}\n```\n这句是在说样本已经被固定。");
    expect(text).toBe("这句是在说样本已经被固定。");
  });

  it("keeps markdown fences for rich rendering", () => {
    const text = sanitizeAnswer("**结论**\n\n```python\nx = 1\n```\n\n公式：$x^2 + y^2 = z^2$");
    expect(text).toContain("```python");
    expect(text).toContain("$x^2 + y^2 = z^2$");
  });

  it("collapses pdf selection whitespace", () => {
    expect(tidyQuote("The   light\nreaction  ")).toBe("The light reaction");
  });
});

describe("looksLikeGarbage / readerAnswer", () => {
  it("rejects English tool chatter as undeliverable", () => {
    const ramble = "I'll help you translate this by reading the repository and running tests.";
    expect(looksLikeGarbage(ramble)).toBe(true);
    expect(readerAnswer(ramble, "translate").ok).toBe(false);
    expect(readerAnswer(ramble, "translate").text).toMatch(/没有得到可用译文/);
  });

  it("accepts a short Chinese translation", () => {
    const good = "译：线粒体是细胞的能量工厂。";
    expect(looksLikeGarbage(good)).toBe(false);
    expect(readerAnswer(good, "translate")).toEqual({ ok: true, text: good });
  });

  it("accepts a short Chinese explanation", () => {
    const good = "这句话是在强调对照组必须与实验组同时处理，否则时间本身会成为干扰。";
    expect(readerAnswer(good, "explain").ok).toBe(true);
  });
});
