import type { ReactElement } from 'react'
import { AgentTeamPanel } from '@/components/AgentTeam/AgentTeamPanel'
import { useTeamPanelStore } from '@/store/team-panel-store'

export function RightPanel({ workspaceId }: { workspaceId: string }): ReactElement | null {
  const open = useTeamPanelStore((s) => s.open)
  if (!open) return null

  return (
    <aside className="h-full w-[var(--workspace-sidebar-width)] shrink-0 border-l border-border bg-background">
      <AgentTeamPanel workspaceId={workspaceId} />
    </aside>
  )
}
