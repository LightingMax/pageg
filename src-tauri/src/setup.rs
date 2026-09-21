use crate::registry::{self, extra_search_dirs, find_command, user_home};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Clone, Serialize)]
pub struct Probe {
    pub id: String,
    pub name: String,
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct SetupStep {
    pub id: String,
    pub title: String,
    pub ok: bool,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct CursorStatus {
    #[serde(rename = "editorFound")]
    pub editor_found: bool,
    #[serde(rename = "editorPath")]
    pub editor_path: Option<String>,
    #[serde(rename = "cliFound")]
    pub cli_found: bool,
    #[serde(rename = "cliPath")]
    pub cli_path: Option<String>,
    #[serde(rename = "cliName")]
    pub cli_name: Option<String>,
    pub authenticated: bool,
    pub email: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct DiagnoseReport {
    pub tools: Vec<Probe>,
    pub agents: Vec<Probe>,
    pub steps: Vec<SetupStep>,
    pub cursor: CursorStatus,
    #[serde(rename = "localLogins")]
    pub local_logins: Vec<Probe>,
    #[serde(rename = "recommendedAgent")]
    pub recommended_agent: Option<String>,
    #[serde(rename = "pathPreview")]
    pub path_preview: Vec<String>,
    pub verdict: String,
    pub fix: String,
    #[serde(rename = "installCommand")]
    pub install_command: String,
}

pub fn install_command() -> &'static str {
    if cfg!(windows) {
        "irm 'https://cursor.com/install?win32=true' | iex"
    } else {
        "curl https://cursor.com/install -fsS | bash"
    }
}

pub async fn diagnose() -> DiagnoseReport {
    let node = probe_tool("node", "Node.js").await;
    let npm = probe_tool("npm", "npm").await;
    let npx = probe_tool("npx", "npx").await;
    let editor = probe_cursor_editor().await;
    let cli = probe_cursor_cli().await;
    let claude = probe_tool("claude", "Claude CLI").await;
    let codex = probe_tool("codex", "Codex CLI").await;
    let gemini = probe_tool("gemini", "Gemini CLI").await;
    let opencode = probe_tool("opencode", "OpenCode").await;

    let cursor_file_login = cursor_login_on_disk();
    let (status_auth, email) = if let Some(path) = cli.path.as_deref() {
        cursor_auth(path).await
    } else {
        (false, None)
    };
    let authenticated = status_auth || cursor_file_login;
    let local_logins = detect_local_logins();
    let codex_logged_in = local_logins.iter().any(|p| p.id == "codex" && p.found);

    let cursor = CursorStatus {
        editor_found: editor.found,
        editor_path: editor.path.clone(),
        cli_found: cli.found,
        cli_path: cli.path.clone(),
        cli_name: cli
            .path
            .as_ref()
            .map(|p| {
                Path::new(p)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("agent")
                    .to_string()
            })
            .or_else(|| Some("agent".into())),
        authenticated,
        email: email.clone(),
    };

    let agents = vec![
        agent_probe(
            "cursor",
            "Cursor",
            cli.found,
            cli.path.clone(),
            "binary",
            if cli.found {
                if authenticated {
                    "复用本机 Cursor CLI 登录（~/.cursor/cli-config.json），不会再弹登录"
                } else {
                    "CLI 在。连接时走 ACP authenticate/cursor_login，复用已有登录，不另开窗口"
                }
            } else {
                "需要 Cursor CLI。编辑器窗口的登录复用不到 ACP"
            },
        ),
        agent_probe(
            "codex",
            "Codex",
            npx.found,
            npx.path.clone(),
            "npx",
            if codex_logged_in {
                "复用 ~/.codex/auth.json，和 Codeg / Codex CLI 同一份登录"
            } else {
                "npx -y @agentclientprotocol/codex-acp（本机还没有 Codex 登录文件）"
            },
        ),
        agent_probe(
            "claude",
            "Claude Code",
            npx.found,
            npx.path.clone(),
            "npx",
            "npx -y @agentclientprotocol/claude-agent-acp",
        ),
        agent_probe(
            "gemini",
            "Gemini",
            npx.found,
            npx.path.clone(),
            "npx",
            "npx -y @google/gemini-cli --acp",
        ),
        agent_probe(
            "opencode",
            "OpenCode",
            opencode.found,
            opencode.path.clone(),
            "binary",
            "opencode acp",
        ),
    ];

    let mut path_preview = extra_search_dirs()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .take(6)
        .collect::<Vec<_>>();
    path_preview.extend(
        std::env::var("PATH")
            .unwrap_or_default()
            .split(if cfg!(windows) { ';' } else { ':' })
            .filter(|s| !s.is_empty())
            .take(8)
            .map(|s| s.to_string()),
    );

    let recommended_agent = if cursor.cli_found {
        Some("cursor".into())
    } else if npx.found && codex_logged_in {
        Some("codex".into())
    } else if npx.found {
        Some("codex".into())
    } else {
        None
    };

    let steps = vec![
        SetupStep {
            id: "reuse".into(),
            title: "复用本机登录".into(),
            ok: local_logins.iter().any(|p| p.found),
            detail: if local_logins.iter().any(|p| p.found) {
                local_logins
                    .iter()
                    .filter(|p| p.found)
                    .map(|p| p.detail.clone().unwrap_or_else(|| p.name.clone()))
                    .collect::<Vec<_>>()
                    .join("；")
            } else {
                "还没找到 Cursor CLI 或 Codex 的本地登录文件。不会另开一套账号。".into()
            },
            action: None,
        },
        SetupStep {
            id: "cli".into(),
            title: "Cursor CLI（要用 Cursor 时）".into(),
            ok: cursor.cli_found,
            detail: if cursor.cli_found {
                format!(
                    "找到 {}{}",
                    cursor.cli_path.clone().unwrap_or_default(),
                    cli.version
                        .as_deref()
                        .map(|v| format!(" · {v}"))
                        .unwrap_or_default()
                )
            } else if cursor.editor_found {
                "编辑器登录复用不到 ACP。没有 CLI 时，会改连已经登录的 Codex。".into()
            } else {
                "未找到 agent / cursor-agent。没有它也能先用 Codex。".into()
            },
            action: Some("install".into()),
        },
        SetupStep {
            id: "connect".into(),
            title: "连接到 Pageg".into(),
            ok: false,
            detail: match recommended_agent.as_deref() {
                Some("cursor") => {
                    "会自动连 Cursor，并用 ACP authenticate 吃掉本机已有登录，不会弹登录窗。".into()
                }
                Some("codex") => "Cursor CLI 还没有，将直接连 Codex（复用 ~/.codex/auth.json）。".into(),
                _ => "装好 Cursor CLI 或保证 Codex 已登录后即可连接。".into(),
            },
            action: Some("connect".into()),
        },
    ];

    let (verdict, fix) = verdict(
        &cursor,
        &npx,
        &node,
        codex_logged_in,
        recommended_agent.as_deref(),
    );

    DiagnoseReport {
        tools: vec![editor, cli, node, npm, npx, claude, codex, gemini, opencode],
        agents,
        steps,
        cursor,
        local_logins,
        recommended_agent,
        path_preview,
        verdict,
        fix,
        install_command: install_command().into(),
    }
}

fn verdict(
    cursor: &CursorStatus,
    npx: &Probe,
    node: &Probe,
    codex_logged_in: bool,
    recommended: Option<&str>,
) -> (String, String) {
    if cursor.cli_found {
        return (
            "Cursor CLI 已在本机。Pageg 会复用它的登录，不另开登录窗口。".into(),
            "连接时发送 ACP authenticate/cursor_login，读的是 ~/.cursor/cli-config.json，和 Codeg 同一份。".into(),
        );
    }
    if npx.found && codex_logged_in {
        return (
            "Cursor CLI 还没装，但 Codex 已经登录。会直接连 Codex，不用再登一次。".into(),
            "凭据在 ~/.codex/auth.json，Codeg / Codex CLI / Pageg 共用。想用 Cursor 时再装 CLI。".into(),
        );
    }
    if recommended == Some("codex") {
        return (
            "可以走 Codex 适配器。若终端里已经登录过 Codex，连接时会自动带上。".into(),
            "点连接即可，不要再走一遍登录窗。".into(),
        );
    }
    if cursor.editor_found {
        return (
            "有 Cursor 编辑器，但没有 Cursor CLI，也没有检测到可复用的 Codex 登录。".into(),
            format!(
                "装 Cursor CLI 之后会自动复用 CLI 登录。Windows：{}",
                install_command()
            ),
        );
    }
    if node.found {
        return (
            "找到了 Node，但还没有可复用的智能体登录。".into(),
            "若 Codex 已在终端登录，重新检测；否则先在终端登录一次 Codex 或安装 Cursor CLI。".into(),
        );
    }
    (
        "当前 GUI 环境里找不到可复用的 Cursor CLI 或 Codex。".into(),
        "终端里若已经登录过，完全退出再开 Pageg，避免 GUI PATH/HOME 缺口。".into(),
    )
}

pub fn cursor_login_on_disk() -> bool {
    let Some(home) = user_home() else {
        return false;
    };
    json_has_login(&home.join(".cursor").join("cli-config.json"))
}

pub fn detect_local_logins() -> Vec<Probe> {
    let home = user_home();
    vec![
        login_probe(
            "cursor",
            "Cursor CLI",
            home.as_ref().map(|h| h.join(".cursor").join("cli-config.json")),
        ),
        login_probe(
            "codex",
            "Codex",
            home.as_ref().map(|h| h.join(".codex").join("auth.json")),
        ),
        login_probe(
            "claude",
            "Claude",
            home.as_ref().map(|h| h.join(".claude").join(".credentials.json")),
        ),
    ]
}

fn login_probe(id: &str, name: &str, path: Option<PathBuf>) -> Probe {
    let Some(path) = path else {
        return Probe {
            id: id.into(),
            name: name.into(),
            found: false,
            path: None,
            version: None,
            detail: Some("找不到用户目录".into()),
        };
    };
    let display = path.to_string_lossy().to_string();
    if json_has_login(&path) {
        Probe {
            id: id.into(),
            name: name.into(),
            found: true,
            path: Some(display.clone()),
            version: None,
            detail: Some(format!("已复用 {display}")),
        }
    } else {
        Probe {
            id: id.into(),
            name: name.into(),
            found: false,
            path: if path.exists() { Some(display) } else { None },
            version: None,
            detail: Some(format!("没有可用的 {name} 登录文件")),
        }
    }
}

fn json_has_login(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    json_has_credential_field(&value)
}

fn json_has_credential_field(value: &Value) -> bool {
    const KEYS: &[&str] = &[
        "tokens",
        "accessToken",
        "refreshToken",
        "access_token",
        "refresh_token",
        "apiKey",
        "api_key",
        "OPENAI_API_KEY",
        "authToken",
        "auth_token",
        "token",
        "cursorApiKey",
    ];
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if KEYS.iter().any(|n| k.eq_ignore_ascii_case(n)) {
                    match v {
                        Value::String(s) if !s.trim().is_empty() => return true,
                        Value::Object(_) | Value::Array(_) => return true,
                        _ => {}
                    }
                }
                if json_has_credential_field(v) {
                    return true;
                }
            }
            false
        }
        Value::Array(arr) => arr.iter().any(json_has_credential_field),
        _ => false,
    }
}

