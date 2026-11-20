<div align="center">

<img src="docs/images/swarm-agent.png" alt="SwarmAgent logo" width="101" height="101">

# SwarmAgent

### Desktop workspace for multi-agent coding

[![Version](https://img.shields.io/badge/version-0.1.1-22c55e)](CHANGELOG.md#011---2026-11-20)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/tauri/tauri-original.svg" width="20" height="20" alt="Tauri"> <img src="https://img.shields.io/badge/Tauri-2-24C8DB" alt="Tauri 2">
<img src="https://img.shields.io/badge/Rust-000000?logo=rust&amp;logoColor=white" alt="Rust">
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" width="20" height="20" alt="React"> <img src="https://img.shields.io/badge/React-19-149ECA" alt="React 19">
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg" width="20" height="20" alt="TypeScript"> <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6" alt="TypeScript 5.8">
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vitejs/vitejs-original.svg" width="20" height="20" alt="Vite"> <img src="https://img.shields.io/badge/Vite-7-646CFF" alt="Vite 7">
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/tailwindcss/tailwindcss-original.svg" width="20" height="20" alt="Tailwind CSS"> <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4" alt="Tailwind CSS 3.4">
<img src="https://raw.githubusercontent.com/xtermjs/xtermjs-branding/master/logo.png" width="20" height="20" alt="xterm.js"> <img src="https://img.shields.io/badge/xterm.js-6-000000" alt="xterm.js 6">
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/zustand/zustand-original.svg" width="20" height="20" alt="Zustand"> <img src="https://img.shields.io/badge/Zustand-5-764ABC" alt="Zustand 5">

<img src="docs/images/main.gif" alt="SwarmAgent demo with two Codex panes, Antigravity, and OpenCode joining an Agent Team and reporting results" width="100%">

</div>

## Coordinate agents in one workspace

Split your workspace into terminal panes and see which agents are working,
finished, or waiting for input. Drag **Codex**, **Antigravity**, **OpenCode**, or
**Claude Code** panes into **Agent Team** to delegate tasks by name. Each pane
has its own identity, so you can assign different work to `codex-1` and
`codex-2` in the same checkout.

<img src="docs/images/fullscreen-main-desk.png" alt="SwarmAgent workspace with four terminal panes, an Agent Team roster, and a summary of worker results" width="100%">

SwarmAgent sends each worker’s report back to the original leader as soon as
it can receive it. Open **Runs** to see individual results and delivery status.
Open **Settings → Run History** to see run counts and clear runs for one
workspace or all open workspaces.

## Track token usage

Open **Settings → Token Usage** to review the selected workspace’s input,
output, and cached tokens. Compare totals and estimated costs by provider,
and use the daily breakdown to see how usage changes over time.

<img src="docs/images/screen-token-usage.png" alt="SwarmAgent Token Usage settings with token counts, estimated costs, and daily usage history" width="100%">

## Get started

Download the [macOS Apple Silicon DMG](https://github.com/ThanhMiLa/swarm-agent/releases/latest)
from GitHub Releases. The build is ad-hoc signed and installed manually.
Install the agent CLIs you want to use so they’re available in the workspace
composer.

1. Open a Git checkout in the composer, choose your agents, and press
   `⌘/Ctrl + Enter` to open the workspace.
2. Drag each agent pane by its header into **Agent Team**. Check **Members**
   for the pane names and wait until they show **Ready**.
3. In the pane you want to lead, send a prompt like this one.

   > [TEAM] Ask codex-2 to verify the quick-start commands and antigravity-1
   > to review the workspace setup steps. Have both report their findings.

4. Open **Runs** to follow the handoffs and read the reports.

## Run from source

Install Node.js, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
git clone https://github.com/ThanhMiLa/swarm-agent.git
cd swarm-agent
npm install
npm run tauri dev
```

## Documentation

- Setup, shortcuts, and troubleshooting in the [user guide](docs/user-guide.md).
- Terminal and Agent Team internals in the [architecture guide](docs/architecture.md).

## License

SwarmAgent is licensed under the [GNU General Public License v3.0](LICENSE).

## Credits

SwarmAgent is based on [Swarmterm](https://github.com/duongducnguyen/swarmterm) by duongducnguyen and further developed by [ThanhMiLa](https://github.com/ThanhMiLa).
