/// <reference types="vite/client" />

declare global {
  interface Window {
    pageg: {
      openPdf: () => Promise<unknown>;
      readPdf: (filePath: string) => Promise<ArrayBuffer>;
      listLibrary: () => Promise<unknown>;
      loadBook: (id: string) => Promise<unknown>;
      saveNotes: (id: string, notes: string) => Promise<void>;
      appendNote: (id: string, block: string) => Promise<string>;
      saveGlossary: (id: string, glossary: string) => Promise<void>;
      saveHighlights: (id: string, highlights: unknown) => Promise<void>;
      savePage: (id: string, page: number) => Promise<void>;
      readSettings: () => Promise<unknown>;
      writeSettings: (settings: unknown) => Promise<void>;
      listAgents: () => Promise<unknown>;
      acpStatus: () => Promise<unknown>;
      acpConnect: (payload: { agentId: string; cwd: string; customCommand?: string }) => Promise<unknown>;
      acpDisconnect: () => Promise<void>;
      acpCancel: () => Promise<void>;
      acpPrompt: (text: string) => Promise<string>;
      acpPromptIsolated: (text: string) => Promise<string>;
      onAcpEvent: (handler: (payload: unknown) => void) => () => void;
    };
  }
}

export {};
