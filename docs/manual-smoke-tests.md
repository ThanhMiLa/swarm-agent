# Manual smoke tests

Run this by hand before a release, or after touching pty, focus, Agent Team or
workspace code. Start with `npm run tauri dev`.

## Basics

- [ ] Launch → create a project with one workspace and one terminal; run a command and see output.
- [ ] Split a pane horizontally and vertically; drag the separator; close a
      pane → the tree collapses.
- [ ] Drag a pane header onto another pane → the two swap, shells stay alive.
- [ ] Sidebar shows one tree: Project → Workspace → Terminal. Add another workspace with three
      terminals via the project right-click menu and again via its ⋮ menu; each uses the
      project folder without asking to pick it again. Add a project using the + in the header.
      Rename and
      drag-reorder projects and workspaces; a workspace cannot be dragged into another project.
- [ ] Right-click a project or workspace → its action menu opens. Right-click terminal
      rows, terminal content, inputs and empty sidebar space → no native WebView menu appears.
- [ ] Start a long command in one workspace and adjust its split sizes. Switch to a sibling,
      then return: the command is still running and the split sizes and focus are unchanged.
- [ ] Collapse a workspace or project; its terminals stay alive. Close a workspace and
      verify sibling terminals stay alive. Close a project, confirm, and verify only its terminals stop.
- [ ] Composer: native folder picker returns the right path, recent folders
      work, agent steppers allocate correctly, the layout preview matches the
      result, `⌘/Ctrl + Enter` creates the project or workspace.
- [ ] Sidebar terminal rows show agent logo and name even when a session title changes.
      Clicking a row in another workspace activates that workspace and focuses the pane.
- [ ] Drag the right edge of Projects to resize it. The rail follows the pointer;
      terminals fit on release without reflowing during the drag. Hide/show keeps
      its animation and the chosen width; restart restores that width.
- [ ] Close the window → hides to tray (ptys stay alive); tray → Show restores;
      tray → Quit exits and kills every pty.
- [ ] The tray/menu-bar icon shows the box-logo mark (macOS: monochrome
      template that flips with the menu-bar theme; Windows/Linux: the color
      compact tile).
- [ ] Launch a second instance → only focuses the existing window.
- [ ] Custom titlebar renders; dragging it moves the window; edges resize
      (Windows/Linux — macOS uses native traffic lights).
- [ ] Minimize / maximize-restore toggle the right icon state (Windows/Linux).
- [ ] The close button hides to tray without quitting (Windows/Linux).

## Terminal

- [ ] **Truecolor:** run a 24-bit colour CLI → colours are exact, not
      downscaled to 256.
- [ ] **UTF-8:** print emoji, box drawing and accented text in a stream → no
      mojibake.
- [ ] **IME:** type Vietnamese with Telex (or a CJK IME) → no lost or duplicated
      characters; backspace deletes exactly one character, including NFD
      compositions.
- [ ] **Copy/paste:** with a selection `Ctrl/⌘+C` copies; with no selection
      `Ctrl+C` still sends SIGINT; `Ctrl/⌘+V` pastes exactly once.
- [ ] **File drop:** drop a file on a pane → the path is inserted, quoted for
      that pane's shell.
- [ ] **Shell switch:** pick another shell in the pane header → that pane
      respawns with it, other panes are untouched.
- [ ] **Agent restart:** pick the checked agent in the pane header (marked
      **Restart**) → its current process stops and a fresh session opens in
      the same pane with the same folder and shell. Repeat; other panes are
      untouched.
- [ ] **Keyboard focus:** click the titlebar / a tab / a pane header, then type
      immediately → characters reach the terminal; Tab triggers shell
      completion instead of walking the focus ring.
- [ ] **Soft line break:** in Claude Code and Codex prompts, type `line one`,
      press `Shift+Enter`, then type `line two` → both lines remain in the
      composer and nothing runs until plain Enter is pressed. No duplicate
      blank line appears; `Ctrl+J` continues to work as before.
- [ ] **Shortcut isolation:** with terminal Find open, `Shift+Enter` still
      selects the previous match instead of inserting terminal input.
