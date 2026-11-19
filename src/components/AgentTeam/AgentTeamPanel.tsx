import { useState, type FormEvent, type ReactElement } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Copy, Pencil, Users, X } from 'lucide-react'
import { AGENT_TEAM_DROP_ID } from '@/lib/agent-team-drop'
import { templateById } from '@/lib/templates'
import { cn } from '@/lib/utils'
import { writeClipboard } from '@/tauri/clipboard'
import { editTeam } from '@/tauri/agent-team'
import { useAgentTeamStore } from '@/store/agent-team-store'
import { useTeamPanelStore } from '@/store/team-panel-store'
import { useAppStore } from '@/store/app-store'
import { useAgentStateStore } from '@/store/agent-state-store'
import { AgentIcon } from '@/components/AgentIcon'

const resultStatus = {
  ready: 'Waiting for leader',
  pasting: 'Sending to leader',
  submitting: 'Sending to leader',
  sent: 'Sent to leader',
  closed: 'Could not send to leader'
}

type MemberStatus = 'Unsupported' | 'MCP pending' | 'Needs input' | 'Working' | 'Ready'

const memberStatusColor: Record<MemberStatus, string> = {
  Ready: 'text-emerald-500',
  Working: 'text-red-400',
  'Needs input': 'text-purple-400',
  'MCP pending': 'text-amber-400',
  Unsupported: 'text-muted-foreground'
}

const iconButton = 'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground'
const supported = new Set(['codex', 'antigravity', 'opencode', 'claude-code'])

export function AgentTeamPanel({ workspaceId }: { workspaceId: string }): ReactElement {
  const team = useAgentTeamStore((s) => s.snapshot.teams.find((item) => item.id === workspaceId))
  const connected = useAgentTeamStore((s) => s.snapshot.connected)
  const holds = useAgentTeamStore((s) => s.holds)
  const error = useAgentTeamStore((s) => s.errors[workspaceId])
  const agentStates = useAgentStateStore((s) => s.byId)
  const drop = useDroppable({ id: AGENT_TEAM_DROP_ID })
  const [view, setView] = useState<'members' | 'runs'>('members')
  const [draft, setDraft] = useState<{ memberId: string; name: string }>()
  const members = team?.members ?? []
  const runs = team?.runs ?? []

  function onError(error: unknown): void {
    useAgentTeamStore.getState().setError(workspaceId, String(error))
  }

  async function update(edit: Parameters<typeof editTeam>[0]): Promise<boolean> {
    useAgentTeamStore.getState().setError(workspaceId, null)
    try {
      await editTeam(edit)
      return true
    } catch (error) {
      onError(error)
      return false
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    if (!draft || !draft.name.trim()) return
    void update({ kind: 'renameMember', teamId: workspaceId, ...draft })
      .then((saved) => { if (saved) setDraft(undefined) })
  }

  return (
    <section ref={drop.setNodeRef} className={cn(
      'flex h-full min-w-0 flex-col overflow-hidden', drop.isOver && 'ring-2 ring-inset ring-primary'
    )}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Users size={15} className="shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Agent Team</h2>
        <button type="button" aria-label="Hide Agent Team" className={iconButton} onClick={() => useTeamPanelStore.getState().setOpen(false)}><X size={14} /></button>
      </header>

      <div className="flex shrink-0 gap-3 border-b border-border px-3">
        {(['members', 'runs'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={view === tab}
            className={cn('border-b-2 py-2 text-xs font-medium', view === tab
              ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            onClick={() => setView(tab)}
          >
            {tab === 'members' ? `Members · ${members.length}` : `Runs · ${runs.length}`}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="px-3 pt-2 text-xs text-destructive [overflow-wrap:anywhere]">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [overflow-wrap:anywhere]">
        {view === 'members' ? <>
          {members.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              Drag agent panes from this workspace here to add them.
            </p>
          )}
          {members.map((member) => {
            const state = agentStates[member.terminalId]?.state
            const ready = supported.has(member.agentId) && connected[member.memberId]
            const label: MemberStatus = !supported.has(member.agentId) ? 'Unsupported'
              : !ready ? 'MCP pending'
              : state === 'blocked' ? 'Needs input' : state === 'working' ? 'Working' : 'Ready'

            if (draft?.memberId === member.memberId) return (
              <form key={member.memberId} className="flex items-center gap-1 border-b border-border py-2" onSubmit={save}>
                <input
                  autoFocus
                  aria-label="Member name"
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setDraft(undefined) } }}
                />
                <button className="px-1.5 text-xs" disabled={!draft.name.trim()}>Save</button>
                <button type="button" aria-label="Cancel rename" className={iconButton} onClick={() => setDraft(undefined)}><X size={13} /></button>
              </form>
            )

            return (
              <div key={member.memberId} className="flex min-w-0 items-center gap-1.5 border-b border-border py-1.5 last:border-b-0">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={`Open ${member.name} · ${templateById(member.agentId).name}`}
                  onClick={() => useAppStore.getState().revealTerminal(member.terminalId)}
                >
                  <AgentIcon template={templateById(member.agentId)} className="size-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{member.name}</span>
                    <span className={cn('block truncate text-[11px]', memberStatusColor[label])}>{label}</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center">
                  <button type="button" className={iconButton} title="Rename" aria-label={`Rename ${member.name}`} onClick={() => setDraft({ memberId: member.memberId, name: member.name })}><Pencil size={13} /></button>
                  <button type="button" className={iconButton} title="Copy name" aria-label={`Copy ${member.name}`} onClick={() => void writeClipboard(member.name).catch(onError)}><Copy size={13} /></button>
                  <button type="button" className={iconButton} title="Remove" aria-label={`Remove ${member.name}`} onClick={() => void update({ kind: 'leave', terminalId: member.terminalId })}><X size={14} /></button>
                </div>
              </div>
            )
          })}
        </> : <>
          {runs.length === 0 && <p className="p-1 text-xs text-muted-foreground">{members.length > 0 ? 'Ask a member to delegate to start a run.' : 'Add a member to start a run.'}</p>}
          {[...runs].reverse().map((run, index) => (
            <details key={run.id} className="mb-2 rounded-md border border-border p-2 text-xs" open={index === 0}>
              <summary className="cursor-pointer font-medium">{run.leader} · {run.results.length}/{run.tasks.length} resolved</summary>
              <button type="button" className="my-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => useAppStore.getState().revealTerminal(run.leaderTerminalId)}>Open leader pane</button>
              <p className="whitespace-pre-wrap break-words">{run.plan}</p>
              {run.tasks.map((task) => {
                const result = run.results.find((item) => item.taskId === task.id)
                return (
                  <div key={task.id} className="mt-2 border-t border-border pt-2">
                    <p className="font-medium">{task.worker} · {task.status.replace('_', ' ')}</p>
                    <p className="break-words text-muted-foreground">{task.scope.length ? task.scope.join(', ') : 'Read-only'}</p>
                    {(holds[task.id] ?? task.note) && <p className="text-muted-foreground">{holds[task.id] ?? task.note}</p>}
                    {task.report && <>
                      <p className="whitespace-pre-wrap break-words">{task.report.summary}</p>
                      {task.report.files.map((path, index) => <p key={index} className="break-words font-mono">{path}</p>)}
                      {task.report.tests.map((test, index) => <p key={index} className="break-words">{test}</p>)}
                    </>}
                    {result && (
                      <p className="mt-1 text-muted-foreground">{holds[result.id] ?? result.note ?? resultStatus[result.stage]}</p>
                    )}
                  </div>
                )
              })}
            </details>
          ))}
        </>}
      </div>
    </section>
  )
}