fn agent_probe(id: &str, name: &str, found: bool, path: Option<String>, kind: &str, detail: &str) -> Probe {
    Probe {
        id: id.into(),
        name: name.into(),
        found,
        path,
        version: Some(kind.into()),
        detail: Some(detail.into()),
    }
}

async fn probe_cursor_editor() -> Probe {
    let names = ["cursor", "Cursor"];
    for name in names {
        let probe = probe_tool(name, "Cursor 编辑器").await;
        if probe.found {
            return probe;
        }
    }
    let extras = [
        std::env::var_os("LOCALAPPDATA").map(|p| Path::new(&p).join("Programs").join("cursor").join("Cursor.exe")),
        std::env::var_os("ProgramFiles").map(|p| Path::new(&p).join("cursor").join("Cursor.exe")),
    ];
    for path in extras.into_iter().flatten() {
        if path.is_file() {
            return Probe {
                id: "cursor-editor".into(),
                name: "Cursor 编辑器".into(),
                found: true,
                path: Some(path.to_string_lossy().to_string()),
                version: None,
                detail: Some("这是编辑器，不是 Pageg 要连的 CLI".into()),
            };
        }
    }
    Probe {
        id: "cursor-editor".into(),
        name: "Cursor 编辑器".into(),
        found: false,
        path: None,
        version: None,
        detail: Some("未找到 Cursor 编辑器".into()),
    }
}

