# SwarmAgent user guide

Everything the [README](../README.md) summarises, in detail: workspaces and panes,
running several agents at once, Agent Team,
settings, keyboard shortcuts, troubleshooting and current limits.

## Create a project and its workspaces

SwarmAgent opens the **New project** composer: pick a folder, choose how many terminals, and assign AI agents with the steppers. Unassigned panes are plain shells; unavailable agents are greyed out. Press `⌘/Ctrl + Enter` to create the project and its first workspace.

Right-click a project (or use its **⋮** menu) and choose **New workspace** to add another terminal layout in the same folder. Use **+** beside the Projects heading to add another project. Switching workspaces hides the old layout without stopping its terminals; switch back to continue in the same sessions. Agent detection re-runs whenever the composer opens.

On relaunch, SwarmAgent restores projects, workspaces, the split layout, and the selected pane. It starts fresh terminal processes and resumes conversations by their exact saved IDs. It never reruns typed shell commands, sends prompts, or picks the most recent chat on its own. If a pane has no reliable saved ID, choose a session there or start a new conversation. You can also open **Resume a conversation…** from the agent menu on the pane.

Automatic session tracking covers Claude Code (lifecycle hooks), Codex (review and trust the SwarmAgent hooks using `/hooks`), OpenCode v2 (TUI plugin), and Antigravity (after it records a user message). Other CLIs can resume if the conversation was explicitly selected and the CLI supports resume by ID. SwarmAgent saves only the ID and layout metadata, not chat contents.

## Panes

- **Split** from the pane header, drag the separator to resize, and drag a header onto another pane to swap the two — shells keep running.
- Closing a pane closes the gap; closing the last pane closes the workspace.
- The sidebar groups terminals under **Project → Workspace → Terminal**. Expand or collapse a branch independently; click a workspace to show its layout or a terminal row to jump to that pane. Terminal rows show the agent logo and name, not the session title. `⌘/Ctrl + B` hides the sidebar.
- A pane can switch to a different agent, shell or folder from its header menu — note this restarts the shell.

## Running several agents at once

