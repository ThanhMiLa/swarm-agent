use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The MCP entry SwarmAgent writes into `.mcp.json`. Uses `${VAR}` syntax that
/// Claude Code expands from the shell env — the two vars are set on every PTY
/// by `pty::spawn_terminal`.
pub fn swarm_agent_entry() -> Value {
    json!({
        "type": "http",
        "url": "${SWARM_AGENT_MCP_URL}",
        "headers": { "Authorization": "Bearer ${SWARM_AGENT_SESSION}" }
    })
}

/// The MCP entry SwarmAgent writes into qwen's `settings.json`. Qwen Code
/// resolves `$VAR`/`${VAR}` in settings strings from the process environment
/// (packages/core envVarResolver), so — like Claude Code and unlike Codex —
/// a placeholder entry written once serves every pane. HTTP transport uses
/// the `httpUrl` key (qwen's `url` means SSE).
pub fn swarm_agent_qwen_entry() -> Value {
    json!({
        "httpUrl": "${SWARM_AGENT_MCP_URL}",
        "headers": { "Authorization": "Bearer ${SWARM_AGENT_SESSION}" }
    })
}

/// Produce new contents for a JSON config with a `mcpServers` object:
/// * If `existing` is `None` or blank, return a file with only SwarmAgent.
/// * If `existing` parses as JSON with a `mcpServers` object, merge the
///   `swarm-agent` entry KEY BY KEY — SwarmAgent-owned keys are overwritten so
///   the current shape always wins, but keys the user added under `swarm-agent`
///   (qwen's `trust`/`timeout`, say) survive. Other server entries are
///   untouched.
/// * If `existing` is malformed JSON, return `Err` — the caller logs it and
///   leaves the file untouched.
fn merge_mcp_servers_json(existing: Option<&str>, entry: Value) -> Result<String, String> {
    let mut root: Value = match existing.map(str::trim).filter(|s| !s.is_empty()) {
        None => json!({ "mcpServers": {} }),
        Some(s) => serde_json::from_str(s).map_err(|e| format!("parse: {e}"))?,
    };
    if !root.is_object() {
        return Err("root is not a JSON object".into());
    }
    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers".to_string())
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        return Err("mcpServers is not an object".into());
    }
    let servers = servers.as_object_mut().unwrap();
    // Migrate only the previous app-owned entry; keep user-defined servers.
    if legacy_json_server(servers.get("swarmterm")) {
        if let Some(previous) = servers.shift_remove("swarmterm") {
            servers.entry("swarm-agent").or_insert(previous);
        }
    }
    match servers.get_mut("swarm-agent") {
        // Existing object entry: overwrite only the keys we own.
        Some(Value::Object(slot)) => {
            for (k, v) in entry.as_object().expect("entry is an object") {
                slot.insert(k.clone(), v.clone());
            }
        }
        // Absent, or a non-object left by something else: replace wholesale.
        _ => {
            servers.insert("swarm-agent".to_string(), entry);
        }
    }
    // Style is detected on the RAW `existing` text, not the trimmed copy fed
    // to the parser: the trailing-newline verdict lives in exactly the bytes
    // `trim()` would throw away.
    crate::json_style::JsonStyle::detect(existing).render(&root)
}

/// Whether `config` (a parsed root object) already carries every key of
/// `entry` under `mcpServers.swarm-agent` with our exact values. User-added
/// extra keys are fine — the merge preserves them, so they must not force a
/// rewrite on every boot.
fn legacy_json_server(server: Option<&Value>) -> bool {
    server.is_some_and(|server| {
        ["url", "httpUrl"]
            .iter()
            .any(|key| server.get(key).and_then(Value::as_str) == Some("${SWARMTERM_MCP_URL}"))
            && server
                .pointer("/headers/Authorization")
                .and_then(Value::as_str)
                == Some("Bearer ${SWARMTERM_SESSION}")
    })
}

fn entry_is_current(config: &Value, entry: &Value) -> bool {
    if legacy_json_server(config.pointer("/mcpServers/swarmterm")) {
        return false;
    }
    match config.get("mcpServers").and_then(|m| m.get("swarm-agent")) {
        Some(cur) => entry
            .as_object()
            .expect("entry is an object")
            .iter()
            .all(|(k, v)| cur.get(k) == Some(v)),
        None => false,
    }
}

/// Strip `//` line and `/* */` block comments outside strings — the same
/// tolerance qwen's settings loader applies (strip-json-comments). Used for
/// READING only: rewriting a commented file would serialize the comments
/// away, so such a file is never rewritten (see the writer below).
fn strip_json_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' => match chars.peek() {
                Some('/') => {
                    while let Some(&n) = chars.peek() {
                        if n == '\n' {
                            break;
                        }
                        chars.next();
                    }
                }
                Some('*') => {
                    chars.next();
                    let mut prev = '\0';
                    for n in chars.by_ref() {
                        if prev == '*' && n == '/' {
                            break;
                        }
                        prev = n;
                    }
                }
                _ => out.push(c),
            },
            _ => out.push(c),
        }
    }
    out
}

