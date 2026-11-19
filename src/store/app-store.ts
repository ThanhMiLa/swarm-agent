import { create, type StateCreator } from 'zustand'
import {
  paneLayoutFor,
  collectLeaves,
  closeLeaf,
  findLeaf,
  resizeSplit,
  splitLeaf,
  reorderLeaves,
  updateLeaf,
  type Direction,
  type LayoutNode,
  type LeafNode
} from '@/lib/layout-tree'
import type { ShellId } from '@/lib/terminal-pref'
import { DEFAULT_TEMPLATE_ID } from '@/lib/templates'
import { workspaceNameFor } from '@/lib/workspace-name'

/** A workspace: a named binary split-tree of terminal panes. */
export interface Workspace {
  id: string
  name: string
  /** Working directory every terminal in this workspace starts from. */
  cwd: string
  layout: LayoutNode
  focusedLeafId: string
}

export interface CreateWorkspaceConfig {
  cwd: string
  terminalCount: number
  agentIds: string[]
  /** Sessions to resume, one extra pane each, appended after the stepper
   *  panes. `cwd` is the session's recorded directory — resume commands only
   *  find their session when run from where it was recorded. */
  resumePanes?: Array<{ agentId: string; sessionId: string; cwd: string }>
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string
  /** Monotonic counter — the "Workspace N" fallback name when no cwd is picked. */
  nextWorkspaceNumber: number
  /** Whether the Welcome tab exists in the tab strip. */
  welcomeOpen: boolean
  /** Whether the Welcome tab (vs the active workspace) is the foreground view. */
  welcomeFocused: boolean
  /** Draft working folder shown in the Welcome form. */
  welcomeFolder: string
  /**
   * Terminal the OS drag is currently hovering, for the drop-target ring.
   * Transient: set on drag enter/over, cleared on drop or leave.
   */
  dropTargetTerminalId: string | null
}

export interface AppActions {
  createWorkspace: (config: CreateWorkspaceConfig) => void
  setWelcomeFolder: (path: string) => void
  openWelcome: () => void
  focusWelcome: () => void
  closeWelcome: () => void
  setActiveWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  closeWorkspace: (id: string) => void
  moveWorkspace: (fromId: string, toId: string) => void
  setFocusedLeaf: (leafId: string) => void
  /** Jump to a terminal wherever it lives: activate its workspace AND focus
   *  its pane. No-op for unknown ids. (Agent Team click-to-navigate.) */
  revealTerminal: (terminalId: string) => void
  setDropTarget: (terminalId: string | null) => void
  splitPane: (leafId: string, direction: Direction) => void
  closePane: (leafId: string) => void
  reorderPane: (fromLeafId: string, toLeafId: string) => void
  resizeSplitNode: (splitId: string, sizes: [number, number]) => void
  setPaneAgent: (leafId: string, agentId: string) => void
  setPaneCwd: (leafId: string, cwd: string | undefined) => void
  setPaneShell: (leafId: string, shellId: ShellId) => void
}

export type AppStore = AppState & AppActions

// --- pure helpers ---------------------------------------------------------

function uid(): string {
  return crypto.randomUUID()
}

/** Return `list` with the item at index `from` moved to index `to`. */
function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** A plain-shell leaf — no template command. Used when splitting a pane. */
function makeLeaf(): LeafNode {
  return { type: 'leaf', id: uid(), terminalId: uid() }
}

/** Return the active workspace, or `undefined` if it cannot be resolved. */
export function selectActiveWorkspace(state: AppState): Workspace | undefined {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId)
}

/** The workspace whose layout owns `terminalId`, or `undefined` if none. */
export function selectWorkspaceByTerminalId(
  state: AppState,
  terminalId: string
): Workspace | undefined {
  return state.workspaces.find((w) =>
    collectLeaves(w.layout).some((l) => l.terminalId === terminalId)
  )
}

