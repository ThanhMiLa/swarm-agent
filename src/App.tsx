import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  useAppStore,
  selectFocusedTerminalId,
  type Workspace as WorkspaceModel
} from '@/store/app-store'
import { useNavbarVisibilityStore } from '@/store/navbar-visibility-store'
import { useStatuslineStore } from '@/store/statusline-store'
import { useAgentStateStore } from '@/store/agent-state-store'
import { useShellMarkStore } from '@/store/shell-mark-store'
import { useContextUsageStore } from '@/store/context-usage-store'
import { matchAppShortcut } from '@/lib/keybindings'
import { jumpToAttention } from '@/lib/attention-jump'
import { collectLeaves, findLeaf } from '@/lib/layout-tree'
import { isMacPlatform } from '@/lib/platform'
import { nextSystemChromeReveal, systemChromeOffset } from '@/lib/titlebar-chrome'
import { onFullscreenChanged } from '@/tauri/window'
import {
  disposeOrphanTerminals,
  focusTerminal,
  getTerminalAgentId,
  isAnyTerminalFocused,
  noteAgentHook,
  refitAttachedTerminals
} from '@/lib/terminal-registry'
import {
  describeFocusedElement,
  shouldReturnFocus,
  FOCUS_RETURN_ATTR
} from '@/lib/terminal-focus'
import { GuardedPointerSensor } from '@/lib/dnd-sensors'
import { resolveDragEnd } from '@/lib/agent-team-drop'
import { startAgentTeamDelivery } from '@/lib/agent-team-delivery'
import { FileDropListener } from '@/components/FileDropListener'
import { RightPanel } from '@/components/RightPanel/RightPanel'
import { Navbar } from '@/components/Navbar/Navbar'
import { SettingsView } from '@/components/Settings/SettingsView'
import { TitleBar } from '@/components/TitleBar/TitleBar'
import { Workspace, PaneDragGhost } from '@/components/Workspace/Workspace'
import { Welcome } from '@/components/Welcome/Welcome'
import { Button } from '@/components/ui/button'
import { useUpdaterStore } from '@/store/updater-store'
import { PERIODIC_CHECK_INTERVAL_MS, STARTUP_CHECK_DELAY_MS } from '@/lib/updater-flow'
import { onUpdateCheckRequested } from '@/tauri/updater'
import { showMessage } from '@/tauri/dialog'
import { useTeamPanelStore } from '@/store/team-panel-store'
import { useRecentsStore } from '@/store/recents-store'
import { useAgentAvailabilityStore } from '@/store/agent-availability-store'
import { useShellAvailabilityStore } from '@/store/shell-availability-store'
import { useTerminalTitleStore } from '@/store/terminal-title-store'
import { useNotificationPrefStore } from '@/store/notification-pref-store'
import { startNotificationWatch } from '@/lib/notification-watch'
import { startAgentStateMirror } from '@/lib/agent-state-mirror'
import { reportAgentState, onAgentHook, onAgentContext } from '@/tauri/agent-state'
import { playChime } from '@/lib/notification-sound'
import { getInputCompatibility } from '@/tauri/input-compatibility'
import { sendSystemNotification } from '@/tauri/notification'
import { useTerminalSearchStore } from '@/store/terminal-search-store'
import { useAgentTeamStore } from '@/store/agent-team-store'
import { editTeam } from '@/tauri/agent-team'
import { showWindow } from '@/tauri/window'
import type { CategoryId } from '@/components/Settings/SettingsView'

// Platform never changes at runtime, so a module-level constant is fine.
const isMac = isMacPlatform()

/** Terminal ids referenced by any workspace's layout — the ones to keep alive. */
function liveTerminalIds(workspaces: WorkspaceModel[]): Set<string> {
  const ids = new Set<string>()
  for (const ws of workspaces) {
    for (const leaf of collectLeaves(ws.layout)) ids.add(leaf.terminalId)
  }
  return ids
}

