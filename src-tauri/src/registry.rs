use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
pub struct AgentInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub kind: &'static str,
    pub command: &'static str,
}

#[derive(Clone)]
pub struct AgentLaunch {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Clone)]
pub struct AgentDefinition {
    pub id: String,
    pub name: String,
    pub _description: String,
    pub launch: AgentLaunch,
}

pub fn catalog() -> Vec<AgentInfo> {
    vec![
        AgentInfo {
            id: "cursor",
            name: "Cursor",
            description: "用你本机的 Cursor CLI（agent acp）。编辑器窗口本身连不上。",
            kind: "binary",
            command: "agent",
        },
        AgentInfo {
            id: "codex",
            name: "Codex",
            description: "OpenAI Codex via @agentclientprotocol/codex-acp",
            kind: "npx",
            command: "npx",
        },
        AgentInfo {
            id: "claude",
            name: "Claude Code",
            description: "Anthropic Claude via @agentclientprotocol/claude-agent-acp",
            kind: "npx",
            command: "npx",
        },
        AgentInfo {
            id: "gemini",
            name: "Gemini",
            description: "Google Gemini CLI ACP mode",
            kind: "npx",
            command: "npx",
        },
        AgentInfo {
            id: "opencode",
            name: "OpenCode",
            description: "OpenCode ACP（需要 PATH 上有 opencode）",
            kind: "binary",
            command: "opencode",
        },
    ]
}

pub fn resolve(id: &str, custom_command: Option<&str>) -> Option<AgentDefinition> {
    if id == "custom" {
        let raw = custom_command.unwrap_or("").trim();
        if raw.is_empty() {
            return None;
        }
        let mut parts = raw.split_whitespace();
        let command = parts.next().unwrap_or("npx").to_string();
        return Some(AgentDefinition {
            id: "custom".into(),
            name: "Custom".into(),
            _description: raw.to_string(),
            launch: AgentLaunch {
                command,
                args: parts.map(|s| s.to_string()).collect(),
            },
        });
    }

    let (name, description, command, args) = match id {
        "cursor" => (
            "Cursor",
            "Cursor ACP via agent acp",
            cursor_bin(),
            vec!["acp".to_string()],
        ),
        "codex" => (
            "Codex",
            "OpenAI Codex via @agentclientprotocol/codex-acp",
            "npx".to_string(),
            vec!["-y".into(), "@agentclientprotocol/codex-acp@1.12.0".into()],
        ),
        "claude" => (
            "Claude Code",
            "Anthropic Claude via @agentclientprotocol/claude-agent-acp",
            "npx".to_string(),
            vec!["-y".into(), "@agentclientprotocol/claude-agent-acp@0.79.0".into()],
        ),
        "gemini" => (
            "Gemini",
            "Google Gemini CLI ACP mode",
            "npx".to_string(),
            vec![
                "-y".into(),
                "@google/gemini-cli@0.60.0".into(),
                "--acp".into(),
                "--skip-trust".into(),
            ],
        ),
        "opencode" => (
            "OpenCode",
            "OpenCode ACP",
            "opencode".to_string(),
            vec!["acp".into()],
        ),
        _ => return None,
    };

    Some(AgentDefinition {
        id: id.to_string(),
        name: name.to_string(),
        _description: description.to_string(),
        launch: AgentLaunch { command, args },
    })
}

fn cursor_bin() -> String {
    find_command("agent")
        .or_else(|| find_command("cursor-agent"))
        .or_else(|| find_command("cursor-agent.cmd"))
        .unwrap_or_else(|| "agent".into())
}

pub fn extra_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".cursor").join("bin"));
        dirs.push(home.join("AppData").join("Roaming").join("npm"));
        dirs.push(home.join("AppData").join("Local").join("fnm"));
        dirs.push(home.join(".cursor"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        dirs.push(local.join("Programs").join("cursor"));
        dirs.push(local.join("cursor-agent"));
        dirs.push(local.join("fnm"));
    }
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        let pf = PathBuf::from(pf);
        dirs.push(pf.join("nodejs"));
        dirs.push(pf.join("cursor").join("resources").join("app").join("bin"));
    }
    dirs
}

pub fn find_command(name: &str) -> Option<String> {
    if let Some(found) = which(name) {
        return Some(found);
    }
    let mut names = vec![name.to_string()];
    if cfg!(windows) {
        names.push(format!("{name}.cmd"));
        names.push(format!("{name}.exe"));
        names.push(format!("{name}.bat"));
    }
    for dir in extra_search_dirs() {
        for cand in &names {
            let path = dir.join(cand);
            if path.is_file() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn which(name: &str) -> Option<String> {
    let (prog, flag) = if cfg!(windows) {
        ("where", name)
    } else {
        ("which", name)
    };
    let output = std::process::Command::new(prog).arg(flag).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim())
        .find(|s| !s.is_empty() && !s.to_lowercase().contains("info:"))
        .map(|s| s.to_string())
}

pub fn path_with_extras() -> String {
    let mut parts: Vec<String> = extra_search_dirs()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(if cfg!(windows) { ";" } else { ":" })
}

pub fn user_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

pub fn apply_user_env(cmd: &mut tokio::process::Command) {
    if let Some(home) = user_home() {
        cmd.env("HOME", &home);
        cmd.env("USERPROFILE", &home);
    }
    cmd.env("PATH", path_with_extras());
}
