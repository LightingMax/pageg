import { useEffect, useState } from "react";
import { activeChatSession } from "../lib/chat-history";
import { inferAskScope } from "../lib/context";
import MarkdownContent from "./MarkdownContent";
import { tr } from "../lib/i18n";
import type { AcpStatus, AgentInfo, AppSettings, AskScope, BookRecord, ChatHistory, Highlight, Language, ReaderTurn, SelectionPayload } from "../lib/types";

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
  onRenameSession: (id: string, title: string) => void;
  onJumpPage: (page: number) => void;
  onCancel: () => void;
  onJump: (mark: Highlight) => void;
  onDeleteMark: (id: string) => void;
  turn: ReaderTurn | null;
  aiTick: number;
  language: Language;
};

function kindLabel(language: Language, kind: string) {
  return {
    mark: tr(language, "marks.tab"),
    note: tr(language, "marks.notes"),
    translate: tr(language, "ai.translate"),
    explain: tr(language, "ai.explain"),
    tag: tr(language, "marks.tags"),
  }[kind] ?? tr(language, "marks.tab");
}

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
  onRenameSession,
  onJumpPage,
  language,
}: Props) {
  const [tab, setTab] = useState<Tab>("marks");
  const [question, setQuestion] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const sorted = [...(book?.highlights ?? [])].sort(
    (a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt),
  );
  const marks = sorted.filter((mark) => mark.kind !== "tag");
  const tags = sorted.filter((mark) => mark.kind === "tag");
  const activeSession = activeChatSession(chatHistory);

  const beginRenameSession = () => {
    if (!activeSession) return;
    setRenamingSessionId(activeSession.id);
    setSessionTitleDraft(activeSession.title);
  };

  const cancelRenameSession = () => {
    setRenamingSessionId(null);
    setSessionTitleDraft("");
  };

  const saveSessionName = () => {
    if (!renamingSessionId || !sessionTitleDraft.trim()) return;
    onRenameSession(renamingSessionId, sessionTitleDraft);
    cancelRenameSession();
  };

  useEffect(() => {
    if (aiTick > 0) setTab("ai");
  }, [aiTick]);

  return (
    <aside className="side">
      <div className="tabs">
        <button className={tab === "marks" ? "active" : ""} onClick={() => setTab("marks")}>
          {tr(language, "marks.tab")}
        </button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>
          {tr(language, "marks.tags")}
          {tags.length > 0 && <span className="tab-count">{tags.length}</span>}
        </button>
        <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>
          {tr(language, "marks.notes")}
        </button>
        <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>
          AI
        </button>
        <button className={tab === "glossary" ? "active" : ""} onClick={() => setTab("glossary")}>
          {tr(language, "marks.glossary")}
        </button>
      </div>

      {tab === "marks" && (
        <>
          <p className="hint">{tr(language, "marks.hint")}</p>
          {marks.length === 0 && <p className="empty">{tr(language, "marks.empty")}</p>}
          <div className="mark-list">
            {marks.map((mark) => (
              <div key={mark.id} className={`mark-item ${mark.id === activeId ? "active" : ""}`}>
                <button className="mark-body" onClick={() => onJump(mark)}>
                  <i className="swatch" style={{ background: mark.color }} />
                  <span>
                    <small>
                      p.{mark.page} · {kindLabel(language, mark.kind ?? "mark")}
                      {mark.style === "underline" ? ` · ${language === "en-US" ? "underline" : "下划线"}` : mark.style === "strike" ? ` · ${language === "en-US" ? "strikethrough" : "删除线"}` : ""}
                    </small>
                    {mark.text}
                    {mark.note ? <em>{mark.note}</em> : null}
                  </span>
                </button>
                <button className="tiny" onClick={() => onDeleteMark(mark.id)}>
                  {tr(language, "marks.delete")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "tags" && (
        <>
          <p className="hint">{tr(language, "tags.hint")}</p>
          {tags.length === 0 && <p className="empty">{tr(language, "tags.empty")}</p>}
          <div className="tag-list">
            {tags.map((tag) => (
              <div key={tag.id} className={`tag-item ${tag.id === activeId ? "active" : ""}`}>
                <button className="tag-body" onClick={() => onJump(tag)}>
                  <span className="tag-ribbon" style={{ background: tag.color }} />
                  <span>
                    <b>{tag.label || tr(language, "tags.unnamed")}</b>
                    <small>{tr(language, "tags.page", { page: tag.page })}</small>
                    <em>{tag.text}</em>
                  </span>
                </button>
                <button className="tiny" onClick={() => onDeleteMark(tag.id)} aria-label={language === "en-US" ? `Delete tag ${tag.label ?? ""}` : `删除标签 ${tag.label ?? ""}`}>
                  {tr(language, "marks.delete")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "notes" && (
        <>
          <p className="hint">{tr(language, "notes.hint")}</p>
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
          <p className="hint">{tr(language, "glossary.hint")}</p>
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
              {tr(language, "ai.hint")}
            </p>
            <p className="hint paper-download-hint">
              {tr(language, "ai.paperDownloadHint")}
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
              <option value="custom">{tr(language, "ai.customCommand")}</option>
            </select>
            {settings.agentId === "custom" && (
              <input
                value={settings.customCommand}
                placeholder={tr(language, "ai.commandPlaceholder")}
                onChange={(e) => onSettings({ ...settings, customCommand: e.target.value })}
              />
            )}
            <div className="top-actions">
              {status.state === "ready" || status.state === "prompting" ? (
                <button className="ghost" onClick={onDisconnect}>
                  {tr(language, "ai.disconnect")}
                </button>
              ) : (
                <button className="solid" onClick={onConnect}>
                  {tr(language, "ai.connect")}
                </button>
              )}
              {status.state === "prompting" && (
                <button className="ghost" onClick={onCancel}>
                  {tr(language, "ai.stop")}
                </button>
              )}
            </div>
            <p className="hint">{status.message ?? tr(language, "ai.notConnected")}</p>
            <div className="chat-session-bar">
              <label>
                <span>{tr(language, "ai.history")}</span>
                <select
                  value={chatHistory.activeSessionId}
                  onChange={(e) => {
                    cancelRenameSession();
                    onSelectSession(e.target.value);
                  }}
                >
                  {chatHistory.sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title} · {session.turns.length} {language === "en-US" ? "turns" : "轮"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="chat-session-actions">
                {renamingSessionId === activeSession?.id ? (
                  <>
                    <input
                      className="session-title-input"
                      value={sessionTitleDraft}
                      maxLength={80}
                      placeholder={tr(language, "ai.renameSessionPlaceholder")}
                      aria-label={tr(language, "ai.renameSessionPlaceholder")}
                      onChange={(e) => setSessionTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveSessionName();
                        }
                        if (e.key === "Escape") cancelRenameSession();
                      }}
                      autoFocus
                    />
                    <button type="button" className="tiny" onClick={saveSessionName} disabled={!sessionTitleDraft.trim()}>
                      {tr(language, "ai.saveSessionName")}
                    </button>
                    <button type="button" className="tiny" onClick={cancelRenameSession}>
                      {tr(language, "ai.cancelRename")}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="tiny" onClick={beginRenameSession} disabled={!activeSession}>
                      {tr(language, "ai.renameSession")}
                    </button>
                    <button type="button" className="tiny" onClick={onNewSession}>
                      {tr(language, "ai.newSession")}
                    </button>
                  </>
                )}
              </div>
            </div>
            {logs && <pre className="hint ai-logs">{logs.slice(-1200)}</pre>}
          </div>
          <div className={`chat-thread ${turn && !turn.ok ? "bad" : ""}`}>
              {activeSession?.turns.length ? (
                activeSession.turns.map((item) => (
                  <article className="chat-turn" key={item.id}>
                    <div className="chat-question">
                      <button type="button" onClick={() => onJumpPage(item.page)}>
                        {language === "en-US" ? `Page ${item.page} · ` : `第 ${item.page} 页 · `}{item.scope === "book" ? tr(language, "ai.book") : item.scope === "selection" ? tr(language, "ai.selection") : item.intent === "translate" ? tr(language, "ai.translate") : item.intent === "explain" ? tr(language, "ai.explain") : tr(language, "ai.currentPage")}
                      </button>
                      <MarkdownContent text={item.question} />
                    </div>
                    <div className="chat-answer"><MarkdownContent text={item.answer} /></div>
                  </article>
                ))
              ) : !turn ? (
                <p className="chat-empty">{tr(language, "ai.empty")}</p>
              ) : null}
              {turn && (
                <article className="chat-turn pending">
                  {turn.quote ? <div className="chat-question"><MarkdownContent text={turn.quote} /></div> : null}
                  <div className="chat-answer"><MarkdownContent text={turn.answer} /></div>
                </article>
              )}
              {!turn && !activeSession?.turns.length && stream ? <div className="chat-answer"><MarkdownContent text={stream} /></div> : null}
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
                  <span>{tr(language, "ai.selected", { page: selection.page })}</span>
                  <button type="button" onClick={onClearSelection}>{tr(language, "ai.clear")}</button>
                </div>
                <p>{selection.text}</p>
                <small>{tr(language, "ai.copied")}</small>
              </div>
            )}
            <textarea
              rows={3}
              value={question}
              placeholder={tr(language, "ai.placeholder")}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button className="solid" type="submit" disabled={status.state !== "ready"}>
              {tr(language, "ai.ask")}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
