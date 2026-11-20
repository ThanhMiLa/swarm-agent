import { describe, it, expect } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  appStoreCreator,
  selectWorkspaceByTerminalId,
  selectFocusedTerminalId,
  type AppStore,
  type CreateProjectConfig,
  type Workspace
} from './app-store'
import { collectLeaves, type SplitNode } from '@/lib/layout-tree'

function freshStore(): StoreApi<AppStore> {
  return createStore<AppStore>()(appStoreCreator)
}

const SINGLE_TERMINAL: CreateProjectConfig = {
  cwd: 'C:/work',
  terminalCount: 1,
  agentIds: ['terminal']
}

/** N plain-terminal panes — the agentIds a "create N panes" test wants. */
function panes(n: number): string[] {
  return Array.from({ length: n }, () => 'terminal')
}

/** A fresh store with one project and its first workspace. */
function storeWithWorkspace(config: CreateProjectConfig = SINGLE_TERMINAL): StoreApi<AppStore> {
  const store = freshStore()
  store.getState().createProject(config)
  return store
}

function addWorkspace(store: StoreApi<AppStore>, config = SINGLE_TERMINAL): void {
  store.getState().createWorkspace(activeWorkspace(store).projectId, config)
}

function activeWorkspace(store: StoreApi<AppStore>): Workspace {
  const s = store.getState()
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
  if (!ws) throw new Error('no active workspace')
  return ws
}

// --- initial state --------------------------------------------------------

describe('initial state', () => {
  it('starts with no projects or workspaces', () => {
    expect(freshStore().getState().projects).toHaveLength(0)
    expect(freshStore().getState().workspaces).toHaveLength(0)
  })

  it('has no active workspace', () => {
    expect(freshStore().getState().activeWorkspaceId).toBe('')
  })
})

describe('createProject', () => {
  it('names the project after its folder and creates Workspace 1', () => {
    const store = storeWithWorkspace()
    const { projects, workspaces } = store.getState()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('work')
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({ name: 'Workspace 1', projectId: projects[0].id })
  })

  it('suffixes repeats of the same folder name', () => {
    const store = storeWithWorkspace()
    store.getState().createProject({ ...SINGLE_TERMINAL, cwd: '/somewhere/work' })
    expect(store.getState().projects.map((p) => p.name)).toEqual(['work', 'work (1)'])
    expect(store.getState().workspaces.map((w) => w.name)).toEqual(['Workspace 1', 'Workspace 1'])
  })

  it('stores the chosen working directory on the project', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, cwd: ' D:/projects/app ' })
    expect(store.getState().projects[0].cwd).toBe('D:/projects/app')
  })
})

describe('project actions', () => {
  it('renames and reorders projects without touching workspace layouts or focus', () => {
    const store = storeWithWorkspace()
    store.getState().createProject({ ...SINGLE_TERMINAL, cwd: '/other' })
    const before = store.getState()
    const [first, second] = before.projects
    before.renameProject(first.id, '  Web app  ')
    before.moveProject(first.id, second.id)
    expect(store.getState().projects.map((p) => p.name)).toEqual(['other', 'Web app'])
    expect(store.getState().workspaces).toBe(before.workspaces)
    expect(store.getState().activeWorkspaceId).toBe(before.activeWorkspaceId)
  })

  it('closes all workspaces of that project and cancels its composer', () => {
    const store = storeWithWorkspace()
    addWorkspace(store)
    const closingProjectId = activeWorkspace(store).projectId
    const closingWorkspaceId = activeWorkspace(store).id
    store.getState().createProject({ ...SINGLE_TERMINAL, cwd: '/other' })
    const surviving = activeWorkspace(store)
    store.getState().setActiveWorkspace(closingWorkspaceId)
    store.getState().openWelcome(closingProjectId)
    store.getState().closeProject(closingProjectId)
    expect(store.getState().projects.map((p) => p.id)).toEqual([surviving.projectId])
    expect(store.getState().workspaces).toEqual([surviving])
    expect(store.getState().activeWorkspaceId).toBe(surviving.id)
    expect(store.getState().welcomeProjectId).toBeNull()
    expect(store.getState().welcomeFocused).toBe(false)
  })
})

