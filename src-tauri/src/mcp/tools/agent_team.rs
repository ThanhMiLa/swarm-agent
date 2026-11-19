use rmcp::handler::server::tool::Extension;
use rmcp::{
    handler::server::wrapper::{Json, Parameters},
    schemars, tool, tool_router,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::{
    agent_team::{self, DispatchArgs, DispatchReceipt, Report, Session},
    mcp::{auth, server::SwarmAgentMcpServer},
    pty::AppState,
};

#[derive(Serialize, schemars::JsonSchema)]
pub struct Roster {
    team: String,
    enabled: bool,
    members: Vec<RosterMember>,
}

#[derive(Serialize, schemars::JsonSchema)]
struct RosterMember {
    member_id: String,
    name: String,
    agent: String,
    connected: bool,
    is_self: bool,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ReportArgs {
    run_id: String,
    task_id: String,
    #[serde(flatten)]
    report: Report,
}

#[derive(Serialize, schemars::JsonSchema)]
pub struct DispatchResponse {
    receipt: DispatchReceipt,
    instruction: &'static str,
}

#[derive(Serialize, schemars::JsonSchema)]
pub struct ReportReceipt {
    accepted: bool,
}

fn error(message: impl Into<String>) -> rmcp::ErrorData {
    rmcp::ErrorData::invalid_request(message.into(), None)
}

fn session(
    state: &AppState,
    parts: &axum::http::request::Parts,
) -> Result<Session, rmcp::ErrorData> {
    let header = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    state
        .mcp_session(auth::bearer(header))
        .ok_or_else(|| error("Missing or stale pane session"))
}

#[tool_router(router = tool_router_agent_team, vis = "pub")]
impl SwarmAgentMcpServer {
    #[tool(
        name = "team_list_members",
        description = "List the panes in your Agent Team so you can resolve an exact name to a member ID. Use this for explicit inter-agent handoffs from the pane, including [TEAM]. A normal coding prompt is solo. If the team is off or a member is disconnected, tell the user instead of opening external apps or using computer control."
    )]
    pub async fn team_list_members(
        &self,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<Json<Roster>, rmcp::ErrorData> {
        let state = self.app.state::<AppState>();
        let origin = session(&state, &parts)?;
        let (team_name, enabled, members) = {
            let teams = state.agent_teams.lock().unwrap();
            let team = teams.team_of(&origin).map_err(error)?;
            (team.name.clone(), team.enabled, team.members.clone())
        };
        let members = members
            .into_iter()
            .map(|m| RosterMember {
                member_id: m.member_id,
                name: m.name,
                agent: m.agent_id,
                connected: state
                    .team_pane(&m.session)
                    .is_some_and(|(_, _, connected)| connected),
                is_self: m.session == origin,
            })
            .collect();
        Ok(Json(Roster {
            team: team_name,
            enabled,
            members,
        }))
    }

    #[tool(
        name = "team_dispatch",
        description = "ONLY when the user requests team work, names agents to delegate to, or includes [TEAM]. Resolve exact member IDs via team_list_members. Ask before dispatching if names are ambiguous. Plan first and give each editing task a distinct file scope in the shared checkout. Use scope [] for read-only tasks, including a greeting or confirmation. Never substitute an external app, computer control or a new CLI if this call fails. Call once with all assignments and end your turn when acknowledged. The app sends each worker's result to your session separately as that task finishes. Never call as an assigned worker or from a review."
    )]
    pub async fn team_dispatch(
        &self,
        Extension(parts): Extension<axum::http::request::Parts>,
        Parameters(args): Parameters<DispatchArgs>,
    ) -> Result<Json<DispatchResponse>, rmcp::ErrorData> {
        let state = self.app.state::<AppState>();
        let origin = session(&state, &parts)?;
        let handle = self.app.clone();
        let receipt: DispatchReceipt = tokio::task::spawn_blocking(move || {
            let state = handle.state::<AppState>();
            let members = state
                .agent_teams
                .lock()
                .unwrap()
                .team_of(&origin)?
                .members
                .clone();
            let (cwd, agent, connected) = state
                .team_pane(&origin)
                .ok_or("The leader session has closed")?;
            if !connected || !agent_team::supports_delivery(&agent) {
                return Err("The leader needs a supported CLI connected to MCP".into());
            }
            let location = agent_team::checkout(&cwd)?;
            let mut checked = std::collections::HashMap::new();
            for a in &args.assignments {
                if let Some(m) = members.iter().find(|m| m.member_id == a.member_id) {
                    if let Some((cwd, _, true)) = state
                        .team_pane(&m.session)
                        .filter(|(_, agent, _)| agent_team::supports_delivery(agent))
                    {
                        if let Ok(checkout) = agent_team::checkout(&cwd) {
                            checked.insert(a.member_id.clone(), (m.session.clone(), checkout));
                        }
                    }
                }
            }
            if state.pane_session(&origin.terminal_id).as_ref() != Some(&origin) {
                return Err("The leader session has restarted".into());
            }
            let receipt = state.agent_teams.lock().unwrap().dispatch(
                origin,
                args,
                &checked,
                location,
                agent_team::now_ms(),
            );
            receipt
        })
        .await
        .map_err(|e| error(e.to_string()))?
        .map_err(error)?;
        agent_team::notify(&self.app);
        Ok(Json(DispatchResponse {
            receipt,
            instruction:
                "End your turn now. The app will send each worker's result separately as that task finishes.",
        }))
    }

    #[tool(
        name = "team_report_result",
        description = "Finish the exact Agent Team task assigned to this pane. Call before your final response. Report succeeded/failed, short summary, changed repository-relative paths and test outcomes. Send no code, patches or terminal logs."
    )]
    pub async fn team_report_result(
        &self,
        Extension(parts): Extension<axum::http::request::Parts>,
        Parameters(args): Parameters<ReportArgs>,
    ) -> Result<Json<ReportReceipt>, rmcp::ErrorData> {
        let state = self.app.state::<AppState>();
        let origin = session(&state, &parts)?;
        state
            .agent_teams
            .lock()
            .unwrap()
            .report(&origin, &args.run_id, &args.task_id, args.report)
            .map_err(error)?;
        agent_team::notify(&self.app);
        Ok(Json(ReportReceipt { accepted: true }))
    }
}
