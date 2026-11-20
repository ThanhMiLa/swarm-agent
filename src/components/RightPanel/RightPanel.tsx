import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AgentTeamPanel } from '@/components/AgentTeam/AgentTeamPanel'
import { AGENT_TEAM_DROP_ID } from '@/lib/agent-team-drop'
import { beginLayoutTransition, endLayoutTransition } from '@/lib/terminal-registry'
import { cn } from '@/lib/utils'
import { useTeamPanelStore } from '@/store/team-panel-store'

export function RightPanel({ workspaceId }: { workspaceId: string }): ReactElement {
  const open = useTeamPanelStore((s) => s.open)
  const previousOpen = useRef(open)
  const layoutTransition = useRef(0)
  // Measure the visible rail, not the fixed-width content clipped inside it.
  const drop = useDroppable({ id: AGENT_TEAM_DROP_ID, disabled: !open })

  useLayoutEffect(() => {
    if (previousOpen.current === open) return
    previousOpen.current = open
    layoutTransition.current = beginLayoutTransition(220)
  }, [open])

  return (
    <aside
      ref={drop.setNodeRef}
      aria-label="Agent Team"
      aria-hidden={!open}
      inert={!open}
      style={{ width: open ? 'var(--workspace-sidebar-width)' : 0 }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'width') {
          endLayoutTransition(layoutTransition.current)
        }
      }}
      className="flex h-full shrink-0 justify-end overflow-hidden transition-[width] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
    >
      <div className={cn(
        'h-full w-[var(--workspace-sidebar-width)] shrink-0 border-l border-border bg-background transition-[transform,opacity] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity] motion-reduce:transition-none',
        open ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
      )}>
        <AgentTeamPanel key={workspaceId} workspaceId={workspaceId} dropActive={open && drop.isOver} />
      </div>
    </aside>
  )
}
