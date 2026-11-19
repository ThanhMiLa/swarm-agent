// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(debug_assertions)]
    {
        let args: Vec<String> = std::env::args().collect();
        if let Some(index) = args.iter().position(|a| a == "--terminal-fixture") {
            swarm_agent_lib::terminal_benchmark::fixture(
                args.get(index + 1).map(String::as_str).unwrap_or("static"),
            );
            return;
        }
    }
    // `swarm-agent --statusline` is Claude Code's status line command: read its
    // JSON from stdin, print one line, exit. Handled here, before `run()`, so
    // the Tauri builder / single-instance plugin / tray / AppKit are never
    // initialised for what is a sub-second CLI invocation.
    //
    // The `windows_subsystem = "windows"` attribute above suppresses console
    // ALLOCATION; it does not detach inherited standard handles. Claude Code
    // spawns this with piped stdio, so the pipes arrive through STARTUPINFO and
    // GetStdHandle resolves them normally. ("GUI subsystem means no stdio" is
    // the intuitive-but-wrong read of that attribute.)
    if std::env::args().skip(1).any(|a| a == "--statusline") {
        swarm_agent_lib::statusline::run_cli();
        return;
    }
    // `swarm-agent --hook` is Claude Code's hook command: same pre-Tauri
    // short-circuit as above, and the same Windows stdio note applies.
    if std::env::args().skip(1).any(|a| a == "--hook") {
        swarm_agent_lib::hook::run_cli();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--mcp-stdio") {
        swarm_agent_lib::mcp::bridge::run_cli();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--agent-team-exited") {
        swarm_agent_lib::hook::report_agent_exit();
        return;
    }
    swarm_agent_lib::run()
}
