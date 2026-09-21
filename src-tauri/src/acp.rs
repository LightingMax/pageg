use crate::registry::{self, AgentDefinition, apply_user_env};
use crate::vault;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

#[derive(Clone, Debug, Serialize)]
pub struct AcpStatus {
    pub state: String,
    #[serde(rename = "agentId", skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AcpEvent {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(rename = "sessionUpdate", skip_serializing_if = "Option::is_none")]
    pub session_update: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AcpStatus>,
}

struct RpcIo {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    assembled: Mutex<String>,
}

pub struct AcpSession {
    child: Child,
    io: Arc<RpcIo>,
    session_id: String,
    agent_id: String,
    agent_name: String,
    _cwd: PathBuf,
    _vault_root: PathBuf,
}

pub struct AcpHost {
    session: Mutex<Option<AcpSession>>,
    status: Mutex<AcpStatus>,
}

impl AcpHost {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            status: Mutex::new(AcpStatus {
                state: "disconnected".into(),
                agent_id: None,
                agent_name: None,
                session_id: None,
                message: None,
            }),
        }
    }

    pub async fn status(&self) -> AcpStatus {
        self.status.lock().await.clone()
    }

    async fn set_status(&self, app: &AppHandle, status: AcpStatus) {
        *self.status.lock().await = status.clone();
        let _ = app.emit(
            "acp-event",
            AcpEvent {
                kind: "status".into(),
                text: None,
                session_update: None,
                status: Some(status),
            },
        );
    }

    pub async fn disconnect(&self, app: &AppHandle) -> Result<(), String> {
        if let Some(mut session) = self.session.lock().await.take() {
            let _ = session.child.kill().await;
        }
        self.set_status(
            app,
            AcpStatus {
                state: "disconnected".into(),
                agent_id: None,
                agent_name: None,
                session_id: None,
                message: None,
            },
        )
        .await;
        Ok(())
    }

    pub async fn connect(
        &self,
        app: &AppHandle,
        agent_id: &str,
        cwd: &str,
        custom_command: Option<&str>,
    ) -> Result<AcpStatus, String> {
        self.disconnect(app).await?;
        let agent = registry::resolve(agent_id, custom_command)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        self.set_status(
            app,
            AcpStatus {
                state: "connecting".into(),
                agent_id: Some(agent.id.clone()),
                agent_name: Some(agent.name.clone()),
                session_id: None,
                message: Some("正在启动 ACP agent… 首次运行可能需要下载适配器".into()),
            },
        )
        .await;

        let vault_root = vault::vault_root(app)?;
        let cwd_path = if cwd.trim().is_empty() {
            vault_root.clone()
        } else {
            PathBuf::from(cwd)
        };
        if agent.id == "cursor"
            && registry::find_command("agent").is_none()
            && registry::find_command("cursor-agent").is_none()
        {
            let err = "还没有 Cursor CLI（agent）。本机有 Cursor 编辑器不等于已连接。请到环境页：安装 Cursor CLI → 登录 → 再连接。".to_string();
            self.set_status(
                app,
                AcpStatus {
                    state: "error".into(),
                    agent_id: Some(agent.id),
                    agent_name: Some(agent.name),
                    session_id: None,
                    message: Some(err.clone()),
                },
            )
            .await;
            return Err(err);
        }
        match handshake(app.clone(), agent.clone(), cwd_path, vault_root).await {
            Ok(session) => {
                let status = AcpStatus {
                    state: "ready".into(),
                    agent_id: Some(session.agent_id.clone()),
                    agent_name: Some(session.agent_name.clone()),
                    session_id: Some(session.session_id.clone()),
                    message: Some(format!("已连接 {}", session.agent_name)),
                };
                *self.session.lock().await = Some(session);
                self.set_status(app, status.clone()).await;
                Ok(status)
            }
            Err(err) => {
                self.set_status(
                    app,
                    AcpStatus {
                        state: "error".into(),
                        agent_id: Some(agent.id),
                        agent_name: Some(agent.name),
                        session_id: None,
                        message: Some(err.clone()),
                    },
                )
                .await;
                Err(err)
            }
        }
    }

    pub async fn prompt(&self, app: &AppHandle, text: &str) -> Result<String, String> {
        let session_id = {
            let guard = self.session.lock().await;
            let session = guard.as_ref().ok_or("ACP session is not ready")?;
            session.session_id.clone()
        };
        let io = {
            let guard = self.session.lock().await;
            let session = guard.as_ref().ok_or("ACP session is not ready")?;
            session.io.clone()
        };
        io.assembled.lock().await.clear();
        let current = self.status().await;
        self.set_status(
            app,
            AcpStatus {
                state: "prompting".into(),
                agent_id: current.agent_id,
                agent_name: current.agent_name.clone(),
                session_id: current.session_id,
                message: Some("Agent 正在阅读这段文字…".into()),
            },
        )
        .await;

        let result = io
            .request(
                "session/prompt",
                json!({
                    "sessionId": session_id,
                    "prompt": [{ "type": "text", "text": text }]
                }),
            )
            .await;

        let current = self.status().await;
        match result {
            Ok(_) => {
                self.set_status(
                    app,
                    AcpStatus {
                        state: "ready".into(),
                        agent_id: current.agent_id,
                        agent_name: current.agent_name,
                        session_id: current.session_id,
                        message: Some("本轮完成。没有你的下一次请求，AI 不会再动。".into()),
                    },
                )
                .await;
                Ok(())
            }
            Err(err) => {
                self.set_status(
                    app,
                    AcpStatus {
                        state: "error".into(),
                        agent_id: current.agent_id,
                        agent_name: current.agent_name,
                        session_id: current.session_id,
                        message: Some(err.clone()),
                    },
                )
                .await;
                Err(err)
            }
        }?;
        let assembled = io.assembled.lock().await.clone();
        let _ = app.emit(
            "acp-event",
            AcpEvent {
                kind: "stop".into(),
                text: Some(assembled.clone()),
                session_update: None,
                status: None,
            },
        );
        Ok(assembled)
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let guard = self.session.lock().await;
        let session = guard.as_ref().ok_or("ACP session is not ready")?;
        session
            .io
            .notify(
                "session/cancel",
                json!({ "sessionId": session.session_id }),
            )
            .await
    }
}

