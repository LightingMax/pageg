import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import DeskHome from "./components/DeskHome";
import PdfPane from "./components/PdfPane";
import SidePanel from "./components/SidePanel";
import SetupPage from "./components/SetupPage";
import TabBar from "./components/TabBar";
import { assemblePrompt, sessionBlock } from "./lib/context";
import { readerAnswer, tidyQuote } from "./lib/answer";
import type {
  AcpEvent,
  AcpStatus,
  AgentInfo,
  AppSettings,
  BookMeta,
  BookRecord,
  Catalog,
  DiagnoseReport,
  Highlight,
  MarkOptions,
  ReaderTurn,
  SelectionPayload,
} from "./lib/types";

const defaultSettings: AppSettings = {
  agentId: "cursor",
  customCommand: "",
  handedness: "right",
  openTabs: [],
  currentShelf: "",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function noteBlock(page: number, quote: string, body: string) {
  return `## p.${page} · ${today()}\n\n> ${quote}\n\n${body}\n`;
}

function asError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ...defaultSettings,
    ...value,
    handedness: value?.handedness === "left" ? "left" : "right",
    openTabs: value?.openTabs ?? [],
    currentShelf: value?.currentShelf ?? "",
  };
}

export default function App() {
  const [library, setLibrary] = useState<BookMeta[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ shelves: [] });
  const [book, setBook] = useState<BookRecord | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<AcpStatus>({ state: "disconnected" });
  const [stream, setStream] = useState("");
  const [logs, setLogs] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [sessionLog, setSessionLog] = useState("");
  const [turn, setTurn] = useState<ReaderTurn | null>(null);
  const [aiTick, setAiTick] = useState(0);
  const autoTried = useRef(false);

  const refreshLibrary = useCallback(async () => {
    setLibrary((await window.pageg.listLibrary()) as BookMeta[]);
    setCatalog((await window.pageg.readCatalog()) as Catalog);
  }, []);

  const adoptBook = useCallback(
    async (next: BookRecord | null | undefined) => {
      if (!next) return;
      setError(null);
      setBook(next);
      setPage(next.lastPage || 1);
      setActiveId(null);
      setSettings((prev) => ({
        ...prev,
        openTabs: prev.openTabs.includes(next.id) ? prev.openTabs : [...prev.openTabs, next.id],
      }));
      const log = await window.pageg.readSession(next.id).catch(() => "");
      setSessionLog(log);
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  const openFromPath = useCallback(
    async (path: string) => {
      try {
        await adoptBook((await window.pageg.openPdfPath(path)) as BookRecord);
      } catch (err) {
        setError(asError(err));
      }
    },
    [adoptBook],
  );

  const openFromFile = useCallback(
    async (file: File) => {
      try {
        const maybePath = (file as File & { path?: string }).path;
        if (maybePath) {
          await openFromPath(maybePath);
          return;
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        await adoptBook((await window.pageg.importPdf(file.name, Array.from(buf))) as BookRecord);
      } catch (err) {
        setError(asError(err));
      }
    },
    [adoptBook, openFromPath],
  );

  const openFromDialog = useCallback(async () => {
    try {
      const next = (await window.pageg.openPdf()) as BookRecord | null;
      await adoptBook(next);
    } catch (err) {
      setError(asError(err));
    }
  }, [adoptBook]);

  useEffect(() => {
    if (!window.pageg) return;
    void refreshLibrary();
    void window.pageg.listAgents().then((list) => setAgents(list as AgentInfo[]));
    void window.pageg.readSettings().then((value) => {
      setSettings(normalizeSettings(value as AppSettings));
      setHydrated(true);
    });
    const stop = window.pageg.onAcpEvent((payload) => {
      const event = payload as AcpEvent;
      if (event.kind === "status" && event.status) setStatus(event.status);
      if (event.kind === "log" && event.text) setLogs((prev) => prev + event.text);
      if (event.kind === "session_update" && event.text) setStream((prev) => prev + event.text);
      if (event.kind === "stop") setStream((prev) => prev || event.text || prev);
    });
    return stop;
  }, [refreshLibrary]);

  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => {
      void window.pageg.writeSettings(settings);
    }, 300);
    return () => window.clearTimeout(t);
  }, [settings, hydrated]);

  useEffect(() => {
    if (!hydrated || !window.pageg || autoTried.current) return;
    autoTried.current = true;
    void (async () => {
      try {
        const report = (await window.pageg.diagnoseEnv()) as DiagnoseReport;
        const agentId = report.recommendedAgent;
        if (!agentId) {
          setSetupOpen(true);
          return;
        }
        const next = { ...settings, agentId };
        setSettings(next);
        await window.pageg.writeSettings(next);
        await window.pageg.acpConnect({
          agentId,
          cwd: "",
          customCommand: next.customCommand,
        });
      } catch {
        setSetupOpen(true);
      }
    })();
  }, [hydrated, settings]);

  useEffect(() => {
    if (!book) return;
    const t = window.setTimeout(() => {
      void window.pageg.saveNotes(book.id, book.notes);
      void window.pageg.saveGlossary(book.id, book.glossary);
      void window.pageg.saveHighlights(book.id, book.highlights);
    }, 400);
    return () => window.clearTimeout(t);
  }, [book]);

  useEffect(() => {
    if (!book) return;
    void window.pageg.savePage(book.id, page);
  }, [book, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!book) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (window.getSelection()?.toString().trim()) return;
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      if (e.key === "ArrowRight") setPage((p) => Math.min(pageCount, p + 1));
      if (e.key === "Escape") setActiveId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, pageCount]);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget) return;
      setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (file) void openFromFile(file);
      else setError("请拖入 PDF 文件");
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFromFile]);

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragging(true);
        else if (event.payload.type === "drop") {
          setDragging(false);
          const path = event.payload.paths.find((item) => item.toLowerCase().endsWith(".pdf"));
          if (path) void openFromPath(path);
          else setError("请拖入 PDF 文件");
        } else {
          setDragging(false);
        }
      })
      .then((fn) => {
        if (gone) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [openFromPath]);

  const openFromLibrary = async (id: string) => {
    try {
      await adoptBook((await window.pageg.loadBook(id)) as BookRecord);
    } catch (err) {
      setError(asError(err));
    }
  };

  const closeTab = async (id: string) => {
    const remaining = settings.openTabs.filter((tab) => tab !== id);
    setSettings((prev) => ({ ...prev, openTabs: remaining }));
    if (book?.id !== id) return;
    if (remaining.length === 0) {
      setBook(null);
      return;
    }
    await openFromLibrary(remaining[remaining.length - 1]);
  };

  const createShelf = async (name: string) => {
    try {
      setCatalog((await window.pageg.createShelf(name)) as Catalog);
    } catch (err) {
      setError(asError(err));
    }
  };

  const renameShelf = async (id: string, name: string) => {
    try {
      setCatalog((await window.pageg.renameShelf(id, name)) as Catalog);
    } catch (err) {
      setError(asError(err));
    }
  };

  const deleteShelf = async (id: string) => {
    try {
      setCatalog((await window.pageg.deleteShelf(id)) as Catalog);
      if (settings.currentShelf === id) {
        setSettings((prev) => ({ ...prev, currentShelf: "" }));
      }
    } catch (err) {
      setError(asError(err));
    }
  };

  const moveBook = async (bookId: string, shelfId: string) => {
    try {
      let next = catalog;
      for (const shelf of catalog.shelves) {
        if (shelf.bookIds.includes(bookId)) {
          next = (await window.pageg.assignBook(shelf.id, bookId, false)) as Catalog;
        }
      }
      if (shelfId) next = (await window.pageg.assignBook(shelfId, bookId, true)) as Catalog;
      setCatalog(next);
    } catch (err) {
      setError(asError(err));
      await refreshLibrary();
    }
  };

  const addHighlight = (sel: SelectionPayload, options: MarkOptions = {}) => {
    const mark: Highlight = {
      id: crypto.randomUUID(),
      page: sel.page,
      text: sel.text,
      color: options.color ?? "#e8c56b",
      note: options.note,
      label: options.label,
      rects: sel.rects,
      createdAt: new Date().toISOString(),
      kind: options.kind ?? "mark",
      style: options.style ?? "highlight",
    };
    setBook((prev) => (prev ? { ...prev, highlights: [...prev.highlights, mark] } : prev));
    return mark;
  };

  const updateHighlight = (id: string, patch: Partial<Highlight>) => {
    setBook((prev) =>
      prev ? { ...prev, highlights: prev.highlights.map((h) => (h.id === id ? { ...h, ...patch } : h)) } : prev,
    );
  };

  const deleteHighlight = (id: string) => {
    setBook((prev) => (prev ? { ...prev, highlights: prev.highlights.filter((h) => h.id !== id) } : prev));
    setActiveId((current) => (current === id ? null : current));
  };

  const saveRemark = async (sel: SelectionPayload, note: string, existingId?: string) => {
    if (existingId) {
      updateHighlight(existingId, { note, kind: note.trim() ? "note" : "mark" });
    } else {
      addHighlight(sel, { kind: note.trim() ? "note" : "mark", note, style: "highlight" });
    }
    if (!note.trim() || !book) return;
    const notes = await window.pageg.appendNote(book.id, noteBlock(sel.page, sel.text, note));
    setBook((prev) => (prev ? { ...prev, notes } : prev));
  };

  const runIntent = async (
    intent: "translate" | "explain" | "ask",
    extra?: string,
    sel?: SelectionPayload | null,
  ) => {
    if (!book) return;
    if (status.state !== "ready" && status.state !== "prompting") {
      setError("还没连上智能体。点右上角状态钮，连上后再翻译。");
      setSetupOpen(true);
      return;
    }
    const selected = tidyQuote(sel?.text ?? "");
    const prompt = assemblePrompt({
      intent,
      book,
      page: sel?.page ?? page,
      selected,
      context: tidyQuote(sel?.context ?? ""),
      extra,
      sessionLog,
    });

    setStream("");
    setAiTick((n) => n + 1);
    setTurn({
      intent,
      quote: selected || extra || "",
      answer: intent === "translate" ? "正在翻译…" : intent === "explain" ? "正在解释…" : "正在回答…",
      ok: true,
    });
    try {
      const raw = await window.pageg.acpPrompt(prompt);
      const result = readerAnswer(raw, intent);
      setStream(result.text);
      setTurn({ intent, quote: selected || extra || "", answer: result.text, ok: result.ok });
      if (!result.ok) {
        setError(result.text);
        return;
      }
      const log = await window.pageg.appendSession(
        book.id,
        sessionBlock(intent, sel?.page ?? page, selected || extra || "", result.text),
      );
      setSessionLog(log);
      if (intent !== "ask" && selected && sel) {
        const nextNotes = await window.pageg.appendNote(book.id, noteBlock(sel.page, selected, result.text));
        setBook((prev) =>
          prev
            ? {
                ...prev,
                notes: nextNotes,
                highlights: [
                  ...prev.highlights,
                  {
                    id: crypto.randomUUID(),
                    page: sel.page,
                    text: selected,
                    color: intent === "translate" ? "#7eb6d9" : "#8fbf6a",
                    note: result.text,
                    rects: sel.rects,
                    createdAt: new Date().toISOString(),
                    kind: intent === "translate" ? "translate" : "explain",
                    style: "highlight",
                  },
                ],
              }
            : prev,
        );
      }
    } catch (err) {
      const message = asError(err);
      setTurn({ intent, quote: selected || extra || "", answer: message, ok: false });
      setStatus({
        state: "error",
        message,
      });
    }
  };

  const connect = async (agentId = settings.agentId) => {
    const cwd = book?.vaultPath ?? "";
    const next = { ...settings, agentId };
    setSettings(next);
    await window.pageg.writeSettings(next);
    setLogs("");
    setStream("");
    setError(null);
    try {
      await window.pageg.acpConnect({
        agentId,
        cwd,
        customCommand: next.customCommand,
      });
      setSetupOpen(false);
    } catch (err) {
      setSetupOpen(true);
      setError(asError(err));
    }
  };

  const chipLabel =
    status.state === "ready"
      ? `已连接 ${status.agentName ?? "智能体"}`
      : status.state === "connecting"
        ? `正在连接 ${status.agentName ?? "智能体"}…`
        : status.state === "prompting"
          ? `${status.agentName ?? "智能体"} 工作中`
          : status.state === "error"
            ? "连接失败 · 点这里看原因"
            : "未连接智能体";

  const pageLabel = useMemo(() => `${page} / ${pageCount}`, [page, pageCount]);
  const tabs = useMemo(
    () => settings.openTabs.map((id) => library.find((item) => item.id === id) || (book?.id === id ? book : null)).filter(Boolean) as BookMeta[],
    [settings.openTabs, library, book],
  );

  return (
    <div className={`app ${book ? "reading-mode" : "home-mode"} ${dragging ? "dragging" : ""}`}>
      {dragging && book && <div className="drop-overlay">松开即可导入 PDF</div>}
      {error && (
        <button className="banner-error" onClick={() => setError(null)}>
          {error}
        </button>
      )}
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setBook(null)} title="回到我的书桌">
          <b>PAGEG</b>
          <span>本地阅读 · 按需智能</span>
        </button>
        <div className="pager">
          <button className="tiny" disabled={!book || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </button>
          <span className="hint">{book ? pageLabel : "我的书桌"}</span>
          <button
            className="tiny"
            disabled={!book || page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            下一页
          </button>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`agent-chip ${status.state}`}
            onClick={() => setSetupOpen(true)}
            title={status.message || "打开环境检测"}
          >
            <i className={`status-dot ${status.state}`} />
            <span>{chipLabel}</span>
          </button>
          <button className="ghost" onClick={() => setSetupOpen(true)}>
            环境
          </button>
          <button className="solid" onClick={() => void openFromDialog()}>
            导入 PDF
          </button>
        </div>
      </header>

      {book && (
        <TabBar
          tabs={tabs}
          activeId={book.id}
          onOpen={(id) => void openFromLibrary(id)}
          onClose={(id) => void closeTab(id)}
          onImport={() => void openFromDialog()}
        />
      )}

      {book ? (
        <div className="shell">
          <PdfPane
          sourcePath={book?.sourcePath ?? null}
          page={page}
          highlights={book?.highlights ?? []}
          activeId={activeId}
          library={library}
          currentBookId={book?.id}
          onPageCount={setPageCount}
          onPageChange={setPage}
          onOpenBook={(id) => void openFromLibrary(id)}
          onImport={() => void openFromDialog()}
          onUploadFile={(file) => void openFromFile(file)}
          handedness={settings.handedness}
          catalog={catalog}
          currentShelf={settings.currentShelf}
          onSelectShelf={(id) => setSettings((prev) => ({ ...prev, currentShelf: id }))}
          onCreateShelf={(name) => void createShelf(name)}
          onAssignBook={(shelfId, on) => {
            if (!book) return;
            void window.pageg.assignBook(shelfId, book.id, on).then((next) => setCatalog(next as Catalog));
          }}
          onMark={(sel, options) => addHighlight(sel, options)}
          onTranslate={(sel) => void runIntent("translate", undefined, sel)}
          onExplain={(sel) => void runIntent("explain", undefined, sel)}
          onSaveNote={(sel, note, existingId) => void saveRemark(sel, note, existingId)}
          onUpdate={updateHighlight}
          onDelete={deleteHighlight}
          onSelect={setActiveId}
          />

          <SidePanel
          book={book}
          agents={agents}
          settings={settings}
          status={status}
          stream={stream}
          logs={logs}
          activeId={activeId}
          turn={turn}
          aiTick={aiTick}
          onNotes={(notes) => setBook((prev) => (prev ? { ...prev, notes } : prev))}
          onGlossary={(glossary) => setBook((prev) => (prev ? { ...prev, glossary } : prev))}
          onSettings={setSettings}
          onConnect={() => void connect()}
          onDisconnect={() => void window.pageg.acpDisconnect()}
          onAsk={(q) => void runIntent("ask", q)}
          onCancel={() => void window.pageg.acpCancel()}
          onJump={(mark) => {
            setPage(mark.page);
            setActiveId(mark.id);
          }}
          onDeleteMark={deleteHighlight}
          />
        </div>
      ) : (
        <DeskHome
          library={library}
          catalog={catalog}
          dragging={dragging}
          onOpenBook={(id) => void openFromLibrary(id)}
          onImport={() => void openFromDialog()}
          onUploadFile={(file) => void openFromFile(file)}
          onCreateShelf={(name) => void createShelf(name)}
          onRenameShelf={(id, name) => void renameShelf(id, name)}
          onDeleteShelf={(id) => void deleteShelf(id)}
          onMoveBook={(bookId, shelfId) => void moveBook(bookId, shelfId)}
        />
      )}

      <SetupPage
        open={setupOpen}
        settings={settings}
        agents={agents}
        status={status}
        onClose={() => setSetupOpen(false)}
        onSettings={setSettings}
        onConnect={(agentId) => void connect(agentId)}
      />
    </div>
  );
}
