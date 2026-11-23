use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

/// Windows Job Object helper. Killing a pty's shell with `TerminateProcess`
/// leaves its child/grandchild processes running (Windows does not cascade a
/// kill down the tree). Putting the shell in a job created with
/// `KILL_ON_JOB_CLOSE` means terminating — or merely dropping — the job tears
/// down every descendant, so closing a pane/workspace actually frees the CPU+RAM.
#[cfg(windows)]
mod job {
    use std::ffi::c_void;
    use std::mem;
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Owns a kill-on-close job handle. On drop the last handle closes, which
    /// terminates any process still in the job — a safety net against orphans.
    pub struct JobHandle(HANDLE);

    // A job handle is an opaque kernel handle; it is sound to move/share across
    // threads (it lives in the Mutex-guarded terminal map).
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl JobHandle {
        /// Create a kill-on-close job and place process `pid` in it. Every process
        /// the shell spawns afterwards inherits the job, so the whole tree is
        /// captured. Returns `None` if any Win32 step fails (caller degrades to
        /// the plain single-process kill).
        pub fn capturing(pid: u32) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(ptr::null(), ptr::null());
                if job.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 {
                    CloseHandle(job);
                    return None;
                }
                let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if proc.is_null() {
                    CloseHandle(job);
                    return None;
                }
                let assigned = AssignProcessToJobObject(job, proc);
                CloseHandle(proc);
                if assigned == 0 {
                    CloseHandle(job);
                    return None;
                }
                Some(JobHandle(job))
            }
        }

        /// Immediately terminate the shell and all of its descendants.
        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for JobHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

static NEXT_FLOW_ID: AtomicU64 = AtomicU64::new(1);

pub fn next_flow_id() -> u64 {
    NEXT_FLOW_ID.fetch_add(1, Ordering::Relaxed)
}

/// Flow control window: maximum 256 KiB unconfirmed UTF-8 bytes per session.
pub const MAX_UNACKED_BYTES: usize = 256 * 1024;

pub struct FlowState {
    pub flow_id: u64,
    pub total_sent_bytes: u64,
    pub total_acked_bytes: u64,
    pub closed: bool,
}

#[derive(Clone)]
pub struct FlowController {
    pub inner: Arc<(Mutex<FlowState>, Condvar)>,
}

impl FlowController {
    pub fn new(flow_id: u64) -> Self {
        Self {
            inner: Arc::new((
                Mutex::new(FlowState {
                    flow_id,
                    total_sent_bytes: 0,
                    total_acked_bytes: 0,
                    closed: false,
                }),
                Condvar::new(),
            )),
        }
    }

    pub fn flow_id(&self) -> u64 {
        self.inner.0.lock().unwrap().flow_id
    }

    /// Wait until total_sent_bytes - total_acked_bytes + chunk_len <= MAX_UNACKED_BYTES.
    /// Returns true if credit granted, false if closed.
    pub fn wait_for_credit(&self, chunk_len: usize) -> bool {
        if chunk_len > MAX_UNACKED_BYTES {
            return false;
        }
        let (lock, cvar) = &*self.inner;
        let mut state = lock.lock().unwrap();
        loop {
            if state.closed {
                return false;
            }
            let unacked = state
                .total_sent_bytes
                .saturating_sub(state.total_acked_bytes) as usize;
            if unacked + chunk_len <= MAX_UNACKED_BYTES {
                state.total_sent_bytes += chunk_len as u64;
                return true;
            }
            state = cvar.wait(state).unwrap();
        }
    }

    /// Acknowledge parsed output bytes.
    pub fn ack(&self, flow_id: u64, processed_bytes: u64) -> bool {
        let (lock, cvar) = &*self.inner;
        let mut state = lock.lock().unwrap();
        if state.flow_id != flow_id || state.closed || processed_bytes > state.total_sent_bytes {
            return false;
        }
        if processed_bytes > state.total_acked_bytes {
            state.total_acked_bytes = processed_bytes;
            cvar.notify_all();
            return true;
        }
        false
    }

    /// Mark closed and wake up all waiting threads.
    pub fn close(&self) {
        let (lock, cvar) = &*self.inner;
        let mut state = lock.lock().unwrap();
        state.closed = true;
        cvar.notify_all();
    }
}

/// Data chunk payload with flow control metadata
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyDataPayload {
    pub flow_id: u64,
    pub data: String,
    pub byte_len: usize,
}

