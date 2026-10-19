import { describe, expect, it } from "vitest";
import { READING_LENSES, readingLensPrompt } from "./reading-prompts";

describe("reading lenses", () => {
  it("offers compact entry points for paper reasoning", () => {
    expect(READING_LENSES.map((lens) => lens.id)).toEqual([
      "mentor",
      "core",
      "research",
      "argument",
      "evidence",
      "limits",
    ]);
  });

  it("keeps the mentor prompt focused on research reconstruction", () => {
    const prompt = readingLensPrompt("mentor", "zh-CN");
    expect(prompt).toContain("重建作者的设计思路");
    expect(prompt).toContain("已有方法仍然存在不足");
    expect(prompt).toContain("需要主动思考的问题");
    expect(prompt).toContain("实验是否足以证明其核心主张");
  });

  it("provides an equivalent English prompt", () => {
    const prompt = readingLensPrompt("research", "en-US");
    expect(prompt).toContain("how the authors did research");
    expect(prompt).toContain("active-thinking question");
  });
});
