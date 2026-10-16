import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import DeskHome from "./components/DeskHome";
import PdfPane from "./components/PdfPane";
import SidePanel from "./components/SidePanel";
import SetupPage from "./components/SetupPage";
import TabBar from "./components/TabBar";
import { assemblePrompt, sessionBlock } from "./lib/context";
import { readerAnswer, tidyQuote } from "./lib/answer";
import { extractPdfMetadata } from "./lib/pdf-metadata";
import { extractDocumentContext, validDocumentContext } from "./lib/pdf-context";
import { buildBookDigest, relevantPages, validBookDigest } from "./lib/book-context";
import { tr } from "./lib/i18n";
import { extractPaperDownload, wantsPaperDownload } from "./lib/paper-download";
import {
  appendChatTurn,
  conversationMemory,
  createChatSession,
  emptyChatHistory,
  historyFromLegacySession,
  normalizeChatHistory,
  renameChatSession,
  selectChatSession,
} from "./lib/chat-history";
import type {
  AcpEvent,
  AcpStatus,
  AgentInfo,
  AppSettings,
  AskScope,
  BookDigest,
  BookMeta,
  BookMetadataPatch,
  BookRecord,
  Catalog,
  ChatHistory,
  DiagnoseReport,
  DocumentContext,
  Highlight,
  MarkOptions,
  ReaderTurn,
  SelectionPayload,
} from "./lib/types";

const defaultSettings: AppSettings = {
  agentId: "cursor",
  customCommand: "",
  handedness: "right",
  language: "zh-CN",
  leftPanelWidth: 148,
  rightPanelWidth: 360,
  openTabs: [],
  currentShelf: "",
  modelId: "",
};