describe('createWorkspace', () => {
  it('makes the new workspace active', () => {
    const store = storeWithWorkspace()
    addWorkspace(store)
    expect(store.getState().activeWorkspaceId).toBe(store.getState().workspaces[1].id)
  })

  it('adds a distinct layout with three panes to the chosen project', () => {
    const store = storeWithWorkspace()
    const [project] = store.getState().projects
    const first = activeWorkspace(store)
    store.getState().createProject({ ...SINGLE_TERMINAL, cwd: '/other' })
    store.getState().createWorkspace(project.id, {
      terminalCount: 3, agentIds: ['codex', 'codex', 'claude-code']
    })
    const ws = activeWorkspace(store)
    expect(ws).toMatchObject({ projectId: project.id, name: 'Workspace 2' })
    const leaves = collectLeaves(ws.layout)
    expect(leaves.map((l) => l.agentId)).toEqual(['codex', 'codex', 'claude-code'])
    expect(new Set([...leaves, ...collectLeaves(first.layout)].map((l) => l.terminalId)).size).toBe(4)
    expect(store.getState().workspaces[0]).toBe(first)
  })

  it('does not create an orphan workspace when the project does not exist', () => {
    const store = freshStore()
    store.getState().createWorkspace('missing', SINGLE_TERMINAL)
    expect(store.getState().workspaces).toEqual([])
  })

  it('builds the requested number of terminal panes', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, terminalCount: 6, agentIds: panes(6) })
    expect(collectLeaves(activeWorkspace(store).layout)).toHaveLength(6)
  })

  it('focuses the first pane', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, terminalCount: 4, agentIds: panes(4) })
    const ws = activeWorkspace(store)
    expect(ws.focusedLeafId).toBe(collectLeaves(ws.layout)[0].id)
  })

  it('stamps each leaf with its agent id from the agentIds list', () => {
    const store = storeWithWorkspace({
      cwd: 'C:/work',
      terminalCount: 4,
      agentIds: ['claude-code', 'claude-code', 'codex', 'terminal']
    })
    const leaves = collectLeaves(activeWorkspace(store).layout)
    expect(leaves).toHaveLength(4)
    expect(leaves.map((l) => l.agentId)).toEqual([
      'claude-code',
      'claude-code',
      'codex',
      'terminal'
    ])
  })

  it('sets the agent id to terminal for the Terminal template', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, terminalCount: 2, agentIds: panes(2) })
    const leaves = collectLeaves(activeWorkspace(store).layout)
    expect(leaves.every((l) => l.agentId === 'terminal')).toBe(true)
  })

  it('falls back to terminal when agentIds shorter than pane count', () => {
    const store = storeWithWorkspace({
      cwd: 'C:/work',
      terminalCount: 4,
      agentIds: ['claude-code', 'claude-code']
    })
    const leaves = collectLeaves(activeWorkspace(store).layout)
    expect(leaves).toHaveLength(4)
    expect(leaves[0].agentId).toBe('claude-code')
    expect(leaves[1].agentId).toBe('claude-code')
    expect(leaves[2].agentId).toBe('terminal')
    expect(leaves[3].agentId).toBe('terminal')
  })

  it('gives each pane a distinct terminalId', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, terminalCount: 8, agentIds: panes(8) })
    const ids = collectLeaves(activeWorkspace(store).layout).map((l) => l.terminalId)
    expect(new Set(ids).size).toBe(8)
  })
})

// --- setActiveWorkspace ---------------------------------------------------

describe('setActiveWorkspace', () => {
  it('switches the active workspace', () => {
    const store = storeWithWorkspace()
    const firstId = store.getState().workspaces[0].id
    addWorkspace(store)
    store.getState().setActiveWorkspace(firstId)
    expect(store.getState().activeWorkspaceId).toBe(firstId)
  })

  it('preserves both split trees, focused panes and terminal ids when switching within a project', () => {
    const store = storeWithWorkspace()
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'horizontal')
    const { id, layout } = activeWorkspace(store)
    store.getState().resizeSplitNode(id, layout.id, [35, 65])
    const first = activeWorkspace(store)
    addWorkspace(store)
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'vertical')
    const second = activeWorkspace(store)

    store.getState().setActiveWorkspace(first.id)
    expect(activeWorkspace(store)).toBe(first)
    store.getState().setActiveWorkspace(second.id)
    expect(activeWorkspace(store)).toBe(second)
  })
})

