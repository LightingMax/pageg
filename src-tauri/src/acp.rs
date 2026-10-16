use crate::registry::{self, apply_user_env, AgentDefinition};
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
pub struct AcpModel {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

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
    #[serde(rename = "modelId", skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub models: Vec<AcpModel>,
}

impl Default for AcpStatus {
    fn default() -> Self {
        Self {
            state: "disconnected".into(),
            agent_id: None,
            agent_name: None,
            session_id: None,
            message: None,
            model_id: None,
            models: Vec::new(),
        }
    }
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
    model_id: Option<String>,
    models: Vec<AcpModel>,
    cwd: PathBuf,
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
            status: Mutex::new(AcpStatus::default()),
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
                ..AcpStatus::default()
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
                ..AcpStatus::default()
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
                    ..AcpStatus::default()
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
                    model_id: session.model_id.clone(),
                    models: session.models.clone(),
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
                        ..AcpStatus::default()
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
                model_id: current.model_id.clone(),
                models: current.models.clone(),
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
                        model_id: current.model_id,
                        models: current.models,
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
                        model_id: current.model_id,
                        models: current.models,
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

    pub async fn reset_context(&self, app: &AppHandle) -> Result<(), String> {
        let (io, cwd) = {
            let guard = self.session.lock().await;
            let session = guard.as_ref().ok_or("ACP session is not ready")?;
            (session.io.clone(), session.cwd.clone())
        };
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
            .and_then(|value| value.as_str())
            .ok_or("session/new did not return sessionId")?
            .to_string();
        let (model_id, models) = session_model_info(&created);
        prefer_ask_mode(&io, &session_id, &created).await;
        {
            let mut guard = self.session.lock().await;
            let session = guard.as_mut().ok_or("ACP session is not ready")?;
            session.session_id = session_id.clone();
            session.model_id = model_id.clone();
            session.models = models.clone();
        }
        let current = self.status().await;
        self.set_status(
            app,
            AcpStatus {
                state: "ready".into(),
                agent_id: current.agent_id,
                agent_name: current.agent_name,
                session_id: Some(session_id),
                message: Some("已建立独立阅读上下文".into()),
                model_id,
                models,
            },
        )
        .await;
        Ok(())
    }

    pub async fn set_model(&self, app: &AppHandle, model_id: &str) -> Result<AcpStatus, String> {
        let (io, session_id) = {
            let guard = self.session.lock().await;
            let session = guard.as_ref().ok_or("ACP session is not ready")?;
            (session.io.clone(), session.session_id.clone())
        };
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err("模型不能为空".into());
        }
        let (base_model, effort) = split_model_id(model_id);
        let response = io
            .request(
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": "model",
                    "value": base_model,
                }),
            )
            .await?;
        if let Some(effort) = effort {
            io.request(
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": "reasoning_effort",
                    "value": effort,
                }),
            )
            .await?;
        }
        let (_, models) = session_model_info(&response);
        let mut guard = self.session.lock().await;
        let session = guard.as_mut().ok_or("ACP session is not ready")?;
        session.model_id = Some(model_id.to_string());
        if !models.is_empty() {
            session.models = models;
        }
        let status = AcpStatus {
            state: "ready".into(),
            agent_id: Some(session.agent_id.clone()),
            agent_name: Some(session.agent_name.clone()),
            session_id: Some(session.session_id.clone()),
            message: Some(format!("已切换到 {}", model_id)),
            model_id: session.model_id.clone(),
            models: session.models.clone(),
        };
        drop(guard);
        self.set_status(app, status.clone()).await;
        Ok(status)
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let guard = self.session.lock().await;
        let session = guard.as_ref().ok_or("ACP session is not ready")?;
        session
            .io
            .notify("session/cancel", json!({ "sessionId": session.session_id }))
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
                "version": env!("CARGO_PKG_VERSION")
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
    let (model_id, models) = session_model_info(&created);

    prefer_ask_mode(&io, &session_id, &created).await;

    Ok(AcpSession {
        child,
        io,
        session_id,
        agent_id: agent.id,
        agent_name: agent.name,
        model_id,
        models,
        cwd,
        _vault_root: vault_root,
    })
}

