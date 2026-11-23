//! Pane-scoped conversation metadata only. Never correlate by newest session,
//! since two panes (and external CLIs) can share the same working directory.
use crate::pty::{AppState, PtyOut};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub agent_id: String,
    pub session_id: String,
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

fn valid_id(agent: &str, id: &str) -> bool {
    match agent {
        "claude-code" | "codex" | "antigravity" => super::is_uuid(id),
        "opencode" => id.strip_prefix("ses_").is_some_and(|tail| {
            (10..=40).contains(&tail.len()) && tail.bytes().all(|b| b.is_ascii_alphanumeric())
        }),
        _ => false,
    }
}

pub fn publish(
    state: &AppState,
    session: &crate::agent_team::Session,
    mut conversation: Conversation,
) -> bool {
    if !valid_id(&conversation.agent_id, &conversation.session_id) {
        return false;
    }
    conversation.cwd = conversation.cwd.filter(|cwd| {
        cwd.len() <= 4096 && !cwd.contains('\0') && std::path::Path::new(cwd).is_absolute()
    });
    let channel = state
        .terminals
        .lock()
        .unwrap()
        .get(&session.terminal_id)
        .filter(|pty| pty.flow.flow_id() == session.generation)
        .filter(|pty| pty.agent_id.as_deref() == Some(conversation.agent_id.as_str()))
        .and_then(|pty| pty.on_data.clone());
    channel.is_some_and(|ch| ch.send(PtyOut::Conversation(conversation)).is_ok())
}

pub fn from_hook(agent: &str, raw: &str) -> Option<Conversation> {
    #[derive(Deserialize)]
    struct Input {
        hook_event_name: String,
        session_id: String,
        cwd: Option<String>,
        agent_id: Option<String>,
    }
    let input: Input = serde_json::from_str(raw).ok()?;
    if input.agent_id.is_some_and(|id| !id.is_empty())
        || !matches!(
            input.hook_event_name.as_str(),
            "SessionStart" | "UserPromptSubmit"
        )
        || !valid_id(agent, &input.session_id)
    {
        return None;
    }
    Some(Conversation {
        agent_id: agent.into(),
        session_id: input.session_id,
        cwd: input.cwd,
        title: None,
    })
}

pub fn register_codex(home: &Path) -> Result<(), String> {
    let root = std::env::var_os("CODEX_HOME")
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    let file = root.join("hooks.json");
    let existing = match std::fs::read_to_string(&file) {
        Ok(raw) => Some(raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    // Keep the definition stable across dev/installed binaries, and do
    // nothing when the CLI is running outside a SwarmAgent pane.
    let command =
        r#"if [ -n "${SWARM_AGENT_BIN:-}" ]; then "$SWARM_AGENT_BIN" --codex-session-hook; fi"#;
    let new = merge_codex_hooks(existing.as_deref(), command)?;
    if let Some(new) = new {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let temp = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temp, new).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, file).map_err(|e| {
            let _ = std::fs::remove_file(temp);
            e.to_string()
        })?;
    }
    Ok(())
}

fn merge_codex_hooks(existing: Option<&str>, command: &str) -> Result<Option<String>, String> {
    let before: Value = match existing {
        Some(raw) => serde_json::from_str(raw).map_err(|e| e.to_string())?,
        None => json!({}),
    };
    let mut updated = before.clone();
    let root = updated
        .as_object_mut()
        .ok_or("Codex hooks config must be an object")?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("Codex hooks must be an object")?;
    for name in ["SessionStart", "UserPromptSubmit"] {
        let groups = hooks
            .entry(name)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or("Codex hook groups must be an array")?;
        let group = json!({ "hooks": [{
            "type": "command", "command": command, "timeout": 3,
            "commandWindows": "if ($env:SWARM_AGENT_BIN) { & $env:SWARM_AGENT_BIN --codex-session-hook }"
        }] });
        if !groups.contains(&group) {
            groups.push(group);
        }
    }
    if before == updated {
        return Ok(None);
    }
    crate::json_style::JsonStyle::detect(existing)
        .render(&updated)
        .map(Some)
}