// --- renameWorkspace ------------------------------------------------------

describe('renameWorkspace', () => {
  it('updates the workspace name', () => {
    const store = storeWithWorkspace()
    store.getState().renameWorkspace(store.getState().workspaces[0].id, 'web')
    expect(store.getState().workspaces[0].name).toBe('web')
  })

  it('trims surrounding whitespace', () => {
    const store = storeWithWorkspace()
    store.getState().renameWorkspace(store.getState().workspaces[0].id, '  api  ')
    expect(store.getState().workspaces[0].name).toBe('api')
  })

  it('ignores an empty or whitespace-only name', () => {
    const store = storeWithWorkspace()
    store.getState().renameWorkspace(store.getState().workspaces[0].id, '   ')
    expect(store.getState().workspaces[0].name).toBe('Workspace 1')
  })
})

// --- closeWorkspace -------------------------------------------------------

describe('closeWorkspace', () => {
  it('removes a non-active workspace', () => {
    const store = storeWithWorkspace()
    const firstId = store.getState().workspaces[0].id
    addWorkspace(store)
    store.getState().closeWorkspace(firstId)
    expect(store.getState().workspaces).toHaveLength(1)
    expect(store.getState().workspaces[0].name).toBe('Workspace 2')
  })

  it('keeps the active workspace unchanged when closing another', () => {
    const store = storeWithWorkspace()
    const firstId = store.getState().workspaces[0].id
    addWorkspace(store)
    const activeBefore = store.getState().activeWorkspaceId
    store.getState().closeWorkspace(firstId)
    expect(store.getState().activeWorkspaceId).toBe(activeBefore)
  })

  it('moves the active marker when closing the active workspace', () => {
    const store = storeWithWorkspace()
    const firstId = store.getState().workspaces[0].id
    addWorkspace(store)
    const secondId = store.getState().activeWorkspaceId
    store.getState().closeWorkspace(secondId)
    expect(store.getState().workspaces).toHaveLength(1)
    expect(store.getState().activeWorkspaceId).toBe(firstId)
  })

  it('leaves the project open when its last workspace is closed', () => {
    const store = storeWithWorkspace()
    const [project] = store.getState().projects
    store.getState().closeWorkspace(activeWorkspace(store).id)
    expect(store.getState().workspaces).toHaveLength(0)
    expect(store.getState().activeWorkspaceId).toBe('')
    expect(store.getState().projects).toEqual([project])
    store.getState().createWorkspace(project.id, SINGLE_TERMINAL)
    expect(activeWorkspace(store).name).toBe('Workspace 2')
  })
})

// --- moveWorkspace --------------------------------------------------------

describe('moveWorkspace', () => {
  function threeWorkspaces(): StoreApi<AppStore> {
    const store = storeWithWorkspace()
    addWorkspace(store)
    addWorkspace(store)
    return store
  }

  it('moves a workspace later in the list', () => {
    const store = threeWorkspaces()
    const [a, , c] = store.getState().workspaces
    store.getState().moveWorkspace(a.id, c.id)
    expect(store.getState().workspaces.map((w) => w.name)).toEqual([
      'Workspace 2',
      'Workspace 3',
      'Workspace 1'
    ])
  })

  it('moves a workspace earlier in the list', () => {
    const store = threeWorkspaces()
    const [a, , c] = store.getState().workspaces
    store.getState().moveWorkspace(c.id, a.id)
    expect(store.getState().workspaces.map((w) => w.name)).toEqual([
      'Workspace 3',
      'Workspace 1',
      'Workspace 2'
    ])
  })

  it('ignores a non-existent id', () => {
    const store = threeWorkspaces()
    const before = store.getState().workspaces.map((w) => w.id)
    store.getState().moveWorkspace('nope', before[0])
    expect(store.getState().workspaces.map((w) => w.id)).toEqual(before)
  })

  it('ignores a non-existent target id', () => {
    const store = threeWorkspaces()
    const before = store.getState().workspaces.map((w) => w.id)
    store.getState().moveWorkspace(before[0], 'nope')
    expect(store.getState().workspaces.map((w) => w.id)).toEqual(before)
  })

  it('is a no-op when source and target are the same', () => {
    const store = threeWorkspaces()
    const before = store.getState().workspaces.map((w) => w.id)
    store.getState().moveWorkspace(before[1], before[1])
    expect(store.getState().workspaces.map((w) => w.id)).toEqual(before)
  })

  it('does not change the active workspace', () => {
    const store = threeWorkspaces()
    const activeBefore = store.getState().activeWorkspaceId
    const [a, , c] = store.getState().workspaces
    store.getState().moveWorkspace(a.id, c.id)
    expect(store.getState().activeWorkspaceId).toBe(activeBefore)
  })

  it('does not reorder workspaces across projects', () => {
    const store = threeWorkspaces()
    store.getState().createProject(SINGLE_TERMINAL)
    const before = store.getState().workspaces
    store.getState().moveWorkspace(before[0].id, activeWorkspace(store).id)
    expect(store.getState().workspaces).toBe(before)
  })
})

