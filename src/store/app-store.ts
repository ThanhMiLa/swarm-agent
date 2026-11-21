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
import { projectNameFor } from '@/lib/project-name'
import { isValidSessionId } from '@/lib/resume-command'
import { readWorkspaceState, writeWorkspaceState } from '@/lib/workspace-persistence'

export interface Project {
  id: string
  name: string
  /** Default working directory for every workspace in the project. */
  cwd: string
  nextWorkspaceNumber: number
}

/** A workspace: a named binary split-tree of terminal panes. */
export interface Workspace {
  id: string
  name: string
  projectId: string
  layout: LayoutNode
  focusedLeafId: string
}

export interface CreateWorkspaceConfig {
  terminalCount: number
  agentIds: string[]
  /** Sessions to resume, one extra pane each, appended after the stepper
   *  panes. `cwd` is the session's recorded directory — resume commands only
   *  find their session when run from where it was recorded. */
  resumePanes?: Array<{ agentId: string; sessionId: string; cwd: string }>
}

export interface CreateProjectConfig extends CreateWorkspaceConfig {
  cwd: string
}

export interface AppState {
  projects: Project[]
  workspaces: Workspace[]
  activeWorkspaceId: string
  /** Whether the project/workspace composer is the foreground view. */
  welcomeFocused: boolean
  /** Composer target; null means create a new project instead. */
  welcomeProjectId: string | null
  /** Draft working folder for the New project form. */
  welcomeFolder: string
  /**
   * Terminal the OS drag is currently hovering, for the drop-target ring.
   * Transient: set on drag enter/over, cleared on drop or leave.
   */
  dropTargetTerminalId: string | null
}

