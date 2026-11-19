//! MCP server: an in-process HTTP endpoint that in-terminal AI agents call to
//! coordinate workspace Agent Team runs.

pub mod auth;
pub mod bridge;
pub mod clients;
pub mod config;
pub mod context_usage;
pub mod server;
pub mod tools;

use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use crate::pty::AppState;

/// Bind a random loopback port, spawn the server, and return the resulting URL.
/// The URL is also stored in `AppState.mcp_url` so `spawn_terminal` can inject
/// it into shell env.
pub async fn start(app: AppHandle) -> Result<Arc<str>, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("mcp: bind failed: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let url: Arc<str> = Arc::from(format!("http://{addr}/mcp"));

    // Prepare CLI configuration before a newly started pane can use this endpoint.
    config::register_codex(&app, &url);
    config::register_qwen(&app);
    config::register_antigravity(&app);
    app.state::<AppState>()
        .mcp_url
        .set(url.clone())
        .map_err(|_| "MCP endpoint was already configured".to_string())?;

    let timer_app = app.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            timer.tick().await;
            if timer_app
                .state::<AppState>()
                .agent_teams
                .lock()
                .unwrap()
                .expire(crate::agent_team::now_ms())
            {
                crate::agent_team::notify(&timer_app);
            }
        }
    });
    let router = server::axum_router(app.clone());
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("mcp: server exited: {e}");
        }
    });

    Ok(url)
}