// --- splitPane ------------------------------------------------------------

describe('splitPane', () => {
  it('splits the focused pane into two', () => {
    const store = storeWithWorkspace()
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'horizontal')
    expect(collectLeaves(activeWorkspace(store).layout)).toHaveLength(2)
  })

  it('focuses the newly created pane', () => {
    const store = storeWithWorkspace()
    const original = activeWorkspace(store).focusedLeafId
    store.getState().splitPane(original, 'vertical')
    expect(activeWorkspace(store).focusedLeafId).not.toBe(original)
  })

  it('records the split direction on the new split node', () => {
    const store = storeWithWorkspace()
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'vertical')
    const layout = activeWorkspace(store).layout as SplitNode
    expect(layout.type).toBe('split')
    expect(layout.direction).toBe('vertical')
  })

  it('creates the split pane with no agent override (plain shell)', () => {
    const store = storeWithWorkspace({ cwd: 'C:/work', terminalCount: 1, agentIds: ['claude-code'] })
    const original = activeWorkspace(store).focusedLeafId
    store.getState().splitPane(original, 'horizontal')
    const created = collectLeaves(activeWorkspace(store).layout).find((l) => l.id !== original)
    expect(created?.agentId).toBeUndefined()
  })
})

// --- closePane ------------------------------------------------------------

describe('closePane', () => {
  it('removes a pane and collapses the tree', () => {
    const store = storeWithWorkspace()
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'horizontal')
    const leaves = collectLeaves(activeWorkspace(store).layout)
    store.getState().closePane(leaves[0].id)
    expect(collectLeaves(activeWorkspace(store).layout)).toHaveLength(1)
  })

  it('moves focus to a surviving pane when the focused pane is closed', () => {
    const store = storeWithWorkspace()
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'horizontal')
    const focused = activeWorkspace(store).focusedLeafId
    store.getState().closePane(focused)
    const ws = activeWorkspace(store)
    expect(ws.focusedLeafId).not.toBe(focused)
    expect(collectLeaves(ws.layout).some((l) => l.id === ws.focusedLeafId)).toBe(true)
  })

  it('closes the workspace when its last pane is closed', () => {
    const store = storeWithWorkspace()
    addWorkspace(store)
    const secondId = store.getState().activeWorkspaceId
    store.getState().closePane(activeWorkspace(store).focusedLeafId)
    expect(store.getState().workspaces.some((w) => w.id === secondId)).toBe(false)
    expect(store.getState().workspaces).toHaveLength(1)
  })

  it('leaves no workspaces when the last pane of the only workspace is closed', () => {
    const store = storeWithWorkspace()
    store.getState().closePane(activeWorkspace(store).focusedLeafId)
    expect(store.getState().workspaces).toHaveLength(0)
  })
})

// --- resizeSplitNode ------------------------------------------------------

