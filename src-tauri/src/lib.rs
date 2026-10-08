mod acp;
mod registry;
mod setup;
mod vault;

use acp::AcpHost;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use vault::Highlight;

pub struct AppState {
    acp: Arc<AcpHost>,
}

#[derive(Deserialize)]
pub struct ConnectPayload {
    #[serde(rename = "agentId")]
    agent_id: String,
    cwd: String,
    #[serde(rename = "customCommand")]
    custom_command: Option<String>,
}

#[tauri::command]
async fn open_pdf(app: AppHandle) -> Result<Option<vault::BookRecord>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    let Some(file) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    vault::open_book(&app, &path.to_string_lossy()).map(Some)
}

#[tauri::command]
async fn open_pdf_path(app: AppHandle, path: String) -> Result<vault::BookRecord, String> {
    let trimmed = path.trim();
    if !trimmed.to_lowercase().ends_with(".pdf") {
        return Err("请选择 PDF 文件".into());
    }
    vault::open_book(&app, trimmed)
}

#[tauri::command]
async fn import_pdf_bytes(
    app: AppHandle,
    name: String,
    data: Vec<u8>,
) -> Result<vault::BookRecord, String> {
    vault::ingest_pdf(&app, &data, &name)
}

#[tauri::command]
async fn read_pdf(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path)
        .await
        .map_err(|e| format!("读 PDF 失败：{e}"))
}

#[tauri::command]
fn library_list(app: AppHandle) -> Result<Vec<vault::BookMeta>, String> {
    vault::list_books(&app)
}

#[tauri::command]
fn library_load(app: AppHandle, id: String) -> Result<vault::BookRecord, String> {
    vault::load_book(&app, &id)
}

#[tauri::command]
fn notes_save(app: AppHandle, id: String, notes: String) -> Result<(), String> {
    vault::save_notes(&app, &id, &notes)
}

#[tauri::command]
fn notes_append(app: AppHandle, id: String, block: String) -> Result<String, String> {
    vault::append_note(&app, &id, &block)
}

#[tauri::command]
fn glossary_save(app: AppHandle, id: String, glossary: String) -> Result<(), String> {
    vault::save_glossary(&app, &id, &glossary)
}

#[tauri::command]
fn highlights_save(app: AppHandle, id: String, highlights: Vec<Highlight>) -> Result<(), String> {
    vault::save_highlights(&app, &id, &highlights)
}

#[tauri::command]
fn book_page(app: AppHandle, id: String, page: u32) -> Result<(), String> {
    vault::save_last_page(&app, &id, page)
}

#[tauri::command]
fn settings_read(app: AppHandle) -> Result<vault::AppSettings, String> {
    vault::read_settings(&app)
}

#[tauri::command]
fn settings_write(app: AppHandle, settings: vault::AppSettings) -> Result<(), String> {
    vault::write_settings(&app, settings)
}

#[tauri::command]
fn session_read(app: AppHandle, id: String) -> Result<String, String> {
    vault::read_session(&app, &id)
}

#[tauri::command]
fn session_append(app: AppHandle, id: String, block: String) -> Result<String, String> {
    vault::append_session(&app, &id, &block)
}

#[tauri::command]
fn catalog_read(app: AppHandle) -> Result<vault::Catalog, String> {
    vault::read_catalog(&app)
}

#[tauri::command]
fn shelf_create(app: AppHandle, name: String) -> Result<vault::Catalog, String> {
    vault::create_shelf(&app, &name)
}

#[tauri::command]
fn shelf_rename(app: AppHandle, id: String, name: String) -> Result<vault::Catalog, String> {
    vault::rename_shelf(&app, &id, &name)
}

#[tauri::command]
fn shelf_delete(app: AppHandle, id: String) -> Result<vault::Catalog, String> {
    vault::delete_shelf(&app, &id)
}

#[tauri::command]
fn shelf_assign(
    app: AppHandle,
    shelf_id: String,
    book_id: String,
    on: bool,
) -> Result<vault::Catalog, String> {
    vault::assign_book(&app, &shelf_id, &book_id, on)
}

#[tauri::command]
async fn env_diagnose() -> Result<setup::DiagnoseReport, String> {
    Ok(setup::diagnose().await)
}

#[tauri::command]
async fn env_warmup(agent_id: String) -> Result<String, String> {
    setup::warmup(&agent_id).await
}

#[tauri::command]
fn env_install_cursor() -> Result<String, String> {
    setup::install_cursor_cli()
}

#[tauri::command]
fn env_cursor_login() -> Result<String, String> {
    setup::open_cursor_login()
}

#[tauri::command]
fn agents_list() -> Vec<registry::AgentInfo> {
    registry::catalog()
}

#[tauri::command]
async fn acp_status(state: State<'_, AppState>) -> Result<acp::AcpStatus, String> {
    Ok(state.acp.status().await)
}

#[tauri::command]
async fn acp_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ConnectPayload,
) -> Result<acp::AcpStatus, String> {
    state
        .acp
        .connect(
            &app,
            &payload.agent_id,
            &payload.cwd,
            payload.custom_command.as_deref(),
        )
        .await
}

#[tauri::command]
async fn acp_disconnect(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.acp.disconnect(&app).await
}

#[tauri::command]
async fn acp_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.acp.cancel().await
}

#[tauri::command]
async fn acp_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<String, String> {
    let answer = state.acp.prompt(&app, &text).await?;
    let _ = app
        .notification()
        .builder()
        .title("Pageg")
        .body("这一轮已经完成，可以继续读了。")
        .show();
    Ok(answer)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            acp: Arc::new(AcpHost::new()),
        })
        .invoke_handler(tauri::generate_handler![
            open_pdf,
            open_pdf_path,
            import_pdf_bytes,
            read_pdf,
            library_list,
            library_load,
            notes_save,
            notes_append,
            glossary_save,
            highlights_save,
            book_page,
            settings_read,
            settings_write,
            session_read,
            session_append,
            catalog_read,
            shelf_create,
            shelf_rename,
            shelf_delete,
            shelf_assign,
            env_diagnose,
            env_warmup,
            env_install_cursor,
            env_cursor_login,
            agents_list,
            acp_status,
            acp_connect,
            acp_disconnect,
            acp_cancel,
            acp_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pageg");
}