- [ ] **Activity dot:** lights while a pane streams output, clears when quiet.

## Terminal links

- [ ] URL: `echo https://example.com` → hover underlines it; a **plain click**
      opens the default OS browser.
- [ ] Drag-select that URL with the mouse → text selects, no browser opens.
- [ ] Absolute path: `ls $PWD/package.json` → plain click does nothing;
      `⌘/Ctrl + click` opens it in the editor.
- [ ] Relative path with line: `echo "src/lib/terminal-links.ts:15:1"` →
      `⌘/Ctrl + click` opens line 15. Then `cd src`, `echo
      "lib/terminal-links.ts:15"` → still resolves (bash/zsh; not PowerShell —
      see Known limits in the README).
- [ ] Non-existent path: `echo "src/lib/does-not-exist.ts:9"` → no underline,
      click does nothing.
- [ ] OSC 8 from an agent: run `claude` in a pane and have it read a file so it
      prints a path → `⌘/Ctrl + click` opens the right file.

## Settings

- [ ] Settings → Appearance: select **iTerm2 Dark**. Verify open and new panes use
      the dark palette and orange, steady cursor; switch back to restore the previous theme.
- [ ] With the same terminal font and size, switch in and out of **iTerm2 Dark**.
      Check that normal glyphs look slightly heavier and dark text is easier
      to read, including low-contrast truecolor text.
- [ ] Appearance shows only theme cards, including for iTerm2 Dark. WebGL is
      preferred (falling back to DOM when unavailable), even after upgrading from
      a version with DOM selected. Switching themes keeps the terminal font setting.
- [ ] Settings → Terminal: changing font / size / line height / ligatures
      updates the preview and every pane.
- [ ] Settings → Keyboard Shortcuts lists the bindings for the current platform.
- [ ] Settings → Run History: finish a run in each of two workspaces and start another. Verify the total and per-workspace counts.
- [ ] Cancel **Clear** on one workspace and verify nothing changes. Confirm the same action and verify both its finished and active runs disappear from Settings and **Runs** without affecting the other workspace. Use **Clear all runs** to remove the remaining runs.
- [ ] Clear a run with a queued task or result. Verify the queued prompt is not submitted and that any agent already working in a pane is not killed.
- [ ] `⌘/Ctrl + B` toggles the sidebar; `Esc` closes Settings.
- [ ] Restart the app → appearance and terminal preferences are remembered.

## Agent Team

- [ ] Toggle Agent Team from the title bar. The rail slides and fades like Projects;
      terminals fit once the animation settles.
      With reduced motion enabled, the panel opens and closes immediately.
- [ ] Add members and start a run. Cancel the header × confirmation: nothing changes.
      Confirm it: members and runs disappear, pending deliveries are cancelled, the
      panel stays open and terminals keep running. Re-add a member in the same workspace;
      another workspace's team remains untouched.
- [ ] Hide Agent Team, then drag an AI pane. The panel slides open and accepts
      the drop; cancelling a drag restores the panel's previous visibility.
- [ ] Open two workspaces in the same checkout. Give each a member named `codex-1`. Confirm that each panel displays only its own roster and runs.

- [ ] Add three out of four Codex panes in the same checkout. Confirm the count, exact routing by name, duplicate name rejection and stable aliases after removal.
- [ ] Add members to the team (automatically active when non-empty; inactive when empty). A plain prompt stays solo. An explicit team request dispatches once and returns the dispatcher to its input before all workers finish.
- [ ] Use each of Claude Code, Codex, Antigravity and OpenCode as a dispatcher and a worker. Hold one worker back and confirm **Runs** shows the finished worker's report immediately while the dispatcher waits until all workers finish (or **Send results now** is clicked) before receiving one combined review prompt. Reports contain paths and tests, while code appears in the current checkout.
- [ ] Switch tabs or hide the panel during a run. Confirm delivery still works. Check that a typed draft, a permission prompt and a restarted pane prevent automated input into the wrong place.
- [ ] Close a worker or wait for timeout. Confirm partial reports remain available. Close the dispatcher and verify no other pane receives review.
- [ ] Try a linked worktree, remove all members to leave the team empty, and change branches during a queued handoff. Check the resulting rejection or visible status.

