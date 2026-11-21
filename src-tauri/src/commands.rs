use portable_pty::PtySize;
use std::io::Write;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use crate::pty::{AppState, CreateTerminalOptions, CreateTerminalResult, PtyOut};

#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    options: CreateTerminalOptions,
    on_data: Channel<PtyOut>,
) -> CreateTerminalResult {
    crate::pty::spawn_terminal(&app, &state, id, options, on_data)
}

#[tauri::command]
pub async fn wait_for_agent_runtime(app: AppHandle) {
    use tauri::Manager;
    // Restored panes can mount before the loopback listener is ready.
    for _ in 0..40 {
        if app.state::<AppState>().mcp_url.get().is_some() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

#[tauri::command]
pub async fn write_terminal(
    state: State<'_, AppState>,
    id: String,
    data: String,
    input_token: Option<String>,
) -> Result<(), String> {
    write_input(&state, &id, data.into_bytes(), input_token).await
}

#[tauri::command]
pub async fn write_terminal_bytes(
    state: State<'_, AppState>,
    id: String,
    bytes: Vec<u8>,
    input_token: Option<String>,
) -> Result<(), String> {
    write_input(&state, &id, bytes, input_token).await
}

async fn write_input(
    state: &AppState,
    id: &str,
    bytes: Vec<u8>,
    input_token: Option<String>,
) -> Result<(), String> {
    // Never hold the terminal map or the UI thread while a PTY write waits for
    // its child. ACK, resize and kill must remain available under backpressure.
    let writer = state
        .terminals
        .lock()
        .unwrap()
        .get(id)
        .filter(|t| t.input_token == input_token)
        .map(|t| (t.writer.clone(), t.team_draft.clone()));
    if let Some((writer, draft)) = writer {
        tauri::async_runtime::spawn_blocking(move || {
            let mut writer = writer.lock().map_err(|e| e.to_string())?;
            draft.lock().map_err(|e| e.to_string())?.take();
            for chunk in bytes.chunks(4096) {
                writer.write_all(chunk).map_err(|e| e.to_string())?;
            }
            writer.flush().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    Ok(())
}

#[tauri::command]
pub fn ack_terminal_output(
    state: State<'_, AppState>,
    id: String,
    flow_id: u64,
    processed_bytes: u64,
) {
    crate::pty::ack_terminal_output(&state, &id, flow_id, processed_bytes);
}

#[tauri::command]
pub fn resize_terminal(state: State<'_, AppState>, id: String, cols: u16, rows: u16) {
    if let Some(t) = state.terminals.lock().unwrap().get(&id) {
        let _ = t.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

#[tauri::command]
pub fn kill_terminal(app: AppHandle, state: State<'_, AppState>, id: String) {
    // Take the terminal OUT of the map so its master PTY handle is dropped here,
    // rather than lingering until the reader thread cleans up. This makes the
    // reader observe EOF promptly on every platform:
    //   - Windows (ConPTY): killing the child does NOT close the output pipe while
    //     the master handle lives, so the reader would park on read() forever.
    //     Dropping the master runs ClosePseudoConsole, which closes the pipe.
    //   - Unix (macOS/Linux): the child's death already closes the slave, so the
    //     reader's own dup'd fd sees EOF regardless; dropping this master fd early
    //     is harmless.
    // Either way the reader then breaks, read_loop emits Exit and frees the id —
    // which a same-id respawn (agent/cwd/shell switch) waits for before spawning.
    //
    // The `let` binding releases the map lock BEFORE the kill/drop, so the reader
    // thread can re-lock the map to clear the id without deadlocking.
    let removed = state.terminals.lock().unwrap().remove(&id);
    if let Some(mut t) = removed {
        crate::pty::cleanup_team_session(&app, &state, &id, &t);
        t.kill();
        // Dropping `t` (and its master PTY) at end of scope forces the reader's EOF.
    }
}

/// Refresh token statistics and advance Agent Team run lifecycle from pane state transitions.
#[tauri::command]
pub fn report_agent_state(app: AppHandle, state: State<'_, AppState>, id: String, display: String) {
    let Some(session) = state.pane_session(&id) else {
        return;
    };
    if state.agent_teams.lock().unwrap().on_agent_state(
        &session,
        &display,
        crate::agent_team::now_ms(),
    ) {
        crate::agent_team::notify(&app);
    }
    if display == "done" || display == "idle" {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            let cache_path = crate::token_usage::store::default_cache_path(&handle);
            let res = tokio::task::spawn_blocking(move || {
                crate::token_usage::store::sync_all_and_aggregate(&cache_path)
            })
            .await;
            if let Ok(stats) = res {
                let _ = handle.emit("token-usage:updated", stats);
            }
        });
    }
}

#[tauri::command]
pub fn list_available_shells() -> Vec<crate::shell::ShellEntry> {
    crate::shell::list_shells().to_vec()
}

#[tauri::command]
pub fn list_available_agents() -> Vec<crate::agents::AgentEntry> {
    crate::agents::list_agents()
}

#[tauri::command]
pub async fn list_agent_sessions(folder: String) -> Vec<crate::sessions::SessionEntry> {
    crate::sessions::list_all(folder).await
}

/// Install or remove Claude Code's `statusLine` entry. Driven from the renderer
/// (on boot and on toggle) rather than from Rust's `setup`, because the
/// preference lives in localStorage and only the renderer can read it. That
/// ordering is fine: the status line only matters once a Claude pane exists,
/// which is strictly after the renderer has mounted.
#[tauri::command]
pub fn set_claude_statusline(app: AppHandle, enabled: bool) -> Result<(), String> {
    crate::statusline::install::apply(&app, enabled)
}

/// Resolve a path candidate the renderer found in terminal output. Returns the
/// canonical path as a string, or `None` when it does not name an existing file
/// — in which case the renderer does not draw a link.
#[tauri::command]
pub fn resolve_path_link(cwd: String, candidate: String) -> Option<String> {
    crate::links::resolve_candidate(std::path::Path::new(&cwd), &candidate)
        .map(|p| p.to_string_lossy().into_owned())
}

/// First of `candidates` (an allowlisted editor id) found on PATH. The renderer
/// asks once and caches; `None` means fall back to revealing in the file manager.
#[tauri::command]
pub fn find_available_editor(candidates: Vec<String>) -> Option<String> {
    let allowed: Vec<String> = candidates
        .into_iter()
        .filter(|c| crate::links::is_allowed_editor(c))
        .collect();
    let path_var = std::env::var("PATH").unwrap_or_default();
    crate::links::find_editor(&path_var, &allowed)
}

/// Launch an editor by argv. Never goes through a shell, so nothing in `args`
/// can be reinterpreted as shell syntax, and `bin` is re-checked against the
/// allowlist because the renderer is not a trust boundary.
#[tauri::command]
pub fn open_in_editor(bin: String, args: Vec<String>) -> Result<(), String> {
    if !crate::links::is_allowed_editor(&bin) {
        return Err(format!("editor not allowed: {bin}"));
    }
    std::process::Command::new(&bin)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Show the file in the OS file manager. Used when no allowlisted editor is on
/// PATH. Reveal-only: the file is selected, never opened, so this can't execute
/// anything.
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{path}"));
        c
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut cmd = {
        // No portable "reveal" on Linux; open the containing directory instead.
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".to_string());
        let mut c = std::process::Command::new("xdg-open");
        c.arg(parent);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Frontend drags a pane into one room's drop zone. Metadata is a frontend
/// snapshot: the leaf's explicit agentId and the registry's live cwd — the
#[tauri::command]
pub async fn get_token_usage_stats(
    app: AppHandle,
) -> Result<crate::token_usage::TokenUsageResponse, String> {
    let cache_path = crate::token_usage::store::default_cache_path(&app);
    tokio::task::spawn_blocking(move || {
        crate::token_usage::store::sync_all_and_aggregate(&cache_path)
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod terminal_io_tests {
    use super::*;
    use crate::pty::{FlowController, ManagedTerminal, MAX_UNACKED_BYTES};
    use portable_pty::{native_pty_system, ChildKiller};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;

    struct BlockedWriter(Arc<(Mutex<bool>, Condvar)>);
    impl Write for BlockedWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            let (lock, wake) = &*self.0;
            let mut released = lock.lock().unwrap();
            while !*released {
                released = wake.wait(released).unwrap();
            }
            Ok(data.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    #[derive(Debug)]
    struct NoopKiller;
    impl ChildKiller for NoopKiller {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(NoopKiller)
        }
    }

    #[tokio::test]
    async fn blocked_pty_input_does_not_block_ack_or_terminal_management() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(Box::new(BlockedWriter(gate.clone()))));
        let flow = FlowController::new(999);
        assert!(flow.wait_for_credit(MAX_UNACKED_BYTES));
        let state = Arc::new(AppState::default());
        state.terminals.lock().unwrap().insert(
            "blocked".into(),
            ManagedTerminal {
                mcp_token: String::new(),
                team_draft: Default::default(),
                workspace_id: None,
                cwd: Default::default(),
                agent_id: None,
                input_token: None,
                writer: writer.clone(),
                master: pair.master,
                killer: Box::new(NoopKiller),
                #[cfg(windows)]
                job: None,

                flow: flow.clone(),
                on_data: None,
                agent_log_dir: None,
            },
        );
        let input_state = state.clone();
        let input = tokio::spawn(async move {
            write_input(&input_state, "blocked", vec![b'x'; 8192], None).await
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        let blocked = writer.try_lock().is_err();
        let ack_state = state.clone();
        let ack = tokio::task::spawn_blocking(move || {
            crate::pty::ack_terminal_output(&ack_state, "blocked", 999, 32768)
        });
        let ack_result = tokio::time::timeout(Duration::from_millis(500), ack).await;
        // Release before asserting so even a regression cannot strand the test worker.
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        let write_result = tokio::time::timeout(Duration::from_secs(2), input).await;
        assert!(blocked, "fixture must exercise a blocked writer");
        assert!(
            ack_result.is_ok(),
            "ACK must not wait for the PTY writer's mutex"
        );
        assert!(write_result.is_ok());
        assert_eq!(flow.inner.0.lock().unwrap().total_acked_bytes, 32768);
        assert!(state.terminals.lock().unwrap().remove("blocked").is_some());
    }

    #[tokio::test]
    async fn stale_input_cannot_reach_a_replacement_session() {
        struct Recorder(Arc<Mutex<Vec<u8>>>);
        impl Write for Recorder {
            fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(data);
                Ok(data.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let state = AppState::default();
        state.terminals.lock().unwrap().insert(
            "reused-id".into(),
            ManagedTerminal {
                mcp_token: String::new(),
                team_draft: Default::default(),
                workspace_id: None,
                cwd: Default::default(),
                agent_id: None,
                input_token: Some("new-session".into()),
                writer: Arc::new(Mutex::new(Box::new(Recorder(recorded.clone())))),
                master: pair.master,
                killer: Box::new(NoopKiller),
                #[cfg(windows)]
                job: None,

                flow: FlowController::new(1000),
                on_data: None,
                agent_log_dir: None,
            },
        );
        write_input(
            &state,
            "reused-id",
            b"stale".to_vec(),
            Some("old-session".into()),
        )
        .await
        .unwrap();
        write_input(&state, "reused-id", b"missing-token".to_vec(), None)
            .await
            .unwrap();
        assert!(recorded.lock().unwrap().is_empty());
        write_input(
            &state,
            "reused-id",
            b"fresh".to_vec(),
            Some("new-session".into()),
        )
        .await
        .unwrap();
        assert_eq!(*recorded.lock().unwrap(), b"fresh");
    }
}
