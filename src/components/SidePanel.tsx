import { useEffect, useState } from "react";
import { activeChatSession } from "../lib/chat-history";
import { inferAskScope } from "../lib/context";
import type { AcpStatus, AgentInfo, AppSettings, AskScope, BookRecord, ChatHistory, Highlight, ReaderTurn, SelectionPayload } from "../lib/types";

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
  selection: SelectionPayload | null;
  onClearSelection: () => void;
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
  selection,
  onClearSelection,
  chatHistory,
  onNewSession,
  onSelectSession,
  onJumpPage,
}: Props) {
  const [tab, setTab] = useState<Tab>("marks");
  const [question, setQuestion] = useState("");
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
        <div className="ai-panel">
          <div className="ai-settings">
            <p className="hint">
              直接提问即可。Pageg 会根据你的问题和已选文字，自动判断使用选区、当前页或整本书。
            </p>
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
            {logs && <pre className="hint ai-logs">{logs.slice(-1200)}</pre>}
          </div>
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
          <form
            className="ask ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!question.trim()) return;
              const inferred = inferAskScope(question, Boolean(selection?.text));
              onAsk({ question: question.trim(), scope: inferred });
              setQuestion("");
            }}
          >
            {selection?.text && (
              <div className="ask-context">
                <div className="ask-context-head">
                  <span>已保留第 {selection.page} 页选中文字</span>
                  <button type="button" onClick={onClearSelection}>清除</button>
                </div>
                <p>{selection.text}</p>
                <small>文字已自动复制，也可以在输入框右键粘贴</small>
              </div>
            )}
            <textarea
              rows={3}
              value={question}
              placeholder="直接提问，例如：这段是什么意思？它和全文的核心观点有什么关系？"
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button className="solid" type="submit" disabled={status.state !== "ready"}>
              提问
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
