# SwarmAgent architecture

SwarmAgent is a Tauri desktop application. The React interface owns workspace
layouts and terminal panes. The Rust backend owns PTYs, workspace team state,
and the local, authenticated MCP endpoint.

Each workspace exposes one Agent Team. A member's name identifies its pane
within that workspace. A terminal restarted in the same pane gets a new
session generation and MCP credential, so pending prompts cannot reach the
replacement session.

## Agent Team lifecycle

1. Agent Team is active automatically whenever at least one member is in the
   team, and inactive when the roster is empty. A leader uses
   `team_list_members` to find exact member IDs and submits an assignment with
   `team_dispatch`.
2. The backend checks that the panes share a checkout and branch, records the
   tasks, and acknowledges immediately so the leader can finish its turn.
3. SwarmAgent delivers each prompt when its destination is safe to type into.
   The renderer checks the composer before paste and submit. The backend
   checks session generation and ownership of the draft before writing Enter.
4. Workers call `team_report_result` with concise findings, paths and test
   results. Each task queues its own result for the original leader as soon
   as it finishes, including if it fails or times out. The backend exposes
   one result at a time in completion order. The renderer submits each one
   when the leader’s composer is ready.

The endpoint listens on loopback. Claude Code and Codex connect over HTTP.
Antigravity and OpenCode use the same app-owned `--mcp-stdio` bridge. The MCP
tool list contains the three Agent Team tools. Closing a workspace removes its
roster and runs.

See the [user guide](user-guide.md) for usage, the
[smoke tests](manual-smoke-tests.md) for verification, and the
[release process](release-process.md) for packaging.
