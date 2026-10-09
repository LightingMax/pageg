import { useMemo, useRef, useState } from "react";
import type { BookMeta, BookMetadataPatch, Catalog, Shelf } from "../lib/types";

type Props = {
  library: BookMeta[];
  catalog: Catalog;
  dragging: boolean;
  onOpenBook: (id: string) => void;
  onImport: () => void;
  onUploadFile: (file: File) => void;
  onCreateShelf: (name: string) => void;
  onRenameShelf: (id: string, name: string) => void;
  onDeleteShelf: (id: string) => void;
  onMoveBook: (bookId: string, shelfId: string) => void;
  onUpdateMetadata: (id: string, patch: BookMetadataPatch) => void;
};

const BOOK_COLORS = ["#8f3f32", "#315f64", "#bd7b3d", "#596b3c", "#715071", "#234a6a", "#a45245"];

function hash(value: string) {
  let result = 17;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function shortTitle(title: string) {
  return title.replace(/\.pdf$/i, "").slice(0, 34);
}

function activity(book: BookMeta) {
  const raw = book.lastOpenedAt || book.updatedAt || book.createdAt;
  return /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) || 0;
}

function BookSpine({ book, index, onOpen }: { book: BookMeta; index: number; onOpen: () => void }) {
  const value = hash(book.id);
  const style = {
    ["--book-color" as string]: BOOK_COLORS[value % BOOK_COLORS.length],
    ["--book-width" as string]: `${148 + (value % 5) * 14}px`,
    ["--book-thickness" as string]: `${24 + (value % 4) * 5}px`,
    ["--book-shift" as string]: `${((value >> 3) % 15) - 7}px`,
    ["--book-tilt" as string]: `${((value >> 5) % 5) - 2}deg`,
    ["--book-delay" as string]: `${index * 45}ms`,
  };

  return (
    <button
      type="button"
      className="desk-book"
      style={style}
      draggable
      title={`打开《${book.title}》；也可以拖到其他书堆`}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-pageg-book", book.id);
        event.dataTransfer.setData("text/plain", book.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <span className="book-cap" />
      <span className="book-title">{shortTitle(book.title)}</span>
      <span className="book-page-lines" />
    </button>
  );
}

function BookStack({ shelf, books, selected, onSelect, onOpenBook, onDropBook }: {
  shelf: Shelf;
  books: BookMeta[];
  selected: boolean;
  onSelect: () => void;
  onOpenBook: (id: string) => void;
  onDropBook: (bookId: string) => void;
}) {
  return (
    <section
      className={`book-stack ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-pageg-book")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        event.currentTarget.classList.add("drag-target");
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove("drag-target")}
      onDrop={(event) => {
        const bookId = event.dataTransfer.getData("application/x-pageg-book");
        if (!bookId) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove("drag-target");
        onDropBook(bookId);
      }}
    >
      <div className="stack-books" aria-label={`${shelf.name}，${books.length} 本`}>
        {books.length > 0 ? books.slice(0, 7).map((book, index) => (
          <BookSpine key={book.id} book={book} index={index} onOpen={() => onOpenBook(book.id)} />
        )) : (
          <div className="empty-stack"><span>{shelf.id ? "把书拖到这里" : "最近阅读会留在这里"}</span></div>
        )}
      </div>
      <button type="button" className="stack-label" onClick={onSelect}>
        <span>{shelf.name}</span><small>{books.length} 本</small>
      </button>
    </section>
  );
}

export default function DeskHome({
  library, catalog, dragging, onOpenBook, onImport, onUploadFile, onCreateShelf,
  onRenameShelf, onDeleteShelf, onMoveBook, onUpdateMetadata,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const [newShelf, setNewShelf] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [indexOpen, setIndexOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthors, setEditAuthors] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editDoi, setEditDoi] = useState("");
  const [targetShelf, setTargetShelf] = useState("");

  const assignedIds = useMemo(() => new Set(catalog.shelves.flatMap((shelf) => shelf.bookIds)), [catalog.shelves]);
  const deskBooks = useMemo(
    () => library.filter((book) => book.onDesk !== false && !assignedIds.has(book.id)).sort((a, b) => activity(b) - activity(a)),
    [assignedIds, library],
  );
  const recentBooks = deskBooks.slice(0, 7);
  const recentShelf: Shelf = { id: "", name: "最近在读", bookIds: recentBooks.map((book) => book.id) };
  const stacks: Shelf[] = [recentShelf, ...catalog.shelves];
  const selected = selectedShelf === null ? null : stacks.find((shelf) => shelf.id === selectedShelf) ?? null;
  const selectedBooks = selected ? library.filter((book) => selected.bookIds.includes(book.id)) : [];
  const pendingCount = library.filter((book) => book.metadataStatus !== "ready" && book.metadataStatus !== "manual").length;
  const indexBooks = library
    .filter((book) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return [book.title, book.originalFilename, book.authors.join(" "), book.year, book.doi, book.subject]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    })
    .sort((a, b) => activity(b) - activity(a));
  const selectedBook = library.find((book) => book.id === selectedBookId) ?? null;

  const chooseShelf = (shelf: Shelf) => {
    setIndexOpen(false);
    setSelectedShelf(shelf.id);
    setRenameDraft(shelf.name);
  };

  const chooseIndexBook = (book: BookMeta) => {
    setSelectedBookId(book.id);
    setEditTitle(book.title);
    setEditAuthors(book.authors.join("; "));
    setEditYear(book.year ?? "");
    setEditDoi(book.doi ?? "");
    setTargetShelf(catalog.shelves.find((item) => item.bookIds.includes(book.id))?.id ?? "");
  };

  return (
    <main className={`desk-home ${dragging ? "receiving" : ""}`}>
      <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onUploadFile(file);
      }} />
      <div className="desk-wall">
        <div className="window-light" aria-hidden="true"><i /><i /><i /></div>
        <button type="button" className="index-cabinet" onClick={() => { setSelectedShelf(null); setIndexOpen(true); }}>
          <span className="cabinet-tabs"><i /><i /><i /></span>
          <b>文献索引</b>
          <small>{library.length} 篇文献 · {pendingCount ? `${pendingCount} 篇识别中` : "信息已整理"}</small>
        </button>
        <div className="desk-welcome">
          <span className="eyebrow">YOUR READING DESK</span>
          <h1>今天，从哪一页开始？</h1>
          <p>新导入的文献会自动识别题名、作者、年份和 DOI。最近阅读留在桌面，其余可以拖回书架。</p>
        </div>
      </div>

      <div className="desk-surface">
        <div className="desk-lamp" aria-hidden="true"><i /><b /><span /></div>
        <div className="pencil-cup" aria-hidden="true"><i /><i /><i /><span /></div>
        <button type="button" className="reading-mat" onClick={onImport}>
          <span className="mat-corners" />
          <b>{dragging ? "松开，放到书桌上" : "把 PDF 放到这里"}</b>
          <small>导入后自动识别并建立索引</small><i>PDF</i>
        </button>

        <div className="desk-stacks">
          {stacks.map((shelf) => (
            <BookStack
              key={shelf.id || "recent"}
              shelf={shelf}
              books={shelf.id ? library.filter((book) => shelf.bookIds.includes(book.id)) : recentBooks}
              selected={selectedShelf !== null && selectedShelf === shelf.id}
              onSelect={() => chooseShelf(shelf)}
              onOpenBook={onOpenBook}
              onDropBook={(bookId) => onMoveBook(bookId, shelf.id)}
            />
          ))}
          {library.length === 0 && <div className="first-book"><b>桌面还是空的</b><span>把第一份 PDF 拖到中央阅读垫上。</span></div>}
        </div>

        <form className="new-stack-card" onSubmit={(event) => {
          event.preventDefault();
          const name = newShelf.trim();
          if (!name) return;
          onCreateShelf(name);
          setNewShelf("");
        }}>
          <label htmlFor="new-shelf">新建一摞</label>
          <div>
            <input id="new-shelf" value={newShelf} maxLength={30} placeholder="例如：机器学习" onChange={(event) => setNewShelf(event.target.value)} />
            <button className="solid" type="submit" disabled={!newShelf.trim()}>创建</button>
          </div>
        </form>
      </div>

      {selected && (
        <aside className="shelf-drawer">
          <div className="drawer-heading">
            <div><span className="eyebrow">当前书堆</span><h2>{selected.name}</h2></div>
            <button className="ghost" onClick={() => setSelectedShelf(null)}>收起</button>
          </div>
          {selected.id && <div className="shelf-actions">
            <input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={30} />
            <button className="tiny" disabled={!renameDraft.trim()} onClick={() => onRenameShelf(selected.id, renameDraft.trim())}>重命名</button>
            <button className="tiny danger" onClick={() => { onDeleteShelf(selected.id); setSelectedShelf(null); }}>删除书堆</button>
          </div>}
          <div className="drawer-books">
            {selectedBooks.map((item) => <button key={item.id} className="drawer-book" onClick={() => onOpenBook(item.id)}>
              <b>{shortTitle(item.title)}</b>
              <small>{item.authors.slice(0, 2).join("、") || "作者待识别"} · 上次读到第 {item.lastPage || 1} 页</small>
            </button>)}
            {selectedBooks.length === 0 && <p className="empty">这摞还没有书。可把其他书拖到这里。</p>}
          </div>
        </aside>
      )}

      {indexOpen && <aside className="library-index">
        <div className="drawer-heading">
          <div><span className="eyebrow">LOCAL LIBRARY</span><h2>文献索引</h2></div>
          <button className="ghost" onClick={() => setIndexOpen(false)}>收起</button>
        </div>
        <input className="index-search" value={query} placeholder="搜索题名、作者、年份或 DOI" onChange={(event) => setQuery(event.target.value)} autoFocus />
        <div className="index-layout">
          <div className="index-results">
            {indexBooks.map((item) => <button key={item.id} className={`index-entry ${selectedBookId === item.id ? "active" : ""}`} onClick={() => chooseIndexBook(item)}>
              <span className={`metadata-dot ${item.metadataStatus || "pending"}`} />
              <span>
                <b>{item.title}</b>
                <small>{item.authors.slice(0, 3).join("、") || "正在从首页识别作者"}</small>
                <em>{[item.year, item.doi, `${item.pageCount ?? "?"} 页`].filter(Boolean).join(" · ")}</em>
              </span>
            </button>)}
            {indexBooks.length === 0 && <p className="empty">没有匹配的文献。</p>}
          </div>
          {selectedBook && <form className="metadata-editor" onSubmit={(event) => {
            event.preventDefault();
            onUpdateMetadata(selectedBook.id, {
              title: editTitle.trim(),
              authors: editAuthors.split(/[;；\n]+/).map((value) => value.trim()).filter(Boolean),
              year: editYear.trim(),
              doi: editDoi.trim(),
            });
          }}>
            <div className="metadata-status"><span className={`metadata-dot ${selectedBook.metadataStatus || "pending"}`} />{selectedBook.metadataStatus === "ready" ? "已自动识别" : selectedBook.metadataStatus === "manual" ? "已人工校正" : "等待识别"}</div>
            <label>题名<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
            <label>作者<textarea value={editAuthors} onChange={(event) => setEditAuthors(event.target.value)} placeholder="多位作者用分号分隔" /></label>
            <div className="metadata-row">
              <label>年份<input value={editYear} onChange={(event) => setEditYear(event.target.value)} /></label>
              <label>DOI<input value={editDoi} onChange={(event) => setEditDoi(event.target.value)} /></label>
            </div>
            <small className="original-name">原文件：{selectedBook.originalFilename || `${selectedBook.title}.pdf`}</small>
            <div className="metadata-actions">
              <button type="submit" className="solid" disabled={!editTitle.trim()}>保存校正</button>
              <button type="button" className="ghost" onClick={() => onOpenBook(selectedBook.id)}>开始阅读</button>
            </div>
            <label>位置<select value={targetShelf} onChange={(event) => setTargetShelf(event.target.value)}>
              <option value="">最近在读（书桌）</option>
              {catalog.shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}
            </select></label>
            <button type="button" className="tiny" onClick={() => onMoveBook(selectedBook.id, targetShelf)}>移动到这个位置</button>
          </form>}
        </div>
      </aside>}
    </main>
  );
}