async fn probe_cursor_cli() -> Probe {
    for name in ["agent", "cursor-agent", "cursor-agent.cmd"] {
        let mut probe = probe_tool(name, "Cursor CLI").await;
        if probe.found {
            probe.id = "cursor-cli".into();
            return probe;
        }
    }
    Probe {
        id: "cursor-cli".into(),
        name: "Cursor CLI".into(),
        found: false,
        path: None,
        version: None,
        detail: Some("未找到 agent / cursor-agent。编辑器 ≠ CLI。".into()),
    }
}

async fn probe_tool(name: &str, label: &str) -> Probe {
    if let Some(path) = find_command(name) {
        let version = version_of(&path).await;
        return Probe {
            id: name.into(),
            name: label.into(),
            found: true,
            path: Some(path),
            version,
            detail: None,
        };
    }
    Probe {
        id: name.into(),
        name: label.into(),
        found: false,
        path: None,
        version: None,
        detail: Some("未在当前应用 PATH 和常见目录中找到".into()),
    }
}

async fn version_of(path: &str) -> Option<String> {
    let output = run_cli(path, &["--version"], 6).await?;
    let text = if output.stdout.trim().is_empty() {
        output.stderr
    } else {
        output.stdout
    };
    let line = text.lines().next().unwrap_or(text.trim()).trim();
    if line.is_empty() {
        None
    } else {
        Some(line.chars().take(80).collect())
    }
}