/// Merge-write a `swarm-agent` MCP entry into a JSON config at `path` (read →
/// `merge_mcp_servers_json` → write tmp → rename). The tmp+rename means a
/// crash mid-write can never truncate the target — important for
/// `~/.claude.json` and qwen's `settings.json`, which hold far more than MCP
/// config. A missing file is created; a malformed existing file returns `Err`
/// and is left untouched.
fn write_mcp_servers_json_to_file(
    path: &Path,
    entry: Value,
    tolerate_comments: bool,
) -> Result<(), String> {
    let existing = match fs::read_to_string(path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("read: {e}")),
    };
    // Skip rewriting when the user's config already carries our entry (our
    // keys with our values; user-added extras allowed). This is the user's
    // PRIMARY config for that CLI: even though a rewrite now keeps key order
    // and indent (`json_style`), it would still widen the (already tiny)
    // read-merge-rename race against a concurrently running CLI, and a
    // steady-state write per boot is noise. So we only ever write on the
    // first run (or if the entry drifts).
    if let Some(s) = existing.as_deref() {
        let strict = serde_json::from_str::<Value>(s).ok();
        // Qwen parses settings via strip-json-comments; recognise an entry
        // inside a commented file so we don't log a bogus error every boot.
        let lenient = if strict.is_none() && tolerate_comments {
            serde_json::from_str::<Value>(&strip_json_comments(s)).ok()
        } else {
            None
        };
        if let Some(v) = strict.as_ref().or(lenient.as_ref()) {
            if entry_is_current(v, &entry) {
                return Ok(());
            }
        }
        // A commented file that still needs the entry is left untouched:
        // serde would strip the user's comments on rewrite.
        if strict.is_none() && lenient.is_some() {
            return Err(
                "file contains comments (the CLI tolerates them; rewriting would strip them) — \
                 add the swarm-agent entry manually"
                    .into(),
            );
        }
    }
    let merged = merge_mcp_servers_json(existing.as_deref(), entry)?;
    // `.claude.json` → `.claude.json.tmp` (same for `settings.json`):
    // with_extension replaces the trailing `json` segment, preserving the
    // leading dot-name.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, merged).map_err(|e| format!("write tmp: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        // Best-effort tmp cleanup on rename failure so we don't leave litter.
        let _ = fs::remove_file(&tmp);
        format!("rename: {e}")
    })?;
    Ok(())
}

/// Claude Code variant (`~/.claude.json`). The parent dir is home — never
/// created here (a missing/typo'd CLAUDE_CONFIG_DIR must fail, not be
/// fabricated).
pub fn write_mcp_config_to_file(path: &Path) -> Result<(), String> {
    write_mcp_servers_json_to_file(path, swarm_agent_entry(), false)
}

/// Qwen Code variant (`settings.json` under `$QWEN_HOME` or `~/.qwen`). An
/// installed-but-never-run qwen has no `~/.qwen` yet, so the parent dir is
/// created — the caller has already probed that the CLI exists.
pub fn write_qwen_settings_to_file(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    write_mcp_servers_json_to_file(path, swarm_agent_qwen_entry(), true)
}

/// Register SwarmAgent's MCP server once in Claude Code's user-scope config
/// (`~/.claude.json`) so every terminal SwarmAgent spawns — in any folder or
/// worktree — discovers it without a per-project `.mcp.json`. Idempotent: the
/// entry is placeholder-only, so re-running on an already-registered config
/// writes identical bytes. Log-only: a failure here must never block boot, and
/// leaves SwarmAgent fully usable minus the agent-facing MCP tools.
pub fn register_user_scope(app: &AppHandle) {
    let home = match app.path().home_dir() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("mcp: cannot resolve home dir for global MCP config: {e}");
            return;
        }
    };
    let cfg_dir = std::env::var("CLAUDE_CONFIG_DIR").ok();
    let path = resolve_global_config_path(&home, cfg_dir.as_deref());
    // Note: read-merge-rename is not locked against a concurrently running
    // Claude Code writing ~/.claude.json; the rename is atomic (never corrupts),
    // and the skip-if-present check keeps this to at most a first-run write, so
    // any lost-update window is a single boot-time write, not steady-state.
    if let Err(e) = write_mcp_config_to_file(&path) {
        eprintln!(
            "mcp: failed to register global MCP config at {}: {e}",
            path.display()
        );
    }
}