- **Activity dots** light up while a pane produces output, so you can see who is working — for agent panes this becomes the richer [agent state dot](#agent-state-dots) instead (every agent except OMP, which keeps the plain dot).

## Agent state dots

An agent pane shows a coloured dot instead of the plain activity dot: **red** — the agent is blocked and needs your input (a permission prompt, a question); **yellow** — it's working; **green** — it finished while you were looking elsewhere, and clears the moment you focus that pane; **no dot** — idle, nothing to report. Right after a pane spawns (and again if the agent process exits) state is briefly unknown, so it falls back to the plain output-activity dot until detection catches up. Plain Terminal panes always use that plain dot — they never get colours. One known limit: **OMP** panes also keep the plain dot — its screen exposes no reliable state signals, so SwarmAgent doesn't guess.

**Claude Code** panes also receive exact signals from Claude's own hooks, not just from reading the screen. At every launch SwarmAgent merge-writes `swarm-agent --hook` entries into `~/.claude/settings.json` (the same file as the status line; additive — hooks you already have are never touched). That makes a permission prompt turn the dot red the instant it appears and a finished reply clear it at once, while screen reading still fills the gaps — for example a question Claude asks without a permission prompt.

Inactive or collapsed workspace rows, and collapsed project rows, show the highest-priority dot across their panes — blocked beats done, done beats working, working beats plain activity. Agent Team lists the connection and activity state of each member.

The sidebar header also shows a small counter across **all** workspaces — a red pill for blocked panes and a green one for panes that finished while you were away. Hover any dot to see how long the pane has been in that state ("Blocked for 4m — needs your input"), and hover the red pill to see the longest wait among them. Click a pill, or press `⌘/Ctrl + Shift + J`, to jump to the next pane that needs you: blocked panes first — the one that has waited longest ahead of the rest — then finished (earliest first), then working, then idle in sidebar order, cycling on repeat presses (and switching workspaces when needed). Landing on a finished pane marks it seen, so the green count drops as you go. Hiding the sidebar hides the counter; the shortcut keeps working.

## Notifications

A background agent pane chimes when it blocks (needs your input) or finishes — a short WebAudio tone, so you don't have to keep watching the dots. The chime fires about a second after the state change, and SwarmAgent re-checks at that moment: a blocked flash that resolves itself, or a pane you've since switched to, never sounds. Several panes changing within about half a second share one chime and one banner — a pane that needs your input wins the tone, and the banner lists them ("Claude Code needs your input · Codex finished", "2 Claude Code panes finished").

A system notification (banner) only appears while the SwarmAgent window is **unfocused** — it's sent silent, since the chime is already the audible part; focus the window and you get the chime alone. macOS asks for notification permission the first time a banner would show, and declining it still leaves the chime working.

Turn channels on or off in **Settings → Notifications**: **Sound** and **System notifications** apply everywhere, and a **per-agent** toggle below silences one CLI without touching the others — every agent with a state dot gets a row, and all default to on. A plain Terminal pane has no agent state, but once its shell has **shell integration** set up (see below) it chimes the same way when a command that ran for more than 10 seconds finishes while you were elsewhere — the banner reads "Command finished (42s)" or "Command failed (exit 1 · 42s)" — and the **Terminal** row in the per-agent list turns that off.

## Resume past agent sessions

Picking a working folder also lists that folder's recent Claude Code, Codex, OpenCode and Qwen Code sessions, read from each CLI's own history (never modified). Tick any of them — each reopens as an extra pane, right where the conversation left off. Tabs filter by agent, and "Show all" opens a searchable dialog over the full list.

## Agent Team

Each workspace has a separate Agent Team. Open Claude Code, Codex, Antigravity or OpenCode panes in the same Git checkout. Drag each AI pane into **Agent Team** in the right panel. A plain shell cannot join. **Members** shows the total, the CLI and whether its MCP connection is ready. Panes of the same CLI receive separate names, such as `codex-1` and `codex-2`. Rename or copy a name from the member row.

Agent Team is automatically active whenever at least one member is in the team, and inactive when the team is empty. In any member pane, ask for delegation explicitly. For example:

> [TEAM] Plan the users API and assign the endpoint to "backend" and tests to "tests".

That pane leads this run. A normal request stays solo. If you ask the leader to pick workers, it can choose from connected members. If a named target is ambiguous, the leader should ask you before dispatching.

For a quick connection test, ask `[TEAM] Use Agent Team MCP to send "hello" to "antigravity-1" and have it report "confirm".` A successful handoff appears under **Runs** and in the member pane. If Antigravity shows **MCP tools not loaded**, restart SwarmAgent and reopen the Antigravity pane so it loads the bridge registration. Dismiss any onboarding dialog still covering the input with Esc.

Workers edit the shared checkout and call `team_report_result` with a brief summary, paths and test outcomes. As each task finishes, SwarmAgent queues a separate prompt for the original leader to review. If the leader is busy, the results are sent in order when its composer is ready. **Runs** shows each task’s report and delivery status. A task that has not reported after ten minutes is marked timed out, and the interactive CLI stays open. If the leader has closed, read the available results under **Runs**.

**Settings → Run History** shows the total and finished Agent Team runs across all open workspaces, with a breakdown by workspace. Use **Clear** on a row to remove all runs for that workspace, or **Clear all runs** to remove them across every open workspace. Both actions ask for confirmation, remove active runs too, and cancel their queued tasks and result deliveries. They do not interrupt a terminal write already in progress, stop work already sent to a CLI, undo changes, or clear agent chat history. If a prompt was pasted but not submitted when you cleared its run, discard the leftover draft in that pane.

## Status line in Claude Code panes

Every Claude Code pane gets a one-line readout under its prompt:

```
mcp ✓  ·  ctx 84k/200k 42%
```

The left half tells you whether Claude actually connected to SwarmAgent — and therefore has the app’s MCP tools: `✓` connected, `…` never reached SwarmAgent (tools missing), `✗` SwarmAgent no longer answering. The right half is the session's context window — tokens used, limit, percentage — amber past 70 %, red past 90 %.

Toggle it in **Settings → Terminal**. SwarmAgent merge-writes the entry into `~/.claude/settings.json` and never touches a status line you already have.

The pane header mirrors the percentage as a small `ctx 63%` chip (same amber / red bands) once the first reply lands, so you can compare panes without reading each status line. It needs the status line enabled — that is where the number comes from — and disappears on `/clear`, when `claude` exits, and on very narrow panes.

## Terminal essentials

- **Real PTYs with 24-bit truecolor** — agent CLIs, emoji and box drawing render exactly as in your normal terminal, and IMEs (Vietnamese Telex, CJK) work without dropped characters.
- `⌘/Ctrl + C` copies when text is selected and otherwise interrupts; `⌘/Ctrl + V` pastes — like VS Code.
- **Programs can copy to your clipboard** — nvim `"+y`, tmux `set -s set-clipboard on`, yazi and `gh` copy through OSC 52, exactly as in VS Code's terminal. Only writes are honoured: a program can never read your clipboard.
- **Click a URL** to open it in your browser; `⌘/Ctrl + click` a file path (`src/foo.ts:42:9`, `src/foo.ts(42,9)`, `File "x.py", line 42`) to open it in your editor at that line. Nothing is ever opened with the OS default app, so a mis-click on a `.sh` or `.exe` can never run it.
- **Drop a file or folder** onto a pane to insert its path, quoted for that pane's shell.
- **Choose your shell** — PowerShell, cmd, PowerShell 7, Git Bash on Windows; zsh, bash, fish on macOS/Linux — per pane, or as a default in Settings.

## Shell integration

A plain Terminal pane has no agent, so SwarmAgent cannot tell when a command you typed has finished — unless your shell says so. If it emits the standard **OSC 133** prompt marks (the same ones VS Code, WezTerm, Ghostty, kitty and Windows Terminal read), SwarmAgent follows each command from prompt to exit and uses that to notify you when a command that ran for more than 10 seconds finishes in a pane you weren't watching (see §Notifications). Nothing is injected into your shell: add the snippet for yours, guarded so it only runs inside SwarmAgent (`SWARM_AGENT_SESSION` is set in every pane). If you already use another terminal's shell integration that emits these marks, there is nothing to add.

**zsh** (`~/.zshrc`)

```zsh
if [[ -n $SWARM_AGENT_SESSION ]]; then
  __swarm_agent_precmd()  { printf '\033]133;D;%s\a\033]133;A\a' "$?"; }
  __swarm_agent_preexec() { printf '\033]133;C\a'; }
  precmd_functions+=(__swarm_agent_precmd)
  preexec_functions+=(__swarm_agent_preexec)
fi
```

**bash** (`~/.bashrc`; bash ≥ 4.4 for `PS0`)

```bash
if [[ -n $SWARM_AGENT_SESSION ]]; then
  __swarm_agent_prompt() { printf '\033]133;D;%s\a\033]133;A\a' "$?"; }
  PROMPT_COMMAND="__swarm_agent_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  PS0='\[\e]133;C\a\]'"$PS0"
fi
```

**fish** (`~/.config/fish/config.fish`)

```fish
if set -q SWARM_AGENT_SESSION
    function __swarm_agent_prompt --on-event fish_prompt
        printf '\e]133;A\a'
    end
    function __swarm_agent_preexec --on-event fish_preexec
        printf '\e]133;C\a'
    end
    function __swarm_agent_postexec --on-event fish_postexec
        printf '\e]133;D;%s\a' $status
    end
end
```

**PowerShell 7** (`$PROFILE`; the least-tested of the four — `cmd.exe` has no equivalent)

```powershell
if ($env:SWARM_AGENT_SESSION) {
  $global:__swarm-agentPrompt = $function:prompt
  function global:prompt {
    $code = [int](-not $?)
    "$([char]27)]133;D;$code`a$([char]27)]133;A`a" + (& $global:__swarm-agentPrompt)
  }
  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
    [Console]::Write("$([char]27)]133;C`a")
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
  }
}
```

The marks are `A` (prompt drawn), `C` (command started) and `D;<exit>` (command ended); `B` (end of prompt) is optional and omitted above. The very first prompt's `D` is ignored, and a machine you `ssh` into without the snippet simply sends nothing until you are back.

## Settings, tray and quitting

**Settings** (from the navbar) covers appearance, terminal font and default shell with a live preview, the status line toggle, and the full shortcut list — these preferences persist between launches.

**Closing the window hides SwarmAgent to the tray** and everything keeps running; tray → **Quit** is what actually exits. Launching a second copy just focuses the window you already have. On Windows, closing a pane kills the entire process tree it started — no orphaned build servers.

## Updates

SwarmAgent quietly checks GitHub Releases for a newer version shortly after launch, then every few hours while it stays open. When one exists, an **Update to vX.Y.Z** button appears at the bottom of the navbar, under Settings — nothing downloads until you click it. The button shows download progress, then turns into **Restart to update** (on Windows the installer takes over and relaunches the app itself). No update, no button — that's the whole notification. To check on demand, use tray → **Check for Updates…** — that one also tells you when you're already up to date, in a native dialog. Offline or flaky network? The automatic check stays silent; it never nags.

## Telemetry

Official release builds send an anonymous usage ping so we can see how many
people actually run SwarmAgent: one `app_open` event at launch, then a
heartbeat every five minutes while the app is open. Each event carries a
random id, the app version and the OS name (`macos` / `windows` / `linux`) —
nothing else. No paths, no terminal content, no hostname, no account.
Google Analytics infers a country from the request's IP, as any website does;
SwarmAgent never sends the IP itself.

The random id lives in one small file so restarts count as the same person —
`~/Library/Application Support/com.swarm-agent.app/telemetry-id` on macOS,
`%APPDATA%\com.swarm-agent.app\telemetry-id` on Windows,
`~/.config/com.swarm-agent.app/telemetry-id` on Linux. Delete it any time to
start over as a new anonymous user.

**Builds from source contain no telemetry at all.** The analytics keys are
injected only when official releases are built; compile SwarmAgent yourself
(`npm run tauri dev` or `npm run tauri build`) and the reporting code
compiles to nothing. Offline use is fine too — a failed ping is silently
dropped, never retried loudly, and never blocks the app.

## What your agents can do

SwarmAgent configures MCP for Claude Code, Codex, Qwen Code, Antigravity and OpenCode. Claude Code, Codex, Antigravity and OpenCode can use the Agent Team tools to list members, dispatch tasks, and report results.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘/Ctrl + B` | Show or hide the sidebar |
| `Esc` | Close Settings |
| `⌘/Ctrl + Enter` | Create the project or workspace from the composer |
| `Shift + Enter` | Insert a line break in supported terminal apps and agent prompts |
| `⌘/Ctrl + C` · `⌘/Ctrl + V` | Copy (when text is selected) · paste |
| `⌘/Ctrl + Click` | Open a file path in your editor, at that line |
| `⌘/Ctrl + F` | Find in the focused terminal · press again to re-select the query · `Esc` closes it |
| `⌘/Ctrl + Shift + J` | Jump to the next pane needing attention (longest-waiting blocked → done → working → idle) |