## Claude Code status line

- [ ] Open a workspace with a Claude Code agent pane. Within a few seconds of
      the first prompt the line under the input box reads
      `mcp ✓  ·  ctx <n>k/<n>k <n>%`.
- [ ] A fresh Claude session reads `ctx —` until its first reply.
- [ ] In a plain Terminal pane run `claude --strict-mcp-config` → `mcp …`:
      Claude is alive but never called our server.
- [ ] With a Claude pane running, quit SwarmAgent from the tray (Quit, not
      close-to-tray) → the next render reads `mcp ✗`.
- [ ] Run `claude` in a system terminal → the `mcp` segment is absent, only
      `ctx …` renders.
- [ ] Let a session pass 70% context → the `ctx` segment turns amber; past 90%
      → red.
- [ ] Settings → Terminal → Agent status line → off. `statusLine` is gone from
      `~/.claude/settings.json` and every other key survived. Toggle back on →
      it returns, pointing at the current binary.
- [ ] Put your own `statusLine` in `~/.claude/settings.json`, relaunch
      SwarmAgent → it is untouched (a warning is logged to the devtools console).
- [ ] Switch a pane's agent (respawns the pty under the same id) → the line
      drops to `mcp …` until the new Claude connects.

## Session resume (composer)

- [ ] Open two panes of the same agent in the same project, each with a different chat. Quit
      and reopen: both panes resume their own chat by ID and retain the selected pane and split.
      For Codex, approve just the SwarmAgent hooks via `/hooks`; for Antigravity, send at least
      one message before quitting.
- [ ] Restore a pane with no saved ID: it should offer the session picker, not open the newest
      chat. Pick a session, then Quit/reopen; that exact session should reopen automatically.
      Restarting or changing an agent should not carry the previous conversation to the new agent.

- [ ] Pick a folder with prior Claude Code activity → "Resume sessions"
      (below Recent) lists them newest first, with agent icon, relative
      time, and All/Claude Code/Codex/OpenCode/Qwen Code tabs (0-count tabs
      disabled).
- [ ] More than 6 sessions → "Show all (N)" opens the two-column sessions
      dialog (agent rail + search); ticks made there survive Done/Esc and
      tab switches.
- [ ] More than 5 recent folders → Recent shows 5 + "Show all (N)"; it opens
      the Recent-folders dialog — search filters, clicking a row fills
      Working folder and closes, ✕ removes, Esc/backdrop/Done dismiss.
- [ ] Narrow window → session tabs wrap to a second line; rows truncate.
- [ ] Tick one + Create → the new pane runs `claude … --resume <id>` and the
      old conversation is visible.
- [ ] Folder with no sessions → no "Resume sessions" section, composer
      otherwise unchanged.
- [ ] Uninstall/rename an agent CLI → its sessions disappear from the list.
- [ ] Reselect the current agent or switch agents on a resume pane via the
      header dropdown → pane respawns fresh (no resume arguments).

## Agent roster (per agent, requires that CLI installed)

Run this block once per newly supported agent — GitHub Copilot, Qwen Code,
Amp, Gemini CLI, Cursor Agent, Antigravity, OMP — on a machine that has it:

- [ ] Composer shows the agent with its icon; stepper assigns panes; the
      agent list scrolls past ~9 rows without clipping the dialog.
- [ ] Uninstalled CLI → the row is greyed out ("Not installed").
- [ ] Spawn a pane → the CLI starts; state dot turns yellow while it works,
      red on a permission prompt, green when finished in background (OMP:
      plain activity dot only — expected).
- [ ] Per-pane agent switcher lists the agent and respawns onto it.
- [ ] Qwen only: "Resume sessions" lists prior qwen sessions for the folder
      and Create runs `qwen --resume <id>`.

## Signed release (macOS)