describe('resizeSplitNode', () => {
  it('updates the sizes of a split node', () => {
    const store = storeWithWorkspace()
    store.getState().splitPane(activeWorkspace(store).focusedLeafId, 'horizontal')
    const layout = activeWorkspace(store).layout as SplitNode
    store.getState().resizeSplitNode(activeWorkspace(store).id, layout.id, [30, 70])
    expect((activeWorkspace(store).layout as SplitNode).sizes).toEqual([30, 70])
  })

  it('ignores callbacks from a hidden workspace', () => {
    const store = storeWithWorkspace(FOUR_PANES)
    const first = activeWorkspace(store)
    addWorkspace(store, FOUR_PANES)
    const second = activeWorkspace(store)
    store.getState().resizeSplitNode(first.id, first.layout.id, [80, 20])
    expect(store.getState().workspaces).toEqual([first, second])
    expect(activeWorkspace(store)).toBe(second)
  })
})

// --- pane overrides -------------------------------------------------------

describe('setPaneAgent', () => {
  it('sets the agent id on the targeted leaf', () => {
    const store = storeWithWorkspace()
    const leafId = activeWorkspace(store).focusedLeafId
    store.getState().setPaneAgent(leafId, 'codex')
    const leaf = collectLeaves(activeWorkspace(store).layout).find((l) => l.id === leafId)
    expect(leaf?.agentId).toBe('codex')
  })

  it('requests a restart on every reselection without changing pane identity or overrides', () => {
    const store = storeWithWorkspace({
      ...SINGLE_TERMINAL,
      terminalCount: 2,
      agentIds: ['codex', 'terminal']
    })
    const { setPaneAgent, setPaneCwd, setPaneShell } = store.getState()
    const leafId = activeWorkspace(store).focusedLeafId
    setPaneCwd(leafId, 'D:/elsewhere')
    setPaneShell(leafId, 'wsl')
    const [original, sibling] = collectLeaves(activeWorkspace(store).layout)

    for (const version of [1, 2]) {
      setPaneAgent(leafId, 'codex')
      const [selected, untouched] = collectLeaves(activeWorkspace(store).layout)
      expect(selected).toEqual({ ...original, agentSelectionVersion: version })
      expect(untouched).toBe(sibling)
    }
  })

  it('clears the resume session when reselecting the same agent', () => {
    const cwd = 'C:/work/codex'
    const store = storeWithWorkspace({
      ...SINGLE_TERMINAL,
      resumePanes: [{ agentId: 'codex', sessionId: 'fe845bc6-6932-4459-8fb6-cdd0e7c6cc84', cwd }]
    })
    const [, resumed] = collectLeaves(activeWorkspace(store).layout)
    store.getState().setPaneAgent(resumed.id, 'codex')
    const [, selected] = collectLeaves(activeWorkspace(store).layout)
    expect(selected).toEqual({
      ...resumed,
      resumeSessionId: undefined,
      agentSelectionVersion: 1
    })
  })
})

describe('setPaneCwd', () => {
  it('sets a per-pane cwd override', () => {
    const store = storeWithWorkspace()
    const leafId = activeWorkspace(store).focusedLeafId
    store.getState().setPaneCwd(leafId, 'D:/elsewhere')
    const leaf = collectLeaves(activeWorkspace(store).layout).find((l) => l.id === leafId)
    expect(leaf?.cwd).toBe('D:/elsewhere')
  })

  it('clears the override when passed undefined', () => {
    const store = storeWithWorkspace()
    const leafId = activeWorkspace(store).focusedLeafId
    store.getState().setPaneCwd(leafId, 'D:/elsewhere')
    store.getState().setPaneCwd(leafId, undefined)
    const leaf = collectLeaves(activeWorkspace(store).layout).find((l) => l.id === leafId)
    expect(leaf?.cwd).toBeUndefined()
  })
})

describe('setPaneShell', () => {
  it('sets a per-pane shell override', () => {
    const store = storeWithWorkspace()
    const leafId = activeWorkspace(store).focusedLeafId
    store.getState().setPaneShell(leafId, 'wsl')
    const leaf = collectLeaves(activeWorkspace(store).layout).find((l) => l.id === leafId)
    expect(leaf?.shellId).toBe('wsl')
  })
})

// --- welcome state --------------------------------------------------------