/// Exit payload with flow control metadata
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitPayload {
    pub flow_id: u64,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

/// Output streamed to the renderer over a per-terminal channel.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type", content = "payload")]
pub enum PtyOut {
    Data(PtyDataPayload),
    Conversation(crate::sessions::tracking::Conversation),
    Exit(PtyExitPayload),
}

/// Options the renderer passes when asking the backend to spawn a pty.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalOptions {
    #[serde(default)]
    pub input_token: Option<String>,
    #[serde(default)]
    pub benchmark_fixture: Option<String>,
    pub cwd: Option<String>,
    pub shell_id: Option<String>,
    pub initial_command: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub workspace_id: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Flat result mirroring the original TS discriminated union (`ok` / `error`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalResult {
    pub ok: bool,
    pub pid: Option<u32>,
    pub shell: Option<String>,
    pub error: Option<String>,
}

impl CreateTerminalResult {
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            pid: None,
            shell: None,
            error: Some(msg.into()),
        }
    }
}

/// A live pty the manager owns. `master` is kept for resize; `writer` for input;
/// `killer` to terminate the child from the command thread. On Windows `job`
/// (when set) owns the shell's whole process tree so closing the terminal frees
/// every descendant, not just the shell.
pub struct ManagedTerminal {
    pub workspace_id: Option<String>,
    pub mcp_token: String,
    /// Valid only while the queued team paste is untouched by any other PTY input.
    pub team_draft: Arc<Mutex<Option<String>>>,
    pub agent_id: Option<String>,
    pub cwd: std::path::PathBuf,
    pub input_token: Option<String>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Box<dyn MasterPty + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    #[cfg(windows)]
    pub job: Option<job::JobHandle>,
    pub flow: FlowController,
    pub on_data: Option<Channel<PtyOut>>,
    pub agent_log_dir: Option<tempfile::TempDir>,
}

impl ManagedTerminal {
    /// Terminate the terminal's whole process tree. On Windows this nukes the job
    /// (shell + every descendant); the `killer` call is a fallback for when the
    /// job could not be created and on non-Windows platforms.
    pub fn kill(&mut self) {
        self.flow.close();
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.terminate();
        }
        let _ = self.killer.kill();
        self.agent_log_dir.take();
    }
}

/// Global backend state managed by Tauri.
pub struct AppState {
    pub terminals: Mutex<HashMap<String, ManagedTerminal>>,
    /// Set when the user picks Quit from the tray, so close-to-tray is bypassed.
    pub quitting: AtomicBool,
    /// The MCP server's Streamable-HTTP endpoint URL. Set once by `mcp::start`
    /// at app boot; read by `spawn_terminal` to seed each shell's env, and by
    /// nothing else. `OnceLock` is used so the read side needs no lock; if the
    /// server failed to bind the cell stays empty and `spawn_terminal` skips
    /// the env injection.
    pub mcp_url: OnceLock<Arc<str>>,
    pub agent_teams: Mutex<crate::agent_team::AgentTeams>,
    pub mcp_clients: Mutex<crate::mcp::clients::McpClients>,
    /// Last context-window percentage each Claude pane's status line reported
    /// via `/status?ctx=` (`mcp::context_usage`). Its own lock, never nested:
    /// `/status` hits it as often as every 300 ms per Claude pane while
    /// streaming, so it must not queue behind pty spawn/kill or MCP traffic.
    pub context_usage: Mutex<crate::mcp::context_usage::ContextUsage>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            quitting: AtomicBool::new(false),
            mcp_url: OnceLock::new(),
            agent_teams: Mutex::new(Default::default()),
            mcp_clients: Mutex::new(crate::mcp::clients::McpClients::default()),
            context_usage: Mutex::new(Default::default()),
        }
    }
}

/// The platform default shell and its launch args.
pub fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        // -NoLogo drops PowerShell's startup banner so panes open clean.
        ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let args = login_args(&shell);
        (shell, args)
    }
}

