import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeChatSession,
  appendChatTurn,
  conversationMemory,
  createChatSession,
  emptyChatHistory,
  historyFromLegacySession,
  normalizeChatHistory,
  renameChatSession,
  selectChatSession,
} from "./chat-history";

describe("per-book chat history", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `id-${Math.random()}`) });
  });

  it("stores turns in the active session and derives its title", () => {
    const history = appendChatTurn(emptyChatHistory(), {
      intent: "ask",
      scope: "page",
      page: 4,
      question: "作者为什么反对传统记忆分类？",
      answer: "因为它无法覆盖当代智能体记忆的多样性。",
    });
    expect(activeChatSession(history)?.turns).toHaveLength(1);
    expect(activeChatSession(history)?.title).toContain("作者为什么");
    expect(conversationMemory(history)).toContain("助手：因为它无法覆盖");
  });

  it("creates and switches between independent sessions", () => {
    const first = emptyChatHistory();
    const firstId = first.activeSessionId;
    const second = createChatSession(first);
    expect(second.activeSessionId).not.toBe(firstId);
    expect(selectChatSession(second, firstId).activeSessionId).toBe(firstId);
  });

  it("renames a session and keeps the custom title after the first turn", () => {
    const initial = emptyChatHistory();
    const history = renameChatSession(initial, initial.activeSessionId, "  研究计划  ");
    const renamed = history.sessions[0];
    expect(renamed.title).toBe("研究计划");
    expect(renamed.titleEdited).toBe(true);
    const withTurn = appendChatTurn(history, {
      intent: "ask",
      scope: "page",
      page: 1,
      question: "自动生成标题会覆盖吗？",
      answer: "不会。",
    });
    expect(activeChatSession(withTurn)?.title).toBe("研究计划");
  });

  it("repairs malformed stored data", () => {
    expect(normalizeChatHistory({ version: 0, sessions: [] }).sessions).toHaveLength(1);
  });

  it("imports the old markdown session log", () => {
    const history = historyFromLegacySession(
      "# Session\n\n## 2026-10-01 · ask · p.8\n\n> RAG 有什么区别？\n\n它具有持续更新的状态。\n",
    );
    expect(activeChatSession(history)?.turns[0]).toMatchObject({ page: 8, question: "RAG 有什么区别？" });
  });
});
