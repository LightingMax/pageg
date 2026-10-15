import { useEffect, useMemo, useState } from "react";
import { tr } from "../lib/i18n";
import type { AcpStatus, AgentInfo, AppSettings, DiagnoseReport, Handedness, Language } from "../lib/types";

type Props = {
  open: boolean;
  settings: AppSettings;
  agents: AgentInfo[];
  status: AcpStatus;
  onClose: () => void;
  onSettings: (value: AppSettings) => void;
  onConnect: (agentId: string) => void;
  language: Language;
  onResetLayout: () => void;
};

export default function SetupPage({
  open,
  settings,
  agents,
  status,
  onClose,
  onSettings,
  onConnect,
  language,
  onResetLayout,
}: Props) {
  const [report, setReport] = useState<DiagnoseReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const text = (zh: string, en: string) => language === "en-US" ? en : zh;

  const refresh = async () => {
    setBusy("diagnose");
    try {
      setReport((await window.pageg.diagnoseEnv()) as DiagnoseReport);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const connected = status.state === "ready" || status.state === "prompting";
  const connecting = status.state === "connecting";
  const cursor = report?.cursor;

  const steps = useMemo(() => {
    const list = report?.steps ?? [];
    return list.map((step) =>
      step.id === "connect"
        ? {
            ...step,
            ok: connected,
            detail: connected
              ? text(`已连接 ${status.agentName ?? "Cursor"}`, `Connected to ${status.agentName ?? "Cursor"}`)
              : connecting
                ? text("正在拉起 ACP…", "Starting ACP…")
                : status.state === "error"
                  ? status.message || text("连接失败", "Connection failed")
                  : step.detail,
          }
        : step,
    );
  }, [report, connected, connecting, status]);

  const headline = connected
    ? text(`已连接 ${status.agentName ?? "智能体"}`, `Connected to ${status.agentName ?? "agent"}`)
    : connecting
      ? text(`正在连接 ${status.agentName ?? "智能体"}…`, `Connecting to ${status.agentName ?? "agent"}…`)
      : cursor?.cliFound
        ? text("将复用 Cursor CLI 登录，不会再弹窗口", "Reusing the Cursor CLI login without opening another sign-in window")
        : report?.localLogins?.some((item) => item.id === "codex" && item.found)
          ? text("Cursor CLI 还没有，将直接复用 Codex 登录", "Cursor CLI is unavailable; Pageg will reuse the Codex login")
          : text("还没连上智能体", "No agent is connected");

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1600);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyAll = () => {
    if (!report) return;
    const lines = [
      text("Pageg 诊断", "Pageg diagnostics"),
      `ACP: ${status.state} ${status.agentName ?? ""} ${status.message ?? ""}`,
      report.verdict,
      report.fix,
      ...steps.map((s) => `${s.ok ? "[ok]" : "[x]"} ${s.title}: ${s.detail}`),
      `editor: ${report.cursor.editorPath ?? "none"}`,
      `cli: ${report.cursor.cliPath ?? "none"}`,
      `recommended: ${report.recommendedAgent ?? "none"}`,
      `local: ${(report.localLogins ?? []).map((item) => `${item.id}:${item.found}`).join(" ")}`,
      `install: ${report.installCommand}`,
      `PATH: ${report.pathPreview.join(" ; ")}`,
    ];
    void copy(lines.join("\n"), text("已复制诊断", "Diagnostics copied"));
  };

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setMessage("");
    try {
      const result = await fn();
      if (typeof result === "string" && result.trim()) setMessage(result);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const recommended = report?.recommendedAgent ?? (cursor?.cliFound ? "cursor" : "codex");
  const nextAction = !cursor?.cliFound && recommended === "cursor"
    ? {
        id: "install",
        label: text("安装 Cursor CLI", "Install Cursor CLI"),
        run: () => run("install", () => window.pageg.installCursorCli()),
      }
    : {
        id: "connect",
        label: connected
          ? text(`重新连接 ${recommended === "codex" ? "Codex" : "Cursor"}`, `Reconnect ${recommended === "codex" ? "Codex" : "Cursor"}`)
          : text(`连接 ${recommended === "codex" ? "Codex" : "Cursor"}`, `Connect ${recommended === "codex" ? "Codex" : "Cursor"}`),
        run: () => {
          onSettings({ ...settings, agentId: recommended });
          onConnect(recommended);
        },
      };

  return (
    <div className="setup-mask" onClick={onClose}>
      <section className="setup-page" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{tr(language, "settings.title")}</h2>
            <p className="hint">
              {text("和 Codeg 一样：不另开登录。Cursor 读 ~/.cursor/cli-config.json，Codex 读 ~/.codex/auth.json。连接时用 ACP authenticate 吃掉已有登录。", "Like Codeg, Pageg reuses local logins. Cursor reads ~/.cursor/cli-config.json and Codex reads ~/.codex/auth.json; ACP authenticate reuses them when connecting.")}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            {tr(language, "settings.close")}
          </button>
        </header>

        <div className="setup-row settings-preferences">
          <div>
            <h3>{tr(language, "settings.language")}</h3>
            <p className="hint">{tr(language, "settings.languageHint")}</p>
          </div>
          <select
            value={settings.language}
            onChange={(event) => onSettings({ ...settings, language: event.target.value as Language })}
            aria-label={tr(language, "settings.language")}
          >
            <option value="zh-CN">{tr(language, "settings.chinese")}</option>
            <option value="en-US">{tr(language, "settings.english")}</option>
          </select>
        </div>

        <div className={`setup-verdict ${connected ? "ok" : "miss"}`}>
          <div className="setup-hero">
            <i className={`status-dot ${connected ? "ready" : status.state}`} />
            <div>
              <b>{headline}</b>
              <p className="hint">{report?.verdict ?? text("正在检测…", "Checking…")}</p>
              <p className="hint">{status.message || report?.fix}</p>
            </div>
          </div>
          <div className="top-actions">
            <button className="solid" onClick={() => void nextAction.run()} disabled={!!busy || connecting}>
              {busy === nextAction.id || connecting ? text("处理中", "Working…") : nextAction.label}
            </button>
            <button className="tiny" onClick={() => void refresh()} disabled={busy === "diagnose"}>
              {busy === "diagnose" ? text("检测中", "Checking…") : text("重新检测", "Check again")}
            </button>
            <button className="tiny" onClick={copyAll} disabled={!report}>
              {copied || text("复制全部诊断", "Copy diagnostics")}
            </button>
          </div>
        </div>

        <div className="setup-steps">
          {steps.map((step) => (
            <div key={step.id} className={`setup-step ${step.ok ? "ok" : "miss"}`}>
              <span className="step-mark">{step.ok ? "✓" : "○"}</span>
              <div>
                <b>{step.title}</b>
                <p className="hint">{step.detail}</p>
              </div>
              {step.id === "cli" && !step.ok ? (
                <button className="tiny" onClick={() => void run("install", () => window.pageg.installCursorCli())} disabled={!!busy}>
                  {text("安装 CLI", "Install CLI")}
                </button>
              ) : null}
              {step.id === "connect" ? (
                <button
                  className="tiny"
                  onClick={() => {
                    const id = report?.recommendedAgent ?? "codex";
                    onSettings({ ...settings, agentId: id });
                    onConnect(id);
                  }}
                  disabled={connecting}
                >
                  {connected ? text("重连", "Reconnect") : text("连接", "Connect")}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {report?.installCommand ? (
          <div className="setup-row">
            <h3>{text("安装命令（可复制）", "Install command (copyable)")}</h3>
            <p className="hint">
              {text(`一键安装会打开 ${report.terminalName}。若系统拦截，请复制这行命令后手动运行。`, `One-click install opens ${report.terminalName}. If macOS blocks it, copy and run this command manually.`)}
            </p>
            <div className="setup-copy">
              <code>{report.installCommand}</code>
              <button className="tiny" onClick={() => void copy(report.installCommand, text("已复制命令", "Command copied"))}>
                {text("复制", "Copy")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="setup-grid">
          <div>
            <h3>{text("工具", "Tools")}</h3>
            {(report?.tools ?? []).map((tool) => (
              <div key={tool.id} className={`probe ${tool.found ? "ok" : "miss"}`}>
                <b>{tool.name}</b>
                <span>{tool.found ? tool.version || tool.path : tool.detail || text("未找到", "Not found")}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>{text("其它智能体", "Other agents")}</h3>
            {(report?.agents ?? agents.map((a) => ({ id: a.id, name: a.name, found: false, detail: a.description }))).map(
              (agent) => (
                <div key={agent.id} className={`probe ${agent.found ? "ok" : "miss"}`}>
                  <div>
                    <b>{agent.name}</b>
                    <p className="hint">{agent.detail}</p>
                  </div>
                  <div className="probe-actions">
                    <button
                      className="tiny"
                      onClick={() => void run(agent.id, () => window.pageg.warmupAgent(agent.id))}
                      disabled={!!busy}
                    >
                      {busy === agent.id ? text("预热中", "Warming up…") : text("一键预热", "Warm up")}
                    </button>
                    <button
                      className="tiny"
                      onClick={() => {
                        onSettings({ ...settings, agentId: agent.id });
                        onConnect(agent.id);
                      }}
                    >
                      {text("连接", "Connect")}
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="setup-row">
          <h3>{tr(language, "settings.handPreference")}</h3>
          <p className="hint">{text("右利手：选区右侧弹出动作。左利手：从左侧弹出。", "Right-handed: actions open to the right of a selection. Left-handed: they open on the left.")}</p>
          <div className="top-actions">
            <button className={settings.handedness === "right" ? "solid" : "ghost"} onClick={() => onSettings({ ...settings, handedness: "right" as Handedness })}>
              {tr(language, "settings.rightHand")}
            </button>
            <button className={settings.handedness === "left" ? "solid" : "ghost"} onClick={() => onSettings({ ...settings, handedness: "left" as Handedness })}>
              {tr(language, "settings.leftHand")}
            </button>
          </div>
        </div>

        <div className="setup-row">
          <h3>{tr(language, "settings.layout")}</h3>
          <p className="hint">{tr(language, "settings.layoutHint")}</p>
          <div className="layout-controls">
            <label>{tr(language, "settings.leftPanel")}<input type="range" min="104" max="320" step="4" value={settings.leftPanelWidth} onChange={(event) => onSettings({ ...settings, leftPanelWidth: Number(event.target.value) })} /></label>
            <label>{tr(language, "settings.rightPanel")}<input type="range" min="280" max="620" step="4" value={settings.rightPanelWidth} onChange={(event) => onSettings({ ...settings, rightPanelWidth: Number(event.target.value) })} /></label>
          </div>
          <button className="tiny" onClick={onResetLayout}>{tr(language, "settings.resetLayout")}</button>
        </div>

        <div className="setup-row">
          <h3>{text("上下文怎么管", "How context works")}</h3>
          <p className="hint">
            {text("不把整本 PDF 丢给模型。每本书一个本地目录：`notes.md`、`glossary.md`、`session.md`、`highlights.json`。每次只送选中原文 + 附近几句 + 命中的术语 + 最近几轮。智能体的工作区就是这本书的目录。", "Pageg does not send the entire PDF by default. Each book has a local vault with `notes.md`, `glossary.md`, `session.md`, and `highlights.json`; prompts include only relevant text, nearby context, terms, and recent turns.")}
          </p>
        </div>

        {settings.agentId === "custom" || settings.customCommand ? (
          <input
            value={settings.customCommand}
            placeholder={text("自定义启动命令", "Custom launch command")}
            onChange={(e) => onSettings({ ...settings, customCommand: e.target.value, agentId: "custom" })}
          />
        ) : null}

        {message && <p className="hint">{message}</p>}
      </section>
    </div>
  );
}