/// Args that make `shell` start as a *login* shell, or empty if we don't
/// recognise it.
///
/// This matters far more than it looks: a non-login zsh reads neither
/// `/etc/zprofile` (where macOS runs `path_helper`, the source of
/// `/usr/local/bin`) nor `~/.zprofile` (where Homebrew's installer writes
/// `brew shellenv`, the source of `/opt/homebrew/bin`). Panes would inherit
/// only the stub PATH the GUI process was launched with, so `brew`, `gh`,
/// `node`, `docker`… all come back "command not found" while Terminal.app on
/// the same machine works. Every mainstream emulator (Terminal.app, iTerm2,
/// Ghostty, WezTerm, Alacritty) starts a login shell for this reason.
///
/// Unknown shells get no args on purpose: an exotic shell that rejects `-l`
/// would exit immediately and leave a dead pane, which is a worse failure than
/// a short PATH.
#[cfg(not(windows))]
pub fn login_args(shell: &str) -> Vec<String> {
    // Compare on the file name only — `$SHELL` is an absolute path, and some
    // installs carry a version suffix (`bash-5.2`).
    let name = std::path::Path::new(shell)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| shell.to_string());
    let stem = name.split('-').next().unwrap_or(&name);
    match stem {
        // `-l` is the login flag for all of these (fish and csh included).
        "sh" | "bash" | "zsh" | "fish" | "ksh" | "mksh" | "dash" | "csh" | "tcsh" => {
            vec!["-l".to_string()]
        }
        _ => vec![],
    }
}

/// The `LANG` value to inject when the parent environment carries no locale at
/// all — the normal state of a GUI app launched from Finder or a desktop shell,
/// which hands us a stub environment with no `LANG`/`LC_*`. Programs in the
/// pane then run under the POSIX "C" locale, and plenty of them degrade to
/// ASCII-only output there (TUIs substitute placeholder glyphs for non-ASCII,
/// `ls` mangles filenames, sort orders change) even though xterm.js decodes
/// UTF-8 unconditionally. Every mainstream emulator (Terminal.app, iTerm2,
/// kitty, WezTerm) papers over this by exporting a UTF-8 locale itself — same
/// class of GUI-launch parity fix as the login-shell PATH story in
/// `login_args`. A user who exports any locale, even a non-UTF-8 one, made a
/// choice; only the "nothing at all" case is filled in. Empty strings count as
/// unset because they select the POSIX locale exactly like absence does.
#[cfg(not(windows))]
pub fn utf8_lang_fallback(
    lang: Option<&str>,
    lc_all: Option<&str>,
    lc_ctype: Option<&str>,
) -> Option<&'static str> {
    let missing = |v: Option<&str>| v.is_none_or(str::is_empty);
    if missing(lang) && missing(lc_all) && missing(lc_ctype) {
        // en_US.UTF-8 ships on every macOS; C.UTF-8 is the one UTF-8 locale
        // modern glibc/musl guarantee without locale generation.
        #[cfg(target_os = "macos")]
        {
            Some("en_US.UTF-8")
        }
        #[cfg(not(target_os = "macos"))]
        {
            Some("C.UTF-8")
        }
    } else {
        None
    }
}

/// Prefix a startup command with `command ` on POSIX/fish shells so user
/// aliases (e.g. `alias codex='codex --dangerously-bypass-approvals-and-sandbox'`)
/// cannot duplicate flags that SwarmAgent already passes.
fn bypass_shell_alias<'a>(command: &'a str, shell_name: &str) -> std::borrow::Cow<'a, str> {
    let trimmed = command.trim_start();
    if trimmed.is_empty() || trimmed.split_whitespace().next() == Some("command") {
        return std::borrow::Cow::Borrowed(command);
    }
    let stem = shell_name.split('-').next().unwrap_or(shell_name);
    match stem {
        "sh" | "bash" | "zsh" | "fish" | "ksh" | "mksh" | "dash" => {
            std::borrow::Cow::Owned(format!("command {trimmed}"))
        }
        _ => std::borrow::Cow::Borrowed(command),
    }
}

