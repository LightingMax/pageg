import type { Language } from "./types";

export type ReadingLensId = "mentor" | "core" | "research" | "argument" | "evidence" | "limits";

export type ReadingLens = {
  id: ReadingLensId;
  label: Record<Language, string>;
  description: Record<Language, string>;
  prompt: Record<Language, string>;
};

const mentorPrompt = `
我正在学习这篇论文。请不要按照 Abstract、Introduction、Method 的顺序机械地总结，也不要直接给我一份冗长的全文摘要。
我希望你作为我的科研导师，帮助我重建作者的设计思路。
首先解释：
作者想解决的核心问题是什么？
在这篇论文出现之前，人们通常如何解决它？
为什么已有方法仍然存在不足？
作者提出了什么关键洞察？
这个洞察如何一步步转化为具体的算法和模型架构？
请先用直观语言和具体例子解释，暂时不要堆积公式。
每完成一个关键阶段，给我一个需要主动思考的问题，让我尝试回答。根据我的回答判断是否需要深入。
如果论文中的设计动机没有明确说明，请明确区分作者的原始论述和你的推测，并尽量指出对应章节或图表。
最后，我们一起检查论文的实验是否足以证明其核心主张。
请基于整篇论文回答，引用证据时标注页码。`.trim();

export const READING_LENSES: ReadingLens[] = [
  {
    id: "mentor",
    label: { "zh-CN": "导师式拆解", "en-US": "Mentor walkthrough" },
    description: { "zh-CN": "重建作者为什么这样做", "en-US": "Rebuild why the authors chose this design" },
    prompt: {
      "zh-CN": mentorPrompt,
      "en-US": `
I am learning this paper. Do not summarize it mechanically in Abstract/Introduction/Method order, and do not give me a long full-text recap.
Act as a research mentor and help me reconstruct the authors' design reasoning.
Start with: What core problem are they solving? How was it usually solved before this paper? Why were prior approaches insufficient? What is the key insight? How does that insight become a concrete algorithm and model architecture?
Explain in intuitive language with concrete examples before using equations.
After each major stage, ask me one question that requires active thinking and use my answer to decide whether to go deeper.
Separate the authors' explicit motivation from your inference, and point to the relevant section or figure when possible.
Finally, check whether the experiments are sufficient to support the central claims.
Use the whole paper and cite page numbers.`,
    },
  },
  {
    id: "core",
    label: { "zh-CN": "中心思想", "en-US": "Core idea" },
    description: { "zh-CN": "一句话抓住论文主张", "en-US": "Find the paper's central claim" },
    prompt: {
      "zh-CN": "请基于整篇论文提取中心思想：先用一句话说清作者要解决的问题和核心主张，再说明关键洞察、方法如何支撑主张、实验给出的证据，以及最值得记住的一点。不要按 Abstract、Introduction、Method 逐节复述；引用证据时标注页码。",
      "en-US": "Extract the core idea of this whole paper: state the problem and central claim in one sentence, then explain the key insight, how the method supports the claim, what evidence the experiments provide, and the one idea worth remembering. Do not recap it section by section; cite page numbers.",
    },
  },
  {
    id: "research",
    label: { "zh-CN": "作者如何做研究", "en-US": "Research design" },
    description: { "zh-CN": "从问题到实验复盘研究路径", "en-US": "Trace the path from question to evidence" },
    prompt: {
      "zh-CN": "我想学习作者如何做研究。请重建这篇论文的研究设计：核心问题、已有方法的缺口、关键洞察、隐含或明确的假设、方法/架构、实验验证和结论。解释每一步为什么必要，明确区分作者原话与合理推断，并在每个阶段给我一个需要主动思考的问题。请基于整篇论文并标注页码。",
      "en-US": "I want to learn how the authors did research. Reconstruct this paper's research design: the core question, the gap in prior work, the key insight, explicit or implicit assumptions, method/architecture, experimental validation, and conclusion. Explain why each step is necessary, separate author claims from reasonable inference, and ask me one active-thinking question at each stage. Use the whole paper and cite page numbers.",
    },
  },
  {
    id: "argument",
    label: { "zh-CN": "论证链", "en-US": "Argument map" },
    description: { "zh-CN": "看每个结论靠什么证据", "en-US": "See how each claim is supported" },
    prompt: {
      "zh-CN": "请把这篇论文重建成一条论证链：作者提出了哪些主要主张？每个主张依赖哪些假设、方法和实验？哪些证据是直接支持，哪些只是相关性或间接迹象？指出论证中最强和最薄弱的环节，并标注页码。不要按章节顺序复述。",
      "en-US": "Reconstruct this paper as an argument map: what are the main claims, and which assumptions, methods, and experiments support each one? Distinguish direct evidence from correlation or indirect signals. Identify the strongest and weakest links in the argument, cite page numbers, and avoid a section-by-section recap.",
    },
  },
  {
    id: "evidence",
    label: { "zh-CN": "实验是否站得住", "en-US": "Evidence check" },
    description: { "zh-CN": "检查实验是否证明了主张", "en-US": "Test whether the experiments support the claims" },
    prompt: {
      "zh-CN": "请像审稿人一样检查这篇论文的实验：核心主张是什么，实验是否真正覆盖这些主张？基线、数据集、指标、消融、对照和统计结果分别说明了什么？有哪些替代解释、未验证的假设或外推边界？最后给出“已经证明”“部分支持”“尚未证明”的结论，并标注页码。",
      "en-US": "Review this paper's experiments like a careful reviewer: what are the central claims, and do the experiments actually cover them? Explain what the baselines, datasets, metrics, ablations, controls, and statistical results show. Identify alternative explanations, untested assumptions, and limits of generalization. Conclude with what is proven, partially supported, or still unproven, citing page numbers.",
    },
  },
  {
    id: "limits",
    label: { "zh-CN": "局限与下一步", "en-US": "Limits & next steps" },
    description: { "zh-CN": "找到边界和可继续的问题", "en-US": "Find boundaries and open questions" },
    prompt: {
      "zh-CN": "请分析这篇论文的适用边界和下一步：方法在哪些条件下有效，哪些场景可能失效？作者明确承认了哪些局限，你还能从方法和实验中推断出哪些局限？基于这些边界，提出三个值得继续研究的问题，并说明它们为什么自然地从本文推出。请标注页码并区分作者观点和你的推断。",
      "en-US": "Analyze this paper's boundaries and next steps: under what conditions does the method work, and where might it fail? Which limitations do the authors acknowledge, and which can you infer from the method and experiments? Based on these boundaries, propose three research questions that naturally follow from the paper and explain why. Cite page numbers and separate author statements from your inference.",
    },
  },
];

export function readingLensPrompt(id: ReadingLensId, language: Language) {
  return READING_LENSES.find((lens) => lens.id === id)?.prompt[language] ?? "";
}
