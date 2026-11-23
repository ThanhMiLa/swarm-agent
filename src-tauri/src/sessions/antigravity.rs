use super::{clean_title, is_uuid, SessionEntry};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

pub(super) fn summary_databases(home: &Path) -> [PathBuf; 2] {
    ["antigravity-cli", "antigravity"].map(|root| {
        home.join(".gemini")
            .join(root)
            .join("conversation_summaries.db")
    })
}

pub(super) fn conversation_title(db: &Path, id: &str) -> Option<String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.busy_timeout(std::time::Duration::ZERO).ok()?;
    let title: String = conn
        .query_row(
            "SELECT title FROM conversation_summaries
             WHERE conversation_id = ?1 AND parent_conversation_id = ''",
            [id],
            |row| row.get(0),
        )
        .ok()?;
    clean_title(&title)
}

pub fn scan(db: &Path, folder: &Path) -> Vec<SessionEntry> {
    let Ok(conn) = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id, title, workspace_uris,
                CAST(strftime('%s', last_modified_time) AS INTEGER)
         FROM conversation_summaries
         WHERE parent_conversation_id = ''
         ORDER BY last_modified_time DESC",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<i64>>(3)?,
        ))
    }) else {
        return Vec::new();
    };
    let canonical = folder.canonicalize().ok();
    rows.filter_map(Result::ok)
        .filter_map(|(id, title, uris, timestamp)| {
            if !is_uuid(&id) {
                return None;
            }
            let uris: Vec<String> = serde_json::from_str(&uris).ok()?;
            let cwd = uris.iter().find_map(|uri| {
                let path = url::Url::parse(uri).ok()?.to_file_path().ok()?;
                (path == folder || canonical.as_ref().is_some_and(|dir| dir == &path))
                    .then_some(path)
            })?;
            Some(SessionEntry {
                title: clean_title(&title)
                    .unwrap_or_else(|| format!("Antigravity session {}", &id[..8])),
                session_id: id,
                agent_id: "antigravity".into(),
                cwd: cwd.to_string_lossy().into_owned(),
                updated_at_ms: timestamp.unwrap_or_default().max(0).saturating_mul(1000) as u64,
            })
        })
        .take(100)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_root_conversations_in_the_requested_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("summaries.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT,
                 workspace_uris TEXT, last_modified_time TEXT, parent_conversation_id TEXT);
             INSERT INTO conversation_summaries VALUES
               ('018f3b2a-7c1d-4e0a-9b2f-1a2b3c4d5e6f', 'Payment', '[\"file:///repo\"]', '2026-07-20 12:22:00', ''),
               ('018f3b2b-7c1d-4e0a-9b2f-1a2b3c4d5e6f', 'Other', '[\"file:///other\"]', '2026-07-20 12:22:00', ''),
               ('018f3b2c-7c1d-4e0a-9b2f-1a2b3c4d5e6f', 'Child', '[\"file:///repo\"]', '2026-07-20 12:22:00', 'parent');",
        )
        .unwrap();
        // On Windows file URIs use a drive letter.
        #[cfg(windows)]
        let folder = {
            db.execute("UPDATE conversation_summaries SET workspace_uris = REPLACE(workspace_uris, 'file:///', 'file:///C:/')", []).unwrap();
            Path::new("C:\\repo")
        };
        #[cfg(not(windows))]
        let folder = Path::new("/repo");
        let entries = scan(&path, folder);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Payment");
        assert!(entries[0].updated_at_ms > 0);
        assert_eq!(
            conversation_title(&path, "018f3b2b-7c1d-4e0a-9b2f-1a2b3c4d5e6f").as_deref(),
            Some("Other")
        );
        assert!(conversation_title(&path, "018f3b2c-7c1d-4e0a-9b2f-1a2b3c4d5e6f").is_none());
        assert!(conversation_title(&path, "018f3b2d-7c1d-4e0a-9b2f-1a2b3c4d5e6f").is_none());
        db.execute(
            "UPDATE conversation_summaries SET title = ' Đổi tên phiên '
             WHERE conversation_id = ?1",
            ["018f3b2b-7c1d-4e0a-9b2f-1a2b3c4d5e6f"],
        )
        .unwrap();
        assert_eq!(
            conversation_title(&path, "018f3b2b-7c1d-4e0a-9b2f-1a2b3c4d5e6f").as_deref(),
            Some("Đổi tên phiên")
        );
    }
}