/// Drain the largest valid-UTF-8 prefix from `buf`, leaving any incomplete
/// trailing multibyte sequence behind for the next read. Bytes that cannot begin
/// or continue a valid sequence are genuinely invalid, so they are flushed
/// lossily immediately rather than stalling the stream waiting for a completion
/// that will never come.
pub fn take_valid_utf8(buf: &mut Vec<u8>) -> Option<String> {
    if buf.is_empty() {
        return None;
    }
    let valid_up_to = match std::str::from_utf8(buf) {
        Ok(s) => s.len(),
        Err(e) => e.valid_up_to(),
    };
    if valid_up_to == 0 {
        // Nothing decodes yet. Wait for more bytes only if the leading byte could
        // plausibly start a multibyte sequence and we haven't already buffered a
        // full char's worth (max 4 bytes). Otherwise the bytes are invalid —
        // flush lossily so the stream never stalls.
        // The three ranges are the 2-, 3- and 4-byte UTF-8 lead classes. They
        // happen to be contiguous, but they are kept split so the classes stay
        // legible next to the UTF-8 spec.
        #[allow(clippy::manual_range_patterns)]
        let leads_multibyte = matches!(buf[0], 0xC2..=0xDF | 0xE0..=0xEF | 0xF0..=0xF4);
        if leads_multibyte && buf.len() < 4 {
            return None;
        }
        let s = String::from_utf8_lossy(buf).into_owned();
        buf.clear();
        return Some(s);
    }
    let s = std::str::from_utf8(&buf[..valid_up_to])
        .expect("valid_up_to guarantees valid utf8")
        .to_owned();
    buf.drain(..valid_up_to);
    Some(s)
}

const READ_BUF_BYTES: usize = 64 * 1024;