/// Register a TUI-only OpenCode plugin for this process; do not edit the user's
/// cli.json. Unlike server events, the composer slot identifies this TUI's
/// current session even when several clients share one OpenCode database.
pub fn configure_opencode(
    app: &tauri::AppHandle,
    command: &mut portable_pty::CommandBuilder,
) -> Result<(), String> {
    let mut config: Value = match std::env::var("OPENCODE_CLI_CONFIG_CONTENT") {
        Ok(raw) => serde_json::from_str(&raw).map_err(|error| error.to_string())?,
        Err(std::env::VarError::NotPresent) => json!({}),
        Err(error) => return Err(error.to_string()),
    };
    let plugins = config
        .as_object_mut()
        .ok_or("Expected an OpenCode CLI config object")?
        .entry("plugins")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or("Expected an OpenCode CLI plugins list")?;
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("opencode-session-plugin-v1");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let source = include_str!("opencode-session-plugin.js");
    let plugin = path.join("tui.js");
    // Inserting or replacing the plugin must be atomic when multiple panes
    // start in parallel.
    if std::fs::read_to_string(&plugin).ok().as_deref() != Some(source) {
        let temp = path.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temp, source).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, plugin).map_err(|e| {
            let _ = std::fs::remove_file(temp);
            e.to_string()
        })?;
    }
    let entry = json!(path.to_string_lossy());
    if !plugins.contains(&entry) {
        plugins.push(entry);
    }
    command.env("OPENCODE_CLI_CONFIG_CONTENT", config.to_string());
    Ok(())
}

pub fn antigravity_command<'a>(command: &'a str, shell: &str) -> std::borrow::Cow<'a, str> {
    let Some(args) = command.strip_prefix("agy ") else {
        return command.into();
    };
    let path = match shell {
        "cmd" => "\"%SWARM_AGENT_AGY_LOG%\"",
        "powershell" | "pwsh" => "\"$env:SWARM_AGENT_AGY_LOG\"",
        _ => "\"$SWARM_AGENT_AGY_LOG\"",
    };
    format!("agy --log-file {path} {args}").into()
}

pub fn antigravity_log_directory() -> std::io::Result<tempfile::TempDir> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("swarm-agent-agy-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    builder.tempdir()
}

fn antigravity_root(line: &str) -> Option<&str> {
    // This is Antigravity's local TUI metadata line, not chat text or a
    // timestamp comparison against its shared conversation store.
    if let Some((_, rest)) = line.split_once("Recorded user message sender window \"") {
        let id = rest
            .split_once("\" for root_conversation_id=\"")?
            .1
            .split('"')
            .next()?;
        return valid_id("antigravity", id).then_some(id);
    }
    // Current Antigravity CLI releases log active conversation switches and
    // user message dispatches via glog lines in `--log-file` rather than the
    // older sender-window line.
    for marker in [
        "] Streaming conversation ",
        "] Forwarding user message to conversation ",
        "] Sending user message to conversation ",
    ] {
        if let Some((_, rest)) = line.split_once(marker) {
            let id = rest.split_whitespace().next()?;
            return valid_id("antigravity", id).then_some(id);
        }
    }
    None
}

pub fn watch_antigravity(
    app: tauri::AppHandle,
    session: crate::agent_team::Session,
    file_path: PathBuf,
    cwd: String,
) {
    tauri::async_runtime::spawn(async move {
        let databases = super::home_dir().map(|home| super::antigravity::summary_databases(&home));
        let mut position = 0;
        let mut active: Option<Conversation> = None;
        let mut next_title_check = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let state = app.state::<AppState>();
            if state.pane_session(&session.terminal_id).as_ref() != Some(&session) {
                break;
            }
            if let Some(id) = read_antigravity_log(&file_path, &mut position).filter(|id| {
                active
                    .as_ref()
                    .is_none_or(|current| current.session_id != *id)
            }) {
                let conversation = Conversation {
                    agent_id: "antigravity".into(),
                    session_id: id,
                    cwd: Some(cwd.clone()),
                    title: None,
                };
                publish(&state, &session, conversation.clone());
                active = Some(conversation);
                next_title_check = Instant::now();
            }
            let (Some(conversation), Some(databases)) = (&mut active, &databases) else {
                continue;
            };
            if Instant::now() >= next_title_check {
                next_title_check = Instant::now() + Duration::from_secs(2);
                let title = databases.iter().find_map(|db| {
                    super::antigravity::conversation_title(db, &conversation.session_id)
                });
                // The summary can arrive after the log or be briefly locked.
                if title.is_some() && conversation.title != title {
                    conversation.title = title;
                    publish(&state, &session, conversation.clone());
                }
            }
        }
    });
}

