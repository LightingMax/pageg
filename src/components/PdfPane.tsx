import { memo, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BookMeta, Catalog, Handedness, Highlight, MarkOptions, MarkStyle, SelectionPayload } from "../lib/types";
import { startPaint } from "../lib/pdf-render";
import ActionRail, { COLORS } from "./ActionRail";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const THUMB_WIDTH = 108;
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.75;
const ZOOM_STEP = 0.125;
const ZOOM_WHEEL_STEP = 0.05;
const ZOOM_WHEEL_INTERVAL_MS = 70;

type PdfDoc = PDFDocumentProxy;
type PageMetric = { w: number; h: number };

type Props = {
  sourcePath: string | null;
  page: number;
  highlights: Highlight[];
  activeId: string | null;
  library: BookMeta[];
  currentBookId?: string;
  onPageCount: (n: number) => void;
  onPageChange: (n: number) => void;
  onOpenBook: (id: string) => void;
  onImport: () => void;
  onUploadFile: (file: File) => void;
  handedness: Handedness;
  catalog: Catalog;
  currentShelf: string;
  onSelectShelf: (id: string) => void;
  onCreateShelf: (name: string) => void;
  onAssignBook: (shelfId: string, on: boolean) => void;
  onMark: (sel: SelectionPayload, options?: MarkOptions) => void;
  onTranslate: (sel: SelectionPayload) => void;
  onExplain: (sel: SelectionPayload) => void;
  onSaveNote: (sel: SelectionPayload, note: string, existingId?: string) => void;
  onUpdate: (id: string, patch: Partial<Highlight>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onTextSelection: (selection: SelectionPayload) => void;
};

function hitTest(highlights: Highlight[], x: number, y: number) {
  return highlights.find((h) =>
    h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
  );
}

function tidyLayerText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function pageStageForNode(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-page]") ?? null;
}

