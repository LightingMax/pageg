import { useEffect, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";
import { tr } from "../lib/i18n";
import type { AcpStatus, Language, ShelfTaskState } from "../lib/types";

export type GlobalMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Props = {
  messages: GlobalMessage[];
  status: AcpStatus;
  busy: boolean;
  shelfTask: ShelfTaskState | null;
  onAsk: (question: string) => void;
  onCancel: () => void;
  onClearShelfTask: () => void;
  language: Language;
};

export default function DeskAssistant({
  messages,
  status,
  busy,
  shelfTask,
  onAsk,
  onCancel,
  onClearShelfTask,
  language,
}: Props) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open, busy]);

  const submit = () => {
    const value = question.trim();
    if (!value || busy) return;
    onAsk(value);
    setQuestion("");
  };

  return (
    <div className={`desk-assistant ${open ? "open" : ""}`}>
      {open && (
        <section className="desk-assistant-panel" aria-label={language === "en-US" ? "Global desk assistant" : "全局书桌助手"}>
          <header className="desk-assistant-header">
            <div>
              <span className="eyebrow">PAGEG DESK</span>
              <h2>{language === "en-US" ? "Desk assistant" : "书桌助手"}</h2>
              <p>{language === "en-US" ? "Manage shelves, papers, and reading plans from here." : "在这里管理书架、论文和阅读计划。"}</p>
            </div>
            <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label={language === "en-US" ? "Close" : "关闭"}>×</button>
          </header>
          {shelfTask && (
            <div className="desk-assistant-task">
              <div>
                <b>{tr(language, "ai.libraryTask")}</b>
                <strong>{shelfTask.shelfName}</strong>
                <small>{shelfTask.status === "running" ? tr(language, "ai.libraryTaskRunning") : shelfTask.items.length === 0 ? tr(language, "ai.libraryTaskShelfOnly") : shelfTask.status === "done" ? tr(language, "ai.libraryTaskDone") : shelfTask.status === "partial" ? tr(language, "ai.libraryTaskPartial") : tr(language, "ai.libraryTaskFailed")}</small>
              </div>
              <button type="button" className="tiny" onClick={onClearShelfTask}>{tr(language, "ai.clearLibraryTask")}</button>
            </div>
          )}
          <div className="desk-assistant-thread" aria-live="polite">
            {messages.length === 0 && <p className="desk-assistant-empty">{language === "en-US" ? "Try: Create a computer vision shelf." : "试试说：新建一个计算机视觉的书架。"}</p>}
            {messages.map((message) => (
              <article className={`desk-assistant-message ${message.role}`} key={message.id}>
                <MarkdownContent text={message.text} />
              </article>
            ))}
            {busy && <article className="desk-assistant-message assistant pending">{language === "en-US" ? "Working…" : "正在处理…"}</article>}
            <div ref={endRef} />
          </div>
          <form className="desk-assistant-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <textarea
              ref={inputRef}
              rows={2}
              value={question}
              placeholder={language === "en-US" ? "Ask the desk to organize your library…" : "让书桌助手整理你的书库…"}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="desk-assistant-composer-actions">
              {busy && <button type="button" className="tiny" onClick={onCancel}>{tr(language, "ai.stop")}</button>}
              <button type="submit" className="solid" disabled={!question.trim() || busy || (status.state !== "ready" && status.state !== "prompting")}>{language === "en-US" ? "Send" : "发送"}</button>
            </div>
          </form>
        </section>
      )}
      <button type="button" className="desk-assistant-launcher" onClick={() => { setOpen((value) => !value); requestAnimationFrame(() => inputRef.current?.focus()); }}>
        <span className="desk-assistant-orbit" aria-hidden="true">✦</span>
        <span>{language === "en-US" ? "Ask your desk" : "问问书桌"}</span>
        {messages.length > 0 && <i>{messages.length}</i>}
      </button>
    </div>
  );
}
