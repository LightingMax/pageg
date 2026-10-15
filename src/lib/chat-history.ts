import type { AskScope, ChatHistory, ChatSession, ChatTurn, ReaderTurn } from "./types";

export const CHAT_HISTORY_VERSION = 1;

function now() {
  return new Date().toISOString();
}

function makeSession(title = "新会话"): ChatSession {
  const stamp = now();
  return { id: crypto.randomUUID(), title, titleEdited: false, createdAt: stamp, updatedAt: stamp, turns: [] };
}

export function emptyChatHistory(): ChatHistory {
  const session = makeSession();
  return { version: CHAT_HISTORY_VERSION, activeSessionId: session.id, sessions: [session] };
}

export function normalizeChatHistory(value: unknown): ChatHistory {
  if (!value || typeof value !== "object") return emptyChatHistory();
  const history = value as ChatHistory;
  const sessions = Array.isArray(history.sessions)
    ? history.sessions.filter(
        (session) =>
          session &&
          typeof session.id === "string" &&
          typeof session.title === "string" &&
          Array.isArray(session.turns),
      )
    : [];
  if (history.version !== CHAT_HISTORY_VERSION || sessions.length === 0) return emptyChatHistory();
  const activeSessionId = sessions.some((session) => session.id === history.activeSessionId)
    ? history.activeSessionId
    : sessions[0].id;
  return { version: CHAT_HISTORY_VERSION, activeSessionId, sessions };
}

export function historyFromLegacySession(markdown: string): ChatHistory {
  const history = emptyChatHistory();
  const sections = markdown.split(/\n(?=## )/).filter((section) => section.startsWith("## "));
  let next = history;
  for (const section of sections) {
    const header = section.match(/^##\s+([^·\n]+)\s*·\s*(\w+)\s*·\s*p\.(\d+)/);
    const quote = section.match(/\n>\s*([^\n]*)/)?.[1]?.trim() ?? "阅读提问";
    const answer = section.replace(/^##[^\n]*\n+/, "").replace(/^>[^\n]*\n+/m, "").trim();
    if (!header || !answer) continue;
    next = appendChatTurn(next, {
      intent: header[2] === "translate" || header[2] === "explain" ? header[2] : "ask",
      page: Number(header[3]),
      question: quote,
      answer,
    });
  }
  return next;
}

export function activeChatSession(history: ChatHistory) {
  return history.sessions.find((session) => session.id === history.activeSessionId) ?? history.sessions[0];
}

export function createChatSession(history: ChatHistory): ChatHistory {
  const session = makeSession();
  return { ...history, activeSessionId: session.id, sessions: [session, ...history.sessions] };
}

export function selectChatSession(history: ChatHistory, id: string): ChatHistory {
  return history.sessions.some((session) => session.id === id) ? { ...history, activeSessionId: id } : history;
}

export function renameChatSession(history: ChatHistory, id: string, title: string): ChatHistory {
  const nextTitle = title.replace(/\s+/g, " ").trim();
  if (!nextTitle) return history;
  const stamp = now();
  return {
    ...history,
    sessions: history.sessions.map((session) =>
      session.id === id ? { ...session, title: nextTitle, titleEdited: true, updatedAt: stamp } : session,
    ),
  };
}

function turnTitle(question: string) {
  const text = question.replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || "阅读会话";
}

export function appendChatTurn(
  history: ChatHistory,
  entry: {
    intent: ReaderTurn["intent"];
    scope?: AskScope;
    page: number;
    question: string;
    answer: string;
  },
): ChatHistory {
  const stamp = now();
  const turn: ChatTurn = { id: crypto.randomUUID(), createdAt: stamp, ...entry };
  return {
    ...history,
    sessions: history.sessions.map((session) =>
      session.id === history.activeSessionId
        ? {
            ...session,
            title: session.turns.length === 0 && !session.titleEdited ? turnTitle(entry.question) : session.title,
            updatedAt: stamp,
            turns: [...session.turns, turn],
          }
        : session,
    ),
  };
}

export function conversationMemory(history: ChatHistory, maxChars = 7000) {
  const session = activeChatSession(history);
  if (!session) return "";
  const blocks = session.turns.map(
    (turn) => `用户（第 ${turn.page} 页，${turn.scope ?? turn.intent}）：${turn.question}\n助手：${turn.answer}`,
  );
  let result = "";
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const next = `${blocks[index]}\n\n${result}`;
    if (next.length > maxChars) break;
    result = next;
  }
  return result.trim();
}
