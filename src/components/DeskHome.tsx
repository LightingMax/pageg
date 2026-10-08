import { useMemo, useRef, useState } from "react";
import type { BookMeta, Catalog, Shelf } from "../lib/types";

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
};

const BOOK_COLORS = ["#8f3f32", "#315f64", "#bd7b3d", "#596b3c", "#715071", "#234a6a", "#a45245"];

function hash(value: string) {
  let result = 17;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function shortTitle(title: string) {
  return title.replace(/\.pdf$/i, "").slice(0, 28);
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

function BookStack({
  shelf,
  books,
  selected,
  onSelect,
  onOpenBook,
  onDropBook,
}: {
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
        {books.length > 0 ? (
          books.slice(0, 7).map((book, index) => (
            <BookSpine key={book.id} book={book} index={index} onOpen={() => onOpenBook(book.id)} />
          ))
        ) : (
          <div className="empty-stack">
            <span>把书拖到这里</span>
          </div>
        )}
      </div>
      <button type="button" className="stack-label" onClick={onSelect}>
        <span>{shelf.name}</span>
        <small>{books.length} 本</small>
      </button>
    </section>
  );
}

export default function DeskHome({
  library,
  catalog,
  dragging,
  onOpenBook,
  onImport,
  onUploadFile,
  onCreateShelf,
  onRenameShelf,
  onDeleteShelf,
  onMoveBook,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const [newShelf, setNewShelf] = useState("");
  const [renameDraft, setRenameDraft] = useState("");

  const assignedIds = useMemo(
    () => new Set(catalog.shelves.flatMap((shelf) => shelf.bookIds)),
    [catalog.shelves],
  );
  const looseBooks = library.filter((book) => !assignedIds.has(book.id));
  const stacks: Shelf[] = [
    ...catalog.shelves,
    ...(looseBooks.length > 0 ? [{ id: "", name: "桌边待读", bookIds: looseBooks.map((book) => book.id) }] : []),
  ];
  const selected = selectedShelf === null ? null : stacks.find((shelf) => shelf.id === selectedShelf) ?? null;
  const selectedBooks = selected
    ? library.filter((book) => selected.bookIds.includes(book.id))
    : [];

  const chooseShelf = (shelf: Shelf) => {
    setSelectedShelf(shelf.id);
    setRenameDraft(shelf.name);
  };

  return (
    <main className={`desk-home ${dragging ? "receiving" : ""}`}>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUploadFile(file);
        }}
      />
      <div className="desk-wall">
        <div className="window-light" aria-hidden="true"><i /><i /><i /></div>
        <div className="wall-print" aria-hidden="true"><span>READ</span><small>slowly · think deeply</small></div>
        <div className="desk-welcome">
          <span className="eyebrow">YOUR READING DESK</span>
          <h1>今天，从哪一页开始？</h1>
          <p>每摞书是一只文件夹。点击一本书阅读，或把它拖到另一摞重新归档。</p>
        </div>
      </div>

      <div className="desk-surface">
        <div className="desk-lamp" aria-hidden="true"><i /><b /><span /></div>
        <div className="pencil-cup" aria-hidden="true"><i /><i /><i /><span /></div>

        <button type="button" className="reading-mat" onClick={onImport}>
          <span className="mat-corners" />
          <b>{dragging ? "松开，放到书桌上" : "把 PDF 放到这里"}</b>
          <small>拖入文件，或点击选择</small>
          <i>PDF</i>
        </button>

        <div className="desk-stacks">
          {stacks.map((shelf) => (
            <BookStack
              key={shelf.id || "loose"}
              shelf={shelf}
              books={library.filter((book) => shelf.bookIds.includes(book.id))}
              selected={selectedShelf !== null && selectedShelf === shelf.id}
              onSelect={() => chooseShelf(shelf)}
              onOpenBook={onOpenBook}
              onDropBook={(bookId) => onMoveBook(bookId, shelf.id)}
            />
          ))}
          {stacks.length === 0 && (
            <div className="first-book">
              <b>桌面还是空的</b>
              <span>把第一份 PDF 拖到中央阅读垫上。</span>
            </div>
          )}
        </div>

        <form
          className="new-stack-card"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newShelf.trim();
            if (!name) return;
            onCreateShelf(name);
            setNewShelf("");
          }}
        >
          <label htmlFor="new-shelf">新建一摞</label>
          <div>
            <input
              id="new-shelf"
              value={newShelf}
              maxLength={30}
              placeholder="例如：机器学习"
              onChange={(event) => setNewShelf(event.target.value)}
            />
            <button className="solid" type="submit" disabled={!newShelf.trim()}>创建</button>
          </div>
        </form>
      </div>

      {selected && (
        <aside className="shelf-drawer">
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">当前书堆</span>
              <h2>{selected.name}</h2>
            </div>
            <button className="ghost" onClick={() => setSelectedShelf(null)}>收起</button>
          </div>
          {selected.id && (
            <div className="shelf-actions">
              <input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={30} />
              <button className="tiny" disabled={!renameDraft.trim()} onClick={() => onRenameShelf(selected.id, renameDraft.trim())}>
                重命名
              </button>
              <button className="tiny danger" onClick={() => { onDeleteShelf(selected.id); setSelectedShelf(null); }}>
                删除书堆
              </button>
            </div>
          )}
          <div className="drawer-books">
            {selectedBooks.map((item) => (
              <button key={item.id} className="drawer-book" onClick={() => onOpenBook(item.id)}>
                <b>{shortTitle(item.title)}</b>
                <small>上次读到第 {item.lastPage || 1} 页</small>
              </button>
            ))}
            {selectedBooks.length === 0 && <p className="empty">这摞还没有书。可把其他书拖到这里。</p>}
          </div>
        </aside>
      )}
    </main>
  );
}