export interface AppActions {
  createProject: (config: CreateProjectConfig) => void
  renameProject: (id: string, name: string) => void
  closeProject: (id: string) => void
  moveProject: (fromId: string, toId: string) => void
  createWorkspace: (projectId: string, config: CreateWorkspaceConfig) => void
  setWelcomeFolder: (path: string) => void
  openWelcome: (projectId?: string) => void
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
  resizeSplitNode: (workspaceId: string, splitId: string, sizes: [number, number]) => void
  setPaneAgent: (leafId: string, agentId: string) => void
  setPaneCwd: (leafId: string, cwd: string | undefined) => void
  setPaneShell: (leafId: string, shellId: ShellId) => void
  startPaneConversation: (terminalId: string, sessionId?: string, cwd?: string) => void
  recordPaneConversation: (terminalId: string, agentId: string, sessionId: string, cwd?: string) => void
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

function makeWorkspace(project: Project, config: CreateWorkspaceConfig, name: string): Workspace {
  let paneIndex = 0
  const resumePanes = config.resumePanes ?? []
  const layout = paneLayoutFor(config.terminalCount + resumePanes.length, () => {
    const i = paneIndex++
    const resume = resumePanes[i - config.terminalCount]
    return resume
      ? { ...makeLeaf(), agentId: resume.agentId, resumeSessionId: resume.sessionId, cwd: resume.cwd }
      : { ...makeLeaf(), agentId: config.agentIds[i] ?? DEFAULT_TEMPLATE_ID }
  }, uid)
  return {
    id: uid(),
    projectId: project.id,
    name,
    layout,
    focusedLeafId: collectLeaves(layout)[0].id
  }
}

const closedWelcome = { welcomeFocused: false, welcomeProjectId: null } as const

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
 * workspace. `undefined` while the composer is visible or no workspace exists.
 */
export function selectFocusedTerminalId(state: AppState): string | undefined {
  if (state.welcomeFocused) return undefined
  const ws = selectActiveWorkspace(state)
  if (!ws) return undefined
  return findLeaf(ws.layout, ws.focusedLeafId)?.terminalId
}

/** Map the active workspace through `fn`, leaving the others untouched. */
function mapActive(state: AppState, fn: (w: Workspace) => Workspace): Pick<AppState, 'workspaces'> {
  const index = state.workspaces.findIndex((w) => w.id === state.activeWorkspaceId)
  if (index === -1) return state
  const updated = fn(state.workspaces[index])
  if (updated === state.workspaces[index]) return state
  return { workspaces: state.workspaces.map((w, i) => i === index ? updated : w) }
}

// --- store ----------------------------------------------------------------

export const appStoreCreator: StateCreator<AppStore> = (set, get) => ({
  projects: [],
  workspaces: [],
  activeWorkspaceId: '',
  welcomeFocused: true,
  welcomeProjectId: null,
  dropTargetTerminalId: null,
  welcomeFolder: '',

  createProject: (config) =>
    set((s) => {
      const project: Project = {
        id: uid(),
        name: projectNameFor(config.cwd, s.projects.map((p) => p.name)),
        cwd: config.cwd.trim(),
        nextWorkspaceNumber: 2
      }
      const ws = makeWorkspace(project, config, 'Workspace 1')
      return {
        projects: [...s.projects, project],
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
        ...closedWelcome
      }
    }),

  renameProject: (id, name) =>
    set((s) => {
      const trimmed = name.trim()
      if (!trimmed) return s
      return { projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) }
    }),

  closeProject: (id) =>
    set((s) => {
      if (!s.projects.some((p) => p.id === id)) return s
      const projects = s.projects.filter((p) => p.id !== id)
      const workspaces = s.workspaces.filter((w) => w.projectId !== id)
      const activeWorkspaceId = workspaces.some((w) => w.id === s.activeWorkspaceId)
        ? s.activeWorkspaceId
        : workspaces[0]?.id ?? ''
      return {
        projects,
        workspaces,
        activeWorkspaceId,
        ...(projects.length === 0
          ? { welcomeFocused: true, welcomeProjectId: null }
          : s.welcomeProjectId === id ? closedWelcome : {})
      }
    }),

  moveProject: (fromId, toId) =>
    set((s) => {
      const from = s.projects.findIndex((p) => p.id === fromId)
      const to = s.projects.findIndex((p) => p.id === toId)
      if (from === -1 || to === -1 || from === to) return s
      return { projects: arrayMove(s.projects, from, to) }
    }),

  createWorkspace: (projectId, config) =>
    set((s) => {
      const project = s.projects.find((p) => p.id === projectId)
      if (!project) return s
      const names = new Set(s.workspaces.filter((w) => w.projectId === projectId).map((w) => w.name))
      let number = project.nextWorkspaceNumber
      while (names.has(`Workspace ${number}`)) number++
      const ws = makeWorkspace(project, config, `Workspace ${number}`)
      return {
        projects: s.projects.map((p) => p.id === projectId ? { ...p, nextWorkspaceNumber: number + 1 } : p),
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
        ...closedWelcome
      }
    }),

  setWelcomeFolder: (path) => set({ welcomeFolder: path }),

  openWelcome: (projectId) =>
    set((s) => projectId !== undefined && !s.projects.some((p) => p.id === projectId)
      ? s
      : { welcomeFocused: true, welcomeProjectId: projectId ?? null }),

  closeWelcome: () => set(closedWelcome),

  setActiveWorkspace: (id) =>
    set((s) =>
      s.workspaces.some((w) => w.id === id)
        ? { activeWorkspaceId: id, ...closedWelcome }
        : s
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
      if (index === -1) return s
      const remaining = s.workspaces.filter((w) => w.id !== id)
      let activeWorkspaceId = s.activeWorkspaceId
      if (id === s.activeWorkspaceId) {
        const inProject = (w: Workspace): boolean => w.projectId === s.workspaces[index].projectId
        const sibling = remaining.slice(index).find(inProject) ?? remaining.filter(inProject).at(-1)
        activeWorkspaceId = sibling?.id ?? remaining[Math.min(index, remaining.length - 1)]?.id ?? ''
      }
      return { workspaces: remaining, activeWorkspaceId }
    }),

