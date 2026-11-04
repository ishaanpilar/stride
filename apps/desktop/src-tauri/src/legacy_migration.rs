//! One-time import of data and secrets from the app's previous incarnations
//! (Mindwtr / DoNext) into Stride's locations.
//!
//! Strictly copy-only: legacy directories and keychain entries are never
//! modified or deleted, and existing Stride data is never overwritten.
//! This is the only place where the legacy names may appear.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Previous per-user data directory names (Mindwtr upstream, plus the bundle
/// identifier used on Linux/Windows by upstream builds). Legacy-only.
const LEGACY_DATA_DIR_NAMES: &[&str] = &["mindwtr", "tech.dongdongbh.mindwtr"];
/// Previous bundle identifiers whose keychain services were
/// `<identifier>:secrets`. Legacy-only.
const LEGACY_KEYRING_IDENTIFIERS: &[&str] = &["com.ishaanpilar.donext", "tech.dongdongbh.mindwtr"];
/// Previous SQLite file stem; renamed to Stride's DB file name while copying.
const LEGACY_DB_FILE_STEM: &str = "mindwtr.db";
const IMPORT_MARKER_FILE_NAME: &str = ".legacy-import-done";

/// Does `root` (either flat or with config/data subfolders) hold real user data?
fn root_has_data(root: &Path) -> bool {
    let non_empty = |p: PathBuf| fs::metadata(p).map(|m| m.is_file() && m.len() > 0).unwrap_or(false);
    for dir in [root.to_path_buf(), root.join("data"), root.join("config")] {
        if non_empty(dir.join(crate::DATA_FILE_NAME)) || non_empty(dir.join(crate::DB_FILE_NAME)) {
            return true;
        }
    }
    false
}

/// Decide which legacy directory (if any) should be imported. Pure for tests.
fn pick_legacy_source(
    marker_present: bool,
    new_has_data: bool,
    candidates: &[PathBuf],
) -> Option<PathBuf> {
    if marker_present || new_has_data {
        return None;
    }
    candidates.iter().find(|p| p.is_dir() && root_has_data(p)).cloned()
}

fn destination_name(name: &str) -> String {
    match name.strip_prefix(LEGACY_DB_FILE_STEM) {
        Some(suffix) => format!("{}{suffix}", crate::DB_FILE_NAME),
        None => name.to_string(),
    }
}

/// Recursively copies `from` into `to`, never overwriting existing files.
fn copy_dir_no_overwrite(from: &Path, to: &Path) -> io::Result<usize> {
    fs::create_dir_all(to)?;
    let mut copied = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type()?;
        let target = to.join(destination_name(&name));
        if file_type.is_dir() {
            copied += copy_dir_no_overwrite(&entry.path(), &target)?;
        } else if file_type.is_file() && !target.exists() {
            fs::copy(entry.path(), &target)?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn legacy_candidates(base: &Path) -> Vec<PathBuf> {
    LEGACY_DATA_DIR_NAMES.iter().map(|n| base.join(n)).collect()
}

/// Core of the data import, parameterised on the base directories for tests.
fn import_legacy_data(config_base: &Path, data_base: &Path) -> io::Result<usize> {
    let mut bases = vec![config_base.to_path_buf()];
    if data_base != config_base {
        bases.push(data_base.to_path_buf());
    }
    let new_roots: Vec<PathBuf> = bases.iter().map(|b| b.join(crate::APP_NAME)).collect();
    let marker_present = new_roots
        .iter()
        .any(|r| r.join(IMPORT_MARKER_FILE_NAME).exists());
    let new_has_data = new_roots.iter().any(|r| root_has_data(r));
    if marker_present || new_has_data {
        return Ok(0);
    }
    let mut total = 0;
    let mut imported_any = false;
    for (base, new_root) in bases.iter().zip(new_roots.iter()) {
        if let Some(source) = pick_legacy_source(false, false, &legacy_candidates(base))
            .or_else(|| {
                // Config-only base on split-dir platforms: accept a legacy dir
                // that has no data file but exists (config/secrets).
                legacy_candidates(base).into_iter().find(|p| p.is_dir())
            })
        {
            log::info!(
                "Importing legacy data (copy only) from {} to {}",
                source.display(),
                new_root.display()
            );
            total += copy_dir_no_overwrite(&source, new_root)?;
            imported_any = true;
        }
    }
    if imported_any {
        for root in &new_roots {
            if root.is_dir() {
                let _ = fs::write(root.join(IMPORT_MARKER_FILE_NAME), b"");
            }
        }
    }
    Ok(total)
}

/// Run before anything reads Stride's directories.
pub(crate) fn migrate_legacy_data_dirs() {
    if crate::storage::is_portable_mode() {
        return;
    }
    let (Some(config_base), Some(data_base)) = (dirs::config_dir(), dirs::data_dir()) else {
        return;
    };
    match import_legacy_data(&config_base, &data_base) {
        Ok(0) => {}
        Ok(count) => eprintln!("Stride: imported {count} files from a previous installation (originals untouched)"),
        Err(error) => eprintln!("Stride: legacy data import failed: {error}"),
    }
}

/// WKWebView keeps localStorage in `~/Library/WebKit/<name>/WebsiteData/Default/<hash>/<hash>/
/// LocalStorage/localstorage.sqlite3`, where `<name>` was the bundle identifier (packaged app)
/// or the executable name (dev builds) of a previous install. Storage is also keyed by page
/// origin (`tauri://localhost` packaged, `http://localhost` in dev), so copying folders cannot
/// carry it across; instead the rows are read here and handed to the page once, which adds the
/// ones it lacks (apps/desktop/src/lib/legacy-local-storage.ts). Legacy-only.
const LEGACY_WEBKIT_DIR_NAMES: &[&str] = &["com.ishaanpilar.donext", "tech.dongdongbh.mindwtr", "mindwtr", "donext"];

fn find_local_storage_dbs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            find_local_storage_dbs(&path, out);
        } else if entry.file_name() == "localstorage.sqlite3" {
            out.push(path);
        }
    }
}

