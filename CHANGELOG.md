# Changelog

All notable changes to **SwarmAgent** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.1]: https://github.com/ThanhMiLa/swarm-agent/releases/tag/v0.0.1
