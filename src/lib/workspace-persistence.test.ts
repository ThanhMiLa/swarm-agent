import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { appStoreCreator } from '@/store/app-store'
import { collectLeaves } from './layout-tree'
import { buildResumeCommand } from './resume-command'
import { readWorkspaceState, writeWorkspaceState } from './workspace-persistence'

const CODEX = '018f3b2a-7c1d-4e0a-9b2f-1a2b3c4d5e6f'
const OTHER = '018f3b2b-7c1d-4e0a-9b2f-1a2b3c4d5e6f'

describe('workspace restore', () => {
  it('keeps same-agent panes distinct and restores workspace selection and split dimensions', () => {
    const store = createStore(appStoreCreator)
    const { createProject, createWorkspace, recordPaneConversation, revealTerminal, resizeSplitNode } = store.getState()
    createProject({ cwd: '/repo', terminalCount: 2, agentIds: ['codex', 'codex'] })
    const first = store.getState().workspaces[0]
    const [left, right] = collectLeaves(first.layout)
    resizeSplitNode(first.id, first.layout.id, [35, 65])
    createWorkspace(first.projectId, { terminalCount: 1, agentIds: ['opencode'] })
    recordPaneConversation(left.terminalId, 'codex', CODEX, '/repo/nested')
    recordPaneConversation(right.terminalId, 'codex', OTHER)
    revealTerminal(right.terminalId)
    const storage = { setItem: vi.fn(), getItem: () => storage.setItem.mock.lastCall![1] as string }
    writeWorkspaceState(storage, store.getState())
    const result = readWorkspaceState(storage)!
    expect(result.projects[0].cwd).toBe('/repo')
    expect(result.activeWorkspaceId).toBe(first.id)
    expect(result.workspaces[0].focusedLeafId).toBe(right.id)
    expect(result.workspaces[0].layout).toMatchObject({ sizes: [35, 65] })
    const panes = collectLeaves(result.workspaces[0].layout)
    expect(panes.map((p) => p.resumeSessionId)).toEqual([CODEX, OTHER])
    expect(panes[0].cwd).toBe('/repo/nested')
    expect(collectLeaves(result.workspaces[1].layout)[0].needsConversationChoice).toBe(true)
    expect(store.getState().workspaces[0].layout).not.toHaveProperty('resumeSessionId')
    expect(panes.map((p) => buildResumeCommand('codex', p.resumeSessionId!))).toEqual([
      expect.stringContaining(` resume ${CODEX}`), expect.stringContaining(` resume ${OTHER}`)
    ])
  })

  it('rejects bad IDs and corrupted JSON without opening a different conversation', () => {
    expect(readWorkspaceState({ getItem: () => 'bad json' })).toBeUndefined()
    const state = {
      projects: [{ id: 'p1', name: 'Project', cwd: '/repo', nextWorkspaceNumber: 2 }],
      workspaces: [{ id: 'w1', projectId: 'p1', name: 'Workspace', focusedLeafId: 'l1',
        layout: { type: 'leaf', id: 'l1', terminalId: 't1', agentId: 'codex', resumeSessionId: `${CODEX}\n` } }]
    }
    const restored = readWorkspaceState({ getItem: () => JSON.stringify(state) })!
    expect(restored.workspaces[0].layout).toMatchObject({
      resumeSessionId: undefined, needsConversationChoice: true
    })
    expect(buildResumeCommand('codex', `${CODEX}\n`)).toBeUndefined()
  })

  it('does not reuse observed IDs after an explicit new conversation or agent restart', () => {
    const store = createStore(appStoreCreator)
    const actions = store.getState()
    actions.createProject({ cwd: '/repo', terminalCount: 1, agentIds: ['codex'] })
    const pane = () => collectLeaves(store.getState().workspaces[0].layout)[0]
    actions.recordPaneConversation(pane().terminalId, 'claude-code', CODEX)
    expect(pane().observedConversation).toBeUndefined()
    actions.recordPaneConversation(pane().terminalId, 'codex', OTHER)
    // Tracking is metadata-only and never mutates the live launch command.
    expect(pane().resumeSessionId).toBeUndefined()
    expect(pane().observedConversation?.id).toBe(OTHER)
    actions.startPaneConversation(pane().terminalId, CODEX)
    expect(pane().resumeSessionId).toBe(CODEX)
    expect(pane().observedConversation).toBeUndefined()
    actions.setPaneAgent(pane().id, 'codex')
    expect(pane().resumeSessionId).toBeUndefined()
  })
})