describe('welcome state', () => {
  it('starts in New project', () => {
    const s = freshStore().getState()
    expect(s.welcomeFocused).toBe(true)
    expect(s.welcomeProjectId).toBeNull()
  })

  it('opens New workspace for the chosen project', () => {
    const store = storeWithWorkspace()
    const [project] = store.getState().projects
    store.getState().setWelcomeFolder('/draft')
    store.getState().openWelcome(project.id)
    expect(store.getState().welcomeFocused).toBe(true)
    expect(store.getState().welcomeProjectId).toBe(project.id)
    expect(store.getState().welcomeFolder).toBe('/draft')
  })

  it('closes and clears the target on cancel', () => {
    const store = storeWithWorkspace()
    store.getState().openWelcome(activeWorkspace(store).projectId)
    store.getState().closeWelcome()
    expect(store.getState().welcomeFocused).toBe(false)
    expect(store.getState().welcomeProjectId).toBeNull()
  })

  it('can switch the composer back to New project', () => {
    const store = storeWithWorkspace()
    store.getState().openWelcome(activeWorkspace(store).projectId)
    store.getState().openWelcome()
    expect(store.getState().welcomeFocused).toBe(true)
    expect(store.getState().welcomeProjectId).toBeNull()
  })

  it('creating a workspace closes welcome', () => {
    const store = storeWithWorkspace()
    store.getState().openWelcome(activeWorkspace(store).projectId)
    addWorkspace(store)
    expect(store.getState().welcomeFocused).toBe(false)
    expect(store.getState().welcomeProjectId).toBeNull()
  })

  it('switching to a workspace unfocuses welcome', () => {
    const store = storeWithWorkspace()
    const id = store.getState().workspaces[0].id
    store.getState().openWelcome()
    store.getState().setActiveWorkspace(id)
    expect(store.getState().welcomeFocused).toBe(false)
  })

  it('closing the only project returns to New project', () => {
    const store = storeWithWorkspace()
    store.getState().closeProject(activeWorkspace(store).projectId)
    expect(store.getState().welcomeFocused).toBe(true)
    expect(store.getState().welcomeProjectId).toBeNull()
  })
})

describe('selectWorkspaceByTerminalId', () => {
  it('finds the workspace whose layout contains the terminalId', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, terminalCount: 2, agentIds: panes(2) })
    const ws = activeWorkspace(store)
    const termId = collectLeaves(ws.layout)[0].terminalId
    expect(selectWorkspaceByTerminalId(store.getState(), termId)?.id).toBe(ws.id)
  })

  it('returns undefined for an unknown terminalId', () => {
    const store = storeWithWorkspace()
    expect(selectWorkspaceByTerminalId(store.getState(), 'nope')).toBeUndefined()
  })
})

// --- selectFocusedTerminalId ----------------------------------------------

describe('selectFocusedTerminalId', () => {
  it('resolves the focused leaf of the active workspace to its terminalId', () => {
    const store = storeWithWorkspace({ ...SINGLE_TERMINAL, terminalCount: 2, agentIds: panes(2) })
    const ws = activeWorkspace(store)
    const second = collectLeaves(ws.layout)[1]
    store.getState().setFocusedLeaf(second.id)
    expect(selectFocusedTerminalId(store.getState())).toBe(second.terminalId)
  })

  it('follows the active workspace when the user switches tabs', () => {
    const store = storeWithWorkspace()
    const first = activeWorkspace(store)
    addWorkspace(store)
    store.getState().setActiveWorkspace(first.id)
    expect(selectFocusedTerminalId(store.getState())).toBe(collectLeaves(first.layout)[0].terminalId)
  })

  it('returns undefined when there is no workspace', () => {
    expect(selectFocusedTerminalId(freshStore().getState())).toBeUndefined()
  })

  it('has no focused terminal while the composer covers the workspace', () => {
    const store = storeWithWorkspace()
    const { openWelcome, closeWelcome } = store.getState()
    const before = selectFocusedTerminalId(store.getState())
    openWelcome(activeWorkspace(store).projectId)
    expect(selectFocusedTerminalId(store.getState())).toBeUndefined()
    closeWelcome()
    expect(selectFocusedTerminalId(store.getState())).toBe(before)
  })
})

// --- reorderPane ----------------------------------------------------------

const TWO_PANES: CreateProjectConfig = {
  cwd: 'C:/w',
  terminalCount: 2,
  agentIds: ['claude-code', 'terminal']
}

const FOUR_PANES: CreateProjectConfig = {
  cwd: 'C:/w',
  terminalCount: 4,
  agentIds: ['claude-code', 'terminal', 'codex', 'opencode']
}

