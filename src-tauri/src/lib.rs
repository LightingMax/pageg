mod acp;
mod registry;
mod setup;
mod vault;

use acp::AcpHost;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

fn download_filename(url: &str, requested: &str) -> String {
    let source = if requested.trim().is_empty() {
        url.split('?')
            .next()
            .and_then(|value| value.rsplit('/').next())
            .unwrap_or("download.pdf")
    } else {
        requested.trim()
    };
    let mut name = source
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if name.is_empty() {
        name = "download".into();
    }
    if !name.to_lowercase().ends_with(".pdf") {
        name.push_str(".pdf");
    }
    if name.len() > 180 {
        name.truncate(180);
        if !name.to_lowercase().ends_with(".pdf") {
            name.push_str(".pdf");
        }
    }
    name
}

fn search_terms(query: &str) -> String {
    let mut terms = Vec::new();
    let mut current = String::new();
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            if current.len() > 1
                && !matches!(
                    current.to_lowercase().as_str(),
                    "pdf" | "download" | "paper"
                )
            {
                terms.push(current.clone());
            }
            current.clear();
        }
    }
    if current.len() > 1
        && !matches!(
            current.to_lowercase().as_str(),
            "pdf" | "download" | "paper"
        )
    {
        terms.push(current);
    }
    if terms.is_empty() {
        query
            .split_whitespace()
            .take(8)
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        terms.into_iter().take(8).collect::<Vec<_>>().join(" ")
    }
}

fn encode_query(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn xml_value(block: &str, tag: &str) -> Option<String> {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    let value = block.split_once(&start)?.1.split_once(&end)?.0.trim();
    Some(
        value
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">"),
    )
}

fn arxiv_pdf_url(block: &str) -> Option<String> {
    let marker = block.find("title=\"pdf\"")?;
    let start = block[..marker].rfind("<link")?;
    let rest = &block[start..];
    let link = &rest[..rest.find('>')?];
    let href = link.split_once("href=\"")?.1.split_once('"')?.0;
    let url = href.replace("http://", "https://");
    url.starts_with("https://").then_some(url)
}

#[derive(Clone, Serialize)]
struct PaperCandidate {
    id: String,
    title: String,
    authors: Vec<String>,
    year: String,
    summary: String,
    url: String,
    #[serde(rename = "pdfUrl")]
    pdf_url: String,
    source: String,
}

fn arxiv_candidates(xml: &str, fallback_title: &str) -> Vec<PaperCandidate> {
    let mut seen = std::collections::HashSet::new();
    xml.split("<entry>")
        .skip(1)
        .filter_map(|block| {
            let pdf_url = arxiv_pdf_url(block)?;
            if !seen.insert(pdf_url.clone()) {
                return None;
            }
            let raw_id = xml_value(block, "id")?;
            let id = raw_id
                .rsplit('/')
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            if id.is_empty() {
                return None;
            }
            let title = xml_value(block, "title")
                .unwrap_or_else(|| fallback_title.to_string())
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let summary = xml_value(block, "summary")
                .unwrap_or_default()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let authors = block
                .split("<author>")
                .skip(1)
                .filter_map(|author| xml_value(author, "name"))
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .take(8)
                .collect::<Vec<_>>();
            let year = xml_value(block, "published")
                .and_then(|value| value.get(0..4).map(str::to_string))
                .unwrap_or_default();
            Some(PaperCandidate {
                id: id.clone(),
                title,
                authors,
                year,
                summary,
                url: format!("https://arxiv.org/abs/{}", id),
                pdf_url,
                source: "arXiv".into(),
            })
        })
        .collect()
}

