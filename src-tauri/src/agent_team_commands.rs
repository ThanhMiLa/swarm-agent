use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Write};
use tauri::{AppHandle, Manager, State};

use crate::{
    agent_team::{self, checkout, Session, Snapshot},
    pty::AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSnapshot {
    #[serde(flatten)]
    state: Snapshot,
    connected: HashMap<String, bool>,
}

#[tauri::command]
pub fn team_snapshot(state: State<'_, AppState>) -> TeamSnapshot {
    let snapshot = state.agent_teams.lock().unwrap().snapshot();
    let connected = snapshot
        .teams
        .iter()
        .flat_map(|t| &t.members)
        .map(|m| {
            (
                m.member_id.clone(),
                state
                    .team_pane(&m.session)
                    .is_some_and(|(_, _, connected)| connected),
            )
        })
        .collect();
    TeamSnapshot {
        state: snapshot,
        connected,
    }
}

#[tauri::command]
pub fn team_clear_runs(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> usize {
    let removed = state
        .agent_teams
        .lock()
        .unwrap()
        .clear_runs(workspace_id.as_deref());
    if removed > 0 {
        agent_team::notify(&app);
    }
    removed
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Edit {
    CloseWorkspace {
        team_id: String,
    },
    ClearTeam {
        team_id: String,
    },
    Join {
        team_id: String,
        terminal_id: String,
    },
    Leave {
        terminal_id: String,
    },
    RenameMember {
        team_id: String,
        member_id: String,
        name: String,
    },
}

#[tauri::command]
pub async fn team_edit(app: AppHandle, edit: Edit) -> Result<(), String> {
    let handle = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        if let Edit::Join {
            team_id,
            terminal_id,
        } = edit
        {
            let session = state
                .pane_session(&terminal_id)
                .ok_or("The pane is no longer open")?;
            let (cwd, agent, _) = state
                .team_pane(&session)
                .ok_or("Only AI panes can join Agent Team")?;
            if agent == "terminal" {
                return Err("Only AI panes can join Agent Team".into());
            }
            let root = checkout(&cwd)?.root;
            let terminals = state.terminals.lock().unwrap();
            if !terminals
                .get(&terminal_id)
                .is_some_and(|t| t.flow.flow_id() == session.generation)
            {
                return Err("The pane has restarted".into());
            }
            if terminals
                .get(&terminal_id)
                .and_then(|t| t.workspace_id.as_deref())
                != Some(team_id.as_str())
            {
                return Err("This terminal belongs to a different workspace".into());
            }
            return state
                .agent_teams
                .lock()
                .unwrap()
                .join(&team_id, session, agent, root);
        }
        let session = if let Edit::Leave { ref terminal_id } = edit {
            state.pane_session(terminal_id)
        } else {
            None
        };
        let mut teams = state.agent_teams.lock().unwrap();
        match edit {
            Edit::CloseWorkspace { team_id } => {
                teams.close_workspace(&team_id);
                Ok(())
            }
            Edit::ClearTeam { team_id } => {
                teams.clear_team(&team_id);
                Ok(())
            }
            Edit::RenameMember {
                team_id,
                member_id,
                name,
            } => teams.rename_member(&team_id, &member_id, &name),
            Edit::Leave { .. } => {
                if let Some(session) = session {
                    teams.leave(&session);
                }
                Ok(())
            }
            Edit::Join { .. } => unreachable!(),
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    agent_team::notify(&app);
    Ok(())
}

/// The renderer checks the interactive composer before requesting each phase.
/// Rust owns the payload, delivery claim, checkout and PTY generation.
#[tauri::command]
pub async fn team_delivery(
    app: AppHandle,
    id: String,
    terminal_id: String,
    generation: u64,
    phase: String,
    reason: Option<String>,
) -> Result<Option<String>, String> {
    let handle = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let session = Session {
            terminal_id,
            generation,
        };
        let (target, location) = state
            .agent_teams
            .lock()
            .unwrap()
            .delivery_target(&id)
            .ok_or("Unknown delivery")?;
        if target != session {
            return Err("Delivery is for a different session".into());
        }
        if phase == "fail" {
            state.agent_teams.lock().unwrap().delivery(
                &id,
                "fail",
                reason,
                agent_team::now_ms(),
            )?;
            return Ok(None);
        }
        if !matches!(phase.as_str(), "paste" | "submit") {
            return Err("Invalid delivery phase".into());
        }
        let write = || -> Result<Option<String>, String> {
            let (cwd, _, connected) = state
                .team_pane(&session)
                .ok_or("The target session has closed")?;
            if !connected || checkout(&cwd)? != location {
                return Err(
                    "The target is disconnected or its checkout or branch has changed".into(),
                );
            }
            let (writer, draft) = {
                let terminals = state.terminals.lock().unwrap();
                let t = terminals
                    .get(&session.terminal_id)
                    .filter(|t| t.flow.flow_id() == session.generation)
                    .ok_or("The target session has restarted")?;
                (t.writer.clone(), t.team_draft.clone())
            };
            let mut writer = writer.lock().map_err(|e| e.to_string())?;
            let mut draft = draft.lock().map_err(|e| e.to_string())?;
            if phase == "paste" && draft.is_some() {
                // Leave this result queued until the earlier draft is cleared.
                return Ok(None);
            }
            if phase == "submit" && draft.as_deref() != Some(&id) {
                return Err("The pane received other input after the team prompt was pasted. Check the pane before submitting.".into());
            }
            let body = {
                let terminals = state.terminals.lock().unwrap();
                if !terminals.get(&session.terminal_id)
                    .is_some_and(|t| t.flow.flow_id() == session.generation)
                {
                    return Err("The target session has restarted".into());
                }
                state.agent_teams.lock().unwrap().delivery(
                    &id,
                    &phase,
                    None,
                    agent_team::now_ms(),
                )?
            };
            let tail = body.as_deref().map(draft_tail);
            let payload = match body {
                Some(body) => {
                    *draft = Some(id.clone());
                    format!("\x1b[200~{}\x1b[201~", body.trim_end().replace('\n', "\r"))
                }
                None => "\r".to_owned(),
            };
            writer.write_all(payload.as_bytes())
                .and_then(|()| writer.flush())
                .map_err(|e| e.to_string())?;
            if phase == "submit" {
                *draft = None;
            }
            Ok(tail)
        };
        match write() {
            Ok(_) if phase == "submit" => {
                state.agent_teams.lock().unwrap().delivery(
                    &id,
                    "sent",
                    None,
                    agent_team::now_ms(),
                )?;
                Ok(None)
            }
            Ok(tail) => Ok(tail),
            Err(error) => {
                let _ = state.agent_teams.lock().unwrap().delivery(
                    &id,
                    "fail",
                    Some(error.clone()),
                    agent_team::now_ms(),
                );
                Err(error)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    agent_team::notify(&app);
    result
}

/// Match the visible end of the draft across TUI line wrapping.
fn draft_tail(prompt: &str) -> String {
    let suffix: Vec<char> = prompt
        .chars()
        .rev()
        .filter(|c| !c.is_whitespace())
        .take(24)
        .collect();
    suffix.into_iter().rev().collect()
}
