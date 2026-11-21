# Changelog

All notable changes to **SwarmAgent** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-22

### Fixed

- **Agent Team `team_dispatch` validation & limits**:
  - Normalized `\r\n` / `\r` line endings to `\n` in `plan`, `assignment.prompt`, `report.summary`, and `report.tests` so CRLF inputs no longer fail validation.
  - Increased UTF-8 byte limits to better support Vietnamese and longer handoffs (`plan`: 8,000 → 16,000 bytes; `prompt`: 12,000 → 32,000 bytes; `report.summary`: 3,000 → 6,000 bytes).
  - Replaced the generic `"Give each worker a prompt and a repository-relative file scope"` error with field-specific messages (empty, byte limit exceeded with actual size, unsupported control characters, or invalid file scope) so agents no longer misinterpret read-only `scope: []` failures.
- **Automated prompt submission (`paste` → `submit`) reliability**:
  - Installed and enabled `@xterm/addon-unicode11` (`activeVersion = '11'`) so wide characters and emojis (e.g. `👋`) match CLI cell widths and no longer leave stale characters in front of the cursor that broke `draftTail` matching.
  - Ignored TUI box-drawing gutters (`│`, `┃`) and right-edge scroll arrows (`↑`, `↓`) when verifying pasted drafts, added support for wrapped collapsed paste tokens in narrow panes, enabled `isPastedDraft` verification for OpenCode, and increased `PASTE_REPAINT_TIMEOUT_MS` from `1500ms` to `3000ms`.
- **Mandatory worker reporting & run completion**:
  - Placed the `team_report_result` instruction with `run_id` and `task_id` at the end of every worker `task_prompt` (so `draftTail` is always clean ASCII) and strengthened MCP server/tool instructions so leaders cannot instruct workers to skip reporting back.
  - Added automatic runtime enforcement via `on_agent_state`: if a worker finishes its turn (`working` → `done`/`idle`) without calling `team_report_result`, SwarmAgent sends a reminder prompt once and, if still unreported, marks the task failed and delivers the result to the leader instead of hanging for 10 minutes.
  - Released `review_started` immediately when the leader transitions `working` → `done`/`idle`, even if the review completes in under `500ms`.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.2.1_aarch64.dmg`, ad-hoc signed for manual installation; not notarized.

## [0.2.0] - 2026-11-21

### Added

- Restore projects, workspaces, split layouts, and selected panes after quitting.
- Save exact conversation IDs per pane to resume Claude Code, Codex, OpenCode v2, and Antigravity sessions. When no ID is known, choose a conversation or start a new one rather than guessing.
- Resume a conversation from the pane's agent menu and browse Antigravity sessions.
- Resize the projects sidebar.

### Notes

- Codex session capture requires trusting the SwarmAgent hooks; Antigravity captures an ID after a user message.
- Terminal processes and Agent Team runs are not restored. No shell commands or prompts are replayed.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.2.0_aarch64.dmg`, ad-hoc signed for manual installation; not notarized.

## [0.1.6] - 2026-11-21

### Changed

- Added distinctive colors and icons to the project and workspace tree, and color-coded agent names in the sidebar and workspace composer.
- Simplified Appearance settings, renamed themes, and made WebGL the default renderer with automatic DOM fallback.
- Moved Run History above Token Usage in Settings and enlarged the header branding.
- The Agent Team header's × now clears members and runs after confirmation; the title-bar button shows or hides the panel. Clearing cancels pending deliveries without closing terminals.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.1.6_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.1.5] - 2026-11-21

### Changed

- Create a project using the **+** beside the Projects heading. Right-click a project or use its **⋮** menu to create a workspace.
- Right-click a workspace to rename or close it, using the same actions as its **⋮** menu.
- Suppress the default WebView context menus throughout the app.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.1.5_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.1.4] - 2026-11-21

### Added

- Organize terminals in a **Project → Workspace → Terminal** sidebar. Each project can contain multiple independently arranged workspaces sharing its working folder.
- Switch workspaces without closing their terminals or restarting their agent sessions. Sidebar rows show the agent logo and name.
- Choose any number of terminals from 1 to 12 when creating a project or workspace.

### Changed

- The Agent Team panel now slides and fades when opened or closed, matching the Projects sidebar. Agent Teams remain scoped to individual workspaces.
- Token usage is grouped by project; Agent Team run history remains grouped by workspace.
- Projects and workspaces remain in memory only and are not restored after quitting the app.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.1.4_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.1.3] - 2026-11-21

