<div align="center">

<img src="docs/images/swarm-agent.png" alt="SwarmAgent logo" width="96" height="96">

# SwarmAgent

**One workspace for your coding agents.**

[![Version](https://img.shields.io/badge/version-0.0.2-2563eb)](https://github.com/ThanhMiLa/swarm-agent/releases/tag/v0.0.2)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

</div>

SwarmAgent is a desktop terminal workspace for coordinating coding agents
across different CLIs. Each workspace has one Agent Team. Drag open agent
panes into it, name them, and ask one to delegate. SwarmAgent sends each
worker’s result back to the original leader as that task finishes.

Agent Team supports **Codex**, **Antigravity**, **OpenCode**, and **Claude Code**. Each pane
has its own identity, so two panes running the same CLI can receive separate
assignments.

## Download

Get the [macOS Apple Silicon DMG](https://github.com/ThanhMiLa/swarm-agent/releases/tag/v0.0.2) from GitHub Releases. This build is ad-hoc signed and installed manually.

## Run from source

Install Node.js, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
git clone https://github.com/ThanhMiLa/swarm-agent.git
cd swarm-agent
npm install
npm run tauri dev
```

Open a Git checkout and add agent panes to the workspace's team. The team
activates automatically when the first member joins. To delegate, send an
explicit request from any member.

> [TEAM] Send "hello" to "antigravity-1" and ask it to report back.

See the [user guide](docs/user-guide.md) for setup, shortcuts and troubleshooting, or the [architecture](docs/architecture.md) for the Agent Team lifecycle.
