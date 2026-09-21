export type MarkStyle = "highlight" | "underline" | "strike";
export type Handedness = "right" | "left";

export type Highlight = {
  id: string;
  page: number;
  text: string;
  color: string;
  note?: string;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  createdAt: string;
  kind?: "mark" | "translate" | "explain" | "note";
  style?: MarkStyle;
};

export type BookMeta = {
  id: string;
  title: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  lastPage: number;
};

export type BookRecord = BookMeta & {
  notes: string;
  highlights: Highlight[];
  glossary: string;
  vaultPath: string;
};

export type Shelf = { id: string; name: string; bookIds: string[] };
export type Catalog = { shelves: Shelf[] };

export type AgentInfo = {
  id: string;
  name: string;
  description: string;
  kind?: string;
  command?: string;
};

export type AppSettings = {
  agentId: string;
  customCommand: string;
  handedness: Handedness;
  openTabs: string[];
  currentShelf: string;
};

export type AcpStatus = {
  state: "disconnected" | "connecting" | "ready" | "prompting" | "error";
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  message?: string;
};

export type AcpEvent = {
  kind: "session_update" | "stop" | "log" | "status";
  text?: string;
  sessionUpdate?: string;
  raw?: unknown;
  status?: AcpStatus;
};

export type SelectionPayload = {
  page: number;
  text: string;
  context: string;
  rects: Highlight["rects"];
  x: number;
  y: number;
};

export type MarkOptions = {
  kind?: Highlight["kind"];
  note?: string;
  color?: string;
  style?: MarkStyle;
};

export type Probe = {
  id: string;
  name: string;
  found: boolean;
  path?: string;
  version?: string;
  detail?: string;
};

export type SetupStep = {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  action?: string;
};

export type CursorStatus = {
  editorFound: boolean;
  editorPath?: string;
  cliFound: boolean;
  cliPath?: string;
  cliName?: string;
  authenticated: boolean;
  email?: string;
};

export type DiagnoseReport = {
  tools: Probe[];
  agents: Probe[];
  steps: SetupStep[];
  cursor: CursorStatus;
  localLogins: Probe[];
  recommendedAgent?: string;
  pathPreview: string[];
  verdict: string;
  fix: string;
  installCommand: string;
};