### Added

- Added an **iTerm2 Dark** appearance preset with a dark terminal palette, steady orange cursor, and an optional JetBrainsMono Nerd Font Mono typography preset.
- Added a WebGL / DOM text renderer selector for iTerm2 Dark. Switching renderers preserves open terminal sessions and their contents.
- Added a terminal rendering sample for comparing regular and bold text, ANSI colors, and RGB colors across terminal apps.

### Changed

- The iTerm2 Dark preset uses heavier terminal text and a minimum contrast ratio for improved readability. Other themes retain their existing rendering settings.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.1.3_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.1.2] - 2026-11-20

### Fixed

- Selecting the current agent in a pane now restarts it in a fresh session instead of doing nothing. The pane keeps its folder and shell; other panes are unaffected.
- Restarting a resumed session starts fresh instead of reopening the old conversation.

### Changed

- The selected agent is marked **Restart** in the pane's agent menu.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.1.2_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.1.1] - 2026-11-20

### Fixed

- On macOS, remove the leftover restart job from the local 0.1.0 install so it no longer brings SwarmAgent to the foreground every 45 seconds.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.1.1_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.1.0] - 2026-11-20

### Added

- **Settings → Run History** shows total, finished, and active Agent Team runs across all open workspaces, with total and finished counts for each workspace.
- **Clear** on a workspace row removes only that workspace's runs. **Clear all runs** removes runs across all open workspaces. Both actions ask for confirmation and include unfinished runs; history is not automatically pruned.
- Clearing active runs cancels queued task handoffs and result delivery. Agents that already received work can keep running. Team membership, agent chat history, and project files are not cleared.

### Changed

- Updated the README with the multi-agent coding workspace description, an Agent Team demo and quick start, and an overview of Token Usage.

## [0.0.2] - 2026-11-20

### Added

- Claude Code can lead or receive Agent Team assignments alongside Codex, Antigravity, and OpenCode.

### Changed

- Agent Team activates when the first pane joins and deactivates when the last member leaves. Delegation still starts with an explicit request.
- The member list shows Working in red, Needs input in purple, and MCP pending in warning yellow. Ready stays green and Unsupported stays gray.

### Fixed

- Codex launched from Finder can discover its supported `--no-daemon` flag through the Node.js executable on the agent search path. This lets the pane authenticate with the local MCP server.
- The MCP bridge treats missing, blank, and unexpanded environment values as inactive.
- Agent Team recognizes Claude Code's collapsed paste marker and holds automated input while a CLI is waiting for confirmation.

### Release Downloads

- **macOS (Apple Silicon)** — `SwarmAgent_0.0.2_aarch64.dmg`, ad-hoc signed for manual installation.

## [0.0.1] - 2026-11-20

Initial release of **SwarmAgent** — one workspace for your coding agents.

### Added

- **Agent Team Coordination**: Drag open agent panes into a workspace team, assign distinct member identities, and delegate tasks across CLIs (**Codex**, **Antigravity**, and **OpenCode**) via an authenticated local MCP server and stdio bridge.
- **Result Routing**: Automatically queues worker results back to the original leader when tasks complete, fail, or time out.
- **Agent Team UI & State**: Added `AgentTeamPanel`, Agent Team state stores (`agent-team-store`, `team-panel-store`), composer/delivery/drop/shell-quoting utilities, and Tauri IPC commands.
- **Documentation & Guidelines**: Updated `README.md`, `docs/user-guide.md`, `docs/architecture.md`, `docs/release-process.md`, and added `AGENTS.md`.

### Changed

- **SwarmAgent Branding & Configuration**: Updated app icons, tray icons, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, hooks, statusline, sessions, token cache, telemetry, and build/release scripts for SwarmAgent (`0.0.1`).

### Removed

- Removed legacy WarRoom, Git/Worktree, Broadcast, and Browser/Preview components, stores, utilities, Rust handlers, and deprecated docs.

### Release Downloads

- **macOS (Apple Silicon / `aarch64`)**: `SwarmAgent_0.0.1_aarch64.dmg` (unsigned / ad-hoc signed local build)

[0.1.3]: https://github.com/ThanhMiLa/swarm-agent/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ThanhMiLa/swarm-agent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ThanhMiLa/swarm-agent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ThanhMiLa/swarm-agent/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/ThanhMiLa/swarm-agent/releases/tag/v0.0.2
[0.0.1]: https://github.com/ThanhMiLa/swarm-agent/releases/tag/v0.0.1
