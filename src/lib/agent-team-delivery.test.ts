import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAgentTeamDelivery } from './agent-team-delivery'
import { useAgentTeamStore } from '@/store/agent-team-store'
import { useAgentStateStore } from '@/store/agent-state-store'
import { useTerminalTypingStore } from '@/store/terminal-typing-store'

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  composer: vi.fn(),
  snapshot: vi.fn()
}))

vi.mock('@/lib/terminal-registry', () => ({ getTeamComposerState: mocks.composer }))
vi.mock('@/tauri/agent-team', () => ({
  deliverTeamPrompt: mocks.deliver,
  onTeamChanged: () => Promise.resolve(() => {}),
  teamSnapshot: mocks.snapshot
}))

const delivery = { id: 'task', terminalId: 'worker', generation: 42 }
const snapshot = { revision: 1, teams: [], pending: [delivery], connected: {} }
let stop: () => void

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  useAgentTeamStore.setState({ snapshot, holds: {} })
  useTerminalTypingStore.setState({ dirty: {}, lastKeyAt: {} })
  useAgentStateStore.getState().publish('worker', 'idle', { paneWatched: false, nowMs: Date.now() })
  mocks.composer.mockReturnValue(true)
  mocks.snapshot.mockResolvedValue(snapshot)
  mocks.deliver.mockImplementation(async (_, phase) => {
    if (phase === 'paste') {
      mocks.snapshot.mockResolvedValue({ ...snapshot, pending: [] })
      return 'noteditfiles.Task:hello'
    }
    return null
  })
  stop = startAgentTeamDelivery()
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('Agent Team terminal delivery', () => {
  it('holds a queued prompt behind typed input, then submits to the exact generation', async () => {
    useTerminalTypingStore.getState().noteInput('worker', 'my draft')
    await vi.advanceTimersByTimeAsync(4000)
    expect(mocks.deliver).not.toHaveBeenCalled()
    expect(useAgentTeamStore.getState().holds.task).toMatch(/typing/)

    useTerminalTypingStore.getState().clearTyping('worker')
    await vi.advanceTimersByTimeAsync(2700)
    expect(mocks.composer).toHaveBeenLastCalledWith('worker', 'noteditfiles.Task:hello')
    expect(mocks.deliver.mock.calls).toEqual([[delivery, 'paste'], [delivery, 'submit']])
  })

  it('waits for the draft to finish rendering before sending Enter', async () => {
    let painted = false
    mocks.composer.mockImplementation((_, draftTail) => draftTail === undefined || painted)
    await vi.advanceTimersByTimeAsync(2800)
    expect(mocks.deliver.mock.calls).toEqual([[delivery, 'paste']])

    painted = true
    await vi.advanceTimersByTimeAsync(200)
    expect(mocks.deliver.mock.calls).toEqual([[delivery, 'paste'], [delivery, 'submit']])
  })

  it('does not send Enter when a permission prompt appears after the paste', async () => {
    mocks.deliver.mockImplementation(async (_, phase) => {
      if (phase === 'paste') {
        mocks.snapshot.mockResolvedValue({ ...snapshot, pending: [] })
        useAgentStateStore.getState().publish('worker', 'blocked', { paneWatched: false, nowMs: Date.now() })
        return 'noteditfiles.Task:hello'
      }
      return null
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.deliver.mock.calls.map(([, phase]) => phase)).toEqual(['paste', 'fail'])
  })

  it('delivers results to the same pane in separate turns', async () => {
    const next = { ...delivery, id: 'next-result' }
    const queued = { ...snapshot, revision: 2, pending: [delivery, next] }
    mocks.snapshot.mockResolvedValue(queued)
    mocks.deliver.mockImplementation(async (item, phase) => {
      if (phase === 'paste') return 'report-tail'
      if (item.id === delivery.id) {
        useAgentStateStore.getState().publish('worker', 'working', { paneWatched: false, nowMs: Date.now() })
        mocks.snapshot.mockResolvedValue({ ...queued, revision: 3, pending: [next] })
      } else {
        mocks.snapshot.mockResolvedValue({ ...queued, revision: 4, pending: [] })
      }
      return null
    })

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.deliver.mock.calls).toEqual([[delivery, 'paste'], [delivery, 'submit']])
    expect(useAgentTeamStore.getState().holds[next.id]).toMatch(/return to its prompt/)

    useAgentStateStore.getState().publish('worker', 'idle', { paneWatched: false, nowMs: Date.now() })
    await vi.advanceTimersByTimeAsync(2700)
    expect(mocks.deliver.mock.calls).toEqual([
      [delivery, 'paste'], [delivery, 'submit'], [next, 'paste'], [next, 'submit']
    ])
  })

  it('keeps a result queued if an earlier automated draft is still in the pane', async () => {
    mocks.deliver.mockImplementationOnce(async () => null)
    await vi.advanceTimersByTimeAsync(2750)
    expect(mocks.deliver.mock.calls).toEqual([[delivery, 'paste']])
    expect(useAgentTeamStore.getState().holds.task).toMatch(/previous Agent Team draft/)

    await vi.advanceTimersByTimeAsync(2300)
    expect(mocks.deliver.mock.calls).toEqual([
      [delivery, 'paste'], [delivery, 'paste'], [delivery, 'submit']
    ])
  })
})
