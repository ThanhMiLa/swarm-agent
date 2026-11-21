import { useEffect, useState, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { isValidSessionId } from '@/lib/resume-command'
import { mergeSessions, type AgentSessionEntry } from '@/lib/agent-sessions'
import { templateById } from '@/lib/templates'
import { listAgentSessions } from '@/tauri/sessions'

export function ConversationPicker({
  agentId, cwd, onChoose, onCancel
}: {
  agentId: string
  cwd: string
  onChoose: (id?: string, directory?: string) => void
  onCancel?: () => void
}): ReactElement {
  const [sessions, setSessions] = useState<AgentSessionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [typedId, setTypedId] = useState('')
  const template = templateById(agentId)
  const canList = Boolean(template.sessionScanner && cwd)

  useEffect(() => {
    if (!canList) return
    let current = true
    setLoading(true)
    void listAgentSessions(cwd)
      .then((items) => {
        if (current) setSessions(mergeSessions(items.filter((item) => item.agentId === agentId), {}))
      })
      .catch(() => {})
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [agentId, canList, cwd])

  return (
    <div
      data-terminal-session-picker
      className="absolute inset-0 z-10 overflow-auto bg-background"
    >
      <div className="mx-auto flex max-w-sm flex-col gap-3 p-4">
        <div>
          <h3 className="text-sm font-medium">Restore {template.name} conversation</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {onCancel
              ? 'Choose a conversation or start a new one. This will restart the agent in this pane.'
              : 'No exact session was saved for this pane. Choose a conversation or start a new one.'}
          </p>
          {!onCancel && agentId === 'codex' && (
            <p className="mt-1 text-xs text-muted-foreground">
              In Codex, review and trust the SwarmAgent session hook via <code>/hooks</code> to save future sessions automatically.
            </p>
          )}
        </div>
        {canList && (loading || sessions.length > 0) && (
          <div className="max-h-36 space-y-1 overflow-auto">
            {loading && <p className="text-xs text-muted-foreground">Looking for sessions…</p>}
            {sessions.map((session) => (
              <button
                type="button"
                key={session.sessionId}
                title={session.title}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => onChoose(session.sessionId, session.cwd)}
              >{session.title}</button>
            ))}
          </div>
        )}
        {template.resume && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (isValidSessionId(agentId, typedId.trim())) onChoose(typedId.trim())
            }}
          >
            <input
              aria-label="Agent session ID"
              placeholder="Paste session ID"
              className="min-w-24 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
              value={typedId}
              onChange={(event) => setTypedId(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={!isValidSessionId(agentId, typedId.trim())}>Resume</Button>
          </form>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChoose()}>
            Start new conversation
          </Button>
          {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        </div>
      </div>
    </div>
  )
}