describe('reorderPane', () => {
  it('moves a pane to the target slot, reflowing the rest, in the active workspace', () => {
    const store = storeWithWorkspace(FOUR_PANES)
    const ids = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    // Drag pane 0 onto pane 2: [0,1,2,3] -> [1,2,0,3]
    store.getState().reorderPane(ids[0], ids[2])
    const after = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    expect(after).toEqual([ids[1], ids[2], ids[0], ids[3]])
  })

  it('swaps two panes when there are only two slots', () => {
    const store = storeWithWorkspace(TWO_PANES)
    const [a, b] = collectLeaves(activeWorkspace(store).layout)
    store.getState().reorderPane(a.id, b.id)
    const after = collectLeaves(activeWorkspace(store).layout)
    expect(after[0].id).toBe(b.id)
    expect(after[1].id).toBe(a.id)
    // The agent override travels with the node to its new slot.
    expect(after[0].agentId).toBe(b.agentId)
    expect(after[1].agentId).toBe(a.agentId)
  })

  it('keeps focusedLeafId on the dragged pane after the reorder', () => {
    const store = storeWithWorkspace(FOUR_PANES)
    const ids = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    store.getState().setFocusedLeaf(ids[0])
    store.getState().reorderPane(ids[0], ids[2])
    expect(activeWorkspace(store).focusedLeafId).toBe(ids[0])
  })

  it('no-ops when the two ids are the same', () => {
    const store = storeWithWorkspace(FOUR_PANES)
    const before = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    store.getState().reorderPane(before[0], before[0])
    const after = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    expect(after).toEqual(before)
  })

  it('no-ops when a leaf id does not exist', () => {
    const store = storeWithWorkspace(FOUR_PANES)
    const before = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    store.getState().reorderPane(before[0], 'nonexistent')
    const after = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    expect(after).toEqual(before)
  })

  it('leaves other (inactive) workspaces untouched', () => {
    const store = storeWithWorkspace(FOUR_PANES) // workspace 1
    const firstWsId = store.getState().activeWorkspaceId
    const firstLayoutBefore = store.getState().workspaces.find((w) => w.id === firstWsId)!.layout
    addWorkspace(store, FOUR_PANES) // workspace 2 — now the active one
    const ids = collectLeaves(activeWorkspace(store).layout).map((l) => l.id)
    store.getState().reorderPane(ids[0], ids[2])
    const firstLayoutAfter = store.getState().workspaces.find((w) => w.id === firstWsId)!.layout
    // mapActive maps only the active workspace, so the inactive one's layout
    // object is returned untouched — same reference, not just deep-equal.
    expect(firstLayoutAfter).toBe(firstLayoutBefore)
  })
})

describe('drop target', () => {
  it('starts with no drop target', () => {
    expect(freshStore().getState().dropTargetTerminalId).toBeNull()
  })

  it('sets and clears the drop target', () => {
    const store = freshStore()
    store.getState().setDropTarget('term-1')
    expect(store.getState().dropTargetTerminalId).toBe('term-1')
    store.getState().setDropTarget(null)
    expect(store.getState().dropTargetTerminalId).toBeNull()
  })
})

// --- revealTerminal -------------------------------------------------------

describe('revealTerminal', () => {
  it('activates the owning workspace and focuses the pane', () => {
    const store = freshStore()
    store.getState().createProject({ cwd: '/one', terminalCount: 2, agentIds: panes(2) })
    const first = activeWorkspace(store)
    const targetLeaf = collectLeaves(first.layout)[1]
    addWorkspace(store) // becomes active
    expect(store.getState().activeWorkspaceId).not.toBe(first.id)

    store.getState().revealTerminal(targetLeaf.terminalId)

    const s = store.getState()
    expect(s.activeWorkspaceId).toBe(first.id)
    const ws = s.workspaces.find((w) => w.id === first.id)
    expect(ws?.focusedLeafId).toBe(targetLeaf.id)
  })

  it('is a no-op for an unknown terminal', () => {
    const store = storeWithWorkspace()
    const before = store.getState().activeWorkspaceId
    store.getState().revealTerminal('nope')
    expect(store.getState().activeWorkspaceId).toBe(before)
  })
})