fn decode_utf16le(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16(&units).ok()
}

/// Reads one WebKit localStorage database. It is copied (with its -wal/-shm) to a temp dir
/// first so the legacy files are never opened for writing.
fn read_local_storage_db(db: &Path) -> rusqlite::Result<Vec<(String, String)>> {
    let tmp = std::env::temp_dir().join(format!("stride-legacy-ls-{}", std::process::id()));
    let _ = fs::create_dir_all(&tmp);
    let copy = tmp.join("localstorage.sqlite3");
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", db.display()));
        let to = PathBuf::from(format!("{}{suffix}", copy.display()));
        let _ = fs::remove_file(&to);
        if from.is_file() {
            let _ = fs::copy(&from, &to);
        }
    }
    let result = (|| {
        let conn = rusqlite::Connection::open(&copy)?;
        let mut stmt = conn.prepare("SELECT key, value FROM ItemTable")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)))?;
        let mut items = Vec::new();
        for row in rows.flatten() {
            if let Some(value) = decode_utf16le(&row.1) {
                items.push((row.0, value));
            }
        }
        Ok(items)
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

/// All legacy localStorage rows, newest database first; the first value seen for a key wins.
fn read_legacy_local_storage(webkit_base: &Path) -> Vec<(String, String)> {
    let mut dbs = Vec::new();
    for name in LEGACY_WEBKIT_DIR_NAMES {
        find_local_storage_dbs(&webkit_base.join(name), &mut dbs);
    }
    let modified = |p: &PathBuf| {
        let wal = PathBuf::from(format!("{}-wal", p.display()));
        [p.clone(), wal]
            .iter()
            .filter_map(|f| fs::metadata(f).and_then(|m| m.modified()).ok())
            .max()
    };
    dbs.sort_by_key(|p| std::cmp::Reverse(modified(p)));
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for db in dbs {
        for (key, value) in read_local_storage_db(&db).unwrap_or_default() {
            if seen.insert(key.clone()) {
                items.push((key, value));
            }
        }
    }
    items
}

/// Legacy localStorage rows for the page to import once (macOS only; empty elsewhere).
/// Async so the file reads never block the main thread.
#[tauri::command(async)]
pub(crate) fn legacy_local_storage_items() -> Vec<(String, String)> {
    if !cfg!(target_os = "macos") || crate::storage::is_portable_mode() {
        return Vec::new();
    }
    dirs::home_dir()
        .map(|home| read_legacy_local_storage(&home.join("Library/WebKit")))
        .unwrap_or_default()
}

/// Which value (if any) to write into the Stride keychain for a key. Pure.
fn secret_to_copy(stride_value: Option<&str>, legacy_value: Option<&str>) -> Option<String> {
    match (stride_value, legacy_value) {
        (None, Some(v)) if !v.is_empty() => Some(v.to_string()),
        _ => None,
    }
}

