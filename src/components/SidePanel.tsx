import { useState } from "react";
import type { AcpStatus, AgentInfo, AppSettings, BookRecord, Highlight } from "../lib/types";

type Tab = "marks" | "notes" | "ai" | "glossary";

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
  onAsk: (question: string) => void;
  onCancel: () => void;
  onJump: (mark: Highlight) => void;
  onDeleteMark: (id: string) => void;
};

const kindLabel: Record<string, string> = {
  mark: "高亮",
  note: "备注",
  translate: "翻译",
  explain: "解释",
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
}: Props) {
  const [tab, setTab] = useState<Tab>("marks");
  const [question, setQuestion] = useState("");
  const marks = [...(book?.highlights ?? [])].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));

  return (
    <aside className="side">
      <div className="tabs">
        <button className={tab === "marks" ? "active" : ""} onClick={() => setTab("marks")}>
          标注
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
            Pageg 复刻的是 Codeg 的 ACP 客户端能力：拉起 Codex / Claude / Gemini 的真实 CLI，而不是自己再包一层模型。
            AI 默认闭嘴，只有你点了动作才会 prompt。
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
                <button className="solid" onClick={onConnect} disabled={!book}>
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
            <form
              className="ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (!question.trim()) return;
                onAsk(question.trim());
                setQuestion("");
              }}
            >
              <input
                value={question}
                placeholder="问这一页，而不是问整本书"
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button className="solid" type="submit" disabled={status.state !== "ready"}>
                提问
              </button>
            </form>
            <div className="stream">{stream || "还没有这一轮的回答。"}</div>
            {logs && <pre className="hint">{logs.slice(-1200)}</pre>}
          </div>
        </>
      )}
    </aside>
  );
}