Run against the `.dmg` produced by `npm run release:mac`, ideally on a Mac that
has never run SwarmAgent from source. Details in
[`release-macos.md`](release-macos.md).

- [ ] The disk image opens with no Gatekeeper warning after
      `xattr -w com.apple.quarantine "0083;00000000;Safari;" <dmg>`.
- [ ] Dragging to Applications and launching shows no "unidentified developer"
      or "damaged" dialog.
- [ ] A terminal pane spawns and runs `ls`; a split pane spawns a second shell.
- [ ] `echo $SWARM_AGENT_MCP_URL` inside a pane prints a loopback URL.
- [ ] An Agent Team assignment reaches its named pane.
- [ ] Prompts for Desktop/Documents/Downloads access name SwarmAgent and carry a
      readable explanation (the `Info.plist` usage strings).

## Windows release

Run against the installer produced by `npm run release:win`, ideally on a
machine that never built SwarmAgent. Details in
[`release-windows.md`](release-windows.md).

- [ ] A freshly downloaded `…x64-setup.exe` shows SmartScreen's "Windows
      protected your PC"; **More info → Run anyway** proceeds.
- [ ] Install completes per-user with no admin prompt; the app launches.
- [ ] A terminal pane spawns and runs `dir`; closing the pane leaves no
      orphaned shell in Task Manager.
- [ ] Uninstall via Settings → Apps removes the Start Menu entry.

## Auto-update

Needs two published releases (the older installed locally). Full flow in
[`release-process.md`](release-process.md).

- [ ] Install the previous version; within ~10 s of launch the update toast
      appears bottom-left naming the newer version.
- [ ] **Dismiss** hides it; tray → **Check for Updates…** brings it back.
- [ ] **Download** shows progress; macOS then offers **Restart to update**
      and relaunching lands on the new version (check the tray tooltip /
      About); on Windows the installer runs and the app comes back updated.
- [ ] On the freshly updated build, tray → **Check for Updates…** reports
      "SwarmAgent is up to date".
- [ ] With Wi-Fi off, launching the app shows no update UI at all; the tray
      check surfaces a dismissible error toast.

## Telemetry (release builds only)

- [ ] Release build (built with GA keys in `.env.release`): launch, then GA →
      Reports → Realtime shows 1 active user within ~a minute.
- [ ] `npm run tauri dev` (no keys): nothing appears in GA Realtime.

## Agent state detection

- [ ] Claude pane: ask for a long task → dot turns yellow (working) while it runs.
- [ ] Claude pane: trigger a permission prompt (e.g. a Bash command without allow rules) → dot turns red (blocked) within ~1s.
- [ ] Answer the prompt, let the task finish while ANOTHER workspace is active → its workspace tab shows a green dot; switching to it and focusing the pane clears the green.
- [ ] Finish a task while WATCHING the pane → no green dot appears (goes straight to idle).
- [ ] Claude transcript viewer (ctrl+o): state does not flap while it is open.
- [ ] Codex pane: same working / blocked (Action Required) / done pass.
- [ ] OpenCode pane: same working / blocked (Permission required) / done pass.
- [ ] Plain terminal pane: yellow output dot behaves exactly as before.
- [ ] Respawn an agent pane (switch agent) → no stale dot; detection resumes after ~3s.
- [ ] Scroll an agent pane far up during a working task → dot still tracks the live bottom of the buffer.

## Notifications

- [ ] Agent blocks (permission prompt) in a background workspace → chime after ~1 s, no OS banner while the window is focused.
- [ ] Same, but with the window unfocused → chime + silent OS banner ("<Agent> needs your input").
- [ ] Agent finishes in a background pane → completion chime; banner only when window unfocused.
- [ ] Blocked flash that resolves within ~1 s → no chime.
- [ ] Blocked while you are watching that pane → nothing.
- [ ] Settings → Notifications: Sound off → banner still works; System off → chime still works; per-agent off → that agent is fully silent.
- [ ] macOS: first banner triggers the system permission prompt; denying it keeps chimes working.
- [ ] Plain Terminal pane never notifies.
