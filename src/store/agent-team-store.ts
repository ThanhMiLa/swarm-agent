import { create } from 'zustand'
import { type TeamSnapshot, teamSnapshot } from '@/tauri/agent-team'

interface AgentTeamState {
  snapshot: TeamSnapshot
  holds: Record<string, string>
  errors: Record<string, string>
  setError: (workspaceId: string, error: string | null) => void
}

export const useAgentTeamStore = create<AgentTeamState>((set) => ({
  snapshot: { revision: -1, teams: [], pending: [], connected: {} },
  holds: {},
  errors: {},
  setError: (workspaceId, error) => set((state) => {
    const errors = { ...state.errors }
    if (error === null) delete errors[workspaceId]
    else errors[workspaceId] = error
    return { errors }
  })
}))

let refreshing = false
let refreshAgain = false

export async function refreshTeams(): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return
  }
  refreshing = true
  try {
    do {
      refreshAgain = false
      const snapshot = await teamSnapshot()
      useAgentTeamStore.setState((previous) =>
        snapshot.revision < previous.snapshot.revision ? previous : { snapshot }
      )
    } while (refreshAgain)
  } finally {
    refreshing = false
  }
}
