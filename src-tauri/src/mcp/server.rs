//! The MCP server surface. One struct = the whole tool set; tool groups are
//! added as additional `impl SwarmAgentMcpServer` blocks in dedicated files
//! (e.g. `mcp/tools/agent_team.rs`). Each such block gets its own
//! `#[tool_router(router = tool_router_<group>)]` (rmcp's macro emits a
//! generated fn per `impl` block, so every group needs a distinct name to
//! avoid colliding on the default `tool_router`); `SwarmAgentMcpServer::new`
//! below merges every group's router with `ToolRouter`'s `+` into the single
//! `tool_router` field `#[tool_handler]` reads from.
//!
//! Adding a tool later:
//! 1. Add `pub mod <group>;` in `mcp/tools/mod.rs`.
//! 2. Write an `impl SwarmAgentMcpServer` block in `mcp/tools/<group>.rs`
//!    annotated `#[tool_router(router = tool_router_<group>, vis = "pub")]`
//!    (see `mcp/tools/agent_team.rs`) with `#[tool]` methods, importing
//!    `use rmcp::{tool, tool_router};` (the macros must be in scope
//!    unqualified — invoking them via a fully-qualified `rmcp::tool_router`
//!    path does not expand correctly with this rmcp version).
//! 3. Register that block's router in `SwarmAgentMcpServer::new` below via
//!    `Self::tool_router_<group>()`, merged into the `tool_router` field with
//!    `+` if more than one group exists.
//!
//! rmcp 2.1 API notes (verified via context7 / docs.rs, since the plan was
//! written against a hypothetical 0.7 shape that does not match this pin):
//! - `#[tool_router]` on an `impl Self` block collects `#[tool]` methods into
//!   a `ToolRouter<Self>` returned by a generated fn (default name
//!   `tool_router`); `#[tool_handler(router = self.tool_router)]` on
//!   `impl ServerHandler for Self` wires whatever `ToolRouter` is stored in
//!   that field into `ServerHandler::call_tool`/`list_tools` automatically.
//! - A tool method can take `rmcp::handler::server::tool::Extension<http::request::Parts>`
//!   as a parameter to read the raw HTTP request (headers etc.) — the
//!   Streamable-HTTP transport stashes `Parts` in the request extensions
//!   before consuming the body, and `Extension<T>` (like arguments structs)
//!   is extracted via rmcp's `FromContextPart`, so it composes with a
//!   `Parameters<Args>` parameter on the same method.
//! - `rmcp::transport::streamable_http_server::tower::StreamableHttpService::new`
//!   takes `(service_factory: impl Fn() -> Result<S, io::Error>, session_manager: Arc<M>, config: StreamableHttpServerConfig)`.
//!   `StreamableHttpService` implements `tower_service::Service` and is
//!   `Clone`, so it mounts directly via `axum::Router::route_service`.
//! - `rmcp::ErrorData::{invalid_request, invalid_params, internal_error}(message, data: Option<Value>)`
//!   are the constructors used to map auth/validation failures to
//!   JSON-RPC-shaped protocol errors (the MCP client renders these as 4xx-ish
//!   failures, distinct from a tool-level `CallToolResult::error`).
//! - `ServerInfo` (`= InitializeResult`) and `Implementation` are both
//!   `#[non_exhaustive]`, so `get_info` below builds them via their `new`/
//!   `with_*` builder methods rather than a struct literal.

