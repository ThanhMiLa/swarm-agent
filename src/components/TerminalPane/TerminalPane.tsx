import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { LeafNode } from '@/lib/layout-tree'
import { useAppStore } from '@/store/app-store'
import { useTerminalPrefStore } from '@/store/terminal-pref-store'
import { useTerminalTitleStore } from '@/store/terminal-title-store'
import { useTerminalSearchStore } from '@/store/terminal-search-store'
import { useContextUsageStore } from '@/store/context-usage-store'
import { Button } from '@/components/ui/button'
import { SearchOverlay } from '@/components/TerminalPane/SearchOverlay'
import { PaneHeader } from './PaneHeader'
import { agentCommand, DEFAULT_TEMPLATE_ID } from '@/lib/templates'
import { shellFlavor } from '@/lib/shell-quoting'
import { buildResumeCommand } from '@/lib/resume-command'
import { ConversationPicker } from './ConversationPicker'
import { isWindowsPlatform } from '@/lib/platform'
import { pickDirectory } from '@/tauri/dialog'
import { cn } from '@/lib/utils'
import {
  attachTerminal,
  detachTerminal,
  focusTerminal,
  getTerminalStatus,
  respawnTerminal,
  retryTerminal,
  subscribeTerminalStatus,
  type TerminalStatus
} from '@/lib/terminal-registry'

interface TerminalPaneProps {
  leaf: LeafNode
  /** Working directory the terminal's shell starts in. */
  cwd: string
  isFocused: boolean
  workspaceId: string
}

/**
 * One terminal pane: a mount point for a live terminal owned by the registry.
 * The xterm instance and its pty persist in the registry across mounts, so
 * this component only attaches/detaches the terminal's DOM — closing a sibling
 * pane (which remounts this one as the split tree collapses) no longer kills or
 * re-spawns the shell. The pty is killed only when the leaf is truly removed.
 */