fn read_antigravity_log(path: &Path, position: &mut u64) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if len < *position {
        *position = 0;
    }
    if len == *position {
        return None;
    }
    // Bound the work for large debug logs, and leave any incomplete trailing
    // line for the next poll.
    let start = (*position).max(len.saturating_sub(256 * 1024));
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut reader = std::io::BufReader::new(file.take(len - start));
    *position = start;
    let mut line = Vec::new();
    let mut latest = None;
    while let Ok(read) = reader.read_until(b'\n', &mut line) {
        if read == 0 || !line.ends_with(b"\n") {
            break;
        }
        *position += read as u64;
        if let Some(id) = std::str::from_utf8(&line).ok().and_then(antigravity_root) {
            latest = Some(id.to_owned());
        }
        line.clear();
    }
    latest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_supply_only_main_conversation_metadata() {
        let raw = r#"{"hook_event_name":"SessionStart","session_id":"018f3b2a-7c1d-4e0a-9b2f-1a2b3c4d5e6f","cwd":"/repo","prompt":"do not persist"}"#;
        let event = from_hook("codex", raw).unwrap();
        assert_eq!(event.cwd.as_deref(), Some("/repo"));
        assert!(!serde_json::to_string(&event).unwrap().contains("prompt"));
        assert!(from_hook("codex", &raw.replace("SessionStart", "SubagentStart")).is_none());
        assert!(from_hook("codex", &raw.replace("018f3b2a", "&& run")).is_none());
    }

    #[test]
    fn antigravity_log_tracks_only_root_sender_metadata() {
        let id = "018f3b2a-7c1d-4e0a-9b2f-1a2b3c4d5e6f";
        let line = format!(
            "INFO Recorded user message sender window \"window\" for root_conversation_id=\"{id}\""
        );
        assert_eq!(antigravity_root(&line), Some(id));
        assert!(antigravity_root(&format!("INFO root_conversation_id=\"{id}\"")).is_none());
        assert!(antigravity_root(&line.replace(id, "invalid")).is_none());

        for log_line in [
            format!("I1123 13:36:25.782129    1337 conversation_manager.go:1269] Streaming conversation {id}"),
            format!("I1123 13:36:34.463069    2122 conversation_manager.go:1067] Forwarding user message to conversation {id} (items=1, media=0)"),
            format!("I1123 13:36:34.463134    2122 server.go:1883] Sending user message to conversation {id} (items=1, media=0)"),
        ] {
            assert_eq!(antigravity_root(&log_line), Some(id), "{log_line}");
        }
        assert!(antigravity_root(&format!(
            "W1123 04:04:48.236754 154 extract_searchable_content.go:253] conversationsearch: oversized step: conversation={id} step=183"
        )).is_none());
    }

    #[test]
    fn antigravity_log_reads_the_latest_complete_conversation() {
        use std::io::Write;

        let mut file = tempfile::NamedTempFile::new().unwrap();
        let first = "018f3b2a-7c1d-4e0a-9b2f-1a2b3c4d5e6f";
        let second = "018f3b2b-7c1d-4e0a-9b2f-1a2b3c4d5e6f";
        writeln!(file, "I1123 manager.go:1] Streaming conversation {first}").unwrap();
        write!(file, "I1123 manager.go:1] Streaming conversation {second}").unwrap();
        let mut offset = 0;
        assert_eq!(
            read_antigravity_log(file.path(), &mut offset).as_deref(),
            Some(first)
        );
        assert_eq!(read_antigravity_log(file.path(), &mut offset), None);
        writeln!(file).unwrap();
        assert_eq!(
            read_antigravity_log(file.path(), &mut offset).as_deref(),
            Some(second)
        );
    }

    #[test]
    fn codex_hooks_preserve_user_handlers_and_are_idempotent() {
        let existing = r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo existing"}]}]},"description":"user config"}"#;
        let merged = merge_codex_hooks(Some(existing), "swarm-agent --codex-session-hook")
            .unwrap()
            .unwrap();
        assert!(merged.contains("echo existing"));
        assert!(merged.contains("user config"));
        assert_eq!(
            merge_codex_hooks(Some(&merged), "swarm-agent --codex-session-hook").unwrap(),
            None
        );
    }
}
