import type { ReactElement } from 'react'
import type { LeafNode } from '@/lib/layout-tree'
import { templateById, DEFAULT_TEMPLATE_ID } from '@/lib/templates'
import { agentTextColor } from '@/lib/agent-colors'
import { useAppStore } from '@/store/app-store'
import { useTerminalActivityStore } from '@/store/terminal-activity-store'
import { useAgentStateStore } from '@/store/agent-state-store'
import { displayState, paneDot } from '@/lib/agent-state/rollup'
import { AgentIcon } from '@/components/AgentIcon'
import { ActivityDot } from '@/components/ActivityDot'
import { StateDot } from '@/components/StateDot'
import { cn } from '@/lib/utils'

export function TerminalList({
  leaves, expanded, focusedLeafId
}: {
  leaves: LeafNode[]
  expanded: boolean
  focusedLeafId?: string
}): ReactElement {
  return (
    <ul hidden={!expanded} className="ml-3 space-y-0.5 border-l border-border pl-1">
      {leaves.map((leaf) => (
        <TerminalItem key={leaf.id} leaf={leaf} focused={leaf.id === focusedLeafId} />
      ))}
    </ul>
  )
}

function TerminalItem({ leaf, focused }: { leaf: LeafNode; focused: boolean }): ReactElement {
  const revealTerminal = useAppStore((s) => s.revealTerminal)
  const agentState = useAgentStateStore((s) => s.byId[leaf.terminalId])
  const outputActive = useTerminalActivityStore((s) => s.active[leaf.terminalId] === true)
  const template = templateById(leaf.agentId ?? DEFAULT_TEMPLATE_ID)
  const dot = paneDot(displayState(agentState), outputActive)

  return (
    <li>
      <button
        type="button"
        onClick={() => revealTerminal(leaf.terminalId)}
        aria-current={focused ? 'true' : undefined}
        title={template.name}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
          focused
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
      >
        <AgentIcon
          template={template}
          className={cn('h-4 w-4 shrink-0', !template.icon && 'text-emerald-400')}
        />
        <span className={cn('flex-1 truncate', agentTextColor(template.id))}>{template.name}</span>
        {dot === 'activity' ? <ActivityDot /> : dot && <StateDot state={dot} sinceMs={agentState?.sinceMs} />}
      </button>
    </li>
  )
}