/// Resolve Claude Code's user-scope config file (`.claude.json`). Honors
/// `CLAUDE_CONFIG_DIR` (Claude Code lets users relocate its config there);
/// a blank value is treated as unset so we never resolve to `/.claude.json`.
pub fn resolve_global_config_path(home: &Path, claude_config_dir: Option<&str>) -> PathBuf {
    match claude_config_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => Path::new(dir).join(".claude.json"),
        None => home.join(".claude.json"),
    }
}

/// `$QWEN_HOME/settings.json` when set (qwen's own relocation mechanism),
/// else `~/.qwen/settings.json`. Blank env treated as unset.
pub fn resolve_qwen_settings_path(home: &Path, qwen_home: Option<&str>) -> PathBuf {
    match qwen_home.map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => Path::new(dir).join("settings.json"),
        None => home.join(".qwen").join("settings.json"),
    }
}

/// Register SwarmAgent's MCP server once in qwen's user-scope settings. The
/// entry is placeholder-only (qwen expands env vars in settings), so this is
/// idempotent and needs no bound URL. Log-only, like `register_user_scope`.
pub fn register_qwen(app: &AppHandle) {
    // Never plant ~/.qwen on machines that don't have the CLI — enrollment is
    // only meaningful (and its dir-creation only justified) when qwen exists.
    if crate::agents::find_agent_binary("qwen").is_none() {
        return;
    }
    let home = match app.path().home_dir() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("mcp: cannot resolve home dir for qwen settings: {e}");
            return;
        }
    };
    let qwen_home = std::env::var("QWEN_HOME").ok();
    let path = resolve_qwen_settings_path(&home, qwen_home.as_deref());
    if let Err(e) = write_qwen_settings_to_file(&path) {
        eprintln!(
            "mcp: failed to register qwen MCP config at {}: {e}",
            path.display()
        );
    }
}

/// Codex CLI does not expand `${VAR}` in `url` (unlike Claude Code), so the
/// concrete endpoint is written on every boot AFTER the port is bound. The
/// bearer still comes from env via `bearer_token_env_var`, so the entry works
/// for every pane without per-pane rewrites. toml_edit (not toml) because
/// config.toml is the user's hand-edited file — formatting and comments must
/// survive the merge.
pub fn merge_codex_config(existing: Option<&str>, url: &str) -> Result<String, String> {
    let mut doc: toml_edit::DocumentMut = existing
        .unwrap_or("")
        .parse()
        .map_err(|e| format!("parse: {e}"))?;
    let servers = doc
        .entry("mcp_servers")
        .or_insert(toml_edit::Item::Table({
            // Implicit so an empty parent never renders a bare [mcp_servers]
            // header above the real [mcp_servers.swarm-agent] one.
            let mut t = toml_edit::Table::new();
            t.set_implicit(true);
            t
        }))
        .as_table_mut()
        .ok_or("mcp_servers is not a table")?;
    if legacy_codex_server(servers.get("swarmterm")) {
        if let Some(previous) = servers.remove("swarmterm") {
            servers.entry("swarm-agent").or_insert(previous);
        }
    }
    let entry = servers
        .entry("swarm-agent")
        .or_insert(toml_edit::Item::Table(toml_edit::Table::new()))
        .as_table_mut()
        .ok_or("swarm-agent MCP config is not a table")?;
    entry.insert("url", toml_edit::value(url));
    entry.insert(
        "bearer_token_env_var",
        toml_edit::value("SWARM_AGENT_SESSION"),
    );
    Ok(doc.to_string())
}

fn legacy_codex_server(server: Option<&toml_edit::Item>) -> bool {
    server.is_some_and(|server| {
        server
            .get("bearer_token_env_var")
            .and_then(toml_edit::Item::as_str)
            == Some("SWARMTERM_SESSION")
            && server
                .get("url")
                .and_then(toml_edit::Item::as_str)
                .is_some_and(|url| url.starts_with("http://127.0.0.1:") && url.ends_with("/mcp"))
    })
}

/// Same skip-if-current + tmp+rename policy as the Claude writer above.
pub fn write_codex_config_to_file(path: &Path, url: &str) -> Result<(), String> {
    let existing = match fs::read_to_string(path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("read: {e}")),
    };
    if let Some(s) = existing.as_deref() {
        if let Ok(doc) = s.parse::<toml_edit::DocumentMut>() {
            let current = doc.get("mcp_servers").and_then(|m| m.get("swarm-agent"));
            let url_ok = current.and_then(|c| c.get("url")).and_then(|v| v.as_str()) == Some(url);
            let bearer_ok = current
                .and_then(|c| c.get("bearer_token_env_var"))
                .and_then(|v| v.as_str())
                == Some("SWARM_AGENT_SESSION");
            let legacy = doc.get("mcp_servers").and_then(|m| m.get("swarmterm"));
            if url_ok && bearer_ok && !legacy_codex_server(legacy) {
                return Ok(());
            }
        }
    }
    let merged = merge_codex_config(existing.as_deref(), url)?;
    let tmp = path.with_extension("toml.tmp");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    fs::write(&tmp, merged).map_err(|e| format!("write tmp: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename: {e}")
    })
}