async fn search_arxiv_candidates(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<PaperCandidate>, String> {
    let terms = search_terms(query);
    if terms.trim().is_empty() {
        return Err("没有足够的论文关键词".into());
    }
    let endpoint = format!(
        "https://export.arxiv.org/api/query?search_query=all%3A{}&start=0&max_results=8&sortBy=relevance&sortOrder=descending",
        encode_query(&terms)
    );
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("搜索公开论文失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("论文搜索返回 HTTP {}", response.status()));
    }
    let xml = response
        .text()
        .await
        .map_err(|e| format!("读取论文搜索结果失败：{e}"))?;
    let candidates = arxiv_candidates(&xml, &terms);
    if candidates.is_empty() {
        return Err(format!("没有找到与“{terms}”匹配的开放 PDF"));
    }
    Ok(candidates)
}

fn openalex_abstract(value: &Value) -> String {
    let Some(index) = value.as_object() else {
        return String::new();
    };
    let mut words = Vec::new();
    for (word, positions) in index {
        if let Some(items) = positions.as_array() {
            for position in items.iter().filter_map(Value::as_u64) {
                words.push((position, word.as_str()));
            }
        }
    }
    words.sort_by_key(|(position, _)| *position);
    words
        .into_iter()
        .map(|(_, word)| word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn openalex_url(value: Option<&Value>) -> Option<String> {
    let url = value?.as_str()?.trim();
    if url.starts_with("https://") {
        Some(url.to_string())
    } else if url.starts_with("http://") {
        Some(url.replacen("http://", "https://", 1))
    } else {
        None
    }
}

fn openalex_candidates(value: &Value, fallback_title: &str) -> Vec<PaperCandidate> {
    let Some(results) = value.get("results").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    results
        .iter()
        .filter_map(|work| {
            let location = work.get("primary_location")?;
            let pdf_url = openalex_url(location.get("pdf_url")).or_else(|| {
                openalex_url(work.get("open_access").and_then(|item| item.get("oa_url")))
            })?;
            if !seen.insert(pdf_url.clone()) {
                return None;
            }
            let id = work
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| value.rsplit('/').next())
                .unwrap_or_default()
                .to_string();
            if id.is_empty() {
                return None;
            }
            let title = work
                .get("title")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(fallback_title)
                .trim()
                .to_string();
            let authors = work
                .get("authorships")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|author| {
                    author
                        .get("author")
                        .and_then(|item| item.get("display_name"))
                })
                .filter_map(Value::as_str)
                .take(8)
                .map(str::to_string)
                .collect::<Vec<_>>();
            let year = work
                .get("publication_year")
                .and_then(Value::as_u64)
                .map(|value| value.to_string())
                .unwrap_or_default();
            let summary =
                openalex_abstract(work.get("abstract_inverted_index").unwrap_or(&Value::Null));
            let url = openalex_url(location.get("landing_page_url"))
                .or_else(|| openalex_url(work.get("doi")))
                .unwrap_or_else(|| format!("https://openalex.org/{id}"));
            Some(PaperCandidate {
                id,
                title,
                authors,
                year,
                summary,
                url,
                pdf_url,
                source: "OpenAlex".into(),
            })
        })
        .collect()
}

async fn search_openalex_candidates(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<PaperCandidate>, String> {
    let terms = search_terms(query);
    if terms.trim().is_empty() {
        return Err("没有足够的论文关键词".into());
    }
    let endpoint = format!(
        "https://api.openalex.org/works?search={}&per-page=8&select=id,title,publication_year,authorships,abstract_inverted_index,primary_location,open_access,doi",
        encode_query(&terms)
    );
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("OpenAlex 搜索失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("OpenAlex 搜索返回 HTTP {}", response.status()));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 OpenAlex 结果失败：{e}"))?;
    let value =
        serde_json::from_str::<Value>(&body).map_err(|e| format!("解析 OpenAlex 结果失败：{e}"))?;
    let candidates = openalex_candidates(&value, &terms);
    if candidates.is_empty() {
        return Err(format!("没有找到与“{terms}”匹配的开放 PDF"));
    }
    Ok(candidates)
}

async fn search_paper_candidates(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<PaperCandidate>, String> {
    match search_arxiv_candidates(client, query).await {
        Ok(candidates) => Ok(candidates),
        Err(arxiv_error) => search_openalex_candidates(client, query)
            .await
            .map_err(|openalex_error| format!("{arxiv_error}；{openalex_error}")),
    }
}

async fn search_arxiv_pdf(
    client: &reqwest::Client,
    query: &str,
) -> Result<(String, String), String> {
    let candidate = search_paper_candidates(client, query)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "没有找到开放 PDF".to_string())?;
    Ok((candidate.pdf_url, candidate.title))
}

#[tauri::command]
async fn search_papers(query: String) -> Result<Vec<PaperCandidate>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Pageg/0.2 (local PDF reader)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("无法初始化论文搜索：{e}"))?;
    search_paper_candidates(&client, &query).await
}

