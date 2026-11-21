//! Pane-scoped conversation metadata only. Never correlate by newest session,
//! since two panes (and external CLIs) can share the same working directory.
use crate::pty::{AppState, PtyOut};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub agent_id: String,
    pub session_id: String,
    pub cwd: Option<String>,
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
    let (_, rest) = line.split_once("Recorded user message sender window \"")?;
    let id = rest
        .split_once("\" for root_conversation_id=\"")?
        .1
        .split('"')
        .next()?;
    valid_id("antigravity", id).then_some(id)
}

pub fn watch_antigravity(
    app: tauri::AppHandle,
    session: crate::agent_team::Session,
    file_path: std::path::PathBuf,
    cwd: String,
) {
    use std::io::{BufRead, Read, Seek, SeekFrom};
    tauri::async_runtime::spawn(async move {
        let mut position = 0;
        let mut last = String::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let state = app.state::<AppState>();
            if state.pane_session(&session.terminal_id).as_ref() != Some(&session) {
                break;
            }
            let Ok(mut file) = std::fs::File::open(&file_path) else {
                continue;
            };
            let Ok(len) = file.metadata().map(|metadata| metadata.len()) else {
                continue;
            };
            if len < position {
                position = 0;
            }
            if len == position {
                continue;
            }
            // Bound the work for large debug logs, and never emit partial lines.
            let start = position.max(len.saturating_sub(256 * 1024));
            if file.seek(SeekFrom::Start(start)).is_err() {
                continue;
            }
            let mut reader = std::io::BufReader::new(file.take(len - start));
            let mut line = Vec::new();
            let mut cursor = start;
            while let Ok(read) = reader.read_until(b'\n', &mut line) {
                if read == 0 || !line.ends_with(b"\n") {
                    break;
                }
                cursor += read as u64;
                if let Ok(text) = std::str::from_utf8(&line) {
                    if let Some(id) = antigravity_root(text).filter(|id| *id != last) {
                        last = id.to_owned();
                        publish(
                            &state,
                            &session,
                            Conversation {
                                agent_id: "antigravity".into(),
                                session_id: last.clone(),
                                cwd: Some(cwd.clone()),
                            },
                        );
                    }
                }
                line.clear();
            }
            // Leave an incomplete trailing line for the next poll.
            position = cursor;
        }
    });
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
