import { useState, type ReactElement } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAgentTeamStore } from '@/store/agent-team-store'
import { clearTeamRuns } from '@/tauri/agent-team'

type WorkspaceLabel = { id: string; name: string; cwd: string }

interface RunHistoryPanelProps {
  workspaces: ReadonlyArray<WorkspaceLabel>
}

export function RunHistoryPanel({ workspaces }: RunHistoryPanelProps): ReactElement {
  const snapshot = useAgentTeamStore((state) => state.snapshot)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const runCounts = new Map(snapshot.teams.map((team) => [team.id, team.runs.length]))
  const rows = workspaces.map((workspace) => {
    const total = runCounts.get(workspace.id) ?? 0
    const finished = snapshot.finishedRunCounts[workspace.id] ?? 0
    return { workspace, total, finished }
  })
  const totalRuns = rows.reduce((sum, row) => sum + row.total, 0)
  const finishedRuns = rows.reduce((sum, row) => sum + row.finished, 0)

  async function clearHistory(workspace?: WorkspaceLabel): Promise<void> {
    const scope = workspace ? `workspace “${workspace.name}”` : 'all open workspaces'
    setClearing(true)
    setNotice(null)
    try {
      const confirmed = await confirm(
        `Remove all Agent Team runs from ${scope}, including active runs? This cancels queued handoffs and reports. It won't interrupt a prompt already being sent or an agent already working. Discard any leftover drafts in the terminal instead of submitting them.`,
        { title: 'Clear runs?', kind: 'warning', okLabel: 'Clear runs' }
      )
      if (!confirmed) return
      const removed = await clearTeamRuns(workspace?.id)
      setNotice({
        text: removed === 0
          ? 'No runs to clear.'
          : `Cleared ${removed.toLocaleString()} ${removed === 1 ? 'run' : 'runs'} from ${scope}.`,
      })
    } catch (error) {
      console.error('Failed to clear Agent Team run history:', error)
      setNotice({ text: 'Could not clear run history. Please try again.', error: true })
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Run History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Count Agent Team runs across your open workspaces.
        </p>
      </header>

      <section aria-label="Run totals" className="rounded-xl border border-border bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Total runs</div>
            <div className="text-2xl font-semibold tabular-nums text-foreground">{totalRuns.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">
              {finishedRuns.toLocaleString()} finished · {(totalRuns - finishedRuns).toLocaleString()} active
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => clearHistory()} disabled={clearing || totalRuns === 0}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear all runs
          </Button>
        </div>
        {notice && (
          <p role={notice.error ? 'alert' : 'status'} className="mt-3 text-xs text-muted-foreground">
            {notice.text}
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No workspaces are open.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card/60">
          <table aria-label="Runs by workspace" className="w-full table-fixed text-sm">
            <thead className="border-b border-border bg-accent/30 text-muted-foreground">
              <tr className="text-left">
                <th scope="col" className="px-4 py-2 font-medium">Workspace</th>
                <th scope="col" className="w-24 px-4 py-2 text-right font-medium">Total</th>
                <th scope="col" className="w-24 px-4 py-2 text-right font-medium">Finished</th>
                <th scope="col" className="w-24 px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ workspace, total, finished }) => (
                <tr key={workspace.id}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    <div className="truncate" title={workspace.cwd || workspace.name}>{workspace.name}</div>
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">{total.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{finished.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Clear all runs for ${workspace.name}`}
                      onClick={() => clearHistory(workspace)}
                      disabled={clearing || total === 0}
                    >
                      Clear
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