const MIN_LEFT_PANEL = 104;
const MAX_LEFT_PANEL = 320;
const MIN_RIGHT_PANEL = 280;
const MAX_RIGHT_PANEL = 620;

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
  const leftPanelWidth = Number(value?.leftPanelWidth);
  const rightPanelWidth = Number(value?.rightPanelWidth);
  return {
    ...defaultSettings,
    ...value,
    handedness: value?.handedness === "left" ? "left" : "right",
    language: value?.language === "en-US" ? "en-US" : "zh-CN",
    leftPanelWidth: Number.isFinite(leftPanelWidth)
      ? Math.min(MAX_LEFT_PANEL, Math.max(MIN_LEFT_PANEL, leftPanelWidth))
      : defaultSettings.leftPanelWidth,
    rightPanelWidth: Number.isFinite(rightPanelWidth)
      ? Math.min(MAX_RIGHT_PANEL, Math.max(MIN_RIGHT_PANEL, rightPanelWidth))
      : defaultSettings.rightPanelWidth,
    openTabs: value?.openTabs ?? [],
    currentShelf: value?.currentShelf ?? "",
    modelId: typeof value?.modelId === "string" ? value.modelId.trim() : defaultSettings.modelId,
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
  const [chatHistory, setChatHistory] = useState<ChatHistory>(() => emptyChatHistory());
  const [turn, setTurn] = useState<ReaderTurn | null>(null);
  const [aiTick, setAiTick] = useState(0);
  const [readerSelection, setReaderSelection] = useState<SelectionPayload | null>(null);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const resizeStart = useRef<{ side: "left" | "right"; x: number; width: number } | null>(null);
  const autoTried = useRef(false);
  const indexingIds = useRef(new Set<string>());
  const contextRequests = useRef(new Map<string, Promise<DocumentContext>>());
  const currentBookId = useRef<string | null>(null);
  const requestBookId = useRef<string | null>(null);
  const language = settings.language;

  const startResize = useCallback((side: "left" | "right", event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStart.current = {
      side,
      x: event.clientX,
      width: side === "left" ? settings.leftPanelWidth : settings.rightPanelWidth,
    };
    setResizing(side);
  }, [settings.leftPanelWidth, settings.rightPanelWidth]);

  const nudgeResize = useCallback((side: "left" | "right", delta: number) => {
    setSettings((previous) => {
      const key = side === "left" ? "leftPanelWidth" : "rightPanelWidth";
      const min = side === "left" ? MIN_LEFT_PANEL : MIN_RIGHT_PANEL;
      const max = side === "left" ? MAX_LEFT_PANEL : MAX_RIGHT_PANEL;
      return { ...previous, [key]: Math.min(max, Math.max(min, previous[key] + delta)) };
    });
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: globalThis.PointerEvent) => {
      const start = resizeStart.current;
      if (!start) return;
      const delta = event.clientX - start.x;
      const next = start.width + (start.side === "left" ? delta : -delta);
      const min = start.side === "left" ? MIN_LEFT_PANEL : MIN_RIGHT_PANEL;
      const max = start.side === "left" ? MAX_LEFT_PANEL : MAX_RIGHT_PANEL;
      const key = start.side === "left" ? "leftPanelWidth" : "rightPanelWidth";
      setSettings((previous) => ({ ...previous, [key]: Math.min(max, Math.max(min, next)) }));
    };
    const finish = () => {
      resizeStart.current = null;
      setResizing(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [resizing]);

  const refreshLibrary = useCallback(async () => {
    setLibrary((await window.pageg.listLibrary()) as BookMeta[]);
    setCatalog((await window.pageg.readCatalog()) as Catalog);
  }, []);

  const recognizeBook = useCallback(
    async (candidate: BookMeta) => {
      if (candidate.metadataStatus === "ready" || candidate.metadataStatus === "manual") return;
      try {
        const buffer = await window.pageg.readPdf(candidate.sourcePath);
        const patch = await extractPdfMetadata(
          buffer,
          candidate.originalFilename || `${candidate.title}.pdf`,
        );
        const enriched = (await window.pageg.updateBookMetadata(candidate.id, patch)) as BookRecord;
        setBook((current) => (current?.id === enriched.id ? enriched : current));
        await refreshLibrary();
      } catch (err) {
        setError(`${tr(language, "desk.metadataError")}：${asError(err)}`);
      }
    },
    [language, refreshLibrary],
  );

  useEffect(() => {
    const pending = library.find(
      (item) =>
        item.metadataStatus !== "ready" &&
        item.metadataStatus !== "manual" &&
        !indexingIds.current.has(item.id),
    );
    if (!pending) return;
    indexingIds.current.add(pending.id);
    void recognizeBook(pending);
  }, [library, recognizeBook]);

  const adoptBook = useCallback(
    async (next: BookRecord | null | undefined) => {
      if (!next) return;
      currentBookId.current = next.id;
      requestBookId.current = null;
      setStream("");
      setLogs("");
      setTurn(null);
      setChatHistory(emptyChatHistory());
      await window.pageg.moveBook(next.id, "");
      const adopted = { ...next, onDesk: true, lastOpenedAt: new Date().toISOString() };
      setError(null);
      setBook(adopted);
      setPage(adopted.lastPage || 1);
      setActiveId(null);
      setReaderSelection(null);
      setSettings((prev) => ({
        ...prev,
        openTabs: prev.openTabs.includes(adopted.id) ? prev.openTabs : [...prev.openTabs, adopted.id],
      }));
      const [log, storedHistory] = await Promise.all([
        window.pageg.readSession(adopted.id).catch(() => ""),
        window.pageg.readChatHistory(adopted.id).catch(() => null),
      ]);
      if (currentBookId.current === adopted.id) {
        const loadedHistory = storedHistory ? normalizeChatHistory(storedHistory) : historyFromLegacySession(log);
        setChatHistory(loadedHistory);
        if (!storedHistory && loadedHistory.sessions.some((session) => session.turns.length > 0)) {
          void window.pageg.saveChatHistory(adopted.id, loadedHistory);
        }
      }
      await refreshLibrary();
      void recognizeBook(adopted);
    },
    [recognizeBook, refreshLibrary],
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
      if (event.kind === "status" && event.status) {
        setStatus(event.status);
        if (event.status.modelId) {
          setSettings((previous) => previous.modelId === event.status?.modelId
            ? previous
            : { ...previous, modelId: event.status?.modelId ?? "" });
        }
      }
      if (event.kind === "log" && event.text) setLogs((prev) => prev + event.text);
      const belongsToOpenBook = requestBookId.current === currentBookId.current;
      if (event.kind === "session_update" && event.text && belongsToOpenBook) setStream((prev) => prev + event.text);
      if (event.kind === "stop" && belongsToOpenBook) setStream((prev) => prev || event.text || prev);
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
      else setError(tr(language, "app.dropPdfError"));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [language, openFromFile]);

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
          else setError(tr(language, "app.dropPdfError"));
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
  }, [language, openFromPath]);

  const openFromLibrary = async (id: string) => {
    try {
      currentBookId.current = id;
      requestBookId.current = null;
      setTurn(null);
      setStream("");
      setLogs("");
      setChatHistory(emptyChatHistory());
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
      currentBookId.current = null;
      requestBookId.current = null;
      setBook(null);
      setTurn(null);
      setStream("");
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
      setCatalog((await window.pageg.moveBook(bookId, shelfId)) as Catalog);
      setBook((current) =>
        current?.id === bookId ? { ...current, onDesk: !shelfId, lastOpenedAt: new Date().toISOString() } : current,
      );
      await refreshLibrary();
    } catch (err) {
      setError(asError(err));
      await refreshLibrary();
    }
  };

  const updateBookMetadata = async (id: string, patch: BookMetadataPatch) => {
    try {
      const updated = (await window.pageg.updateBookMetadata(id, {
        ...patch,
        metadataStatus: "manual",
      })) as BookRecord;
      setBook((current) => (current?.id === id ? updated : current));
      await refreshLibrary();
    } catch (err) {
      setError(asError(err));
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
    scope: AskScope = "page",
  ) => {
    if (!book) return;
    const requestBook = book;
    const requestHistory = chatHistory;
    requestBookId.current = requestBook.id;
    const updateTurn = (next: ReaderTurn | null) => {
      if (currentBookId.current === requestBook.id) setTurn(next);
    };
    if (status.state !== "ready" && status.state !== "prompting") {
      setError(tr(language, "app.connectBeforeAsk"));
      setSetupOpen(true);
      return;
    }
    setStream("");
    setAiTick((n) => n + 1);
    const activeSelection = sel ?? (intent === "ask" ? readerSelection : null);
    const selected = tidyQuote(activeSelection?.text ?? "");
    const targetPage = intent === "ask" && scope === "page" ? page : activeSelection?.page ?? page;
    updateTurn({
      intent,
      quote: selected || extra || "",
      answer: intent === "translate" ? tr(language, "app.translating") : intent === "explain" ? tr(language, "app.explaining") : tr(language, "app.answering"),
      ok: true,
    });
    try {
      let sourceText = "";
      let bookDigest = "";
      let relevantText = "";
      if (intent === "ask") {
        if (scope === "selection") {
          if (!activeSelection?.text.trim()) throw new Error(tr(language, "app.selectText"));
          sourceText = activeSelection.context || activeSelection.text;
        } else {
          let pending = contextRequests.current.get(book.id);
          if (!pending) {
            pending = (async () => {
              const cached = await window.pageg.readDocumentContext(book.id);
              if (validDocumentContext(cached, book.pageCount)) return cached;
              updateTurn({ intent: "ask", quote: extra || "", answer: tr(language, "app.extracting"), ok: true });
              const buffer = await window.pageg.readPdf(book.sourcePath);
              const context = await extractDocumentContext(buffer, (done, total) => {
                updateTurn({
                  intent: "ask",
                  quote: extra || "",
                  answer: tr(language, "app.extractingPage", { done, total }),
                  ok: true,
                });
              });
              await window.pageg.saveDocumentContext(book.id, context);
              return context;
            })();
            contextRequests.current.set(book.id, pending);
          }
          const documentContext = await pending.catch((err) => {
            contextRequests.current.delete(book.id);
            throw err;
          });
          if (scope === "page") {
            sourceText = documentContext.pages.find((item) => item.page === page)?.text ?? "";
              if (!sourceText) throw new Error(language === "en-US" ? `Page ${page} has no extractable text; it may be a scanned PDF.` : `第 ${page} 页没有提取到可读文字，可能是扫描版 PDF。`);
          } else {
            const cachedDigest = await window.pageg.readBookDigest(book.id);
            let digest: BookDigest;
            if (validBookDigest(cachedDigest, documentContext)) {
              digest = cachedDigest;
              updateTurn({ intent: "ask", quote: extra || "", answer: tr(language, "app.digestLoaded"), ok: true });
            } else {
              digest = await buildBookDigest(
                book,
                documentContext,
                (text) => window.pageg.acpPromptIsolated(text),
                (_done, _total, label) =>
                  updateTurn({ intent: "ask", quote: extra || "", answer: `${label}…`, ok: true }),
              );
              await window.pageg.saveBookDigest(book.id, digest);
            }
            bookDigest = digest.summary;
            relevantText = relevantPages(documentContext.pages, `${extra ?? ""}\n${selected}`);
          }
        }
      }

      const prompt = assemblePrompt({
        intent,
        book,
        page: targetPage,
        selected,
        context: tidyQuote(activeSelection?.context ?? ""),
        extra,
        sessionLog: conversationMemory(requestHistory),
        scope,
        sourceText,
        bookDigest,
        relevantText,
      });
      if (intent === "ask") {
        updateTurn({ intent, quote: selected || extra || "", answer: tr(language, "app.readyAnswer"), ok: true });
      }
      const raw =
        intent === "ask" ? await window.pageg.acpPromptIsolated(prompt) : await window.pageg.acpPrompt(prompt);
      const downloadRequest = intent === "ask" && wantsPaperDownload(extra ?? "");
      const extracted = extractPaperDownload(raw, downloadRequest);
      const parsedResult = readerAnswer(extracted.text, intent);
      const result =
        !parsedResult.ok && downloadRequest
          ? {
              ok: true,
              text:
                language === "en-US"
                  ? "I found a paper and am downloading it into your reading desk…"
                  : "我找到了一篇相关论文，正在下载并加载到你的书桌…",
            }
          : parsedResult;
      if (currentBookId.current === requestBook.id) setStream(result.text);
      updateTurn({ intent, quote: selected || extra || "", answer: result.text, ok: result.ok });
      if (!result.ok) {
        setError(result.text);
        return;
      }
      await window.pageg.appendSession(
        book.id,
        sessionBlock(intent, targetPage, selected || extra || "", result.text),
      );
      const nextHistory = appendChatTurn(requestHistory, {
        intent,
        scope: intent === "ask" ? scope : undefined,
        page: targetPage,
        question: selected || extra || (intent === "translate" ? tr(language, "app.translateSelection") : tr(language, "app.explainSelection")),
        answer: result.text,
      });
      await window.pageg.saveChatHistory(requestBook.id, nextHistory);
      if (currentBookId.current === requestBook.id) {
        setChatHistory(nextHistory);
        setTurn(null);
      }
      if (intent !== "ask" && selected && activeSelection) {
        const nextNotes = await window.pageg.appendNote(book.id, noteBlock(activeSelection.page, selected, result.text));
        setBook((prev) =>
          prev?.id === requestBook.id
            ? {
                ...prev,
                notes: nextNotes,
                highlights: [
                  ...prev.highlights,
                  {
                    id: crypto.randomUUID(),
                    page: activeSelection.page,
                    text: selected,
                    color: intent === "translate" ? "#7eb6d9" : "#8fbf6a",
                    note: result.text,
                    rects: activeSelection.rects,
                    createdAt: new Date().toISOString(),
                    kind: intent === "translate" ? "translate" : "explain",
                    style: "highlight",
                  },
                ],
              }
            : prev,
        );
      }
      if (downloadRequest && extracted.candidate) {
        try {
          const downloaded = (await window.pageg.downloadPdf(
            extracted.candidate.url,
            extracted.candidate.filename ?? extracted.candidate.title ?? "",
          )) as BookRecord;
          await adoptBook(downloaded);
        } catch (downloadError) {
          if (currentBookId.current === requestBook.id) {
            setError(
              (language === "en-US" ? "Paper download failed" : "论文下载失败") + "：" + asError(downloadError),
            );
          }
        }
      }
      if (downloadRequest && !extracted.candidate) {
        try {
          const downloaded = (await window.pageg.searchAndDownloadPaper(extra ?? "")) as BookRecord;
          await adoptBook(downloaded);
        } catch (downloadError) {
          if (currentBookId.current === requestBook.id) {
            setError(
              (language === "en-US" ? "Paper search or download failed" : "论文搜索或下载失败") +
                "：" +
                asError(downloadError),
            );
          }
        }
      }
    } catch (err) {
      const message = asError(err);
      updateTurn({ intent, quote: selected || extra || "", answer: message, ok: false });
      if (currentBookId.current === requestBook.id) setError(message);
    }
  };

  const startChatSession = () => {
    if (!book) return;
    const next = createChatSession(chatHistory);
    setChatHistory(next);
    setTurn(null);
    setStream("");
    void window.pageg.saveChatHistory(book.id, next);
  };

  const openChatSession = (id: string) => {
    if (!book) return;
    const next = selectChatSession(chatHistory, id);
    setChatHistory(next);
    setTurn(null);
    setStream("");
    void window.pageg.saveChatHistory(book.id, next);
  };

  const renameSession = (id: string, title: string) => {
    if (!book) return;
    const next = renameChatSession(chatHistory, id, title);
    if (next === chatHistory) return;
    setChatHistory(next);
    void window.pageg.saveChatHistory(book.id, next);
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
      const connected = (await window.pageg.acpConnect({
        agentId,
        cwd,
        customCommand: next.customCommand,
      })) as AcpStatus;
      if (next.modelId && connected.models?.some((model) => model.id === next.modelId) && connected.modelId !== next.modelId) {
        await window.pageg.acpSetModel(next.modelId);
      }
      setSetupOpen(false);
    } catch (err) {
      setSetupOpen(true);
      setError(asError(err));
    }
  };

  const selectModel = async (modelId: string) => {
    setSettings((previous) => ({ ...previous, modelId }));
    try {
      setStatus((previous) => ({ ...previous, modelId, message: `已切换到 ${modelId}` }));
      await window.pageg.acpSetModel(modelId);
    } catch (err) {
      setError(asError(err));
    }
  };

  const chipLabel =
    status.state === "ready"
      ? tr(language, "app.connected", { name: status.agentName ?? (language === "en-US" ? "agent" : "智能体") })
      : status.state === "connecting"
        ? tr(language, "app.connecting", { name: status.agentName ?? (language === "en-US" ? "agent" : "智能体") })
        : status.state === "prompting"
          ? tr(language, "app.working", { name: status.agentName ?? (language === "en-US" ? "agent" : "智能体") })
          : status.state === "error"
            ? tr(language, "app.connectionFailed")
            : tr(language, "app.unconnected");

  const pageLabel = useMemo(() => `${page} / ${pageCount}`, [page, pageCount]);
  const tabs = useMemo(
    () => settings.openTabs.map((id) => library.find((item) => item.id === id) || (book?.id === id ? book : null)).filter(Boolean) as BookMeta[],
    [settings.openTabs, library, book],
  );

  return (
    <div className={`app ${book ? "reading-mode" : "home-mode"} ${dragging ? "dragging" : ""}`}>
      {dragging && book && <div className="drop-overlay">{tr(language, "app.dropImport")}</div>}
      {error && (
        <button className="banner-error" onClick={() => setError(null)}>
          {error}
        </button>
      )}
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => {
            currentBookId.current = null;
            requestBookId.current = null;
            setBook(null);
            setTurn(null);
            setStream("");
          }}
          title={tr(language, "app.backDesk")}
        >
          <b>PAGEG</b>
          <span>{tr(language, "app.subtitle")}</span>
        </button>
        <div className="pager">
          <button className="tiny" disabled={!book || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {tr(language, "app.previous")}
          </button>
          <span className="hint">{book ? pageLabel : tr(language, "app.desk")}</span>
          <button
            className="tiny"
            disabled={!book || page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            {tr(language, "app.next")}
          </button>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`agent-chip ${status.state}`}
            onClick={() => setSetupOpen(true)}
            title={status.message || tr(language, "settings.title")}
          >
            <i className={`status-dot ${status.state}`} />
            <span>{chipLabel}</span>
          </button>
          <button className="ghost" onClick={() => setSetupOpen(true)}>
            {tr(language, "app.environment")}
          </button>
          <button className="solid" onClick={() => void openFromDialog()}>
            {tr(language, "app.importPdf")}
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
        <div className="shell" style={{ "--right-panel-width": `${settings.rightPanelWidth}px` } as CSSProperties}>
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
            if (on) void moveBook(book.id, shelfId);
          }}
          onMark={(sel, options) => addHighlight(sel, options)}
          onTranslate={(sel) => void runIntent("translate", undefined, sel)}
          onExplain={(sel) => void runIntent("explain", undefined, sel)}
          onSaveNote={(sel, note, existingId) => void saveRemark(sel, note, existingId)}
          onUpdate={updateHighlight}
          onDelete={deleteHighlight}
          onSelect={setActiveId}
          onTextSelection={setReaderSelection}
          language={language}
          leftPanelWidth={settings.leftPanelWidth}
          onResizeStart={startResize}
          onResizeNudge={nudgeResize}
          resizing={resizing === "left"}
          />

          <div
            className={`pane-resizer pane-resizer-right ${resizing === "right" ? "active" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={tr(language, "resize.right")}
            tabIndex={0}
            onPointerDown={(event) => startResize("right", event)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") nudgeResize("right", 16);
              if (event.key === "ArrowRight") nudgeResize("right", -16);
              if (event.key === "Home") setSettings((previous) => ({ ...previous, rightPanelWidth: defaultSettings.rightPanelWidth }));
            }}
            title={tr(language, "resize.right")}
          />

          <SidePanel
          book={book}
          settings={settings}
          status={status}
          stream={stream}
          logs={logs}
          activeId={activeId}
          turn={turn}
          chatHistory={chatHistory}
          aiTick={aiTick}
          onNotes={(notes) => setBook((prev) => (prev ? { ...prev, notes } : prev))}
          onGlossary={(glossary) => setBook((prev) => (prev ? { ...prev, glossary } : prev))}
          onConnect={() => void connect()}
          onModel={(modelId) => void selectModel(modelId)}
          onDisconnect={() => void window.pageg.acpDisconnect()}
          onAsk={({ question, scope }) => void runIntent("ask", question, null, scope)}
          onNewSession={startChatSession}
          onSelectSession={openChatSession}
          onRenameSession={renameSession}
          onJumpPage={setPage}
          selection={readerSelection}
          onClearSelection={() => setReaderSelection(null)}
          onCancel={() => void window.pageg.acpCancel()}
          onJump={(mark) => {
            setPage(mark.page);
            setActiveId(mark.id);
          }}
          onDeleteMark={deleteHighlight}
          language={language}
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
          onUpdateMetadata={(id, patch) => void updateBookMetadata(id, patch)}
          language={language}
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
        language={language}
        onResetLayout={() => setSettings((previous) => ({
          ...previous,
          leftPanelWidth: defaultSettings.leftPanelWidth,
          rightPanelWidth: defaultSettings.rightPanelWidth,
        }))}
      />
    </div>
  );
}
