use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SKILL: &str = include_str!("../../skills/pageg-reader/SKILL.md");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Highlight {
    pub id: String,
    pub page: u32,
    pub text: String,
    pub color: String,
    pub note: Option<String>,
    pub rects: Vec<Rect>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BookMeta {
    pub id: String,
    pub title: String,
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "lastPage")]
    pub last_page: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BookRecord {
    #[serde(flatten)]
    pub meta: BookMeta,
    pub notes: String,
    pub highlights: Vec<Highlight>,
    pub glossary: String,
    #[serde(rename = "vaultPath")]
    pub vault_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    #[serde(rename = "customCommand", default)]
    pub custom_command: String,
    #[serde(default = "default_handedness")]
    pub handedness: String,
    #[serde(rename = "openTabs", default)]
    pub open_tabs: Vec<String>,
    #[serde(rename = "currentShelf", default)]
    pub current_shelf: String,
}

fn default_handedness() -> String {
    "right".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            agent_id: "cursor".into(),
            custom_command: String::new(),
            handedness: default_handedness(),
            open_tabs: Vec::new(),
            current_shelf: String::new(),
        }
    }
}

fn now_iso() -> String {
    // Keep it simple and stable without extra crates.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

pub fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub fn vault_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("vault"))
}

fn book_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(vault_root(app)?.join("books").join(id))
}

fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(data);
    hex::encode(&hasher.finalize()[..8])
}

fn looks_like_pdf(bytes: &[u8]) -> bool {
    bytes.windows(5).take(1024).any(|window| window == b"%PDF-")
}