On macOS the modifier is `⌘`, which deliberately leaves `Ctrl + B` to the terminal for tmux.

## Troubleshooting

- **An agent is greyed out in the composer** — its CLI isn't on your `PATH`; install it and reopen the composer.
- **An agent says its execute was refused** — the target pane is blocked on a permission or question; answer that prompt (or let the sending agent `wait_peer`) and the hand-off goes through on re-send.
- **A relative path isn't clickable after `cd`** — a PowerShell quirk; absolute paths (everything agents print) still work.
- **The app disappeared** — it's in the tray; click the icon to bring it back.

## Known limits

- **Terminal process state and Agent Team runs aren't restored** after quitting; saved workspace layouts and known conversation IDs are restored.
- **Visual styles** — VS Code Dark Modern and Terminal Black (pure black); a light theme is on the list.
- **Agent Team membership doesn't survive a pane restart** — re-drag the pane.
- **Terminal search covers the visible scrollback only** — matches beyond xterm's own buffer, and search-and-replace, aren't available.
- **Linux** is implemented but less tested than Windows and macOS.
- **Claude Code hooks are written at every launch** — the `swarm-agent --hook` entries in `~/.claude/settings.json` are re-checked on each boot (no write when nothing changed; your own hooks are left alone).
- **`claude` started by hand in a plain Terminal pane gets no coloured dot** — only panes created as Claude Code agents are wired to the hooks.
- **After Esc (interrupt) a Claude Code pane can read "working" for up to 30 s** — Claude fires no Stop hook on an interrupt, so the working signal has to time out before screen reading takes over again.
- **Find widget with regex on shows "Invalid regex" while you type** — a pattern that does not parse yet (for example `foo(`) reads **Invalid regex** in the counter and clears the previous highlights until the pattern is valid again. Toggle regex off to search it as literal text.
- **Any program in any pane can overwrite the clipboard via OSC 52** — like VS Code, there is no per-pane gate. Reads are refused and empty writes never clear it; copies larger than 1 MiB are ignored.
- **Shell integration is opt-in** — a hand-typed command in a plain Terminal pane is only noticed if that shell emits OSC 133 marks (§Shell integration). Nothing is injected, `cmd.exe` cannot do it, and an interrupted command that redraws the prompt without a `D` mark is simply forgotten.
