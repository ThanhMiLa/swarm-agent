import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface TeamMember {
  memberId: string
  terminalId: string
  generation: number
  name: string
  agentId: string
}

export interface TeamTask {
  id: string
  worker: string
  scope: string[]
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'unavailable'
  note: string | null
  report: { summary: string; files: string[]; tests: string[] } | null
}

export interface TeamRun {
  id: string
  leader: string
  plan: string
  tasks: TeamTask[]
  results: Array<{
    id: string
    taskId: string
    stage: 'ready' | 'pasting' | 'submitting' | 'sent' | 'closed'
    note: string | null
  }>
  leaderTerminalId: string
}

export interface Team {
  id: string
  name: string
  enabled: boolean
  members: TeamMember[]
  runs: TeamRun[]
}

export interface Delivery {
  id: string
  terminalId: string
  generation: number
}

export interface TeamSnapshot {
  revision: number
  teams: Team[]
  pending: Delivery[]
  connected: Record<string, boolean>
}

type Edit =
  | { kind: 'closeWorkspace'; teamId: string }
  | { kind: 'join'; teamId: string; terminalId: string }
  | { kind: 'leave'; terminalId: string }
  | { kind: 'renameMember'; teamId: string; memberId: string; name: string }

export const teamSnapshot = (): Promise<TeamSnapshot> => invoke('team_snapshot')
export const editTeam = (edit: Edit): Promise<void> => invoke('team_edit', { edit })
export const onTeamChanged = (refresh: () => void) => listen('agent-team:changed', refresh)

/** Paste returns the draft tail, or null while an earlier draft is pending. */
export const deliverTeamPrompt = (
  delivery: Delivery,
  phase: 'paste' | 'submit' | 'fail',
  reason?: string
): Promise<string | null> => invoke('team_delivery', { ...delivery, phase, reason })