  moveWorkspace: (fromId, toId) =>
    set((s) => {
      if (fromId === toId) return s
      const source = s.workspaces.find((w) => w.id === fromId)
      if (!source) return s
      const siblings = s.workspaces.filter((w) => w.projectId === source.projectId)
      const to = siblings.findIndex((w) => w.id === toId)
      if (to === -1) return s
      const reordered = arrayMove(siblings, siblings.indexOf(source), to)
      let i = 0
      return {
        workspaces: s.workspaces.map((w) => w.projectId === source.projectId ? reordered[i++] : w)
      }
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
        ...closedWelcome,
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

  resizeSplitNode: (workspaceId, splitId, sizes) =>
    set((s) => {
      // Hidden groups may still emit layout callbacks during a workspace switch.
      if (s.activeWorkspaceId !== workspaceId) return s
      return mapActive(s, (w) => {
        const layout = resizeSplit(w.layout, splitId, sizes)
        return layout === w.layout ? w : { ...w, layout }
      })
    }),

  // An explicit selection starts a fresh session, even for the same agent.
  setPaneAgent: (leafId, agentId) =>
    set((s) =>
      mapActive(s, (w) => {
        const leaf = findLeaf(w.layout, leafId)
        if (!leaf) return w
        return {
          ...w,
          layout: updateLeaf(w.layout, leafId, {
            agentId,
            agentSelectionVersion: (leaf.agentSelectionVersion ?? 0) + 1,
            resumeSessionId: undefined,
            observedConversation: undefined,
            needsConversationChoice: false
          })
        }
      })
    ),

  setPaneCwd: (leafId, cwd) =>
    set((s) =>
      mapActive(s, (w) => ({
        ...w,
        layout: updateLeaf(w.layout, leafId, {
          cwd,
          resumeSessionId: undefined,
          observedConversation: undefined
        })
      }))
    ),

  setPaneShell: (leafId, shellId) =>
    set((s) => mapActive(s, (w) => {
      const leaf = findLeaf(w.layout, leafId)
      if (!leaf || leaf.shellId === shellId) return w
      return { ...w, layout: updateLeaf(w.layout, leafId, {
        shellId,
        resumeSessionId: leaf.observedConversation?.id ?? leaf.resumeSessionId,
        cwd: leaf.observedConversation?.cwd ?? leaf.cwd,
        observedConversation: undefined
      }) }
    })),

  startPaneConversation: (terminalId, sessionId, cwd) => set((s) => {
    const workspace = selectWorkspaceByTerminalId(s, terminalId)
    const leaf = workspace && collectLeaves(workspace.layout).find((l) => l.terminalId === terminalId)
    if (!workspace || !leaf || (sessionId && !isValidSessionId(leaf.agentId ?? DEFAULT_TEMPLATE_ID, sessionId))) return s
    const layout = updateLeaf(workspace.layout, leaf.id, {
      resumeSessionId: sessionId,
      cwd: cwd ?? leaf.cwd,
      observedConversation: undefined,
      needsConversationChoice: false,
      agentSelectionVersion: (leaf.agentSelectionVersion ?? 0) + 1
    })
    return { workspaces: s.workspaces.map((w) => w === workspace ? { ...w, layout } : w) }
  }),

  recordPaneConversation: (terminalId, agentId, sessionId, cwd) => set((s) => {
    if (!isValidSessionId(agentId, sessionId)) return s
    const workspace = selectWorkspaceByTerminalId(s, terminalId)
    const leaf = workspace && collectLeaves(workspace.layout).find((l) => l.terminalId === terminalId)
    if (!workspace || !leaf || leaf.agentId !== agentId || leaf.needsConversationChoice) return s
    if (leaf.observedConversation?.id === sessionId && leaf.observedConversation.cwd === cwd) return s
    const layout = updateLeaf(workspace.layout, leaf.id, { observedConversation: { id: sessionId, cwd } })
    return { workspaces: s.workspaces.map((w) => w === workspace ? { ...w, layout } : w) }
  })
})

export const useAppStore = create<AppStore>()(appStoreCreator)

if (typeof window !== 'undefined') {
  const saved = readWorkspaceState(window.localStorage)
  if (saved) useAppStore.setState({ ...saved, welcomeFocused: saved.projects.length === 0 })
  useAppStore.subscribe((state, previous) => {
    if (state.projects !== previous.projects || state.workspaces !== previous.workspaces ||
        state.activeWorkspaceId !== previous.activeWorkspaceId) {
      writeWorkspaceState(window.localStorage, state)
    }
  })
}
