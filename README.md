<div align="center">

<img src="docs/images/swarm-agent.png" alt="SwarmAgent logo" width="101" height="101">

# SwarmAgent

### Desktop workspace for multi-agent coding

[![Version](https://img.shields.io/badge/version-0.2.7-22c55e)](CHANGELOG.md#027---2026-11-27)
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

## Features

### Split terminal panes and Agent Team

Run agents side by side in one workspace, see their status, and delegate tasks
across Codex, Antigravity, OpenCode, and Claude Code with **Agent Team**.

<img src="docs/images/fullscreen-main-desk.png" alt="SwarmAgent workspace with four terminal panes, an Agent Team roster, and a summary of worker results" width="100%">

### Token usage tracking

Track input, output, and cached tokens by provider, with daily usage and
estimated costs.

<img src="docs/images/screen-token-usage.png" alt="SwarmAgent Token Usage settings with token counts, estimated costs, and daily usage history" width="100%">

## Get started

Download the [macOS Apple Silicon DMG](https://github.com/ThanhMiLa/swarm-agent/releases/latest)
or [Windows x64 installer](https://github.com/ThanhMiLa/swarm-agent/releases/latest)
from GitHub Releases. Builds are currently unsigned (ad-hoc signed on macOS;
on Windows, click **More info → Run anyway** if SmartScreen warns, or turn off
**Smart App Control** if Windows 11 blocks unsigned installers).
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