export function TerminalPane({
  leaf,
  cwd,
  isFocused,
  workspaceId
}: TerminalPaneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)

  const splitPane = useAppStore((s) => s.splitPane)
  const closePane = useAppStore((s) => s.closePane)
  const setFocusedLeaf = useAppStore((s) => s.setFocusedLeaf)
  const setPaneAgent = useAppStore((s) => s.setPaneAgent)
  const setPaneCwd = useAppStore((s) => s.setPaneCwd)
  const setPaneShell = useAppStore((s) => s.setPaneShell)
  const startPaneConversation = useAppStore((s) => s.startPaneConversation)
  const globalShellId = useTerminalPrefStore((s) => s.shellId)
  const isDropTarget = useAppStore((s) => s.dropTargetTerminalId === leaf.terminalId)

  const { id: leafId, terminalId, agentSelectionVersion } = leaf

  const agentTitle = useTerminalTitleStore((s) => s.titles[terminalId])
  // Per-terminal selector: only this pane wakes when ITS number changes, and the
  // store returns the same state on a no-change sample, so streaming stays quiet.
  const ctxPct = useContextUsageStore((s) => s.byId[terminalId])
  // Narrow boolean selector: only THIS pane re-renders when the find overlay
  // opens/closes for it, not every pane on every keystroke in some other one
  // (the overlay owns its own query/toggle state, not the store).
  const searchOpen = useTerminalSearchStore((s) => s.openFor === terminalId)

  // Reorder-DnD: the whole pane root is both the drop target AND the draggable
  // node (so the drag overlay assumes the pane's size); the header (below) is the
  // grab handle via setActivatorNodeRef. Both keyed by leafId — dnd-kit keeps the
  // draggable and droppable namespaces separate, so the shared id is fine. The
  // live terminal is keyed by terminalId in the registry, so a reorder only
  // re-parents this pane's DOM, never killing the shell.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: leafId })
  const {
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    listeners: dragListeners,
    attributes: dragAttributes,
    isDragging
  } = useDraggable({ id: leafId })

  // The pane root carries both refs (drop target + draggable node).
  const setPaneRef = (el: HTMLDivElement | null): void => {
    setDropRef(el)
    setDragRef(el)
  }

  // Resolve each per-pane value against its default.
  const resolvedCwd = leaf.cwd ?? cwd
  const resolvedShellId = leaf.shellId ?? globalShellId
  const resolvedAgentId = leaf.agentId ?? DEFAULT_TEMPLATE_ID
  const baseCommand = agentCommand(resolvedAgentId)
  const resolvedCommand = leaf.needsConversationChoice ? undefined : (leaf.resumeSessionId
    ? buildResumeCommand(resolvedAgentId, leaf.resumeSessionId)
    : undefined) ?? baseCommand
  // Published to the DOM so the app-level file-drop listener can quote paths
  // for this pane's shell without re-deriving the resolution chain.
  const paneShellFlavor = shellFlavor(resolvedShellId, isWindowsPlatform())

  const [status, setStatus] = useState<TerminalStatus>(() => getTerminalStatus(terminalId))
  const [showConversationPicker, setShowConversationPicker] = useState(false)
  const pickingConversation = leaf.needsConversationChoice || showConversationPicker
  const processAgentId = leaf.needsConversationChoice ? DEFAULT_TEMPLATE_ID : resolvedAgentId

  // Attach the live terminal to this pane's container and mirror its status.
  // Keyed on terminalId only: remounts (sibling close → tree collapse) re-attach
  // the same live terminal; config changes are handled by the respawn effect.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    attachTerminal(terminalId, container, {
      cwd: resolvedCwd,
      shellId: resolvedShellId,
      initialCommand: resolvedCommand,
      workspaceId,
      agentId: processAgentId
    })
    setStatus(getTerminalStatus(terminalId))
    const unsubscribe = subscribeTerminalStatus(terminalId, () =>
      setStatus(getTerminalStatus(terminalId))
    )

    return () => {
      unsubscribe()
      detachTerminal(terminalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId])

  // Respawn on a config change or an explicit agent selection. The ref starts
  // at the mount-time values so reattaching an existing pty doesn't restart it.
  const appliedRef = useRef({
    cwd: resolvedCwd,
    shellId: resolvedShellId,
    command: resolvedCommand,
    agentId: processAgentId,
    agentSelectionVersion
  })
  useEffect(() => {
    const prev = appliedRef.current
    if (
      prev.cwd === resolvedCwd &&
      prev.shellId === resolvedShellId &&
      prev.command === resolvedCommand &&
      prev.agentId === processAgentId &&
      prev.agentSelectionVersion === agentSelectionVersion
    ) {
      return
    }
    appliedRef.current = {
      cwd: resolvedCwd,
      shellId: resolvedShellId,
      command: resolvedCommand,
      agentId: processAgentId,
      agentSelectionVersion
    }
    respawnTerminal(terminalId, {
      cwd: resolvedCwd,
      shellId: resolvedShellId,
      initialCommand: resolvedCommand,
      workspaceId,
      agentId: processAgentId
    })
  }, [terminalId, resolvedCwd, resolvedShellId, resolvedCommand, processAgentId, agentSelectionVersion, workspaceId])

  // Pull keyboard focus into xterm when this pane becomes the focused one.
  useEffect(() => {
    if (isFocused && !pickingConversation) focusTerminal(terminalId)
  }, [isFocused, pickingConversation, terminalId])

  async function handleChoosePath(): Promise<void> {
    const dir = await pickDirectory()
    if (dir) setPaneCwd(leafId, dir)
  }

  return (
    <div
      ref={setPaneRef}
      onMouseDown={() => setFocusedLeaf(leafId)}
      // Clicking pane chrome (header, borders) blurs xterm; App.tsx returns the
      // keyboard to the terminal on the way back up (lib/terminal-focus.ts).
      data-focus-return
      data-terminal-id={terminalId}
      data-leaf-id={leafId}
      data-shell-flavor={paneShellFlavor}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md border bg-background',
        isFocused ? 'border-ring' : 'border-pane-border',
        // Drop-target ring while another pane is dragged over this one.
        isOver && !isDragging && 'ring-2 ring-inset ring-ring',
        // OS file drag hovering this pane — same affordance as the pane-reorder
        // drop ring, in the accent color so the two gestures read differently.
        isDropTarget && 'ring-2 ring-inset ring-primary',
        // Dim the pane being dragged, so the lifted ghost reads as the "real" one.
        isDragging && 'opacity-40'
      )}
    >
      <PaneHeader
        agentId={resolvedAgentId}
        shellId={resolvedShellId}
        resolvedCwd={resolvedCwd}
        hasCwdOverride={leaf.cwd !== undefined}
        onAgentChange={(id) => {
          setShowConversationPicker(false)
          setPaneAgent(leafId, id)
        }}
        onChooseConversation={() => setShowConversationPicker(true)}
        onShellChange={(id) => setPaneShell(leafId, id)}
        onChoosePath={() => void handleChoosePath()}
        onResetPath={() => setPaneCwd(leafId, undefined)}
        onSplitRight={() => splitPane(leafId, 'horizontal')}
        onSplitDown={() => splitPane(leafId, 'vertical')}
        onClose={() => closePane(leafId)}
        dragHandleRef={setActivatorNodeRef}
        dragListeners={dragListeners}
        dragAttributes={dragAttributes}
        agentTitle={agentTitle}
        ctxPct={ctxPct}
      />

      <div className="relative flex-1 overflow-hidden">
        <div ref={containerRef} inert={pickingConversation} className="absolute inset-0" />

        {searchOpen && <SearchOverlay terminalId={terminalId} />}

        {pickingConversation && (
          <ConversationPicker
            key={`${resolvedAgentId}:${resolvedCwd}`}
            agentId={resolvedAgentId}
            cwd={resolvedCwd}
            onChoose={(id, directory) => {
              setShowConversationPicker(false)
              startPaneConversation(terminalId, id, directory)
            }}
            onCancel={leaf.needsConversationChoice ? undefined : () => setShowConversationPicker(false)}
          />
        )}

        {!pickingConversation && status.kind === 'error' && (
          <StatusOverlay
            title="Terminal error"
            detail={status.message}
            actionLabel="Retry"
            onAction={() => retryTerminal(terminalId)}
          />
        )}
        {!pickingConversation && status.kind === 'exited' && (
          <StatusOverlay
            title="Process exited"
            detail={`Exit code ${status.exitCode}`}
            actionLabel="Restart"
            onAction={() => retryTerminal(terminalId)}
          />
        )}
      </div>
    </div>
  )

}

interface StatusOverlayProps {
  title: string
  detail: string
  actionLabel: string
  onAction: () => void
}

function StatusOverlay({ title, detail, actionLabel, onAction }: StatusOverlayProps): React.ReactElement {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-4 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-sm break-words text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onAction}>
        <RotateCw className="h-3.5 w-3.5" />
        {actionLabel}
      </Button>
    </div>
  )
}