/// Spawn a pty, register it in state, and start a reader thread that streams
/// decoded output (and finally the exit code) over `on_data`.
pub fn spawn_terminal(
    app: &AppHandle,
    state: &AppState,
    id: String,
    options: CreateTerminalOptions,
    on_data: Channel<PtyOut>,
) -> CreateTerminalResult {
    if state.terminals.lock().unwrap().contains_key(&id) {
        return CreateTerminalResult::err(format!("Terminal \"{id}\" already exists"));
    }

    let resolved = options
        .shell_id
        .as_deref()
        .and_then(crate::shell::resolve_shell);
    let (shell, args) = resolved.clone().unwrap_or_else(default_shell);

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: options.rows,
        cols: options.cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => return CreateTerminalResult::err(e.to_string()),
    };

    let mut cmd = CommandBuilder::new(&shell);
    for a in &args {
        cmd.arg(a);
    }
    if let Some(fixture) = &options.benchmark_fixture {
        #[cfg(debug_assertions)]
        {
            if std::env::var_os("SWARM_AGENT_BENCHMARK").is_some()
                && ["static", "stream", "tui", "tui-stream"].contains(&fixture.as_str())
            {
                cmd = CommandBuilder::new(std::env::current_exe().expect("benchmark executable"));
                cmd.args(["--terminal-fixture", fixture]);
            } else {
                return CreateTerminalResult::err(
                    "Benchmark fixtures require the isolated debug runner",
                );
            }
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = fixture;
            return CreateTerminalResult::err("Benchmark fixtures are disabled in release builds");
        }
    }
    // Inherit the parent environment, then advertise truecolor so CLIs emit
    // 24-bit color sequences that ConPTY forwards and xterm renders verbatim.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM", "xterm-256color");
    // GUI launches arrive with no locale vars; fill in a UTF-8 LANG so CLIs
    // don't degrade to ASCII-only output (see utf8_lang_fallback for the why).
    #[cfg(not(windows))]
    if let Some(lang) = utf8_lang_fallback(
        std::env::var("LANG").ok().as_deref(),
        std::env::var("LC_ALL").ok().as_deref(),
        std::env::var("LC_CTYPE").ok().as_deref(),
    ) {
        cmd.env("LANG", lang);
    }
    // Ask the shell to report its working directory on every prompt (OSC 7), so
    // relative path links stay resolvable after a `cd`. bash is the only shell we
    // have to arrange this for via the environment: macOS zsh already emits OSC 7
    // from /etc/zshrc and fish does it natively. PowerShell has no environment
    // hook — it falls back to the spawn cwd, so relative links there stop
    // resolving once the user cds away. Prepend rather than replace so a
    // user-configured PROMPT_COMMAND still runs.
    if shell.to_lowercase().contains("bash") {
        let osc7 = r#"printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-}" "$PWD""#;
        let existing = std::env::var("PROMPT_COMMAND").unwrap_or_default();
        let combined = if existing.is_empty() {
            osc7.to_string()
        } else {
            format!("{osc7}; {existing}")
        };
        cmd.env("PROMPT_COMMAND", combined);
    }
    // A pane ID survives respawn. Credentials must not survive with it.
    let mcp_token = uuid::Uuid::new_v4().to_string();
    cmd.env("SWARM_AGENT_SESSION", &mcp_token);
    if let Some(url) = state.mcp_url.get() {
        cmd.env("SWARM_AGENT_MCP_URL", url.as_ref());
    }
    let cwd = options.cwd.clone().unwrap_or_else(|| {
        app.path()
            .home_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| ".".to_string())
    });
    cmd.cwd(&cwd);
    crate::mcp::config::configure_terminal(&mut cmd, options.agent_id.as_deref());
    if options.agent_id.as_deref() == Some("opencode") {
        if let Err(err) = crate::sessions::tracking::configure_opencode(app, &mut cmd) {
            eprintln!("session restore: OpenCode plugin unavailable: {err}");
        }
    }
    let shell_name = std::path::Path::new(&shell)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let agy_log = (options.agent_id.as_deref() == Some("antigravity")
        && options
            .initial_command
            .as_deref()
            .is_some_and(|s| s.starts_with("agy ")))
    .then(|| crate::sessions::tracking::antigravity_log_directory().ok())
    .flatten();
    if let Some(dir) = &agy_log {
        cmd.env("SWARM_AGENT_AGY_LOG", dir.path().join("pane.log"));
    }
    let report_exit = options
        .agent_id
        .as_deref()
        .is_some_and(crate::agent_team::supports_delivery)
        && std::env::current_exe()
            .map(|exe| cmd.env("SWARM_AGENT_BIN", exe))
            .is_ok();

    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => return CreateTerminalResult::err(e.to_string()),
    };
    let pid = child.process_id();
    let killer = child.clone_killer();

    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            // The child already spawned; don't leave it orphaned.
            let _ = child.clone_killer().kill();
            return CreateTerminalResult::err(e.to_string());
        }
    };
    let reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            let _ = child.clone_killer().kill();
            return CreateTerminalResult::err(e.to_string());
        }
    };
    let reader = crate::pty_output::PtyOutputReader::new(reader, &*pair.master);

    // Capture the shell in a job BEFORE running any command, so every process the
    // command tree spawns is born inside the job and dies with it.
    #[cfg(windows)]
    let job = pid.and_then(job::JobHandle::capturing);

    let flow_id = next_flow_id();
    let flow = FlowController::new(flow_id);

    let startup = options.initial_command.as_deref().map(|command| {
        if agy_log.is_some() {
            crate::sessions::tracking::antigravity_command(command, &shell_name)
        } else {
            crate::mcp::config::private_agent_command(options.agent_id.as_deref(), command)
        }
    });
    let agy_tracking = agy_log
        .as_ref()
        .map(|dir| (dir.path().join("pane.log"), cwd.clone()));
    let writer = Arc::new(Mutex::new(writer));
    state.terminals.lock().unwrap().insert(
        id.clone(),
        ManagedTerminal {
            input_token: options.input_token.clone(),
            writer: writer.clone(),
            mcp_token,
            team_draft: Default::default(),
            workspace_id: options.workspace_id,
            cwd: cwd.into(),
            agent_id: options.agent_id,
            master: pair.master,
            killer,
            #[cfg(windows)]
            job,
            flow: flow.clone(),
            on_data: Some(on_data.clone()),
            agent_log_dir: agy_log,
        },
    );

    if let Some((file_path, cwd)) = agy_tracking {
        crate::sessions::tracking::watch_antigravity(
            app.clone(),
            crate::agent_team::Session {
                terminal_id: id.clone(),
                generation: flow_id,
            },
            file_path,
            cwd,
        );
    }

    // Run the template's first command (clearing the screen first for the
    // platform default shell so the prompt/echo don't linger above the program).
    if let Some(ic) = startup {
        let ic = bypass_shell_alias(&ic, &shell_name);
        let exit = if report_exit {
            match shell_name.as_str() {
                "cmd" => " & \"%SWARM_AGENT_BIN%\" --agent-team-exited",
                "powershell" | "pwsh" => "; & $env:SWARM_AGENT_BIN --agent-team-exited",
                _ => "; \"$SWARM_AGENT_BIN\" --agent-team-exited",
            }
        } else {
            ""
        };
        let line = if resolved.is_some() {
            format!("{ic}{exit}\r")
        } else {
            let clear = if cfg!(windows) { "Clear-Host" } else { "clear" };
            format!("{clear}; {ic}{exit}\r")
        };
        if let Ok(mut writer) = writer.lock() {
            let _ = writer.write_all(line.as_bytes());
            let _ = writer.flush();
        }
    }

    let app = app.clone();
    std::thread::spawn(move || {
        read_loop(app, id, flow, reader, child, on_data);
    });

    CreateTerminalResult {
        ok: true,
        pid,
        shell: Some(shell),
        error: None,
    }
}