impl RpcIo {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        self.write(&payload).await?;
        rx.await.map_err(|_| "ACP request dropped".to_string())?
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
        .await
    }

    async fn write(&self, payload: &Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
        line.push(b'\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&line).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())
    }
}

async fn handshake(
    app: AppHandle,
    agent: AgentDefinition,
    cwd: PathBuf,
    vault_root: PathBuf,
) -> Result<AcpSession, String> {
    if !cwd.exists() {
        std::fs::create_dir_all(&cwd).map_err(|e| format!("无法创建工作区：{e}"))?;
    }
    let mut command = spawn_command(&agent.launch.command, &agent.launch.args);
    command
        .current_dir(&cwd)
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|e| {
        if agent.id == "cursor" {
            format!(
                "拉不起 Cursor CLI（{}）。编辑器窗口连不上，需要 agent / cursor-agent。到环境页安装 CLI 后重试。原始错误：{e}",
                agent.launch.command
            )
        } else {
            format!("无法启动 {}：{e}", agent.launch.command)
        }
    })?;
    let stdin = child.stdin.take().ok_or("missing stdin")?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;

    let io = Arc::new(RpcIo {
        stdin: Mutex::new(stdin),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        assembled: Mutex::new(String::new()),
    });

    tokio::spawn(read_stderr(app.clone(), stderr));
    tokio::spawn(read_stdout(
        app.clone(),
        io.clone(),
        stdout,
        cwd.clone(),
        vault_root.clone(),
    ));

    io.request(
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true },
                "terminal": false
            },
            "clientInfo": {
                "name": "pageg",
                "title": "Pageg",
                "version": "0.1.0"
            }
        }),
    )
    .await?;

    maybe_authenticate(&io, &agent).await?;

    let created = io
        .request(
            "session/new",
            json!({
                "cwd": cwd.to_string_lossy(),
                "mcpServers": []
            }),
        )
        .await?;
    let session_id = created
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or("session/new did not return sessionId")?
        .to_string();

    Ok(AcpSession {
        child,
        io,
        session_id,
        agent_id: agent.id,
        agent_name: agent.name,
        _cwd: cwd,
        _vault_root: vault_root,
    })
}

async fn maybe_authenticate(io: &RpcIo, agent: &AgentDefinition) -> Result<(), String> {
    let method_id = match agent.id.as_str() {
        "cursor" => Some("cursor_login"),
        _ => None,
    };
    let Some(method_id) = method_id else {
        return Ok(());
    };
    match io
        .request("authenticate", json!({ "methodId": method_id }))
        .await
    {
        Ok(_) => Ok(()),
        Err(err) if auth_already_ok(&err) => Ok(()),
        Err(err) => {
            if agent.id == "cursor" && crate::setup::cursor_login_on_disk() {
                return Ok(());
            }
            Err(if agent.id == "cursor" {
                format!(
                    "Cursor CLI 没能复用本机登录（ACP authenticate/cursor_login）。这和编辑器窗口登录不是同一份。若 Codeg 能用 Cursor，应对应 ~/.cursor/cli-config.json。也可以先连 Codex（复用 ~/.codex/auth.json）。原始错误：{err}"
                )
            } else {
                err
            })
        }
    }
}

