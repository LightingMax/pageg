import { useEffect, useRef, useState } from "react";
import { activeChatSession } from "../lib/chat-history";
import { inferAskScope } from "../lib/context";
import MarkdownContent from "./MarkdownContent";
import { tr } from "../lib/i18n";
import { READING_LENSES } from "../lib/reading-prompts";
import type { AcpStatus, AskScope, BookRecord, ChatHistory, CustomReadingLens, Highlight, Language, PaperSearchState, ReaderTurn, SelectionPayload } from "../lib/types";

type Tab = "marks" | "tags" | "notes" | "ai" | "glossary";

type Props = {
  book: BookRecord | null;
  status: AcpStatus;
  stream: string;
  logs: string;
  activeId: string | null;
  onNotes: (value: string) => void;
  onGlossary: (value: string) => void;
  onAsk: (request: { question: string; scope: AskScope }) => void;
  onCancel: () => void;
  selection: SelectionPayload | null;
  onClearSelection: () => void;
  chatHistory: ChatHistory;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onJumpPage: (page: number) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onJump: (mark: Highlight) => void;
  onDeleteMark: (id: string) => void;
  paperSearch: PaperSearchState | null;
  onSelectPaper: (id: string) => void;
  onConfirmPaper: () => void;
  onCancelPaper: () => void;
  customReadingLenses: CustomReadingLens[];
  onCustomReadingLenses: (lenses: CustomReadingLens[]) => void;
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
  status,
  stream,
  logs,
  activeId,
  onNotes,
  onGlossary,
  onAsk,
  onCancel,
  onJump,
  onDeleteMark,
  paperSearch,
  onSelectPaper,
  onConfirmPaper,
  onCancelPaper,
  customReadingLenses,
  onCustomReadingLenses,
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
  focusMode,
  onToggleFocus,
}: Props) {
  const [tab, setTab] = useState<Tab>("marks");
  const [question, setQuestion] = useState("");
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [lensManagerOpen, setLensManagerOpen] = useState(false);
  const [lensDraft, setLensDraft] = useState<CustomReadingLens | null>(null);
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

  const useReadingLens = (prompt: string) => {
    setQuestion(prompt);
    requestAnimationFrame(() => questionInputRef.current?.focus());
  };

  const startNewLens = () => {
    setLensDraft({
      id: `custom-${crypto.randomUUID()}`,
      label: "",
      description: "",
      prompt: "",
    });
    setLensManagerOpen(true);
  };

  const startEditLens = (lens: CustomReadingLens) => {
    setLensDraft({ ...lens });
    setLensManagerOpen(true);
  };

  const cancelLensEdit = () => setLensDraft(null);

  const saveLens = () => {
    if (!lensDraft?.label.trim() || !lensDraft.prompt.trim()) return;
    const next = {
      ...lensDraft,
      label: lensDraft.label.trim(),
      description: lensDraft.description.trim(),
      prompt: lensDraft.prompt.trim(),
    };
    onCustomReadingLenses([...customReadingLenses.filter((lens) => lens.id !== next.id), next]);
    setLensDraft(null);
  };

  const deleteLens = (id: string) => {
    onCustomReadingLenses(customReadingLenses.filter((lens) => lens.id !== id));
    if (lensDraft?.id === id) setLensDraft(null);
  };

  const lensViews = [
    ...READING_LENSES.map((lens) => ({
      id: lens.id,
      label: lens.label[language],
      description: lens.description[language],
      prompt: lens.prompt[language],
    })),
    ...customReadingLenses.map((lens) => ({
      id: lens.id,
      label: lens.label,
      description: lens.description || tr(language, "ai.customLens"),
      prompt: lens.prompt,
    })),
  ];

  useEffect(() => {
    if (aiTick > 0) setTab("ai");
  }, [aiTick]);

  return (
    <aside className="side">
      <div className="tabs">
        <nav className="tabs-list" aria-label={language === "en-US" ? "Reader tools" : "阅读工具"}>
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
        </nav>
        {tab === "ai" && (
          <div className="tabs-actions">
            <button
              type="button"
              className="tiny focus-chat-toggle"
              onClick={onToggleFocus}
              aria-pressed={focusMode}
              aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
              title={language === "en-US" ? "Shortcut: Ctrl/Cmd + Shift + F" : "快捷键：Ctrl/⌘ + Shift + F"}
            >
              {tr(language, focusMode ? "ai.exitFocus" : "ai.focusChat")}
            </button>
            {status.state === "prompting" && (
              <button type="button" className="tiny" onClick={onCancel}>
                {tr(language, "ai.stop")}
              </button>
            )}
          </div>
        )}
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
            {paperSearch && (
              <section className="paper-search-panel" aria-live="polite">
                <div className="paper-search-heading">
                  <div>
                    <b>{tr(language, "ai.paperCandidates")}</b>
                    <small>{paperSearch.query || tr(language, "ai.paperSearchHint")}</small>
                  </div>
                  <button type="button" className="paper-search-close" onClick={onCancelPaper}>
                    {tr(language, "ai.cancelPaperSearch")}
                  </button>
                </div>
                {paperSearch.loading ? (
                  <p className="paper-search-state">{tr(language, "ai.searchingPapers")}</p>
                ) : paperSearch.error ? (
                  <p className="paper-search-state error">{paperSearch.error}</p>
                ) : (
                  <>
                    <div className="paper-candidate-list">
                      {paperSearch.candidates.map((candidate) => (
                        <button
                          type="button"
                          key={candidate.id}
                          className={`paper-candidate ${candidate.id === paperSearch.selectedId ? "selected" : ""}`}
                          onClick={() => onSelectPaper(candidate.id)}
                        >
                          <span className="paper-candidate-check" aria-hidden="true">{candidate.id === paperSearch.selectedId ? "✓" : ""}</span>
                          <span className="paper-candidate-body">
                            <strong>{candidate.title}</strong>
                            <small>{[candidate.year, candidate.authors.slice(0, 3).join(", "), candidate.source].filter(Boolean).join(" · ")}</small>
                            {candidate.summary && <em>{candidate.summary}</em>}
                          </span>
                        </button>
                      ))}
                    </div>
                    {paperSearch.candidates.length > 0 && (
                      <div className="paper-search-actions">
                        <span>{tr(language, "ai.paperConfirmHint")}</span>
                        <button
                          type="button"
                          className="solid"
                          onClick={onConfirmPaper}
                          disabled={!paperSearch.selectedId || paperSearch.downloading}
                        >
                          {paperSearch.downloading ? tr(language, "ai.downloadingPaper") : tr(language, "ai.downloadSelected")}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
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
            <section className="reading-lenses" aria-label={tr(language, "ai.readingLenses")}>
              <div className="reading-lenses-heading">
                <div>
                  <b>{tr(language, "ai.readingLenses")}</b>
                  <small>{tr(language, "ai.readingLensesHint")}</small>
                </div>
                <div className="reading-lenses-heading-actions">
                  <span>{tr(language, "ai.readingLensesAction")}</span>
                  <button type="button" className="tiny" onClick={() => setLensManagerOpen((open) => !open)}>
                    {tr(language, lensManagerOpen ? "ai.closeLensManager" : "ai.manageLenses")}
                  </button>
                </div>
              </div>
              <div className="reading-lens-list">
                {lensViews.map((lens) => (
                  <button
                    type="button"
                    className="reading-lens"
                    key={lens.id}
                    onClick={() => useReadingLens(lens.prompt)}
                    disabled={status.state !== "ready"}
                    title={lens.description}
                  >
                    <strong>{lens.label}</strong>
                    <small>{lens.description}</small>
                  </button>
                ))}
              </div>
              {lensManagerOpen && (
                <div className="reading-lens-manager">
                  <div className="reading-lens-manager-head">
                    <span>{tr(language, "ai.customLenses")}</span>
                    <button type="button" className="tiny" onClick={startNewLens}>
                      {tr(language, "ai.addLens")}
                    </button>
                  </div>
                  {customReadingLenses.length === 0 && !lensDraft ? (
                    <p className="reading-lens-empty">{tr(language, "ai.customLensEmpty")}</p>
                  ) : (
                    <div className="custom-lens-list">
                      {customReadingLenses.map((lens) => (
                        <div className="custom-lens-row" key={lens.id}>
                          <div>
                            <strong>{lens.label}</strong>
                            <small>{lens.description || tr(language, "ai.customLens")}</small>
                          </div>
                          <div className="custom-lens-actions">
                            <button type="button" className="tiny" onClick={() => startEditLens(lens)}>
                              {tr(language, "ai.editLens")}
                            </button>
                            <button type="button" className="tiny danger" onClick={() => deleteLens(lens.id)}>
                              {tr(language, "ai.deleteLens")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {lensDraft && (
                    <form
                      className="reading-lens-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveLens();
                      }}
                    >
                      <label>
                        <span>{tr(language, "ai.lensLabel")}</span>
                        <input
                          value={lensDraft.label}
                          maxLength={40}
                          placeholder={tr(language, "ai.lensLabelPlaceholder")}
                          onChange={(event) => setLensDraft((draft) => draft && { ...draft, label: event.target.value })}
                          autoFocus
                        />
                      </label>
                      <label>
                        <span>{tr(language, "ai.lensDescription")}</span>
                        <input
                          value={lensDraft.description}
                          maxLength={80}
                          placeholder={tr(language, "ai.lensDescriptionPlaceholder")}
                          onChange={(event) => setLensDraft((draft) => draft && { ...draft, description: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>{tr(language, "ai.lensPrompt")}</span>
                        <textarea
                          rows={6}
                          value={lensDraft.prompt}
                          placeholder={tr(language, "ai.lensPromptPlaceholder")}
                          onChange={(event) => setLensDraft((draft) => draft && { ...draft, prompt: event.target.value })}
                        />
                      </label>
                      <div className="reading-lens-form-actions">
                        <button type="submit" className="solid" disabled={!lensDraft.label.trim() || !lensDraft.prompt.trim()}>
                          {tr(language, "ai.saveLens")}
                        </button>
                        <button type="button" className="tiny" onClick={cancelLensEdit}>
                          {tr(language, "ai.cancelRename")}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </section>
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
              ref={questionInputRef}
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