fn read_to_string_lossy(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub fn ensure_layout(app: &AppHandle) -> Result<PathBuf, String> {
    let root = vault_root(app)?;
    fs::create_dir_all(root.join("books")).map_err(|e| e.to_string())?;
    let settings = data_root(app)?.join("settings.json");
    if !settings.exists() {
        write_json(&settings, &AppSettings::default())?;
    }
    Ok(root)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

fn write_skill(dir: &Path) -> Result<(), String> {
    let skill_dir = dir.join(".agents").join("skills").join("pageg-reader");
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    fs::write(skill_dir.join("SKILL.md"), SKILL).map_err(|e| e.to_string())?;
    fs::write(dir.join("AGENTS.md"), SKILL).map_err(|e| e.to_string())?;
    Ok(())
}

fn touch_meta(dir: &Path) -> Result<(), String> {
    let meta_path = dir.join("meta.json");
    let mut meta: BookMeta =
        serde_json::from_str(&read_to_string_lossy(&meta_path)).map_err(|e| e.to_string())?;
    meta.updated_at = now_iso();
    write_json(&meta_path, &meta)
}

pub fn read_settings(app: &AppHandle) -> Result<AppSettings, String> {
    ensure_layout(app)?;
    let path = data_root(app)?.join("settings.json");
    let raw = fs::read_to_string(path).unwrap_or_else(|_| "{}".into());
    let mut settings: AppSettings = serde_json::from_str(&raw).unwrap_or_default();
    if settings.agent_id.is_empty() {
        settings.agent_id = "cursor".into();
    }
    if settings.handedness.is_empty() {
        settings.handedness = default_handedness();
    }
    Ok(settings)
}

pub fn write_settings(app: &AppHandle, settings: AppSettings) -> Result<(), String> {
    ensure_layout(app)?;
    write_json(&data_root(app)?.join("settings.json"), &settings)
}

pub fn ingest_pdf(app: &AppHandle, bytes: &[u8], filename: &str) -> Result<BookRecord, String> {
    if bytes.is_empty() || !looks_like_pdf(bytes) {
        return Err("这不是一份有效的 PDF 文件".into());
    }
    ensure_layout(app)?;
    let id = hash_bytes(bytes);
    let dir = book_dir(app, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_skill(&dir)?;
    let dest = dir.join("source.pdf");
    fs::write(&dest, bytes).map_err(|e| format!("无法保存 PDF：{e}"))?;
    let source_str = dest.to_string_lossy().to_string();

    let meta_path = dir.join("meta.json");
    let title = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled")
        .to_string();
    let stamp = now_iso();
    let meta = if meta_path.exists() {
        let mut meta: BookMeta =
            serde_json::from_str(&read_to_string_lossy(&meta_path)).map_err(|e| e.to_string())?;
        meta.source_path = source_str;
        meta.updated_at = stamp;
        meta
    } else {
        fs::write(dir.join("notes.md"), format!("# {title}\n\n")).map_err(|e| e.to_string())?;
        fs::write(dir.join("glossary.md"), "# Glossary\n\n").map_err(|e| e.to_string())?;
        fs::write(dir.join("session.md"), "# Session\n\n").map_err(|e| e.to_string())?;
        fs::write(dir.join("highlights.json"), "[]").map_err(|e| e.to_string())?;
        BookMeta {
            id: id.clone(),
            title,
            source_path: source_str,
            created_at: stamp.clone(),
            updated_at: stamp,
            last_page: 1,
        }
    };
    write_json(&meta_path, &meta)?;
    load_book(app, &id)
}

pub fn open_book(app: &AppHandle, source_path: &str) -> Result<BookRecord, String> {
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err(format!("找不到文件：{source_path}"));
    }
    let bytes = fs::read(&source).map_err(|e| format!("无法读取 PDF：{e}"))?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf")
        .to_string();
    ingest_pdf(app, &bytes, &name)
}

pub fn load_book(app: &AppHandle, id: &str) -> Result<BookRecord, String> {
    let dir = book_dir(app, id)?;
    let mut meta: BookMeta = serde_json::from_str(&read_to_string_lossy(&dir.join("meta.json")))
        .map_err(|e| e.to_string())?;
    let copied = dir.join("source.pdf");
    if !copied.exists() && Path::new(&meta.source_path).exists() {
        let _ = fs::copy(&meta.source_path, &copied);
    }
    if copied.exists() {
        meta.source_path = copied.to_string_lossy().to_string();
    }
    let highlights = serde_json::from_str(&read_to_string_lossy(&dir.join("highlights.json")))
        .unwrap_or_default();
    Ok(BookRecord {
        meta,
        notes: read_to_string_lossy(&dir.join("notes.md")),
        glossary: read_to_string_lossy(&dir.join("glossary.md")),
        highlights,
        vault_path: dir.to_string_lossy().to_string(),
    })
}

pub fn list_books(app: &AppHandle) -> Result<Vec<BookMeta>, String> {
    ensure_layout(app)?;
    let root = vault_root(app)?.join("books");
    let mut books = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(books),
    };
    for entry in entries.flatten() {
        let meta_path = entry.path().join("meta.json");
        if let Ok(raw) = fs::read_to_string(meta_path) {
            if let Ok(meta) = serde_json::from_str::<BookMeta>(&raw) {
                books.push(meta);
            }
        }
    }
    books.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(books)
}

pub fn save_notes(app: &AppHandle, id: &str, notes: &str) -> Result<(), String> {
    let dir = book_dir(app, id)?;
    fs::write(dir.join("notes.md"), notes).map_err(|e| e.to_string())?;
    touch_meta(&dir)
}

pub fn save_glossary(app: &AppHandle, id: &str, glossary: &str) -> Result<(), String> {
    let dir = book_dir(app, id)?;
    fs::write(dir.join("glossary.md"), glossary).map_err(|e| e.to_string())?;
    touch_meta(&dir)
}

pub fn save_highlights(app: &AppHandle, id: &str, highlights: &[Highlight]) -> Result<(), String> {
    let dir = book_dir(app, id)?;
    write_json(&dir.join("highlights.json"), &highlights)?;
    touch_meta(&dir)
}

pub fn save_last_page(app: &AppHandle, id: &str, last_page: u32) -> Result<(), String> {
    let dir = book_dir(app, id)?;
    let meta_path = dir.join("meta.json");
    let mut meta: BookMeta =
        serde_json::from_str(&read_to_string_lossy(&meta_path)).map_err(|e| e.to_string())?;
    meta.last_page = last_page;
    meta.updated_at = now_iso();
    write_json(&meta_path, &meta)
}

pub fn append_note(app: &AppHandle, id: &str, block: &str) -> Result<String, String> {
    let dir = book_dir(app, id)?;
    let path = dir.join("notes.md");
    let prev = read_to_string_lossy(&path);
    let next = format!("{}\n\n{}\n", prev.trim_end(), block.trim());
    fs::write(&path, &next).map_err(|e| e.to_string())?;
    touch_meta(&dir)?;
    Ok(next)
}

pub fn is_inside(root: &Path, target: &Path) -> bool {
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let target = fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    target.starts_with(root)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shelf {
    pub id: String,
    pub name: String,
    #[serde(rename = "bookIds", default)]
    pub book_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Catalog {
    #[serde(default)]
    pub shelves: Vec<Shelf>,
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(vault_root(app)?.join("catalog.json"))
}

pub fn read_catalog(app: &AppHandle) -> Result<Catalog, String> {
    ensure_layout(app)?;
    let path = catalog_path(app)?;
    if !path.exists() {
        let catalog = Catalog::default();
        write_json(&path, &catalog)?;
        return Ok(catalog);
    }
    serde_json::from_str(&read_to_string_lossy(&path)).map_err(|e| e.to_string())
}

fn write_catalog(app: &AppHandle, catalog: &Catalog) -> Result<(), String> {
    write_json(&catalog_path(app)?, catalog)
}

pub fn create_shelf(app: &AppHandle, name: &str) -> Result<Catalog, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("书架名称不能为空".into());
    }
    let mut catalog = read_catalog(app)?;
    catalog.shelves.push(Shelf {
        id: format!("s{}", now_iso()),
        name: name.to_string(),
        book_ids: Vec::new(),
    });
    write_catalog(app, &catalog)?;
    Ok(catalog)
}

pub fn rename_shelf(app: &AppHandle, id: &str, name: &str) -> Result<Catalog, String> {
    let mut catalog = read_catalog(app)?;
    let shelf = catalog
        .shelves
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or("找不到这个书架")?;
    shelf.name = name.trim().to_string();
    write_catalog(app, &catalog)?;
    Ok(catalog)
}

pub fn delete_shelf(app: &AppHandle, id: &str) -> Result<Catalog, String> {
    let mut catalog = read_catalog(app)?;
    catalog.shelves.retain(|s| s.id != id);
    write_catalog(app, &catalog)?;
    Ok(catalog)
}

pub fn assign_book(
    app: &AppHandle,
    shelf_id: &str,
    book_id: &str,
    on: bool,
) -> Result<Catalog, String> {
    let mut catalog = read_catalog(app)?;
    let shelf = catalog
        .shelves
        .iter_mut()
        .find(|s| s.id == shelf_id)
        .ok_or("找不到这个书架")?;
    if on {
        if !shelf.book_ids.iter().any(|id| id == book_id) {
            shelf.book_ids.push(book_id.to_string());
        }
    } else {
        shelf.book_ids.retain(|id| id != book_id);
    }
    write_catalog(app, &catalog)?;
    Ok(catalog)
}

pub fn read_session(app: &AppHandle, id: &str) -> Result<String, String> {
    Ok(read_to_string_lossy(&book_dir(app, id)?.join("session.md")))
}

pub fn append_session(app: &AppHandle, id: &str, block: &str) -> Result<String, String> {
    let dir = book_dir(app, id)?;
    let path = dir.join("session.md");
    let prev = read_to_string_lossy(&path);
    let mut next = format!("{}\n\n{}\n", prev.trim_end(), block.trim());
    if next.len() > 12_000 {
        let keep = next
            .rfind("\n## ")
            .and_then(|first| {
                next[first + 1..]
                    .match_indices("\n## ")
                    .nth(6)
                    .map(|(i, _)| first + 1 + i)
            })
            .unwrap_or(0);
        if keep > 0 {
            next = format!("# Session\n{}", &next[keep..]);
        }
    }
    fs::write(&path, &next).map_err(|e| e.to_string())?;
    Ok(next)
}