fn auth_already_ok(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("already")
        || lower.contains("not required")
        || lower.contains("not needed")
        || (lower.contains("auth") && lower.contains("skip"))
}

fn spawn_command(command: &str, args: &[String]) -> Command {
    let mut cmd = if cfg!(windows) && looks_like_script(command) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command).args(args);
        c
    } else {
        let mut c = Command::new(command);
        c.args(args);
        c
    };
    apply_user_env(&mut cmd);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn looks_like_script(command: &str) -> bool {
    let lower = command.to_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat") || (!Path::new(command).is_absolute() && !lower.ends_with(".exe"))
}

async fn read_stderr(app: AppHandle, stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = app.emit(
            "acp-event",
            AcpEvent {
                kind: "log".into(),
                text: Some(format!("{line}\n")),
                session_update: None,
                status: None,
            },
        );
    }
}

async fn read_stdout(
    app: AppHandle,
    io: Arc<RpcIo>,
    stdout: tokio::process::ChildStdout,
    cwd: PathBuf,
    vault_root: PathBuf,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
            if msg.get("id").is_some() {
                let id = msg.get("id").cloned().unwrap_or(Value::Null);
                let params = msg.get("params").cloned().unwrap_or(json!({}));
                let response = handle_agent_request(method, params, &cwd, &vault_root).await;
                let payload = match response {
                    Ok(result) => json!({"jsonrpc":"2.0","id": id, "result": result}),
                    Err(err) => json!({
                        "jsonrpc":"2.0",
                        "id": id,
                        "error": { "code": -32000, "message": err }
                    }),
                };
                let _ = io.write(&payload).await;
                continue;
            }
            if method == "session/update" {
                let update = msg
                    .get("params")
                    .and_then(|p| p.get("update"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let session_update = update
                    .get("sessionUpdate")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let text = chunk_text(&update);
                if let Some(chunk) = &text {
                    io.assembled.lock().await.push_str(chunk);
                }
                let _ = app.emit(
                    "acp-event",
                    AcpEvent {
                        kind: "session_update".into(),
                        text,
                        session_update,
                        status: None,
                    },
                );
            }
            continue;
        }
        if let Some(id) = msg.get("id").and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64))) {
            if let Some(tx) = io.pending.lock().await.remove(&id) {
                if let Some(error) = msg.get("error") {
                    let _ = tx.send(Err(error.to_string()));
                } else {
                    let _ = tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                }
            }
        }
    }
}

fn chunk_text(update: &Value) -> Option<String> {
    update
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .or_else(|| update.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
}

async fn handle_agent_request(
    method: &str,
    params: Value,
    cwd: &Path,
    vault_root: &Path,
) -> Result<Value, String> {
    match method {
        "fs/read_text_file" => {
            let path = PathBuf::from(params.get("path").and_then(|v| v.as_str()).unwrap_or(""));
            if !vault::is_inside(vault_root, &path) && !vault::is_inside(cwd, &path) {
                return Err("Path is outside the Pageg vault".into());
            }
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({ "content": content }))
        }
        "fs/write_text_file" => {
            let path = PathBuf::from(params.get("path").and_then(|v| v.as_str()).unwrap_or(""));
            if !vault::is_inside(vault_root, &path) && !vault::is_inside(cwd, &path) {
                return Err("Refusing to write outside the Pageg vault".into());
            }
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            let content = params
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            tokio::fs::write(&path, content)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({}))
        }
        "cursor/ask_question" => Ok(json!({ "outcome": { "outcome": "skipped" } })),
        "cursor/create_plan" => Ok(json!({ "outcome": { "outcome": "accepted" } })),
        "session/request_permission" => {
            let options = params.get("options").and_then(|v| v.as_array()).cloned();
            let option_id = options
                .as_ref()
                .and_then(|opts| {
                    opts.iter().find(|opt| {
                        opt.get("kind")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .contains("allow")
                            || opt
                                .get("optionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .contains("allow")
                    })
                })
                .or_else(|| options.as_ref().and_then(|opts| opts.first()))
                .and_then(|opt| opt.get("optionId").and_then(|v| v.as_str()))
                .unwrap_or("");
            if option_id.is_empty() {
                Ok(json!({ "outcome": { "outcome": "cancelled" } }))
            } else {
                Ok(json!({ "outcome": { "outcome": "selected", "optionId": option_id } }))
            }
        }
        _ => Err(format!("Unsupported client method: {method}")),
    }
}