#[tauri::command]
async fn download_pdf(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<vault::BookRecord, String> {
    let url = url.trim();
    if !url.to_lowercase().starts_with("https://") {
        return Err("论文下载只允许使用 HTTPS 地址".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Pageg/0.1 (local PDF reader)")
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("无法初始化下载器：{e}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载论文失败：{e}"))?;
    if response.url().scheme() != "https" {
        return Err("论文下载重定向到了非 HTTPS 地址".into());
    }
    if !response.status().is_success() {
        return Err(format!("论文地址返回 HTTP {}", response.status()));
    }
    const MAX_DOWNLOAD_BYTES: u64 = 80 * 1024 * 1024;
    if response.content_length().unwrap_or(0) > MAX_DOWNLOAD_BYTES {
        return Err("论文文件超过 80 MB，已停止下载".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取论文文件失败：{e}"))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("论文文件超过 80 MB，已停止下载".into());
    }
    vault::ingest_pdf(&app, &bytes, &download_filename(url, &filename))
}

#[tauri::command]
async fn search_and_download_pdf(
    app: AppHandle,
    query: String,
    filename: String,
) -> Result<vault::BookRecord, String> {
    let client = reqwest::Client::builder()
        .user_agent("Pageg/0.1 (local PDF reader)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("无法初始化论文搜索：{e}"))?;
    let (url, title) = search_arxiv_pdf(&client, &query).await?;
    let suggested = if filename.trim().is_empty() {
        format!("{title}.pdf")
    } else {
        filename
    };
    download_pdf(app, url, suggested).await
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
fn book_metadata_update(
    app: AppHandle,
    id: String,
    patch: vault::BookMetadataPatch,
) -> Result<vault::BookRecord, String> {
    vault::update_book_metadata(&app, &id, patch)
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
fn document_context_read(app: AppHandle, id: String) -> Result<Option<serde_json::Value>, String> {
    vault::read_document_context(&app, &id)
}

#[tauri::command]
fn document_context_save(
    app: AppHandle,
    id: String,
    context: serde_json::Value,
) -> Result<(), String> {
    vault::save_document_context(&app, &id, &context)
}

#[tauri::command]
fn book_digest_read(app: AppHandle, id: String) -> Result<Option<serde_json::Value>, String> {
    vault::read_book_digest(&app, &id)
}

#[tauri::command]
fn book_digest_save(app: AppHandle, id: String, digest: serde_json::Value) -> Result<(), String> {
    vault::save_book_digest(&app, &id, &digest)
}

#[tauri::command]
fn chat_history_read(app: AppHandle, id: String) -> Result<Option<serde_json::Value>, String> {
    vault::read_chat_history(&app, &id)
}

#[tauri::command]
fn chat_history_save(app: AppHandle, id: String, history: serde_json::Value) -> Result<(), String> {
    vault::save_chat_history(&app, &id, &history)
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
fn shelf_move_book(
    app: AppHandle,
    book_id: String,
    shelf_id: String,
) -> Result<vault::Catalog, String> {
    vault::move_book(&app, &book_id, &shelf_id)
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
async fn acp_set_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<acp::AcpStatus, String> {
    state.acp.set_model(&app, &model_id).await
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

#[tauri::command]
async fn acp_prompt_isolated(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<String, String> {
    state.acp.reset_context(&app).await?;
    state.acp.prompt(&app, &text).await
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
            download_pdf,
            search_papers,
            search_and_download_pdf,
            read_pdf,
            library_list,
            library_load,
            book_metadata_update,
            notes_save,
            notes_append,
            glossary_save,
            highlights_save,
            book_page,
            settings_read,
            settings_write,
            session_read,
            session_append,
            document_context_read,
            document_context_save,
            book_digest_read,
            book_digest_save,
            chat_history_read,
            chat_history_save,
            catalog_read,
            shelf_create,
            shelf_rename,
            shelf_delete,
            shelf_assign,
            shelf_move_book,
            env_diagnose,
            env_warmup,
            env_install_cursor,
            env_cursor_login,
            agents_list,
            acp_status,
            acp_connect,
            acp_disconnect,
            acp_cancel,
            acp_set_model,
            acp_prompt,
            acp_prompt_isolated
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pageg");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_names_are_safe_pdf_filenames() {
        assert_eq!(
            download_filename("https://arxiv.org/pdf/2504.19413v1", "Mem0: paper/2025"),
            "Mem0_ paper_2025.pdf"
        );
        assert_eq!(
            download_filename("https://arxiv.org/pdf/2504.19413v1", ""),
            "2504.19413v1.pdf"
        );
    }

    #[test]
    fn search_terms_keep_the_research_keyword() {
        assert_eq!(search_terms("帮我下载 mem0 的论文"), "mem0");
    }

    #[test]
    fn arxiv_links_are_read_from_atom_entries() {
        let entry = r#"<entry><title>Mem0: Paper</title><link href="https://arxiv.org/abs/2504.19413v1" rel="alternate"/><link href="https://arxiv.org/pdf/2504.19413v1" rel="related" type="application/pdf" title="pdf"/></entry>"#;
        assert_eq!(
            arxiv_pdf_url(entry).as_deref(),
            Some("https://arxiv.org/pdf/2504.19413v1")
        );
        assert_eq!(xml_value(entry, "title").as_deref(), Some("Mem0: Paper"));
    }

    #[test]
    fn openalex_results_keep_open_pdf_candidates() {
        let value = serde_json::json!({
            "results": [{
                "id": "https://openalex.org/W1",
                "title": "Cortex: Consolidating Context into Parametric Memory",
                "publication_year": 2026,
                "authorships": [{"author": {"display_name": "Jintian Zhang"}}],
                "abstract_inverted_index": {"Context": [0], "becomes": [1], "memory": [2]},
                "primary_location": {
                    "landing_page_url": "https://arxiv.org/abs/2610.20399",
                    "pdf_url": "https://arxiv.org/pdf/2610.20399"
                }
            }]
        });
        let candidates = openalex_candidates(&value, "cortex");
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].title,
            "Cortex: Consolidating Context into Parametric Memory"
        );
        assert_eq!(candidates[0].pdf_url, "https://arxiv.org/pdf/2610.20399");
        assert_eq!(candidates[0].authors, vec!["Jintian Zhang"]);
        assert_eq!(candidates[0].summary, "Context becomes memory");
    }
}
