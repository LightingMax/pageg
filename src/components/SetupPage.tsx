import { useEffect, useMemo, useState } from "react";
import type { AcpStatus, AgentInfo, AppSettings, DiagnoseReport, Handedness } from "../lib/types";

type Props = {
  open: boolean;
  settings: AppSettings;
  agents: AgentInfo[];
  status: AcpStatus;
  onClose: () => void;
  onSettings: (value: AppSettings) => void;
  onConnect: (agentId: string) => void;
};

export default function SetupPage({
  open,
  settings,
  agents,
  status,
  onClose,
  onSettings,
  onConnect,
}: Props) {
  const [report, setReport] = useState<DiagnoseReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");

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
              ? `已连接 ${status.agentName ?? "Cursor"}`
              : connecting
                ? "正在拉起 ACP…"
                : status.state === "error"
                  ? status.message || "连接失败"
                  : step.detail,
          }
        : step,
    );
  }, [report, connected, connecting, status]);

  const headline = connected
    ? `已连接 ${status.agentName ?? "智能体"}`
    : connecting
      ? `正在连接 ${status.agentName ?? "智能体"}…`
      : cursor?.cliFound
        ? "将复用 Cursor CLI 登录，不会再弹窗口"
        : report?.localLogins?.some((item) => item.id === "codex" && item.found)
          ? "Cursor CLI 还没有，将直接复用 Codex 登录"
          : "还没连上智能体";

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
      `Pageg 诊断`,
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
    void copy(lines.join("\n"), "已复制诊断");
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
        label: "安装 Cursor CLI",
        run: () => run("install", () => window.pageg.installCursorCli()),
      }
    : {
        id: "connect",
        label: connected
          ? `重新连接 ${recommended === "codex" ? "Codex" : "Cursor"}`
          : `连接 ${recommended === "codex" ? "Codex" : "Cursor"}`,
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
            <h2>环境与智能体</h2>
            <p className="hint">
              和 Codeg 一样：不另开登录。Cursor 读 ~/.cursor/cli-config.json，Codex 读 ~/.codex/auth.json。连接时用 ACP authenticate 吃掉已有登录。
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className={`setup-verdict ${connected ? "ok" : "miss"}`}>
          <div className="setup-hero">
            <i className={`status-dot ${connected ? "ready" : status.state}`} />
            <div>
              <b>{headline}</b>
              <p className="hint">{report?.verdict ?? "正在检测…"}</p>
              <p className="hint">{status.message || report?.fix}</p>
            </div>
          </div>
          <div className="top-actions">
            <button className="solid" onClick={() => void nextAction.run()} disabled={!!busy || connecting}>
              {busy === nextAction.id || connecting ? "处理中" : nextAction.label}
            </button>
            <button className="tiny" onClick={() => void refresh()} disabled={busy === "diagnose"}>
              {busy === "diagnose" ? "检测中" : "重新检测"}
            </button>
            <button className="tiny" onClick={copyAll} disabled={!report}>
              {copied || "复制全部诊断"}
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
                  安装 CLI
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
                  {connected ? "重连" : "连接"}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {report?.installCommand ? (
          <div className="setup-row">
            <h3>安装命令（可复制）</h3>
            <p className="hint">一键安装会弹出 PowerShell。若被拦截，把这行贴进去自己跑。</p>
            <div className="setup-copy">
              <code>{report.installCommand}</code>
              <button className="tiny" onClick={() => void copy(report.installCommand, "已复制命令")}>
                复制
              </button>
            </div>
          </div>
        ) : null}

        <div className="setup-grid">
          <div>
            <h3>工具</h3>
            {(report?.tools ?? []).map((tool) => (
              <div key={tool.id} className={`probe ${tool.found ? "ok" : "miss"}`}>
                <b>{tool.name}</b>
                <span>{tool.found ? tool.version || tool.path : tool.detail || "未找到"}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>其它智能体</h3>
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
                      {busy === agent.id ? "预热中" : "一键预热"}
                    </button>
                    <button
                      className="tiny"
                      onClick={() => {
                        onSettings({ ...settings, agentId: agent.id });
                        onConnect(agent.id);
                      }}
                    >
                      连接
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="setup-row">
          <h3>用手习惯</h3>
          <p className="hint">右利手：选区右侧弹出动作。左利手：从左侧弹出。</p>
          <div className="top-actions">
            <button className={settings.handedness === "right" ? "solid" : "ghost"} onClick={() => onSettings({ ...settings, handedness: "right" as Handedness })}>
              右利手
            </button>
            <button className={settings.handedness === "left" ? "solid" : "ghost"} onClick={() => onSettings({ ...settings, handedness: "left" as Handedness })}>
              左利手
            </button>
          </div>
        </div>

        <div className="setup-row">
          <h3>上下文怎么管</h3>
          <p className="hint">
            不把整本 PDF 丢给模型。每本书一个本地目录：`notes.md`、`glossary.md`、`session.md`、`highlights.json`。
            每次只送选中原文 + 附近几句 + 命中的术语 + 最近几轮。智能体的工作区就是这本书的目录。
          </p>
        </div>

        {settings.agentId === "custom" || settings.customCommand ? (
          <input
            value={settings.customCommand}
            placeholder="自定义启动命令"
            onChange={(e) => onSettings({ ...settings, customCommand: e.target.value, agentId: "custom" })}
          />
        ) : null}

        {message && <p className="hint">{message}</p>}
      </section>
    </div>
  );
}