/// Blocking read loop: stream decoded output, then wait for exit and clean up.
fn read_loop(
    app: AppHandle,
    id: String,
    flow: FlowController,
    mut reader: crate::pty_output::PtyOutputReader,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    on_data: Channel<PtyOut>,
) {
    let flow_id = flow.flow_id();
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; READ_BUF_BYTES];
    'output: loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
            Ok(n) => {
                pending.extend_from_slice(&chunk[..n]);
                while let Some(text) = take_valid_utf8(&mut pending) {
                    let byte_len = text.len();
                    if !flow.wait_for_credit(byte_len) {
                        let _ = child.kill();
                        break 'output;
                    }
                    if on_data
                        .send(PtyOut::Data(PtyDataPayload {
                            flow_id,
                            data: text,
                            byte_len,
                        }))
                        .is_err()
                    {
                        flow.close();
                        let _ = child.kill();
                        break 'output;
                    }
                }
            }
        }
    }
    // Flush any trailing bytes (lossily) so nothing is lost.
    if !pending.is_empty() {
        let trailing = String::from_utf8_lossy(&pending).into_owned();
        let byte_len = trailing.len();
        if flow.wait_for_credit(byte_len) {
            let _ = on_data.send(PtyOut::Data(PtyDataPayload {
                flow_id,
                data: trailing,
                byte_len,
            }));
        }
    }
    let exit_code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);

    // Remove from the registry BEFORE notifying the renderer: a retry triggered by
    // the exit event must find the id free, since create rejects a duplicate live id.
    if let Some(state) = app.try_state::<AppState>() {
        let removed = {
            let mut terminals = state.terminals.lock().unwrap();
            if terminals
                .get(&id)
                .is_some_and(|t| t.flow.flow_id() == flow_id)
            {
                terminals.remove(&id)
            } else {
                None
            }
        };
        if let Some(terminal) = removed {
            cleanup_team_session(&app, &state, &id, &terminal);
        } else {
            let _ = on_data.send(PtyOut::Exit(PtyExitPayload { flow_id, exit_code }));
            return;
        }
    }
    let _ = on_data.send(PtyOut::Exit(PtyExitPayload { flow_id, exit_code }));
}

/// Acknowledge parsed terminal output bytes from frontend flow control.
pub fn ack_terminal_output(state: &AppState, id: &str, flow_id: u64, processed_bytes: u64) {
    let flow = {
        let terminals = state.terminals.lock().unwrap();
        terminals.get(id).map(|t| t.flow.clone())
    };
    if let Some(flow) = flow {
        flow.ack(flow_id, processed_bytes);
    }
}

pub fn cleanup_team_session(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    terminal: &ManagedTerminal,
) {
    state
        .mcp_clients
        .lock()
        .unwrap()
        .forget(&terminal.mcp_token);
    state.context_usage.lock().unwrap().forget(id);
    let changed = state
        .agent_teams
        .lock()
        .unwrap()
        .leave(&crate::agent_team::Session {
            terminal_id: id.to_owned(),
            generation: terminal.flow.flow_id(),
        });
    if changed {
        crate::agent_team::notify(app);
    }
}

