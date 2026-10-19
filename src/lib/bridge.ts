import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const pageg = {
  openPdf: () => invoke("open_pdf"),
  openPdfPath: (path: string) => invoke("open_pdf_path", { path }),
  importPdf: (name: string, data: number[]) => invoke("import_pdf_bytes", { name, data }),
  downloadPdf: (url: string, filename = "") => invoke("download_pdf", { url, filename }),
  searchPapers: (query: string) => invoke("search_papers", { query }),
  searchAndDownloadPaper: (query: string, filename = "") =>
    invoke("search_and_download_pdf", { query, filename }),
  readPdf: async (filePath: string) => {
    const bytes = await invoke<number[]>("read_pdf", { path: filePath });
    return new Uint8Array(bytes).buffer;
  },
  listLibrary: () => invoke("library_list"),
  loadBook: (id: string) => invoke("library_load", { id }),
  updateBookMetadata: (id: string, patch: unknown) => invoke("book_metadata_update", { id, patch }),
  saveNotes: (id: string, notes: string) => invoke("notes_save", { id, notes }),
  appendNote: (id: string, block: string) => invoke<string>("notes_append", { id, block }),
  saveGlossary: (id: string, glossary: string) => invoke("glossary_save", { id, glossary }),
  saveHighlights: (id: string, highlights: unknown) => invoke("highlights_save", { id, highlights }),
  savePage: (id: string, page: number) => invoke("book_page", { id, page }),
  readSettings: () => invoke("settings_read"),
  writeSettings: (settings: unknown) => invoke("settings_write", { settings }),
  readSession: (id: string) => invoke<string>("session_read", { id }),
  appendSession: (id: string, block: string) => invoke<string>("session_append", { id, block }),
  readDocumentContext: (id: string) => invoke("document_context_read", { id }),
  saveDocumentContext: (id: string, context: unknown) => invoke("document_context_save", { id, context }),
  readBookDigest: (id: string) => invoke("book_digest_read", { id }),
  saveBookDigest: (id: string, digest: unknown) => invoke("book_digest_save", { id, digest }),
  readChatHistory: (id: string) => invoke("chat_history_read", { id }),
  saveChatHistory: (id: string, history: unknown) => invoke("chat_history_save", { id, history }),
  readCatalog: () => invoke("catalog_read"),
  createShelf: (name: string) => invoke("shelf_create", { name }),
  renameShelf: (id: string, name: string) => invoke("shelf_rename", { id, name }),
  deleteShelf: (id: string) => invoke("shelf_delete", { id }),
  assignBook: (shelfId: string, bookId: string, on: boolean) =>
    invoke("shelf_assign", { shelfId, bookId, on }),
  moveBook: (bookId: string, shelfId: string) => invoke("shelf_move_book", { bookId, shelfId }),
  diagnoseEnv: () => invoke("env_diagnose"),
  warmupAgent: (agentId: string) => invoke<string>("env_warmup", { agentId }),
  installCursorCli: () => invoke<string>("env_install_cursor"),
  cursorLogin: () => invoke<string>("env_cursor_login"),
  listAgents: () => invoke("agents_list"),
  acpStatus: () => invoke("acp_status"),
  acpConnect: (payload: { agentId: string; cwd: string; customCommand?: string }) =>
    invoke("acp_connect", { payload }),
  acpDisconnect: () => invoke("acp_disconnect"),
  acpCancel: () => invoke("acp_cancel"),
  acpSetModel: (modelId: string) => invoke("acp_set_model", { modelId }),
  acpPrompt: (text: string) => invoke<string>("acp_prompt", { text }),
  acpPromptIsolated: (text: string) => invoke<string>("acp_prompt_isolated", { text }),
  onAcpEvent: (handler: (payload: unknown) => void) => {
    const pending = listen("acp-event", (event) => handler(event.payload));
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  },
};

declare global {
  interface Window {
    pageg: typeof pageg;
  }
}