/// `$CODEX_HOME/config.toml` when set (Codex's own relocation mechanism),
/// else `~/.codex/config.toml`. Blank env treated as unset.
pub fn resolve_codex_config_path(home: &Path, codex_home: Option<&str>) -> PathBuf {
    match codex_home.map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => Path::new(dir).join("config.toml"),
        None => home.join(".codex").join("config.toml"),
    }
}

/// Register the just-bound MCP URL for Codex. Log-only, like register_user_scope.
pub fn register_codex(app: &AppHandle, url: &str) {
    let home = match app.path().home_dir() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("mcp: cannot resolve home dir for codex config: {e}");
            return;
        }
    };
    let codex_home = std::env::var("CODEX_HOME").ok();
    let path = resolve_codex_config_path(&home, codex_home.as_deref());
    if let Err(e) = write_codex_config_to_file(&path, url) {
        eprintln!(
            "mcp: failed to register codex MCP config at {}: {e}",
            path.display()
        );
    }
}

const TEAM_BRIDGE: &str = "swarm_agent_team";

fn bridge_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

pub fn register_antigravity(app: &AppHandle) {
    if crate::agents::find_agent_binary("agy").is_none() {
        return;
    }
    let result = (|| {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        let path = home.join(".gemini").join("config").join("mcp_config.json");
        write_antigravity_config(&path, &bridge_path()?)
    })();
    if let Err(e) = result {
        eprintln!("mcp: unable to configure Antigravity: {e}");
    }
}

fn write_antigravity_config(path: &Path, command: &Path) -> Result<(), String> {
    let existing = match fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    // Antigravity can leave an empty config file when no servers are registered.
    let mut root = match existing
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        Some(text) => serde_json::from_str::<Value>(text).map_err(|e| e.to_string())?,
        None => json!({}),
    };
    let entry = json!({ "command": command, "args": ["--mcp-stdio"] });
    let servers = root
        .as_object_mut()
        .ok_or("Invalid Antigravity config")?
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("Invalid Antigravity MCP servers")?;
    let legacy = "swarmterm_agent_team";
    let migrated = servers.get(legacy).is_some_and(|server| {
        server.get("args") == entry.get("args")
            && server
                .get("command")
                .and_then(Value::as_str)
                .is_some_and(|path| {
                    matches!(
                        path.rsplit(['/', '\\']).next(),
                        Some("swarmterm" | "swarmterm.exe" | "Swarmterm")
                    )
                })
    });
    if migrated {
        if let Some(previous) = servers.shift_remove(legacy) {
            servers.entry(TEAM_BRIDGE).or_insert(previous);
        }
    }
    match servers.get_mut(TEAM_BRIDGE) {
        Some(existing) if existing.get("args") != entry.get("args") => {
            return Err(format!("MCP name {TEAM_BRIDGE} is already in use"));
        }
        Some(existing) if !migrated && existing.get("command") == entry.get("command") => {
            return Ok(())
        }
        Some(existing) => existing["command"] = entry["command"].clone(),
        None => {
            servers.insert(TEAM_BRIDGE.into(), entry);
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let output = crate::json_style::JsonStyle::detect(existing.as_deref()).render(&root)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, output).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

pub fn configure_terminal(command: &mut portable_pty::CommandBuilder, agent: Option<&str>) {
    if agent != Some("opencode") {
        return;
    }
    let result = (|| -> Result<(), String> {
        let mut config = match std::env::var("OPENCODE_CONFIG_CONTENT") {
            Ok(raw) => serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string())?,
            Err(std::env::VarError::NotPresent) => serde_json::json!({}),
            Err(e) => return Err(e.to_string()),
        };
        let bridge = bridge_path()?;
        let root = config
            .as_object_mut()
            .ok_or("Invalid OpenCode config overlay")?;
        let servers = root
            .entry("mcp")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or("Invalid OpenCode MCP servers")?;
        if servers.contains_key(TEAM_BRIDGE) {
            return Err(format!("MCP name {TEAM_BRIDGE} is already in use"));
        }
        servers.insert(
            TEAM_BRIDGE.into(),
            serde_json::json!({
                "type": "local", "command": [bridge, "--mcp-stdio"], "enabled": true
            }),
        );
        command.env("OPENCODE_CONFIG_CONTENT", config.to_string());
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("mcp: unable to configure OpenCode: {error}");
    }
}

/// Keep each CLI's MCP process in its own environment even on versions
/// that otherwise share an app-server across terminal panes.
pub fn private_agent_command<'a>(
    agent: Option<&str>,
    command: &'a str,
) -> std::borrow::Cow<'a, str> {
    use std::{borrow::Cow, sync::OnceLock};
    static CODEX: OnceLock<bool> = OnceLock::new();
    static OPENCODE: OnceLock<bool> = OnceLock::new();
    let (name, flag, supported) = match agent {
        Some("codex") => ("codex", "--no-daemon", &CODEX),
        Some("opencode") => ("opencode", "--standalone", &OPENCODE),
        _ => return Cow::Borrowed(command),
    };
    let Some(rest) = command.strip_prefix(name) else {
        return Cow::Borrowed(command);
    };
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return Cow::Borrowed(command);
    }
    if rest.split_whitespace().any(|arg| arg == flag) {
        return Cow::Borrowed(command);
    }
    if *supported.get_or_init(|| supports_flag(name, flag)) {
        Cow::Owned(format!("{name} {flag}{rest}"))
    } else {
        Cow::Borrowed(command)
    }
}