export default function App(): ReactElement {
  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const welcomeFocused = useAppStore((s) => s.welcomeFocused)
  const welcomeProjectId = useAppStore((s) => s.welcomeProjectId)
  const openWelcome = useAppStore((s) => s.openWelcome)
  const closeWelcome = useAppStore((s) => s.closeWelcome)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<CategoryId>('appearance')
  // Native full-screen state, owned here because both the header's traffic-light
  // inset and the system-chrome dodge below are driven by it.
  const [isFullscreen, setIsFullscreen] = useState(false)

  const reorderPane = useAppStore((s) => s.reorderPane)
  const [draggingLeafId, setDraggingLeafId] = useState<string | null>(null)
  const panelBeforeDrag = useRef<boolean | null>(null)
  const dndSensors = useSensors(
    useSensor(GuardedPointerSensor, { activationConstraint: { distance: 5 } })
  )
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const draggingLeaf = draggingLeafId && activeWs ? findLeaf(activeWs.layout, draggingLeafId) : null

  function restoreTeamPanel(): void {
    if (panelBeforeDrag.current !== null) useTeamPanelStore.getState().setOpen(panelBeforeDrag.current)
    panelBeforeDrag.current = null
  }

  function handleDragStart(id: string): void {
    setDraggingLeafId(id)
    const panel = useTeamPanelStore.getState()
    panelBeforeDrag.current = panel.open
    const leaf = activeWs && findLeaf(activeWs.layout, id)
    if (leaf?.agentId && leaf.agentId !== 'terminal') panel.setOpen(true)
  }

  function handleDragEnd(activeId: string, overId: string | null): void {
    setDraggingLeafId(null)
    const action = resolveDragEnd(activeId, overId)
    if (action.kind === 'join' && activeWs) {
      const leaf = findLeaf(activeWs.layout, action.leafId)
      if (leaf) {
        panelBeforeDrag.current = null
        const { setError } = useAgentTeamStore.getState()
        setError(activeWs.id, null)
        void editTeam({ kind: 'join', teamId: activeWs.id, terminalId: leaf.terminalId })
          .catch((error) => setError(activeWs.id, String(error)))
        return
      }
    }
    restoreTeamPanel()
    if (action.kind === 'reorder') reorderPane(action.activeLeafId, action.overLeafId)
  }

  const projectFolders = new Map(projects.map((p) => [p.id, p.cwd]))
  // The first project must be created before the composer can be dismissed.
  const showWelcome = welcomeFocused || projects.length === 0
  const welcomeClosable = projects.length > 0

  useEffect(() => {
    // Await the native startup preference before exposing any editable fields.
    // The backend serializes this read with its saved compatibility apply.
    void (async () => {
      if (isMac) {
        try {
          await getInputCompatibility()
        } catch (error) {
          console.error('[startup] input compatibility unavailable', error)
        }
      }
      await showWindow()
    })()
    useRecentsStore.getState().hydrate()
    void useAgentAvailabilityStore.getState().refresh()
    void useShellAvailabilityStore.getState().refresh()
    void useStatuslineStore.getState().sync()
  }, [])

  // Esc closes the Welcome page when it's closeable and Settings isn't covering it.
  useEffect(() => {
    if (!showWelcome || !welcomeClosable || settingsOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeWelcome()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showWelcome, welcomeClosable, settingsOpen, closeWelcome])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = matchAppShortcut(e, isMac)
      if (action === 'toggle-navbar') {
        e.preventDefault()
        useNavbarVisibilityStore.getState().toggle()
        return
      }
      if (action === 'find-in-terminal') {
        // Leave editable UI in control. xterm's own input is a textarea too,
        // so explicitly allow find while a terminal has keyboard focus.
        if (!isAnyTerminalFocused() && !shouldReturnFocus(describeFocusedElement(document.activeElement))) {
          return
        }
        const terminalId = selectFocusedTerminalId(useAppStore.getState())
        if (terminalId) {
          e.preventDefault()
          useTerminalSearchStore.getState().open(terminalId)
          return
        }
      }
      if (action === 'jump-to-attention') {
        // Same stand-down as find: never yank focus out of the composer, a
        // rename field, a menu, or the Settings overlay.
        if (!isAnyTerminalFocused() && !shouldReturnFocus(describeFocusedElement(document.activeElement))) {
          return
        }
        // No candidate → let the keystroke fall through (the registry gate
        // already dropped it toward the pty, so nothing leaks either way).
        if (jumpToAttention()) e.preventDefault()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  // --- keyboard focus belongs to the terminal -----------------------------
  // The shell owns the keyboard; app chrome only borrows it. dnd-kit makes its
  // drag nodes focusable (tabIndex 0 on tabs, navbar items, pane roots), so a
  // click parks DOM focus on chrome and every keystroke is dropped until the
  // user clicks back into the pane — and a Tab (shell completion) walks the
  // focus ring across the tab titles instead. These three effects hand focus
  // back; see `lib/terminal-focus.ts`.

  // Read inside the window listeners below, which are registered once and must
  // not capture a stale value.
  const settingsOpenRef = useRef(settingsOpen)
  settingsOpenRef.current = settingsOpen

  /** Focus the active workspace's focused terminal, unless something is typing. */
  const returnFocusToTerminal = useCallback(() => {
    // Settings is a modal without a focus trap: its Esc handler lives on the
    // document, so it keeps working — but pulling focus behind it would type
    // the user's keystrokes into the shell while they look at the dialog.
    if (settingsOpenRef.current) return
    if (useAppStore.getState().welcomeFocused) return
    if (!shouldReturnFocus(describeFocusedElement(document.activeElement))) return
    const terminalId = selectFocusedTerminalId(useAppStore.getState())
    if (terminalId) focusTerminal(terminalId)
  }, [])

  /**
   * Same, but scheduled to land after everyone else's focus work: Radix menus
   * and the rename input claim focus on a timeout, and dnd-kit re-focuses the
   * dragged node in a requestAnimationFrame when a drag ends. Running last is
   * what lets the activeElement check above be trusted — if a menu or an input
   * legitimately took the keyboard, it already holds it by now.
   */
  const deferReturnFocusToTerminal = useCallback(() => {
    requestAnimationFrame(() => setTimeout(returnFocusToTerminal, 0))
  }, [returnFocusToTerminal])

  // 1. Landing on a workspace: switching tabs, leaving Welcome, closing
  //    Settings. Workspaces stay mounted (see the render below), so the target
  //    pane never remounts and TerminalPane's isFocused effect never re-runs —
  //    nothing else would pull focus off the tab that was clicked. Deferred so
  //    it also beats Radix restoring focus to the Settings trigger on close.
  useEffect(() => {
    if (showWelcome || settingsOpen) return
    deferReturnFocusToTerminal()
  }, [activeWorkspaceId, showWelcome, settingsOpen, deferReturnFocusToTerminal])

  // 2. Pointer gestures on chrome that has no keyboard use of its own — every
  //    region marked `data-focus-return`: title bar, sidebar, tab strip, panes
  //    and their split separators. `pointerup` (not just `click`)
  //    because a finished drag swallows the click — and dnd-kit's own
  //    focus-restore would otherwise leave the keyboard on the dragged tab.
  //    `click` is kept alongside it for keyboard-activated buttons, which fire
  //    no pointer events; a double return-focus is a harmless no-op.
  useEffect(() => {
    const onPointerUp = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`[${FOCUS_RETURN_ATTR}]`) === null) return
      deferReturnFocusToTerminal()
    }
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('click', onPointerUp)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('click', onPointerUp)
    }
  }, [deferReturnFocusToTerminal])

  // 3. Regaining the window — close-to-tray, Cmd+Tab, or a click on the title
  //    bar. The webview restores focus to whatever held it last, which after a
  //    tray round-trip is the document body.
  useEffect(() => {
    window.addEventListener('focus', deferReturnFocusToTerminal)
    return () => window.removeEventListener('focus', deferReturnFocusToTerminal)
  }, [deferReturnFocusToTerminal])

  // While the window is occluded (alt-tab away on Windows, tray round-trip) a
  // ResizeObserver tick can fit a pane against a near-zero layout and collapse
  // it to the FitAddon's 2×1 minimum; the container's real size never changes
  // afterwards, so nothing re-fires the observer and the pane stays wrapped at
  // 2 columns. Re-measure every attached pane whenever the user comes back.
  useEffect(() => {
    const refit = (): void => {
      if (document.visibilityState === 'hidden') return
      refitAttachedTerminals()
    }
    window.addEventListener('focus', refit)
    document.addEventListener('visibilitychange', refit)
    return () => {
      window.removeEventListener('focus', refit)
      document.removeEventListener('visibilitychange', refit)
    }
  }, [])

  // A done badge means "finished while you weren't looking" — so it clears
  // the moment the pane is actually being looked at: focus changes within
  // the app (store subscription covers setFocusedLeaf AND workspace
  // switches) and the window regaining OS focus. Watched-ness at completion
  // time is judged inside the store publish; this effect handles the other
  // direction — the user coming TO an already-done pane.
  useEffect(() => {
    const markFocusedSeen = (): void => {
      if (!document.hasFocus()) return
      const terminalId = selectFocusedTerminalId(useAppStore.getState())
      if (terminalId) useAgentStateStore.getState().markSeen(terminalId)
    }
    markFocusedSeen()
    const unsubscribe = useAppStore.subscribe(markFocusedSeen)
    window.addEventListener('focus', markFocusedSeen)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', markFocusedSeen)
    }
  }, [])

  // --- macOS full screen: get out from under the auto-hiding system chrome ---
  // In full screen macOS slides the menu bar + titlebar down ON TOP of the app
  // the moment the pointer touches the top edge of the screen, burying our
  // header and half the tab strip. The pointer is the only signal a webview
  // gets, and it is enough: shift the app down by the band the OS is about to
  // occupy, so the revealed chrome lands in empty space (see lib/titlebar-chrome).
  const [systemChromeRevealed, setSystemChromeRevealed] = useState(false)

  useEffect(() => {
    if (!isMac) return // no auto-hiding titlebar to dodge off macOS
    let unlisten: (() => void) | undefined
    onFullscreenChanged(setIsFullscreen).then((un) => (unlisten = un))
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    if (!isMac || !isFullscreen) {
      setSystemChromeRevealed(false)
      return
    }
    const onMove = (e: MouseEvent): void => {
      setSystemChromeRevealed((prev) => nextSystemChromeReveal(prev, e.clientY))
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [isFullscreen])

  const chromeOffset = systemChromeOffset(isMac, isFullscreen, systemChromeRevealed)

  // Clean up sessions and teams as their workspaces close.
  useEffect(
    () =>
      useAppStore.subscribe((state, previous) => {
        if (state.workspaces === previous.workspaces) return
        const live = liveTerminalIds(state.workspaces)
        disposeOrphanTerminals(live)
        for (const workspace of previous.workspaces) {
          if (!state.workspaces.some((current) => current.id === workspace.id)) {
            useAgentTeamStore.getState().setError(workspace.id, null)
            void editTeam({ kind: 'closeWorkspace', teamId: workspace.id }).catch(console.error)
          }
        }
        const { titles, clearTitle } = useTerminalTitleStore.getState()
        for (const terminalId of Object.keys(titles)) {
          if (!live.has(terminalId)) clearTitle(terminalId)
        }
      }),
    []
  )

  // Silent update checks: one a few seconds after boot (never competing with
  // pty spawn), then periodically — SwarmAgent runs for days, and the navbar
  // update button only ever appears through these. Failures are swallowed by
  // the flow reducer. The periodic tick only fires from idle so it can never
  // clobber a known update or an in-flight download.
  useEffect(() => {
    const check = () => void useUpdaterStore.getState().check(false)
    const t = window.setTimeout(check, STARTUP_CHECK_DELAY_MS)
    const i = window.setInterval(() => {
      if (useUpdaterStore.getState().state.phase === 'idle') check()
    }, PERIODIC_CHECK_INTERVAL_MS)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(i)
    }
  }, [])

  // Tray "Check for Updates…" → manual check (talkative: reports up-to-date
  // and failures in a native dialog).
  useEffect(() => {
    const unlisten = onUpdateCheckRequested(() => void useUpdaterStore.getState().check(true))
    return () => void unlisten.then((fn) => fn())
  }, [])

  // Claude Code hook edges (`swarm-agent --hook` → POST /hook → `agent:hook`)
  // feed the pane's detector directly. Mount-once and routed by terminalId so
  // no per-pane component has to own a listener — the registry decides whether
  // the pane's detector is one that understands hooks (Claude Code only).
  useEffect(() => {
    const unlisten = onAgentHook((e) => noteAgentHook(e.terminalId, e.signal))
    return () => void unlisten.then((fn) => fn())
  }, [])

  // Context-window usage (`swarm-agent --statusline` → GET /status?ctx → `agent:context`)
  // lands in its own store, keyed by terminalId, so only the pane whose number
  // changed re-renders its chip. `pct: null` clears it — Rust publishes that on
  // every Forget, and the store makes a null-on-nothing a no-op.
  useEffect(() => {
    const unlisten = onAgentContext((e) => useContextUsageStore.getState().apply(e.terminalId, e.pct))
    return () => void unlisten.then((fn) => fn())
  }, [])

  // Manual-check verdicts land as native OS dialogs, not DOM — nothing to
  // position over the terminal. Subscribed outside the render path so the
  // per-chunk download progress never re-renders App. Dismiss BEFORE the
  // dialog: the machine is already idle while the dialog waits for OK.
  useEffect(() => {
    return useUpdaterStore.subscribe((cur, prev) => {
      if (cur.state.phase === prev.state.phase) return
      if (cur.state.phase === 'upToDate') {
        useUpdaterStore.getState().dismiss()
        void showMessage('SwarmAgent is up to date.', { title: 'SwarmAgent' })
      } else if (cur.state.phase === 'error') {
        const detail = cur.state.message
        useUpdaterStore.getState().dismiss()
        void showMessage(`Update check failed:\n${detail}`, { title: 'SwarmAgent', kind: 'error' })
      }
    })
  }, [])

  // Agent notifications — plus long-command notifications for plain panes
  // (OSC 133 shell marks) — subscribed outside the render path (updater
  // precedent) so per-tick agent-state churn never re-renders App.
  useEffect(() => {
    return startNotificationWatch({
      subscribeAgentStates: (listener) =>
        useAgentStateStore.subscribe((cur, prev) => listener(cur.byId, prev.byId)),
      getAgentStates: () => useAgentStateStore.getState().byId,
      subscribeCommands: (listener) =>
        useShellMarkStore.subscribe((cur, prev) => listener(cur.byId, prev.byId)),
      getCommandStates: () => useShellMarkStore.getState().byId,
      isPaneWatched: (id) =>
        document.hasFocus() && selectFocusedTerminalId(useAppStore.getState()) === id,
      isWindowFocused: () => document.hasFocus(),
      getAgentId: getTerminalAgentId,
      getPrefs: () => useNotificationPrefStore.getState().prefs,
      getPaneTitle: (id) => useTerminalTitleStore.getState().titles[id] ?? '',
      playChime,
      sendSystemNotification: (opts) => void sendSystemNotification(opts),
      now: Date.now,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number)
    })
  }, [])

  // Report settled turns for token statistics and review reservations.
  useEffect(() => {
    return startAgentStateMirror({
      subscribe: (listener) =>
        useAgentStateStore.subscribe((cur, prev) => listener(cur.byId, prev.byId)),
      getStates: () => useAgentStateStore.getState().byId,
      report: (id, display) => {
        void reportAgentState(id, display).catch(() => {})
      }
    })
  }, [])

  useEffect(() => startAgentTeamDelivery(), [])

  return (
    <div
      // translateY, not padding or a spacer: those would shrink the app's height,
      // and a height change reflows every xterm and resizes its pty — line-wrap
      // churn in a TUI every time the pointer grazes the top of the screen. A
      // transform slides the whole app down as one block; the bottom few rows go
      // off-screen for as long as the overlay is up, and nothing re-lays out.
      style={{
        transform: `translateY(${chromeOffset}px)`,
        transition: 'transform 150ms ease-out'
      }}
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <FileDropListener />
      <TitleBar fullscreen={isFullscreen} />

      <div className="relative flex min-h-0 flex-1">
        <Navbar
          settingsOpen={settingsOpen}
          onToggleSettings={() => {
            setSettingsTab('appearance')
            setSettingsOpen((open) => !open)
          }}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Workspaces stay mounted and visible whether Settings is open or
              not — the Settings modal dims them behind its backdrop, and their
              terminals (and PTYs) survive a Settings detour. */}
          <div className="relative min-h-0 flex-1 bg-canvas">
              <DndContext
                sensors={dndSensors}
                collisionDetection={pointerWithin}
                onDragStart={(e) => handleDragStart(String(e.active.id))}
                onDragEnd={(e) => handleDragEnd(String(e.active.id), e.over ? String(e.over.id) : null)}
                onDragCancel={() => {
                  setDraggingLeafId(null)
                  restoreTeamPanel()
                }}
              >
                 <div inert={showWelcome} className="flex h-full w-full overflow-hidden">
                  <div className="relative h-full min-w-0 flex-1 overflow-hidden">
                    {workspaces.map((ws) => (
                      <div
                        key={ws.id}
                        className="absolute inset-0"
                        style={{ display: ws.id === activeWorkspaceId ? 'block' : 'none' }}
                      >
                         <Workspace workspace={ws} cwd={projectFolders.get(ws.projectId) ?? ''} />
                      </div>
                    ))}
                  </div>
                   {activeWs && <RightPanel workspaceId={activeWs.id} />}
                </div>
                <DragOverlay>
                  {draggingLeaf ? <PaneDragGhost leaf={draggingLeaf} /> : null}
                </DragOverlay>
              </DndContext>

              {showWelcome && (
                <div className="absolute inset-0 z-20 overflow-y-auto bg-canvas">
                  <Welcome key={welcomeProjectId ?? 'new-project'} />
                </div>
              )}
              {!showWelcome && !activeWs && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                  <p>No open workspaces.</p>
                  <Button variant="outline" onClick={() => openWelcome(projects[0].id)}>New workspace</Button>
                </div>
              )}
            </div>

        </main>

        {settingsOpen && (
          <SettingsView
            key={settingsTab}
            onClose={() => setSettingsOpen(false)}
            initialCategory={settingsTab}
          />
        )}
      </div>
    </div>
  )
}