use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{Implementation, ProtocolVersion, ServerCapabilities, ServerInfo};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::{
    StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{tool_handler, ServerHandler};
use tauri::{AppHandle, Manager};

use axum::extract::RawQuery;
use axum::extract::State as AxumState;
use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;

use crate::mcp::auth;
use crate::mcp::context_usage::{self, AgentContextEvent};
use crate::pty::AppState;

#[derive(Clone)]
pub struct SwarmAgentMcpServer {
    pub app: AppHandle,
    tool_router: ToolRouter<Self>,
}

impl SwarmAgentMcpServer {
    fn new(app: AppHandle) -> Self {
        // Merge every tool group's router. `+` combines `ToolRouter`s so
        // `#[tool_handler]` sees the union of both groups' `#[tool]` methods.
        Self {
            app,
            tool_router: Self::tool_router_agent_team(),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for SwarmAgentMcpServer {
    fn get_info(&self) -> ServerInfo {
        // `ServerInfo` (aka `InitializeResult`) is `#[non_exhaustive]`, so a
        // field literal is rejected even naming every field — use its builder
        // methods instead.
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::LATEST)
            .with_server_info(
                Implementation::new("swarm-agent", env!("CARGO_PKG_VERSION")).with_title("SwarmAgent"),
            )
            .with_instructions(
                "SwarmAgent provides workspace Agent Team tools. \
                 All team members are peers — any member can act as the dispatcher for a run and assign tasks \
                 to other members as workers. \
                 Agent Team is opt-in per user prompt: only use team tools for delegation if the \
                 user explicitly asks to use the team, names a member to delegate to, or writes [TEAM]. \
                 A plain coding request is solo even when the pane is in an Agent Team. An instruction to send a \
                 prompt to another CLI or agent from this pane refers to a SwarmAgent team member. \
                 Use only the SwarmAgent team tools for that request. Never open an external app, \
                 use computer control, create a Codex chat/thread, or launch another CLI to substitute for a team pane. If \
                 the team has no active members, a member is disconnected, or a team tool is missing, \
                 report that obstacle to the user and stop that handoff. List members to find \
                 exact IDs and ask the user if a target is ambiguous. Plan distinct repository-relative file scopes for \
                 editing tasks, and pass scope [] for read-only tasks (summaries, reviews, handoffs, greetings, or \
                 confirmations) — never invent dummy file paths for read-only work. Always generate a fresh request_id \
                 for new or modified work. Keep plan (<= 16000 UTF-8 bytes) and each prompt (<= 32000 UTF-8 bytes) \
                 concise plain text with \\n line breaks and no ANSI/control characters; if a handoff is larger, write \
                 the full details to a repository file and reference its path instead. If team_dispatch returns a \
                 validation error, read the exact field error, fix that field, and retry once with a fresh request_id \
                 before reporting failure. Never instruct a worker to skip team_report_result, even if the user says \
                 no reply is needed — calling team_report_result is mandatory to finish the run. Call team_dispatch \
                 once, then end your turn without waiting. Assigned workers MUST always call team_report_result before \
                 ending their turn (this runtime requirement overrides any instruction in Plan or Task saying no reply \
                 or report is needed; never call team_dispatch back to the dispatcher); report file paths and observations, \
                 not code. \
                 When all workers finish, the app sends one combined Agent Team result prompt to the dispatcher. \
                 Review all worker tasks together against your plan, report findings to the user, and only then \
                 make small integration fixes or start a follow-up team_dispatch run if needed."
            )
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
        let tools = self.tool_router.list_all();
        // An initialize attempt does not mean the CLI received the tools.
        // Only record successful discovery from a live pane's own credential.
        if let Some(parts) = context.extensions.get::<axum::http::request::Parts>() {
            let state = self.app.state::<AppState>();
            let token = auth::bearer(bearer_header(&parts.headers));
            if state.mcp_session(token).is_some()
                && state
                    .mcp_clients
                    .lock()
                    .unwrap()
                    .mark_tools_discovered(token)
            {
                crate::agent_team::notify(&self.app);
            }
        }
        Ok(rmcp::model::ListToolsResult::with_all_items(tools))
    }
}

/// Streamable HTTP sessions track protocol state. Live PTY bearer credentials
/// independently identify the caller for Agent Team membership and tools.
pub fn axum_router(app: AppHandle) -> axum::Router {
    let session_manager = Arc::new(LocalSessionManager::default());
    let service = StreamableHttpService::new(
        {
            let app = app.clone();
            move || Ok(SwarmAgentMcpServer::new(app.clone()))
        },
        session_manager,
        StreamableHttpServerConfig::default(),
    );
    axum::Router::new()
        .route_service("/mcp", service)
        .route("/status", get(status_handler))
        .route("/hook", post(hook_handler))
        .route("/conversation", post(conversation_handler))
        .with_state(app)
}

/// The bearer gate shared by the loopback side routes (`/status`, `/hook`):
/// resolve the header's token to a LIVE terminal id, or `None`. Auth goes
/// through the live PTY registry, so its token stops answering when the
/// session dies — the same revocation rule the MCP tools use.
fn live_caller(app: &AppHandle, headers: &HeaderMap) -> Option<String> {
    let token = auth::bearer(bearer_header(headers));
    let state = app.state::<AppState>();
    state.mcp_session(token).map(|session| session.terminal_id)
}

fn bearer_header(headers: &HeaderMap) -> &str {
    headers
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
}

/// A CLI integration may publish only the ID (and working directory) of its
/// own PTY. The per-spawn bearer prevents one pane from updating another.
async fn conversation_handler(
    AxumState(app): AxumState<AppHandle>,
    headers: HeaderMap,
    Json(conversation): Json<crate::sessions::tracking::Conversation>,
) -> StatusCode {
    let state = app.state::<AppState>();
    let Some(session) = state.mcp_session(auth::bearer(bearer_header(&headers))) else {
        return StatusCode::UNAUTHORIZED;
    };
    if crate::sessions::tracking::publish(&state, &session, conversation) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::BAD_REQUEST
    }
}

/// Record one context-usage sample for a pane and emit `agent:context` only
/// if the ROUNDED value changed (`ContextUsage::record` is the dedupe). The
/// lock is statement-scoped on purpose: `emit` fans out to every webview and
/// must never run under a mutex that `/status` contends for every render.
fn publish_context(app: &AppHandle, terminal_id: &str, pct: Option<f64>) {
    let change = app
        .state::<AppState>()
        .context_usage
        .lock()
        .unwrap()
        .record(terminal_id, pct);
    if let Some(pct) = change {
        use tauri::Emitter;
        let _ = app.emit(
            "agent:context",
            &AgentContextEvent {
                terminal_id: terminal_id.to_owned(),
                pct,
                at_ms: crate::agent_team::now_ms(),
            },
        );
    }
}

/// `GET /status` — the status line's only backend call. Loopback-only (the
/// listener binds `127.0.0.1:0`); it reveals nothing beyond one boolean about
/// the caller's own pane, and records the caller's own context % when the
/// probe rides it in as `?ctx=` (the response body is unchanged — the probe's
/// parser must not care).
async fn status_handler(
    AxumState(app): AxumState<AppHandle>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let Some(terminal_id) = live_caller(&app, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    publish_context(
        &app,
        &terminal_id,
        context_usage::parse_ctx_query(query.as_deref()),
    );
    let token = auth::bearer(bearer_header(&headers));
    let connected = app
        .state::<AppState>()
        .mcp_clients
        .lock()
        .unwrap()
        .has_discovered_tools(token);
    (
        StatusCode::OK,
        // The probe reads to EOF rather than implementing keep-alive framing.
        [(axum::http::header::CONNECTION, "close")],
        Json(serde_json::json!({ "mcp": { "connected": connected } })),
    )
        .into_response()
}

/// `POST /hook` — the `swarm-agent --hook` CLI reporting one Claude Code hook
/// event for its own pane. The body is a closed enum (`HookBody`), never the
/// hook's stdin: prompt text, tool input and cwd stay inside the pane. The
/// verdict is re-emitted to the renderer as `agent:hook` (payload in lockstep
/// with `src/tauri/agent-state.ts::AgentHookEvent`); Rust keeps no hook state
/// itself — precedence over screen-scrape is decided in the renderer.
async fn hook_handler(
    AxumState(app): AxumState<AppHandle>,
    headers: HeaderMap,
    Json(body): Json<crate::hook::HookBody>,
) -> Response {
    if body.signal == crate::hook::Signal::AgentExited {
        let state = app.state::<AppState>();
        let token = auth::bearer(bearer_header(&headers));
        let Some(session) = state.mcp_session(token) else {
            return StatusCode::UNAUTHORIZED.into_response();
        };
        {
            let mut terminals = state.terminals.lock().unwrap();
            if let Some(terminal) = terminals
                .get_mut(&session.terminal_id)
                .filter(|t| t.flow.flow_id() == session.generation)
            {
                terminal.agent_id = None;
            }
        }
        state.mcp_clients.lock().unwrap().forget(token);
        state.agent_teams.lock().unwrap().leave(&session);
        crate::agent_team::notify(&app);
        return StatusCode::NO_CONTENT.into_response();
    }
    let Some(terminal_id) = live_caller(&app, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    use tauri::Emitter;
    let _ = app.emit(
        "agent:hook",
        &crate::hook::AgentHookEvent {
            terminal_id: terminal_id.clone(),
            signal: body.signal,
            at_ms: crate::agent_team::now_ms(),
        },
    );
    // SessionEnd must drop the context chip NOW, not at the next launch's
    // first status-line render; and since SessionStart also maps to `Forget`,
    // a relaunched `claude` starts from "no data" even if that render is late.
    if matches!(body.signal, crate::hook::Signal::Forget) {
        publish_context(&app, &terminal_id, None);
    }
    // The CLI reads to EOF with a 300 ms budget; `close` ends it promptly.
    (
        StatusCode::NO_CONTENT,
        [(axum::http::header::CONNECTION, "close")],
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_discovery_builds_all_production_schemas() {
        let router = SwarmAgentMcpServer::tool_router_agent_team();
        let tools = router.list_all();
        assert_eq!(tools.len(), 3);
        for name in ["team_list_members", "team_dispatch", "team_report_result"] {
            let tool = tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap_or_else(|| panic!("missing {name}"));
            assert_eq!(
                tool.output_schema
                    .as_ref()
                    .and_then(|schema| schema.get("type"))
                    .and_then(serde_json::Value::as_str),
                Some("object")
            );
        }
    }
}