/**
 * The terminal that should own the keyboard: the focused leaf of the active
 * workspace. `undefined` when no workspace exists (Welcome-only launch).
 */
export function selectFocusedTerminalId(state: AppState): string | undefined {
  const ws = selectActiveWorkspace(state)
  if (!ws) return undefined
  return findLeaf(ws.layout, ws.focusedLeafId)?.terminalId
}

/** Map the active workspace through `fn`, leaving the others untouched. */
function mapActive(state: AppState, fn: (w: Workspace) => Workspace): Pick<AppState, 'workspaces'> {
  return {
    workspaces: state.workspaces.map((w) => (w.id === state.activeWorkspaceId ? fn(w) : w))
  }
}

// --- store ----------------------------------------------------------------

export const appStoreCreator: StateCreator<AppStore> = (set, get) => ({
  workspaces: [],
  activeWorkspaceId: '',
  nextWorkspaceNumber: 1,
  welcomeOpen: true,
  welcomeFocused: true,
  dropTargetTerminalId: null,
  welcomeFolder: '',

  createWorkspace: (config) =>
    set((s) => {
      // Pane count = squad size (one agent id per pane); paneLayoutFor derives
      // the grid/split shape. makeWizardLeaf is called row-major, matching the
      // agentIds order. The ?? fallback is defensive — agentIds.length panes
      // always have a matching id.
      let paneIndex = 0
      const resumePanes = config.resumePanes ?? []
      const makeWizardLeaf = (): LeafNode => {
        const i = paneIndex++
        const resume = i >= config.terminalCount ? resumePanes[i - config.terminalCount] : undefined
        if (resume) {
          return {
            type: 'leaf',
            id: uid(),
            terminalId: uid(),
            agentId: resume.agentId,
            resumeSessionId: resume.sessionId,
            cwd: resume.cwd
          }
        }
        return {
          type: 'leaf',
          id: uid(),
          terminalId: uid(),
          agentId: config.agentIds[i] ?? DEFAULT_TEMPLATE_ID,
        }
      }
      const layout = paneLayoutFor(config.terminalCount + resumePanes.length, makeWizardLeaf, uid)
      const ws: Workspace = {
        id: uid(),
        name: workspaceNameFor(
          config.cwd,
          s.workspaces.map((w) => w.name),
          s.nextWorkspaceNumber
        ),
        cwd: config.cwd,
        layout,
        focusedLeafId: collectLeaves(layout)[0].id
      }
      return {
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
        nextWorkspaceNumber: s.nextWorkspaceNumber + 1,
        welcomeOpen: false,
        welcomeFocused: false
      }
    }),

  setWelcomeFolder: (path) => set({ welcomeFolder: path }),

  openWelcome: () => set({ welcomeOpen: true, welcomeFocused: true }),

  focusWelcome: () => set({ welcomeFocused: true }),

  closeWelcome: () => set({ welcomeOpen: false, welcomeFocused: false }),

  setActiveWorkspace: (id) =>
    set((s) =>
      s.workspaces.some((w) => w.id === id)
        ? { activeWorkspaceId: id, welcomeFocused: false }
        : {}
    ),

  renameWorkspace: (id, name) =>
    set((s) => {
      const trimmed = name.trim()
      if (trimmed === '') return {}
      return {
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w))
      }
    }),

  closeWorkspace: (id) =>
    set((s) => {
      const index = s.workspaces.findIndex((w) => w.id === id)
      if (index === -1) return {}
      const remaining = s.workspaces.filter((w) => w.id !== id)
      // Closing the last workspace leaves none — the app reopens the setup wizard.
      if (remaining.length === 0) {
        return { workspaces: [], activeWorkspaceId: '', welcomeOpen: true, welcomeFocused: true }
      }
      let activeWorkspaceId = s.activeWorkspaceId
      if (id === s.activeWorkspaceId) {
        activeWorkspaceId = remaining[Math.min(index, remaining.length - 1)].id
      }
      return { workspaces: remaining, activeWorkspaceId }
    }),

  moveWorkspace: (fromId, toId) =>
    set((s) => {
      if (fromId === toId) return {}
      const from = s.workspaces.findIndex((w) => w.id === fromId)
      const to = s.workspaces.findIndex((w) => w.id === toId)
      if (from === -1 || to === -1) return {}
      return { workspaces: arrayMove(s.workspaces, from, to) }
    }),

  setFocusedLeaf: (leafId) =>
    set((s) =>
      mapActive(s, (w) => (findLeaf(w.layout, leafId) ? { ...w, focusedLeafId: leafId } : w))
    ),

  revealTerminal: (terminalId) =>
    set((s) => {
      const ws = selectWorkspaceByTerminalId(s, terminalId)
      if (!ws) return {}
      const leaf = collectLeaves(ws.layout).find((l) => l.terminalId === terminalId)
      if (!leaf) return {}
      return {
        activeWorkspaceId: ws.id,
        welcomeFocused: false,
        workspaces: s.workspaces.map((w) => (w.id === ws.id ? { ...w, focusedLeafId: leaf.id } : w))
      }
    }),

  setDropTarget: (terminalId) => set({ dropTargetTerminalId: terminalId }),

  splitPane: (leafId, direction) =>
    set((s) =>
      mapActive(s, (w) => {
        if (!findLeaf(w.layout, leafId)) return w
        const newLeaf = makeLeaf()
        return {
          ...w,
          layout: splitLeaf(w.layout, leafId, direction, newLeaf, uid()),
          focusedLeafId: newLeaf.id
        }
      })
    ),

  closePane: (leafId) => {
    const active = selectActiveWorkspace(get())
    if (!active) return
    const layout = closeLeaf(active.layout, leafId)
    // Closing the last pane of a workspace closes the workspace itself.
    if (layout === null) {
      get().closeWorkspace(active.id)
      return
    }
    set((s) =>
      mapActive(s, (w) => {
        const focusedLeafId = findLeaf(layout, w.focusedLeafId)?.id ?? collectLeaves(layout)[0].id
        return { ...w, layout, focusedLeafId }
      })
    )
  },

  // Reorder panes in the active workspace: move `fromLeafId` to `toLeafId`'s
  // slot, reflowing the rest. Focus follows the same leaf ID.
  reorderPane: (fromLeafId, toLeafId) =>
    set((s) =>
      mapActive(s, (w) => {
        if (fromLeafId === toLeafId) return w
        if (!findLeaf(w.layout, fromLeafId) || !findLeaf(w.layout, toLeafId)) return w
        return { ...w, layout: reorderLeaves(w.layout, fromLeafId, toLeafId) }
      })
    ),

  resizeSplitNode: (splitId, sizes) =>
    set((s) => mapActive(s, (w) => ({ ...w, layout: resizeSplit(w.layout, splitId, sizes) }))),

  // An agent switch respawns the pty; replaying a brief written for another
  // agent would be wrong, so a pending prompt is dropped along with it. A
  // resume session id is meaningless under another agent too — clear it.
  setPaneAgent: (leafId, agentId) =>
    set((s) =>
      mapActive(s, (w) => ({
        ...w,
        layout: updateLeaf(w.layout, leafId, {
          agentId,
          resumeSessionId: undefined
        })
      }))
    ),

  setPaneCwd: (leafId, cwd) =>
    set((s) =>
      mapActive(s, (w) => ({
        ...w,
        layout: updateLeaf(w.layout, leafId, {
          cwd,
          resumeSessionId: undefined
        })
      }))
    ),

  setPaneShell: (leafId, shellId) =>
    set((s) => mapActive(s, (w) => ({ ...w, layout: updateLeaf(w.layout, leafId, { shellId }) })))
})

export const useAppStore = create<AppStore>()(appStoreCreator)