const Thumbnail = memo(function Thumbnail({
  pdf,
  pageNumber,
  metric,
  active,
  onOpen,
}: {
  pdf: PdfDoc;
  pageNumber: number;
  metric: PageMetric;
  active: boolean;
  onOpen: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    let cancelled = false;
    let painted = false;
    const run = async () => {
      if (painted || cancelled) return;
      painted = true;
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const { task } = startPaint(page, canvas, THUMB_WIDTH / metric.w);
      try {
        await task.promise;
      } catch (error) {
        painted = false;
        if ((error as { name?: string }).name === "RenderingCancelledException") return;
        throw error;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void run();
      },
      { rootMargin: "200px" },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [pdf, pageNumber, metric.w]);

  return (
    <button
      ref={rootRef}
      type="button"
      className={`thumb ${active ? "active" : ""}`}
      data-thumb={pageNumber}
      onClick={onOpen}
    >
      <canvas ref={canvasRef} />
      <small>{pageNumber}</small>
    </button>
  );
});

const PageSheet = memo(function PageSheet({
  pdf,
  pageNumber,
  cssWidth,
  metric,
  highlights,
  activeId,
  onSelect,
}: {
  pdf: PdfDoc;
  pageNumber: number;
  cssWidth: number;
  metric: PageMetric;
  highlights: Highlight[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const cssScale = cssWidth / metric.w;
  const cssH = metric.h * cssScale;
  const pageHighlights = highlights.filter((h) => h.page === pageNumber);

  useEffect(() => {
    const slot = slotRef.current;
    const canvas = canvasRef.current;
    const textLayerDiv = textRef.current;
    if (!slot || !canvas || !textLayerDiv) return;
    let cancelled = false;
    let painted = false;
    let task: { cancel: () => void } | null = null;

    const paint = async () => {
      if (painted || cancelled) return;
      painted = true;
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: cssScale });
      try {
        const started = startPaint(page, canvas, cssScale);
        task = started.task;
        await started.task.promise;
      } catch (error) {
        painted = false;
        if ((error as { name?: string }).name === "RenderingCancelledException") return;
        throw error;
      }
      if (cancelled) return;
      const textContent = await page.getTextContent();
      if (cancelled) return;
      textLayerDiv.replaceChildren();
      textLayerDiv.className = "textLayer";
      textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
      textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
      const layer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await layer.render();
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void paint();
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(slot);
    return () => {
      cancelled = true;
      task?.cancel();
      io.disconnect();
    };
  }, [pdf, pageNumber, cssScale]);

  return (
    <div
      ref={slotRef}
      id={`pdf-page-${pageNumber}`}
      data-page={pageNumber}
      className="page-stage"
      style={{
        width: cssWidth,
        height: cssH,
        ["--total-scale-factor" as string]: String(cssScale),
      }}
    >
      <canvas ref={canvasRef} />
      <div className="hl-layer">
        {pageHighlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              className={`hl style-${h.style ?? "highlight"} ${h.note ? "has-note" : ""} ${h.id === activeId ? "selected" : ""}`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                ["--hl-color" as string]: h.color || COLORS[0],
              }}
            />
          )),
        )}
      </div>
      <div ref={textRef} className="textLayer" />
      {pageHighlights
        .filter((h) => h.kind === "tag")
        .map((tag, index) => (
          <button
            key={`tag-${tag.id}`}
            type="button"
            className={`page-tag ${tag.id === activeId ? "active" : ""}`}
            style={{
              top: `${Math.max(1, Math.min(94, (tag.rects[0]?.y ?? 0.08) * 100))}%`,
              ["--tag-color" as string]: tag.color || COLORS[2],
              transform: `translateY(${index * 3}px)`,
            }}
            title={`跳到标签：${tag.label || tag.text}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(tag.id)}
          >
            {tag.label || "标签"}
          </button>
        ))}
    </div>
  );
});

export default function PdfPane({
  sourcePath,
  page,
  highlights,
  activeId,
  library,
  currentBookId,
  onPageCount,
  onPageChange,
  onOpenBook,
  onImport,
  onUploadFile,
  handedness,
  catalog,
  currentShelf,
  onSelectShelf,
  onCreateShelf,
  onAssignBook,
  onMark,
  onTranslate,
  onExplain,
  onSaveNote,
  onUpdate,
  onDelete,
  onSelect,
  onTextSelection,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const reported = useRef(page);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [metrics, setMetrics] = useState<PageMetric[]>([]);
  const [paneWidth, setPaneWidth] = useState(820);
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shelfName, setShelfName] = useState("");
  const wheelZoomLastAt = useRef<number | null>(null);
  const wheelZoomDirection = useRef(0);

  const active = highlights.find((h) => h.id === activeId) ?? null;

  useEffect(() => {
    if (!sourcePath) {
      setPdf(null);
      setMetrics([]);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void window.pageg
      .readPdf(sourcePath)
      .then(async (buffer) => {
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(buffer),
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
        }).promise;
        const sizes = await Promise.all(
          Array.from({ length: doc.numPages }, async (_, i) => {
            const pdfPage = await doc.getPage(i + 1);
            const viewport = pdfPage.getViewport({ scale: 1 });
            return { w: viewport.width, h: viewport.height };
          }),
        );
        if (cancelled) return;
        setPdf(doc);
        setMetrics(sizes);
        onPageCount(doc.numPages);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPdf(null);
        setMetrics([]);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourcePath, onPageCount]);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const measure = () => setPaneWidth(Math.max(520, el.clientWidth - 48));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf, sourcePath]);

  useEffect(() => {
    reported.current = page;
  }, [sourcePath]);

  useEffect(() => {
    const root = pagesRef.current;
    if (!root || !pdf) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = root.getBoundingClientRect().top + Math.min(120, root.clientHeight * 0.18);
      let next = reported.current;
      for (const node of root.querySelectorAll<HTMLElement>("[data-page]")) {
        const box = node.getBoundingClientRect();
        if (box.top <= y && box.bottom > y) {
          next = Number(node.dataset.page);
          break;
        }
      }
      if (next && next !== reported.current) {
        reported.current = next;
        onPageChange(next);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pdf, metrics.length, onPageChange]);

  useEffect(() => {
    const root = pagesRef.current;
    if (!root || !pdf) return;
    wheelZoomLastAt.current = null;
    wheelZoomDirection.current = 0;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement | null)?.closest(".reader-tools")) return;
      if (!event.deltaY) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const now = performance.now();
      if (direction !== wheelZoomDirection.current) wheelZoomLastAt.current = null;
      if (wheelZoomLastAt.current !== null && now - wheelZoomLastAt.current < ZOOM_WHEEL_INTERVAL_MS) return;
      wheelZoomLastAt.current = now;
      wheelZoomDirection.current = direction;
      setZoom((value) =>
        Math.max(
          ZOOM_MIN,
          Math.min(ZOOM_MAX, value + direction * ZOOM_WHEEL_STEP),
        ),
      );
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [pdf]);

  useEffect(() => {
    document
      .querySelector<HTMLElement>(`.thumb[data-thumb='${page}']`)
      ?.scrollIntoView({ block: "nearest" });
  }, [page]);

  useEffect(() => {
    if (!pdf) return;
    if (page === reported.current) {
      const current = document.getElementById(`pdf-page-${page}`);
      const root = pagesRef.current;
      if (current && root) {
        const box = current.getBoundingClientRect();
        const rootBox = root.getBoundingClientRect();
        if (box.top < rootBox.bottom - 40 && box.bottom > rootBox.top + 40) return;
      }
    }
    reported.current = page;
    document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ block: "start" });
  }, [page, pdf, metrics.length]);

  useEffect(() => {
    if (!activeId) return;
    const found = highlights.find((h) => h.id === activeId);
    if (found) {
      if (found.kind === "tag") {
        setTagDraft(found.label ?? "");
        setTagOpen(true);
        setNoteOpen(false);
      } else {
        setNoteDraft(found.note ?? "");
        setNoteOpen(true);
        setTagOpen(false);
      }
    }
  }, [activeId]);

  useEffect(() => {
    let selectionTimer = 0;
    let dragStart: { stage: HTMLElement; x: number; y: number } | null = null;

    const showSelection = (stage: HTMLElement, text: string, rects: Highlight["rects"]) => {
      if (rects.length === 0) return false;
      const pageNumber = Number(stage.dataset.page);
      const pageBox = stage.getBoundingClientRect();
      const last = rects.at(-1);
      const nearby = tidyLayerText(stage.querySelector(".textLayer")?.textContent ?? "");
      const idx = nearby.indexOf(text);
      const context = idx >= 0 ? nearby.slice(Math.max(0, idx - 280), idx + text.length + 280) : text;
      setNoteOpen(false);
      setTagOpen(false);
      onSelect(null);
      const nextSelection = {
        page: pageNumber,
        text,
        context,
        rects,
        x: last ? (last.x + last.w) * pageBox.width : 24,
        y: last ? last.y * pageBox.height : 24,
      };
      setSelection(nextSelection);
      onTextSelection(nextSelection);
      if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => undefined);
      return true;
    };

    const captureTextSelection = () => {
      const sel = window.getSelection();
      const text = tidyLayerText(sel?.toString() ?? "");
      if (!text || !sel || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      const stage = pageStageForNode(range.startContainer);
      if (!stage || !pagesRef.current?.contains(stage)) return false;
      const pageBox = stage.getBoundingClientRect();
      const rects = [...range.getClientRects()]
        .filter(
          (r) =>
            r.width > 1 &&
            r.height > 1 &&
            r.right > pageBox.left &&
            r.left < pageBox.right &&
            r.bottom > pageBox.top &&
            r.top < pageBox.bottom,
        )
        .map((r) => ({
          x: Math.max(0, r.left - pageBox.left) / pageBox.width,
          y: Math.max(0, r.top - pageBox.top) / pageBox.height,
          w: Math.max(0, Math.min(r.right, pageBox.right) - Math.max(r.left, pageBox.left)) / pageBox.width,
          h: Math.max(0, Math.min(r.bottom, pageBox.bottom) - Math.max(r.top, pageBox.top)) / pageBox.height,
        }));
      return showSelection(stage, text, rects);
    };

    const captureDragSelection = (event: MouseEvent, origin: NonNullable<typeof dragStart>) => {
      if (!pagesRef.current?.contains(origin.stage)) return false;
      const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (distance < 5) return false;
      const pageBox = origin.stage.getBoundingClientRect();
      const x1 = Math.min(origin.x, event.clientX);
      const x2 = Math.max(origin.x, event.clientX);
      const sameLine = Math.abs(event.clientY - origin.y) < 14;
      const y1 = sameLine ? Math.min(origin.y, event.clientY) - 9 : Math.min(origin.y, event.clientY);
      const y2 = sameLine ? Math.max(origin.y, event.clientY) + 9 : Math.max(origin.y, event.clientY);
      const pieces = [...origin.stage.querySelectorAll<HTMLElement>(".textLayer span")]
        .map((node) => ({ node, box: node.getBoundingClientRect() }))
        .filter(({ node, box }) => {
          const value = tidyLayerText(node.textContent ?? "");
          return value && box.width > 1 && box.height > 1 && box.right >= x1 && box.left <= x2 && box.bottom >= y1 && box.top <= y2;
        });
      const text = tidyLayerText(pieces.map(({ node }) => node.textContent ?? "").join(" "));
      if (!text) return false;
      const rects = pieces.map(({ box }) => ({
        x: Math.max(0, box.left - pageBox.left) / pageBox.width,
        y: Math.max(0, box.top - pageBox.top) / pageBox.height,
        w: Math.max(0, Math.min(box.right, pageBox.right) - Math.max(box.left, pageBox.left)) / pageBox.width,
        h: Math.max(0, Math.min(box.bottom, pageBox.bottom) - Math.max(box.top, pageBox.top)) / pageBox.height,
      }));
      return showSelection(origin.stage, text, rects);
    };

    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const stage = target?.closest<HTMLElement>("[data-page]") ?? null;
      dragStart = stage && pagesRef.current?.contains(stage) ? { stage, x: event.clientX, y: event.clientY } : null;
    };

    const onUp = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const origin = dragStart;
      dragStart = null;
      if (target?.closest(".sel-bar, .note-pop, .tag-pop, .page-tag, .dropzone, .nav-left, .action-rail")) return;
      if (captureTextSelection()) return;
      if (origin && captureDragSelection(event, origin)) return;
      const stage = target?.closest<HTMLElement>("[data-page]");
      if (!stage || !pagesRef.current?.contains(stage)) return;
      const pageNumber = Number(stage.dataset.page);
      const pageBox = stage.getBoundingClientRect();
      const x = (event.clientX - pageBox.left) / pageBox.width;
      const y = (event.clientY - pageBox.top) / pageBox.height;
      const hit = hitTest(highlights.filter((h) => h.page === pageNumber), x, y);
      if (hit) {
        setSelection(null);
        onSelect(hit.id);
        return;
      }
      setSelection(null);
      setNoteOpen(false);
      setTagOpen(false);
      onSelect(null);
    };

    const onSelectionChange = () => {
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(() => {
        captureTextSelection();
      }, 140);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      window.clearTimeout(selectionTimer);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [highlights, onSelect, onTextSelection]);

  const mark = (style: MarkStyle, color = COLORS[0]) => {
    if (!selection) return;
    onMark(selection, { kind: "mark", style, color });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  useEffect(() => {
    if (!selection || noteOpen || tagOpen) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      if (key === "h") {
        event.preventDefault();
        mark("highlight");
      } else if (key === "u") {
        event.preventDefault();
        mark("underline");
      } else if (key === "s") {
        event.preventDefault();
        mark("strike");
      } else if (key === "n") {
        event.preventDefault();
        openNote();
      } else if (key === "b") {
        event.preventDefault();
        openTag();
      } else if (key === "t") {
        event.preventDefault();
        onTranslate(selection);
        setSelection(null);
      } else if (key === "e") {
        event.preventDefault();
        onExplain(selection);
        setSelection(null);
      } else if (key === "escape") {
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, noteOpen, tagOpen]);

  const openNote = () => {
    if (selection) {
      setNoteDraft("");
      setNoteOpen(true);
      setTagOpen(false);
      return;
    }
    if (active) {
      setNoteDraft(active.note ?? "");
      setNoteOpen(true);
    }
  };

  const openTag = () => {
    setTagDraft(active?.kind === "tag" ? active.label ?? "" : "");
    setTagOpen(true);
    setNoteOpen(false);
  };

  const saveTag = () => {
    const label = tagDraft.trim();
    if (!label) return;
    if (active?.kind === "tag") {
      onUpdate(active.id, { label });
    } else if (selection) {
      onMark(selection, {
        kind: "tag",
        label,
        style: "underline",
        color: COLORS[2],
      });
    }
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setTagOpen(false);
  };

  const saveNote = () => {
    if (active) {
      onSaveNote(
        {
          page: active.page,
          text: active.text,
          context: active.text,
          rects: active.rects,
          x: 24,
          y: 24,
        },
        noteDraft,
        active.id,
      );
      setNoteOpen(false);
      return;
    }
    if (!selection) return;
    onSaveNote(selection, noteDraft);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setNoteOpen(false);
  };

  const pickFile = () => fileRef.current?.click();
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/pdf"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) onUploadFile(file);
      }}
    />
  );

  const overlayPage = active?.page ?? selection?.page;
  const overlayStage = overlayPage
    ? pagesRef.current?.querySelector<HTMLElement>(`[data-page='${overlayPage}']`)
    : null;
  const overlayBox = overlayStage
    ? { w: overlayStage.clientWidth, h: overlayStage.clientHeight }
    : { w: paneWidth, h: 400 };
  const popX = active
    ? Math.min((active.rects.at(-1)?.x ?? 0.05) * overlayBox.w, overlayBox.w - 300)
    : selection
      ? Math.min(selection.x, overlayBox.w - 300)
      : 24;
  const popY = active
    ? Math.max(8, (active.rects[0]?.y ?? 0.1) * overlayBox.h - 12)
    : selection
      ? Math.max(8, selection.y - 48)
      : 24;

  return (
    <div className="reader-wrap">
      {fileInput}
      <aside className="nav-left">
        <h2>书架</h2>
        <select
          value={currentShelf}
          onChange={(e) => onSelectShelf(e.target.value)}
        >
          <option value="">全部书</option>
          {catalog.shelves.map((shelf) => (
            <option key={shelf.id} value={shelf.id}>
              {shelf.name}
            </option>
          ))}
        </select>
        <form
          className="shelf-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!shelfName.trim()) return;
            onCreateShelf(shelfName.trim());
            setShelfName("");
          }}
        >
          <input
            value={shelfName}
            placeholder="新建书架"
            onChange={(e) => setShelfName(e.target.value)}
          />
        </form>
        {currentBookId && catalog.shelves.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAssignBook(e.target.value, true);
            }}
          >
            <option value="">放到书架…</option>
            {catalog.shelves.map((shelf) => (
              <option key={shelf.id} value={shelf.id}>
                {shelf.name}
              </option>
            ))}
          </select>
        )}
        <div className="library-mini">
          {library.length === 0 && <p className="empty">还没有书。</p>}
          {(currentShelf
            ? library.filter((item) => catalog.shelves.find((s) => s.id === currentShelf)?.bookIds.includes(item.id))
            : library
          ).map((item) => (
            <button
              key={item.id}
              className={`book-item ${currentBookId === item.id ? "active" : ""}`}
              onClick={() => onOpenBook(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
        {pdf && (
          <>
            <h2>页面</h2>
            <div ref={thumbsRef} className="thumbs">
              {metrics.map((metric, i) => (
                <Thumbnail
                  key={i + 1}
                  pdf={pdf}
                  pageNumber={i + 1}
                  metric={metric}
                  active={page === i + 1}
                  onOpen={() => {
                    reported.current = i + 1;
                    onPageChange(i + 1);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </aside>

      <div ref={pagesRef} className="reader">
        {pdf && (
          <div className="reader-tools" aria-label="PDF 阅读工具">
            <button className="tiny" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}>
              −
            </button>
            <button className="zoom-value" onClick={() => setZoom(1)} title="适合宽度">
              {Math.round(zoom * 100)}%
            </button>
            <button className="tiny" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}>
              +
            </button>
            <span>拖选文字后可高亮、划线、备注或添加标签；按住 Ctrl/⌘ 滚轮可细调缩放</span>
          </div>
        )}
        {!sourcePath && (
          <div className="dropzone">
            <h2>把 PDF 拖进来</h2>
            <p className="hint">导入后划词，点翻译或解释。AI 只动你点的那一句，PDF 本身不会被改。</p>
            <div className="dropzone-actions">
              <button className="solid" onClick={onImport}>
                选择 PDF
              </button>
              <button className="ghost" onClick={pickFile}>
                上传文件
              </button>
            </div>
          </div>
        )}
        {loadError && (
          <div className="dropzone">
            <h2>打不开这份 PDF</h2>
            <p className="hint">{loadError}</p>
            <div className="dropzone-actions">
              <button className="solid" onClick={onImport}>
                重新导入
              </button>
            </div>
          </div>
        )}
        {loading && <p className="hint reader-status">正在打开 PDF…</p>}
        {pdf &&
          metrics.map((metric, i) => (
            <PageSheet
              key={i + 1}
              pdf={pdf}
              pageNumber={i + 1}
              cssWidth={paneWidth * zoom}
              metric={metric}
              highlights={highlights}
              activeId={activeId}
              onSelect={(id) => onSelect(id)}
            />
          ))}
        {selection && !noteOpen && !tagOpen && overlayStage && (
          <ActionRail
            selection={selection}
            handedness={handedness}
            stageLeft={overlayStage.offsetLeft}
            stageTop={overlayStage.offsetTop}
            stageWidth={overlayBox.w}
            stageHeight={overlayBox.h}
            onMark={(style, color) => mark(style, color)}
            onNote={openNote}
            onTag={openTag}
            onTranslate={() => {
              onTranslate(selection);
              setSelection(null);
            }}
            onExplain={() => {
              onExplain(selection);
              setSelection(null);
            }}
          />
        )}
        {tagOpen && (selection || active?.kind === "tag") && overlayStage && (
          <div
            className="tag-pop"
            style={{
              position: "absolute",
              left: overlayStage.offsetLeft + Math.max(8, popX - 80),
              top: overlayStage.offsetTop + popY,
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <b>{active?.kind === "tag" ? "编辑标签" : "给这里加标签"}</b>
            <p className="quote">{(active?.text ?? selection?.text ?? "").slice(0, 120)}</p>
            <input
              value={tagDraft}
              placeholder="例如：核心结论、待复习、案例"
              maxLength={24}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveTag();
                if (event.key === "Escape") setTagOpen(false);
              }}
              autoFocus
            />
            <div className="note-actions">
              <button className="solid" onClick={saveTag} disabled={!tagDraft.trim()}>
                保存标签
              </button>
              {active?.kind === "tag" && (
                <button className="ghost" onClick={() => onDelete(active.id)}>
                  删除
                </button>
              )}
              <button className="ghost" onClick={() => setTagOpen(false)}>
                取消
              </button>
            </div>
          </div>
        )}
        {noteOpen && (selection || active) && overlayStage && (
          <div
            className="note-pop"
            style={{
              position: "absolute",
              left: overlayStage.offsetLeft + Math.max(8, popX - 40),
              top: overlayStage.offsetTop + popY,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="quote">{(active?.text ?? selection?.text ?? "").slice(0, 180)}</p>
            <textarea
              value={noteDraft}
              placeholder="写下这句的备注，只存在本地"
              onChange={(e) => setNoteDraft(e.target.value)}
              autoFocus
            />
            <div className="note-actions">
              <button className="solid" onClick={saveNote}>
                保存备注
              </button>
              {active && (
                <button className="ghost" onClick={() => onDelete(active.id)}>
                  删除标注
                </button>
              )}
              <button className="ghost" onClick={() => setNoteOpen(false)}>
                取消
              </button>
            </div>
            {active && (
              <div className="color-dots">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    className="dot"
                    style={{ background: color }}
                    onClick={() => onUpdate(active.id, { color, style: "highlight" })}
                  />
                ))}
                <button className="tiny" onClick={() => onUpdate(active.id, { style: "underline" })}>
                  下划线
                </button>
                <button className="tiny" onClick={() => onUpdate(active.id, { style: "strike" })}>
                  删除线
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