fn session_model_info(value: &Value) -> (Option<String>, Vec<AcpModel>) {
    let model_state = value.get("models");
    let current = model_state
        .and_then(|state| state.get("currentModelId"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("configOptions")
                .and_then(Value::as_array)
                .and_then(|options| {
                    options
                        .iter()
                        .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
                })
                .and_then(|option| option.get("currentValue"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let available = model_state
        .and_then(|state| state.get("availableModels"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let config_models = value
        .get("configOptions")
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
        })
        .and_then(|option| option.get("options"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let source = if available.is_empty() {
        config_models
    } else {
        available
    };
    let mut seen = std::collections::HashSet::new();
    let models = source
        .into_iter()
        .filter_map(|model| {
            let id = model
                .get("modelId")
                .or_else(|| model.get("id"))
                .or_else(|| model.get("value"))?
                .as_str()?
                .trim();
            if id.is_empty() || !seen.insert(id.to_string()) {
                return None;
            }
            let name = model
                .get("name")
                .or_else(|| model.get("displayName"))
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(id)
                .to_string();
            let description = model
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(AcpModel {
                id: id.to_string(),
                name,
                description,
            })
        })
        .collect();
    (current, models)
}

fn split_model_id(id: &str) -> (&str, Option<&str>) {
    let Some((model, rest)) = id.split_once('[') else {
        return (id, None);
    };
    let effort = rest.strip_suffix(']');
    (model, effort)
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

async fn prefer_ask_mode(io: &RpcIo, session_id: &str, created: &Value) {
    let mode_id = created
        .get("modes")
        .and_then(|v| v.as_array())
        .and_then(|modes| {
            modes.iter().find_map(|mode| {
                let id = mode.get("id").and_then(|v| v.as_str())?;
                let name = mode.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                if id.eq_ignore_ascii_case("ask")
                    || name.to_lowercase().contains("ask")
                    || name.contains("问答")
                    || name.contains("只读")
                {
                    Some(id.to_string())
                } else {
                    None
                }
            })
        })
        .or_else(|| Some("ask".into()));
    if let Some(mode_id) = mode_id {
        let _ = io
            .request(
                "session/set_mode",
                json!({ "sessionId": session_id, "modeId": mode_id }),
            )
            .await;
    }
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
    lower.ends_with(".cmd")
        || lower.ends_with(".bat")
        || (!Path::new(command).is_absolute() && !lower.ends_with(".exe"))
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
                let kind = session_update.as_deref().unwrap_or("");
                if kind == "agent_thought_chunk"
                    || kind == "tool_call"
                    || kind == "tool_call_update"
                {
                    if let Some(text) = chunk_text(&update) {
                        let _ = app.emit(
                            "acp-event",
                            AcpEvent {
                                kind: "log".into(),
                                text: Some(format!("{text}\n")),
                                session_update,
                                status: None,
                            },
                        );
                    }
                    continue;
                }
                let text = if is_reader_message(kind) {
                    chunk_text(&update)
                } else {
                    None
                };
                if let Some(chunk) = &text {
                    io.assembled.lock().await.push_str(chunk);
                }
                if text.is_some() {
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
            }
            continue;
        }
        if let Some(id) = msg
            .get("id")
            .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)))
        {
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

fn is_reader_message(kind: &str) -> bool {
    kind.is_empty()
        || kind == "agent_message_chunk"
        || kind == "agent_message"
        || kind == "message"
        || kind == "message_chunk"
}

fn chunk_text(update: &Value) -> Option<String> {
    if let Some(text) = update
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
    {
        return Some(text.to_string());
    }
    if let Some(text) = update.get("text").and_then(|t| t.as_str()) {
        return Some(text.to_string());
    }
    if let Some(items) = update.get("content").and_then(|c| c.as_array()) {
        let joined = items
            .iter()
            .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");
        if !joined.is_empty() {
            return Some(joined);
        }
    }
    None
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
            let reject = options.as_ref().and_then(|opts| {
                opts.iter().find(|opt| {
                    let blob = format!(
                        "{} {}",
                        opt.get("kind").and_then(|v| v.as_str()).unwrap_or(""),
                        opt.get("optionId").and_then(|v| v.as_str()).unwrap_or("")
                    )
                    .to_lowercase();
                    blob.contains("reject") || blob.contains("deny") || blob.contains("cancel")
                })
            });
            if let Some(opt) = reject {
                let option_id = opt
                    .get("optionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("reject-once");
                Ok(json!({ "outcome": { "outcome": "selected", "optionId": option_id } }))
            } else {
                Ok(json!({ "outcome": { "outcome": "cancelled" } }))
            }
        }
        _ => Err(format!("Unsupported client method: {method}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_chunks_are_kept() {
        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "译：你好" }
        });
        assert_eq!(chunk_text(&update).as_deref(), Some("译：你好"));
        assert!(is_reader_message("agent_message_chunk"));
    }

    #[test]
    fn thoughts_and_tools_are_not_reader_messages() {
        assert!(!is_reader_message("agent_thought_chunk"));
        assert!(!is_reader_message("tool_call"));
        assert!(!is_reader_message("tool_call_update"));
        assert!(!is_reader_message("plan"));
    }

    #[test]
    fn content_arrays_are_joined() {
        let update = json!({
            "content": [
                { "type": "text", "text": "译：" },
                { "type": "text", "text": "腺苷三磷酸" }
            ]
        });
        assert_eq!(chunk_text(&update).as_deref(), Some("译：腺苷三磷酸"));
    }

    #[test]
    fn session_models_use_codex_model_state() {
        let response = json!({
            "sessionId": "session-1",
            "models": {
                "currentModelId": "gpt-6.1-sol",
                "availableModels": [
                    { "id": "gpt-6.1-sol", "displayName": "GPT-6.1-Sol", "description": "workhorse" },
                    { "id": "gpt-6-luna", "displayName": "GPT-6-Luna" }
                ]
            }
        });
        let (current, models) = session_model_info(&response);
        assert_eq!(current.as_deref(), Some("gpt-6.1-sol"));
        assert_eq!(models[0].name, "GPT-6.1-Sol");
        assert_eq!(models[1].id, "gpt-6-luna");
    }

    #[test]
    fn session_models_fall_back_to_config_options() {
        let response = json!({
            "configOptions": [{
                "id": "model",
                "currentValue": "gpt-6-sol",
                "options": [{ "value": "gpt-6-sol", "name": "GPT-6-Sol" }]
            }]
        });
        let (current, models) = session_model_info(&response);
        assert_eq!(current.as_deref(), Some("gpt-6-sol"));
        assert_eq!(models[0].id, "gpt-6-sol");
    }

    #[test]
    fn session_models_accept_acp_reasoning_variants() {
        let response = json!({
            "models": {
                "currentModelId": "gpt-6-astra[high]",
                "availableModels": [
                    { "modelId": "gpt-6-astra[low]", "name": "6 Astra (low)" },
                    { "modelId": "gpt-6-astra[high]", "name": "6 Astra (high)" }
                ]
            }
        });
        let (current, models) = session_model_info(&response);
        assert_eq!(current.as_deref(), Some("gpt-6-astra[high]"));
        assert_eq!(models[0].id, "gpt-6-astra[low]");
        assert_eq!(
            split_model_id("gpt-6-astra[high]"),
            ("gpt-6-astra", Some("high"))
        );
    }
}