/// Copy secrets from legacy keychain services into Stride's, read-only on the
/// legacy side. Never overwrites a secret Stride already has.
pub(crate) fn migrate_legacy_keyring_secrets(app: &tauri::AppHandle, keys: &[&str]) {
    if crate::storage::is_portable_mode() {
        return;
    }
    #[cfg(target_os = "linux")]
    if crate::install::is_flatpak() {
        return;
    }
    let workspace = crate::workspaces::active_workspace_id();
    for key in keys {
        let current = crate::config::get_keyring_secret(app, key).ok().flatten();
        if current.is_some() {
            continue;
        }
        for identifier in LEGACY_KEYRING_IDENTIFIERS {
            let service = crate::config::keyring_service_name(identifier, workspace);
            let legacy = keyring::Entry::new(&service, key)
                .ok()
                .and_then(|entry| entry.get_password().ok());
            if let Some(value) = secret_to_copy(None, legacy.as_deref()) {
                match crate::config::set_keyring_secret(app, key, Some(value)) {
                    Ok(()) => log::info!("Copied secret {key} from a previous installation"),
                    Err(error) => log::warn!("Failed to copy legacy secret {key}: {error}"),
                }
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn copies_legacy_profile_and_renames_db() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        write(&base.join("mindwtr/data/data.json"), "{\"tasks\":[1]}");
        write(&base.join("mindwtr/data/mindwtr.db"), "db");
        write(&base.join("mindwtr/data/mindwtr.db-wal"), "wal");
        write(&base.join("mindwtr/config/config.toml"), "x=1");
        let n = import_legacy_data(base, base).unwrap();
        assert_eq!(n, 4);
        assert_eq!(fs::read_to_string(base.join("stride/data/stride.db")).unwrap(), "db");
        assert!(base.join("stride/data/stride.db-wal").exists());
        assert!(base.join("stride/config/config.toml").exists());
        // legacy untouched
        assert!(base.join("mindwtr/data/mindwtr.db").exists());
        // second run is a no-op
        assert_eq!(import_legacy_data(base, base).unwrap(), 0);
    }

    #[test]
    fn never_overwrites_existing_stride_data() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        write(&base.join("mindwtr/data/data.json"), "old");
        write(&base.join("stride/data/data.json"), "new");
        assert_eq!(import_legacy_data(base, base).unwrap(), 0);
        assert_eq!(fs::read_to_string(base.join("stride/data/data.json")).unwrap(), "new");
        assert!(!base.join("stride/.legacy-import-done").exists());
    }

    #[test]
    fn no_legacy_means_no_stride_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(import_legacy_data(tmp.path(), tmp.path()).unwrap(), 0);
        assert!(!tmp.path().join("stride").exists());
    }

    #[test]
    fn marker_blocks_reimport() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        write(&base.join("mindwtr/data.json"), "old");
        write(&base.join("stride/.legacy-import-done"), "");
        assert_eq!(import_legacy_data(base, base).unwrap(), 0);
    }

    #[test]
    fn prefers_first_legacy_name_and_handles_split_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let (cfg, data) = (tmp.path().join("cfg"), tmp.path().join("data"));
        write(&cfg.join("tech.dongdongbh.mindwtr/config.toml"), "c");
        write(&data.join("tech.dongdongbh.mindwtr/data.json"), "d");
        write(&data.join("tech.dongdongbh.mindwtr/mindwtr.db"), "db");
        import_legacy_data(&cfg, &data).unwrap();
        assert!(cfg.join("stride/config.toml").exists());
        assert!(data.join("stride/data.json").exists());
        assert!(data.join("stride/stride.db").exists());
    }

    #[test]
    fn pick_source_decisions() {
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("a/data.json"), "x");
        let c = vec![tmp.path().join("missing"), tmp.path().join("a")];
        assert_eq!(pick_legacy_source(false, false, &c), Some(tmp.path().join("a")));
        assert_eq!(pick_legacy_source(true, false, &c), None);
        assert_eq!(pick_legacy_source(false, true, &c), None);
    }

    #[test]
    fn reads_legacy_local_storage_rows_without_touching_them() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        let dir = base.join("mindwtr/WebsiteData/Default/h/h/LocalStorage");
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("localstorage.sqlite3");
        {
            let conn = rusqlite::Connection::open(&db).unwrap();
            conn.execute_batch("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL);").unwrap();
            let utf16 = |s: &str| s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect::<Vec<u8>>();
            conn.execute("INSERT INTO ItemTable VALUES (?1, ?2)", rusqlite::params!["mindwtr-theme", utf16("dark")]).unwrap();
            conn.execute("INSERT INTO ItemTable VALUES (?1, ?2)", rusqlite::params!["mindwtr:view", utf16("{\"a\":\"é\"}")]).unwrap();
        }
        let before = fs::read(&db).unwrap();
        let mut items = read_legacy_local_storage(base);
        items.sort();
        assert_eq!(items, vec![
            ("mindwtr-theme".to_string(), "dark".to_string()),
            ("mindwtr:view".to_string(), "{\"a\":\"é\"}".to_string()),
        ]);
        assert_eq!(fs::read(&db).unwrap(), before);
        assert!(read_legacy_local_storage(&base.join("nothing")).is_empty());
    }

    #[test]
    fn utf16_decoding() {
        assert_eq!(decode_utf16le(&[0x64, 0, 0x61, 0]), Some("da".to_string()));
        assert_eq!(decode_utf16le(&[0x64]), None);
    }

    #[test]
    fn secret_copy_decisions() {
        assert_eq!(secret_to_copy(None, Some("k")), Some("k".into()));
        assert_eq!(secret_to_copy(Some("have"), Some("k")), None);
        assert_eq!(secret_to_copy(None, None), None);
        assert_eq!(secret_to_copy(None, Some("")), None);
    }
}