impl AppState {
    pub fn pane_session(&self, id: &str) -> Option<crate::agent_team::Session> {
        let terminals = self.terminals.lock().unwrap();
        terminals.get(id).map(|t| crate::agent_team::Session {
            terminal_id: id.to_owned(),
            generation: t.flow.flow_id(),
        })
    }
    pub fn mcp_session(&self, token: &str) -> Option<crate::agent_team::Session> {
        if token.trim().is_empty() {
            return None;
        }
        let terminals = self.terminals.lock().unwrap();
        terminals
            .iter()
            .find(|(_, t)| t.mcp_token == token.trim())
            .map(|(id, t)| crate::agent_team::Session {
                terminal_id: id.clone(),
                generation: t.flow.flow_id(),
            })
    }
    pub fn team_pane(
        &self,
        session: &crate::agent_team::Session,
    ) -> Option<(std::path::PathBuf, String, bool)> {
        let (cwd, agent, token) = {
            let terminals = self.terminals.lock().unwrap();
            let terminal = terminals
                .get(&session.terminal_id)
                .filter(|t| t.flow.flow_id() == session.generation)?;
            (
                terminal.cwd.clone(),
                terminal.agent_id.clone()?,
                terminal.mcp_token.clone(),
            )
        };
        let connected = self
            .mcp_clients
            .lock()
            .unwrap()
            .has_discovered_tools(&token);
        Some((cwd, agent, connected))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_nonempty() {
        let (cmd, _args) = default_shell();
        assert!(!cmd.is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn default_shell_is_a_login_shell() {
        let (_cmd, args) = default_shell();
        assert!(
            args.iter().any(|a| a == "-l"),
            "unix panes must spawn a login shell, got args {args:?}"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn login_args_cover_the_common_posix_shells() {
        for shell in [
            "/bin/zsh",
            "/bin/bash",
            "/bin/sh",
            "/opt/homebrew/bin/fish",
            "/bin/ksh",
        ] {
            assert_eq!(login_args(shell), vec!["-l".to_string()], "{shell}");
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn login_args_are_empty_for_unknown_shells() {
        // An unrecognised shell may reject `-l` and leave the pane dead on
        // arrival; no args is the safe fallback.
        assert!(login_args("/usr/local/bin/nu").is_empty());
        assert!(login_args("/usr/bin/xonsh").is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn login_args_ignore_the_directory_and_version_suffix() {
        assert_eq!(login_args("zsh"), vec!["-l".to_string()]);
        assert_eq!(
            login_args("/usr/local/bin/bash-5.2"),
            vec!["-l".to_string()]
        );
    }

    #[test]
    fn bypass_shell_alias_prefixes_posix_and_fish_shells() {
        let cmd = "codex --dangerously-bypass-approvals-and-sandbox";
        for shell in [
            "zsh", "bash", "bash-5.2", "sh", "fish", "ksh", "mksh", "dash",
        ] {
            assert_eq!(
                bypass_shell_alias(cmd, shell),
                format!("command {cmd}"),
                "{shell}"
            );
        }
    }

    #[test]
    fn bypass_shell_alias_leaves_non_posix_shells_and_idempotent_commands_alone() {
        let cmd = "codex --dangerously-bypass-approvals-and-sandbox";
        for shell in ["powershell", "pwsh", "cmd", "nu", "csh", "tcsh", "wsl"] {
            assert_eq!(bypass_shell_alias(cmd, shell), cmd, "{shell}");
        }
        assert_eq!(
            bypass_shell_alias("command codex --foo", "zsh"),
            "command codex --foo"
        );
        assert_eq!(bypass_shell_alias("   ", "zsh"), "   ");
    }

    #[test]
    fn take_valid_utf8_returns_complete_prefix_and_holds_partial_tail() {
        // "é" is 0xC3 0xA9; feed only the first byte after an ascii char.
        let mut buf = vec![b'h', b'i', 0xC3];
        let out = take_valid_utf8(&mut buf).unwrap();
        assert_eq!(out, "hi");
        assert_eq!(buf, vec![0xC3]); // incomplete tail retained
    }

    #[test]
    fn take_valid_utf8_completes_across_chunks() {
        let mut buf = vec![0xC3, 0xA9]; // full "é"
        let out = take_valid_utf8(&mut buf).unwrap();
        assert_eq!(out, "é");
        assert!(buf.is_empty());
    }

    #[test]
    fn take_valid_utf8_flushes_long_invalid_runs() {
        let mut buf = vec![0xFF, 0xFE, 0xFD, 0xFC, 0xFB];
        let out = take_valid_utf8(&mut buf).unwrap();
        assert!(!out.is_empty()); // lossy, but does not stall
        assert!(buf.is_empty());
    }

    #[test]
    fn take_valid_utf8_flushes_short_invalid_runs() {
        let mut buf = vec![0xFF, 0xFE, 0xFD]; // 3 invalid bytes, not a multibyte lead
        let out = take_valid_utf8(&mut buf).unwrap();
        assert!(!out.is_empty());
        assert!(buf.is_empty()); // flushed immediately, not stalled
    }

    #[cfg(not(windows))]
    #[test]
    fn utf8_lang_fallback_fills_a_bare_gui_environment() {
        // Finder/desktop launch: no locale vars at all → inject a UTF-8 LANG.
        let lang = utf8_lang_fallback(None, None, None).unwrap();
        assert!(lang.contains("UTF-8"));
    }

    #[cfg(not(windows))]
    #[test]
    fn utf8_lang_fallback_treats_empty_values_as_unset() {
        // An empty LANG selects the POSIX locale exactly like an absent one.
        assert!(utf8_lang_fallback(Some(""), Some(""), None).is_some());
    }

    #[cfg(not(windows))]
    #[test]
    fn utf8_lang_fallback_respects_any_explicit_locale() {
        // A user who exports a locale — even a non-UTF-8 one — keeps it.
        assert!(utf8_lang_fallback(Some("en_US.UTF-8"), None, None).is_none());
        assert!(utf8_lang_fallback(Some("C"), None, None).is_none());
        assert!(utf8_lang_fallback(None, Some("C"), None).is_none());
        assert!(utf8_lang_fallback(None, None, Some("vi_VN.UTF-8")).is_none());
    }

    #[test]
    fn flow_controller_grants_credit_within_window() {
        let flow = FlowController::new(42);
        assert_eq!(flow.flow_id(), 42);

        // Window is 256 KiB; request 128 KiB
        assert!(flow.wait_for_credit(128 * 1024));
        // Request another 64 KiB (total 192 KiB <= 256 KiB)
        assert!(flow.wait_for_credit(64 * 1024));
    }

    #[test]
    fn flow_controller_rejects_ack_for_bytes_not_sent() {
        let flow = FlowController::new(42);
        assert!(flow.wait_for_credit(8192));
        assert!(!flow.ack(42, 16384));
        assert_eq!(flow.inner.0.lock().unwrap().total_acked_bytes, 0);
        assert!(!flow.wait_for_credit(MAX_UNACKED_BYTES + 1));
    }

    #[test]
    fn flow_controller_blocks_and_resumes_on_ack() {
        let flow = FlowController::new(10);
        // Fill up to the limit
        assert!(flow.wait_for_credit(MAX_UNACKED_BYTES));

        let flow_clone = flow.clone();
        let handle = std::thread::spawn(move || {
            // Next request will block until credit is opened
            flow_clone.wait_for_credit(32 * 1024)
        });

        // Sleep briefly to ensure waiter thread is parked
        std::thread::sleep(std::time::Duration::from_millis(50));

        // ACK 64 KiB
        assert!(flow.ack(10, 64 * 1024));

        let granted = handle.join().expect("thread joined");
        assert!(granted);
    }

    #[test]
    fn flow_controller_ignores_stale_or_mismatched_ack() {
        let flow = FlowController::new(10);
        assert!(flow.wait_for_credit(64 * 1024));

        // Mismatched flow id is ignored
        assert!(!flow.ack(9, 64 * 1024));
        // Stale smaller ACK is ignored
        assert!(flow.ack(10, 32 * 1024));
        assert!(!flow.ack(10, 16 * 1024));
    }

    #[test]
    fn flow_controller_close_wakes_waiters() {
        let flow = FlowController::new(1);
        assert!(flow.wait_for_credit(MAX_UNACKED_BYTES));

        let flow_clone = flow.clone();
        let handle = std::thread::spawn(move || flow_clone.wait_for_credit(1024));

        std::thread::sleep(std::time::Duration::from_millis(50));
        flow.close();

        let ok = handle.join().expect("thread joined");
        assert!(!ok); // closed session returns false
    }

    #[test]
    fn pty_out_serializes_with_flow_id_and_byte_len() {
        let data = PtyOut::Data(PtyDataPayload {
            flow_id: 123,
            data: "sample".to_string(),
            byte_len: 6,
        });
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"type\":\"data\""));
        assert!(json.contains("\"flowId\":123"));
        assert!(json.contains("\"byteLen\":6"));
        assert!(json.contains("\"data\":\"sample\""));

        let exit = PtyOut::Exit(PtyExitPayload {
            flow_id: 123,
            exit_code: 0,
        });
        let exit_json = serde_json::to_string(&exit).unwrap();
        assert!(exit_json.contains("\"type\":\"exit\""));
        assert!(exit_json.contains("\"flowId\":123"));
        assert!(exit_json.contains("\"exitCode\":0"));
    }
}
