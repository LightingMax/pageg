import { useEffect, useState } from "react";
import { activeChatSession } from "../lib/chat-history";
import type { AcpStatus, AgentInfo, AppSettings, AskScope, BookRecord, ChatHistory, Highlight, ReaderTurn } from "../lib/types";

type Tab = "marks" | "tags" | "notes" | "ai" | "glossary";

type Props = {
  book: BookRecord | null;
  agents: AgentInfo[];
  settings: AppSettings;
  status: AcpStatus;
  stream: string;
  logs: string;
  activeId: string | null;
  onNotes: (value: string) => void;
  onGlossary: (value: string) => void;
  onSettings: (value: AppSettings) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAsk: (request: { question: string; scope: AskScope }) => void;
  hasSelection: boolean;
  chatHistory: ChatHistory;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onJumpPage: (page: number) => void;
  onCancel: () => void;
  onJump: (mark: Highlight) => void;
  onDeleteMark: (id: string) => void;
  turn: ReaderTurn | null;
  aiTick: number;
};

const kindLabel: Record<string, string> = {
  mark: "高亮",
  note: "备注",
  translate: "翻译",
  explain: "解释",
  tag: "标签",
};

export default function SidePanel({
  book,
  agents,
  settings,
  status,
  stream,
  logs,
  activeId,
  onNotes,
  onGlossary,
  onSettings,
  onConnect,
  onDisconnect,
  onAsk,
  onCancel,
  onJump,
  onDeleteMark,
  turn,
  aiTick,
  hasSelection,
  chatHistory,
  onNewSession,
  onSelectSession,
  onJumpPage,
}: Props) {
  const [tab, setTab] = useState<Tab>("marks");
  const [question, setQuestion] = useState("");
  const [askScope, setAskScope] = useState<AskScope>("page");
  const sorted = [...(book?.highlights ?? [])].sort(
    (a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt),
  );
  const marks = sorted.filter((mark) => mark.kind !== "tag");
  const tags = sorted.filter((mark) => mark.kind === "tag");
  const activeSession = activeChatSession(chatHistory);

  useEffect(() => {
    if (aiTick > 0) setTab("ai");
  }, [aiTick]);

  return (
    <aside className="side">
      <div className="tabs">
        <button className={tab === "marks" ? "active" : ""} onClick={() => setTab("marks")}>
          标注
        </button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>
          标签
          {tags.length > 0 && <span className="tab-count">{tags.length}</span>}
        </button>
        <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>
          笔记
        </button>
        <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>
          AI
        </button>
        <button className={tab === "glossary" ? "active" : ""} onClick={() => setTab("glossary")}>
          术语表
        </button>
      </div>

      {tab === "marks" && (
        <>
          <p className="hint">在 PDF 上划词后可以高亮、下划线、备注。点一条就能跳回那一页。</p>
          {marks.length === 0 && <p className="empty">还没有标注。</p>}
          <div className="mark-list">
            {marks.map((mark) => (
              <div key={mark.id} className={`mark-item ${mark.id === activeId ? "active" : ""}`}>
                <button className="mark-body" onClick={() => onJump(mark)}>
                  <i className="swatch" style={{ background: mark.color }} />
                  <span>
                    <small>
                      p.{mark.page} · {kindLabel[mark.kind ?? "mark"] ?? "高亮"}
                      {mark.style === "underline" ? " · 下划线" : mark.style === "strike" ? " · 删除线" : ""}
                    </small>
                    {mark.text}
                    {mark.note ? <em>{mark.note}</em> : null}
                  </span>
                </button>
                <button className="tiny" onClick={() => onDeleteMark(mark.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "tags" && (
        <>
          <p className="hint">标签是书里的路标。点击标签会直接回到对应页和原文位置。</p>
          {tags.length === 0 && <p className="empty">划选一段文字，再点“标签”即可创建。</p>}
          <div className="tag-list">
            {tags.map((tag) => (
              <div key={tag.id} className={`tag-item ${tag.id === activeId ? "active" : ""}`}>
                <button className="tag-body" onClick={() => onJump(tag)}>
                  <span className="tag-ribbon" style={{ background: tag.color }} />
                  <span>
                    <b>{tag.label || "未命名标签"}</b>
                    <small>第 {tag.page} 页</small>
                    <em>{tag.text}</em>
                  </span>
                </button>
                <button className="tiny" onClick={() => onDeleteMark(tag.id)} aria-label={`删除标签 ${tag.label ?? ""}`}>
                  删除
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "notes" && (
        <>
          <p className="hint">这本书的本地 Markdown。高亮、翻译、解释都可以追加进来，原文 PDF 不会被改。</p>
          <textarea
            className="md"
            value={book?.notes ?? ""}
            disabled={!book}
            onChange={(e) => onNotes(e.target.value)}
          />
        </>
      )}

      {tab === "glossary" && (
        <>
          <p className="hint">确认过的译法放这里。下次翻译会先读这张表，避免一本里同一个词三种译法。</p>
          <textarea
            className="md"
            value={book?.glossary ?? ""}
            disabled={!book}
            onChange={(e) => onGlossary(e.target.value)}
          />
        </>
      )}

      {tab === "ai" && (
        <>
          <p className="hint">
            Pageg 会直接提取 PDF 正文。当前页可立即提问；整本书会在首次使用时分段压缩并保存，后续提问直接复用。
          </p>
          <div className="ask">
            <select
              value={settings.agentId}
              onChange={(e) => onSettings({ ...settings, agentId: e.target.value })}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
              <option value="custom">自定义命令</option>
            </select>
            {settings.agentId === "custom" && (
              <input
                value={settings.customCommand}
                placeholder="例如 npx -y @agentclientprotocol/codex-acp"
                onChange={(e) => onSettings({ ...settings, customCommand: e.target.value })}
              />
            )}
            <div className="top-actions">
              {status.state === "ready" || status.state === "prompting" ? (
                <button className="ghost" onClick={onDisconnect}>
                  断开
                </button>
              ) : (
                <button className="solid" onClick={onConnect}>
                  连接 Agent
                </button>
              )}
              {status.state === "prompting" && (
                <button className="ghost" onClick={onCancel}>
                  停止
                </button>
              )}
            </div>
            <p className="hint">{status.message ?? "尚未连接"}</p>
            <div className="chat-session-bar">
              <label>
                <span>会话历史</span>
                <select value={chatHistory.activeSessionId} onChange={(e) => onSelectSession(e.target.value)}>
                  {chatHistory.sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title} · {session.turns.length} 轮
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="tiny" onClick={onNewSession}>
                ＋ 新会话
              </button>
            </div>
            <form
              className="ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (!question.trim()) return;
                const inferred = /整本|全书|全文|整篇|whole\s+book/i.test(question) ? "book" : askScope;
                onAsk({ question: question.trim(), scope: inferred });
                if (inferred !== askScope) setAskScope(inferred);
                setQuestion("");
              }}
            >
              <div className="scope-picker" aria-label="AI 阅读范围">
                <button
                  type="button"
                  className={askScope === "selection" ? "active" : ""}
                  disabled={!hasSelection}
                  onClick={() => setAskScope("selection")}
                >
                  选区
                </button>
                <button type="button" className={askScope === "page" ? "active" : ""} onClick={() => setAskScope("page")}>
                  当前页
                </button>
                <button type="button" className={askScope === "book" ? "active" : ""} onClick={() => setAskScope("book")}>
                  整本书
                </button>
              </div>
              <input
                value={question}
                placeholder={askScope === "book" ? "总结全书，或基于整本书提问" : askScope === "selection" ? "询问刚才选中的文字" : "询问当前页内容"}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button className="solid" type="submit" disabled={status.state !== "ready"}>
                提问
              </button>
            </form>
            <div className={`chat-thread ${turn && !turn.ok ? "bad" : ""}`}>
              {activeSession?.turns.length ? (
                activeSession.turns.map((item) => (
                  <article className="chat-turn" key={item.id}>
                    <div className="chat-question">
                      <button type="button" onClick={() => onJumpPage(item.page)}>
                        第 {item.page} 页 · {item.scope === "book" ? "整本书" : item.scope === "selection" ? "选区" : item.intent === "translate" ? "翻译" : item.intent === "explain" ? "解释" : "当前页"}
                      </button>
                      <p>{item.question}</p>
                    </div>
                    <div className="chat-answer">{item.answer}</div>
                  </article>
                ))
              ) : !turn ? (
                <p className="chat-empty">这个会话还没有内容。提问、翻译或解释都会保存在这里。</p>
              ) : null}
              {turn && (
                <article className="chat-turn pending">
                  {turn.quote ? <div className="chat-question"><p>{turn.quote}</p></div> : null}
                  <div className="chat-answer">{turn.answer}</div>
                </article>
              )}
              {!turn && !activeSession?.turns.length && stream ? <div className="chat-answer">{stream}</div> : null}
            </div>
            {logs && <pre className="hint">{logs.slice(-1200)}</pre>}
          </div>
        </>
      )}
    </aside>
  );
}