async fn cursor_auth(cli_path: &str) -> (bool, Option<String>) {
    let Some(output) = run_cli(cli_path, &["status", "--format", "json"], 8).await else {
        return (false, None);
    };
    let blob = format!("{}\n{}", output.stdout, output.stderr);
    if let Some((ok, email)) = parse_auth_json(&blob) {
        return (ok, email);
    }
    let lower = blob.to_lowercase();
    if lower.contains("not logged") || lower.contains("unauthenticated") || lower.contains("please log in") {
        return (false, None);
    }
    if lower.contains("logged in") || lower.contains("authenticated") {
        return (true, None);
    }
    (false, None)
}

fn parse_auth_json(blob: &str) -> Option<(bool, Option<String>)> {
    let start = blob.find('{')?;
    let end = blob.rfind('}')?;
    if end < start {
        return None;
    }
    let value: Value = serde_json::from_str(&blob[start..=end]).ok()?;
    let authenticated = value
        .get("isAuthenticated")
        .or_else(|| value.get("loggedIn"))
        .or_else(|| value.get("authenticated"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let email = value
        .pointer("/userInfo/email")
        .or_else(|| value.pointer("/user/email"))
        .or_else(|| value.get("email"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some((authenticated, email))
}

struct CliOutput {
    stdout: String,
    stderr: String,
}

async fn run_cli(path: &str, args: &[&str], secs: u64) -> Option<CliOutput> {
    let mut cmd = spawn_probe(path, args);
    let output = timeout(Duration::from_secs(secs), cmd.output()).await.ok()?.ok()?;
    Some(CliOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn spawn_probe(path: &str, args: &[&str]) -> Command {
    let mut cmd = if cfg!(windows) && looks_like_script(path) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(path).args(args);
        c
    } else {
        let mut c = Command::new(path);
        c.args(args);
        c
    };
    cmd.env("NO_COLOR", "1");
    registry::apply_user_env(&mut cmd);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn looks_like_script(command: &str) -> bool {
    let lower = command.to_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat")
}

pub async fn warmup(agent_id: &str) -> Result<String, String> {
    let agent = registry::resolve(agent_id, None).ok_or_else(|| format!("未知智能体：{agent_id}"))?;
    if agent_id == "cursor" && find_command("agent").is_none() && find_command("cursor-agent").is_none() {
        return Err(format!(
            "还没有 Cursor CLI。点「安装 Cursor CLI」，或在 PowerShell 运行：{}",
            install_command()
        ));
    }
    let mut args = agent.launch.args.clone();
    if agent_id == "cursor" {
        args = vec!["--version".into()];
    } else if !args.iter().any(|a| a == "--help" || a == "--version") {
        args.push("--help".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut cmd = spawn_probe(&agent.launch.command, &arg_refs);
    let output = timeout(Duration::from_secs(90), cmd.output())
        .await
        .map_err(|_| "预热超时。网络慢时再试一次。".to_string())?
        .map_err(|e| format!("无法启动 {}：{e}", agent.launch.command))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success()
        || stdout.contains("Usage")
        || stderr.contains("Usage")
        || stdout.to_lowercase().contains("cursor")
        || stdout.to_lowercase().contains("agent")
    {
        return Ok(format!("{} 已就绪。", agent.name));
    }
    Err(format!(
        "{} 预热失败：{}",
        agent.name,
        stderr.lines().next().or_else(|| stdout.lines().next()).unwrap_or("未知错误")
    ))
}

pub fn install_cursor_cli() -> Result<String, String> {
    let script = if cfg!(windows) {
        format!(
            "Write-Host '正在安装 Cursor CLI…'; {}; Write-Host ''; Write-Host '装完后关闭此窗口，回到 Pageg 点「重新检测」。'",
            install_command()
        )
    } else {
        format!("echo 'Installing Cursor CLI'; {}; echo 'Close this window, then click Re-check in Pageg.'", install_command())
    };
    open_visible_shell(&script)?;
    Ok("已打开安装窗口。装完后回到 Pageg，点「重新检测」。".into())
}

pub fn open_cursor_login() -> Result<String, String> {
    let bin = find_command("agent")
        .or_else(|| find_command("cursor-agent"))
        .or_else(|| find_command("cursor-agent.cmd"))
        .ok_or_else(|| "还没装 Cursor CLI，先点「安装 Cursor CLI」。".to_string())?;
    let escaped = bin.replace('\'', "''");
    let script = if cfg!(windows) {
        format!(
            "Write-Host '登录 Cursor CLI：{escaped}'; & '{escaped}' login; Write-Host ''; Write-Host '登录完成后关闭此窗口，回到 Pageg 点「重新检测」。'"
        )
    } else {
        format!("'{escaped}' login; echo 'Close this window, then click Re-check in Pageg.'")
    };
    open_visible_shell(&script)?;
    Ok("已打开登录窗口。完成后回到这里点「重新检测」。".into())
}

fn open_visible_shell(script: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("powershell")
            .args([
                "-NoExit",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .spawn()
            .map_err(|e| format!("打不开终端窗口：{e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = script;
        Err("当前平台请在终端手动运行安装/登录命令。".into())
    }
}