fn supports_flag(name: &str, flag: &str) -> bool {
    let Some(executable) = crate::agents::find_agent_binary(name) else {
        return false;
    };
    let mut command = std::process::Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.arg("--help").output().is_ok_and(|output| {
        output.status.success()
            && String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .any(|word| word == flag)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_replaces_only_app_managed_mcp_entries() {
        let old = r#"{"mcpServers":{"swarmterm":{"url":"${SWARMTERM_MCP_URL}","headers":{"Authorization":"Bearer ${SWARMTERM_SESSION}"},"trust":true},"custom":{"command":"custom"}}}"#;
        let merged = parse(&merge_mcp_servers_json(Some(old), swarm_agent_entry()).unwrap());
        assert!(merged["mcpServers"].get("swarmterm").is_none());
        assert_eq!(merged["mcpServers"]["swarm-agent"]["trust"], true);
        assert_eq!(merged["mcpServers"]["custom"]["command"], "custom");

        let old = "[mcp_servers.swarmterm]\nurl = \"http://127.0.0.1:4567/mcp\"\nbearer_token_env_var = \"SWARMTERM_SESSION\"\nstartup_timeout_sec = 12\n";
        let merged = merge_codex_config(Some(old), "http://127.0.0.1:9876/mcp").unwrap();
        assert!(!merged.contains("[mcp_servers.swarmterm]"));
        assert!(merged.contains("[mcp_servers.swarm-agent]"));
        assert!(merged.contains("startup_timeout_sec = 12"));
    }

    #[test]
    fn antigravity_registers_bridge_in_existing_empty_config() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("mcp_config.json");
        let exe = temp.path().join("swarm-agent");
        fs::write(&path, "").unwrap();
        write_antigravity_config(&path, &exe).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(
            parse(&content)["mcpServers"][TEAM_BRIDGE],
            json!({ "command": exe, "args": ["--mcp-stdio"] })
        );
        write_antigravity_config(&path, &exe).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }

    #[test]
    fn antigravity_keeps_existing_servers_and_leaves_invalid_config_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("mcp_config.json");
        let original = json!({ "mcpServers": { "existing": { "command": "other-mcp" } } });
        fs::write(&path, original.to_string()).unwrap();
        write_antigravity_config(&path, Path::new("swarm-agent")).unwrap();
        let updated = parse(&fs::read_to_string(&path).unwrap());
        assert_eq!(
            updated["mcpServers"]["existing"],
            original["mcpServers"]["existing"]
        );

        fs::write(&path, "{broken").unwrap();
        assert!(write_antigravity_config(&path, Path::new("swarm-agent")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
    }

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn merge_claude(existing: Option<&str>) -> Result<String, String> {
        merge_mcp_servers_json(existing, swarm_agent_entry())
    }

    fn merge_qwen(existing: Option<&str>) -> Result<String, String> {
        merge_mcp_servers_json(existing, swarm_agent_qwen_entry())
    }

    #[test]
    fn merge_preserves_user_added_keys_under_swarm_agent() {
        // qwen users add e.g. "trust": true under our entry to silence
        // per-tool confirmations — a boot must never clobber that.
        let existing = r#"{"mcpServers":{"swarm-agent":{"httpUrl":"stale","trust":true}}}"#;
        let out = merge_qwen(Some(existing)).unwrap();
        let v = parse(&out);
        assert_eq!(v["mcpServers"]["swarm-agent"]["trust"], true);
        assert_eq!(
            v["mcpServers"]["swarm-agent"]["httpUrl"],
            "${SWARM_AGENT_MCP_URL}"
        );
    }

    #[test]
    fn write_skips_when_current_even_with_user_extras() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let content = r#"{"mcpServers":{"swarm-agent":{"httpUrl":"${SWARM_AGENT_MCP_URL}","headers":{"Authorization":"Bearer ${SWARM_AGENT_SESSION}"},"trust":true}}}"#;
        std::fs::write(&path, content).unwrap();
        write_qwen_settings_to_file(&path).unwrap();
        // Byte-identical: our keys were current, so the user extras never
        // forced a reformat.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }

    #[test]
    fn qwen_commented_file_with_current_entry_is_recognized() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let content = "// my settings\n{\"mcpServers\":{\"swarm-agent\":{\"httpUrl\":\"${SWARM_AGENT_MCP_URL}\",\"headers\":{\"Authorization\":\"Bearer ${SWARM_AGENT_SESSION}\"}}}}";
        std::fs::write(&path, content).unwrap();
        write_qwen_settings_to_file(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }

    #[test]
    fn qwen_commented_file_without_entry_errs_and_is_untouched() {
        // Rewriting would strip the user's comments — refuse instead.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let content = "{\n  // trusted folders\n  \"ui\": {}\n}";
        std::fs::write(&path, content).unwrap();
        assert!(write_qwen_settings_to_file(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }

    #[test]
    fn strip_json_comments_leaves_strings_alone() {
        let s = r#"{"a":"http://x/*not a comment*/","b":1}// tail"#;
        let stripped = strip_json_comments(s);
        let v: Value = serde_json::from_str(&stripped).unwrap();
        assert_eq!(v["a"], "http://x/*not a comment*/");
        assert_eq!(v["b"], 1);
    }

    #[test]
    fn creates_from_nothing() {
        let out = merge_claude(None).unwrap();
        let v = parse(&out);
        assert_eq!(v["mcpServers"]["swarm-agent"]["type"], "http");
        assert_eq!(
            v["mcpServers"]["swarm-agent"]["url"],
            "${SWARM_AGENT_MCP_URL}"
        );
    }

    #[test]
    fn creates_from_empty_string() {
        let out = merge_claude(Some("   ")).unwrap();
        assert_eq!(parse(&out)["mcpServers"]["swarm-agent"]["type"], "http");
    }

    #[test]
    fn preserves_other_servers() {
        let existing = r#"{"mcpServers": {"other": {"type": "stdio", "command": "x"}}}"#;
        let out = merge_claude(Some(existing)).unwrap();
        let v = parse(&out);
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(v["mcpServers"]["swarm-agent"]["type"], "http");
    }

    #[test]
    fn replaces_existing_swarm_agent_block() {
        // If the user (or an old SwarmAgent build) already had a swarm-agent entry
        // with stale headers, overwrite it so the current shape wins.
        let existing = r#"{"mcpServers": {"swarm-agent": {"type": "stdio"}}}"#;
        let out = merge_claude(Some(existing)).unwrap();
        assert_eq!(parse(&out)["mcpServers"]["swarm-agent"]["type"], "http");
    }

    #[test]
    fn preserves_unrelated_top_level_keys() {
        let existing = r#"{"projects": {"foo": 1}, "mcpServers": {}}"#;
        let out = merge_claude(Some(existing)).unwrap();
        let v = parse(&out);
        assert_eq!(v["projects"]["foo"], 1);
        assert_eq!(v["mcpServers"]["swarm-agent"]["type"], "http");
    }

    /// Byte offset of `"key"` in the rendered text — order is a TEXT property,
    /// `Value` equality is order-free.
    fn pos(text: &str, key: &str) -> usize {
        text.find(&format!("\"{key}\""))
            .unwrap_or_else(|| panic!("{key} missing in {text}"))
    }

    #[test]
    fn merge_keeps_user_key_order_and_appends_mcp_servers_last() {
        let out = merge_claude(Some(r#"{"z":1,"a":2}"#)).unwrap();
        assert!(pos(&out, "z") < pos(&out, "a"), "{out}");
        assert!(pos(&out, "a") < pos(&out, "mcpServers"), "{out}");
    }

    #[test]
    fn merge_keeps_four_space_indent_and_trailing_newline() {
        let out = merge_claude(Some("{\n    \"z\": 1\n}\n")).unwrap();
        assert!(out.starts_with("{\n    \"z\": 1,\n    \"mcpServers\": {\n        \"swarm-agent\": {\n            \"type\": \"http\""), "{out}");
        assert!(out.ends_with("}\n") && !out.ends_with("\n\n"), "{out}");
    }

    #[test]
    fn merge_keeps_tab_indent_and_no_trailing_newline() {
        let out = merge_claude(Some("{\n\t\"z\": 1\n}")).unwrap();
        assert!(
            out.contains("\n\t\"mcpServers\": {\n\t\t\"swarm-agent\": {\n\t\t\t\"type\""),
            "{out}"
        );
        assert!(out.ends_with('}'), "{out}");
    }

    #[test]
    fn merge_of_compact_or_new_file_is_byte_identical_to_pretty() {
        let compact = merge_claude(Some(r#"{"z":1}"#)).unwrap();
        assert!(
            compact.starts_with("{\n  \"z\": 1,\n  \"mcpServers\""),
            "{compact}"
        );
        assert!(compact.ends_with('}'), "{compact}");
        let fresh = merge_claude(None).unwrap();
        assert_eq!(fresh, serde_json::to_string_pretty(&parse(&fresh)).unwrap());
    }

    #[test]
    fn errors_on_malformed_json() {
        assert!(merge_claude(Some("{not json")).is_err());
    }

    #[test]
    fn errors_when_root_not_object() {
        assert!(merge_claude(Some("[1,2,3]")).is_err());
    }

    #[test]
    fn errors_when_mcp_servers_not_object() {
        assert!(merge_claude(Some(r#"{"mcpServers":"nope"}"#)).is_err());
    }

    #[test]
    fn global_path_defaults_to_home() {
        let p = resolve_global_config_path(Path::new("/home/duong"), None);
        assert_eq!(p, Path::new("/home/duong/.claude.json"));
    }

    #[test]
    fn global_path_honors_claude_config_dir() {
        let p = resolve_global_config_path(Path::new("/home/duong"), Some("/custom/cfg"));
        assert_eq!(p, Path::new("/custom/cfg/.claude.json"));
    }

    #[test]
    fn global_path_ignores_blank_config_dir() {
        // Blank/whitespace CLAUDE_CONFIG_DIR must fall back to home, not
        // resolve to "/.claude.json".
        let p = resolve_global_config_path(Path::new("/home/duong"), Some("   "));
        assert_eq!(p, Path::new("/home/duong/.claude.json"));
    }

    #[test]
    fn to_file_creates_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        write_mcp_config_to_file(&path).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains("\"swarm-agent\""));
        assert!(contents.contains("${SWARM_AGENT_MCP_URL}"));
    }

    #[test]
    fn to_file_merges_and_preserves_other_config() {
        // Simulate a realistic ~/.claude.json: a top-level key plus an
        // unrelated MCP server that must survive the merge.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{"numStartups":42,"mcpServers":{"1devtool":{"command":"x"}}}"#,
        )
        .unwrap();
        write_mcp_config_to_file(&path).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["numStartups"], 42);
        assert_eq!(v["mcpServers"]["1devtool"]["command"], "x");
        assert_eq!(v["mcpServers"]["swarm-agent"]["type"], "http");
    }

    #[test]
    fn to_file_leaves_malformed_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        std::fs::write(&path, "{not json").unwrap();
        assert!(write_mcp_config_to_file(&path).is_err());
        // Original bytes preserved — the tmp+rename never clobbered them.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{not json");
    }

    #[test]
    fn to_file_is_idempotent() {
        // Writing twice must leave byte-identical content: the second call sees
        // the swarm-agent entry already present and must not rewrite (no reformat).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        write_mcp_config_to_file(&path).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        write_mcp_config_to_file(&path).unwrap();
        let second = std::fs::read_to_string(&path).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn to_file_skips_rewrite_when_entry_already_present() {
        // A file that already contains the exact swarm-agent entry but in a
        // different (compact) formatting must be left byte-for-byte untouched —
        // we must not reformat/reorder the user's ~/.claude.json on repeat boots.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        let compact = r#"{"numStartups":7,"mcpServers":{"swarm-agent":{"type":"http","url":"${SWARM_AGENT_MCP_URL}","headers":{"Authorization":"Bearer ${SWARM_AGENT_SESSION}"}}}}"#;
        std::fs::write(&path, compact).unwrap();
        write_mcp_config_to_file(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), compact);
    }

    #[test]
    fn qwen_creates_from_nothing_with_http_url_placeholder() {
        let out = merge_qwen(None).unwrap();
        let v = parse(&out);
        assert_eq!(
            v["mcpServers"]["swarm-agent"]["httpUrl"],
            "${SWARM_AGENT_MCP_URL}"
        );
        assert_eq!(
            v["mcpServers"]["swarm-agent"]["headers"]["Authorization"],
            "Bearer ${SWARM_AGENT_SESSION}"
        );
    }

    #[test]
    fn qwen_preserves_settings_sections_and_other_servers() {
        let existing =
            r#"{"ui":{"autoModeAcknowledged":true},"mcpServers":{"other":{"command":"x"}}}"#;
        let out = merge_qwen(Some(existing)).unwrap();
        let v = parse(&out);
        assert_eq!(v["ui"]["autoModeAcknowledged"], true);
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(
            v["mcpServers"]["swarm-agent"]["httpUrl"],
            "${SWARM_AGENT_MCP_URL}"
        );
    }

    #[test]
    fn qwen_errors_on_malformed_json() {
        assert!(merge_qwen(Some("{not json")).is_err());
    }

    #[test]
    fn qwen_file_write_creates_parent_dir_and_is_idempotent() {
        // Unlike ~/.claude.json, ~/.qwen may not exist yet — the writer
        // creates it (codex-writer precedent).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".qwen").join("settings.json");
        write_qwen_settings_to_file(&path).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        write_qwen_settings_to_file(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
    }

    #[test]
    fn qwen_file_write_leaves_malformed_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{not json").unwrap();
        assert!(write_qwen_settings_to_file(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{not json");
    }

    #[test]
    fn qwen_file_write_replaces_stale_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"mcpServers":{"swarm-agent":{"httpUrl":"http://127.0.0.1:9/mcp"}}}"#,
        )
        .unwrap();
        write_qwen_settings_to_file(&path).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            v["mcpServers"]["swarm-agent"]["httpUrl"],
            "${SWARM_AGENT_MCP_URL}"
        );
    }

    #[test]
    fn qwen_path_honors_qwen_home_and_ignores_blank() {
        let p = resolve_qwen_settings_path(Path::new("/home/duong"), None);
        assert_eq!(p, Path::new("/home/duong/.qwen/settings.json"));
        let p = resolve_qwen_settings_path(Path::new("/home/duong"), Some("/custom"));
        assert_eq!(p, Path::new("/custom/settings.json"));
        let p = resolve_qwen_settings_path(Path::new("/home/duong"), Some("  "));
        assert_eq!(p, Path::new("/home/duong/.qwen/settings.json"));
    }

    const URL: &str = "http://127.0.0.1:4242/mcp";

    #[test]
    fn codex_creates_from_nothing() {
        let out = merge_codex_config(None, URL).unwrap();
        assert!(out.contains("[mcp_servers.swarm-agent]"));
        assert!(out.contains(&format!("url = \"{URL}\"")));
        assert!(out.contains("bearer_token_env_var = \"SWARM_AGENT_SESSION\""));
    }

    #[test]
    fn codex_preserves_other_tables_and_comments() {
        let existing =
            "# my codex settings\nmodel = \"o4\"\n\n[mcp_servers.other]\ncommand = \"x\"\n";
        let out = merge_codex_config(Some(existing), URL).unwrap();
        assert!(out.contains("# my codex settings"));
        assert!(out.contains("model = \"o4\""));
        assert!(out.contains("[mcp_servers.other]"));
        assert!(out.contains("[mcp_servers.swarm-agent]"));
    }

    #[test]
    fn codex_updates_stale_url() {
        let existing = "[mcp_servers.swarm-agent]\nurl = \"http://127.0.0.1:9/mcp\"\nbearer_token_env_var = \"SWARM_AGENT_SESSION\"\n";
        let out = merge_codex_config(Some(existing), URL).unwrap();
        assert!(out.contains(&format!("url = \"{URL}\"")));
        assert!(!out.contains("127.0.0.1:9"));
    }

    #[test]
    fn codex_errors_on_malformed_toml() {
        assert!(merge_codex_config(Some("mcp_servers = ["), URL).is_err());
    }

    #[test]
    fn codex_file_write_skips_when_current() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        write_codex_config_to_file(&path, URL).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        write_codex_config_to_file(&path, URL).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
    }

    #[test]
    fn codex_file_write_leaves_malformed_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "mcp_servers = [").unwrap();
        assert!(write_codex_config_to_file(&path, URL).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "mcp_servers = [");
    }

    #[test]
    fn codex_path_defaults_to_home_dot_codex() {
        let p = resolve_codex_config_path(Path::new("/home/duong"), None);
        assert_eq!(p, Path::new("/home/duong/.codex/config.toml"));
    }

    #[test]
    fn codex_path_honors_codex_home_and_ignores_blank() {
        let p = resolve_codex_config_path(Path::new("/home/duong"), Some("/custom"));
        assert_eq!(p, Path::new("/custom/config.toml"));
        let p = resolve_codex_config_path(Path::new("/home/duong"), Some("  "));
        assert_eq!(p, Path::new("/home/duong/.codex/config.toml"));
    }
}
