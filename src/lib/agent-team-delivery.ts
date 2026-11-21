import { getTeamComposerState } from '@/lib/terminal-registry'
import { useAgentStateStore } from '@/store/agent-state-store'
import { useAgentTeamStore, refreshTeams } from '@/store/agent-team-store'
import { useTerminalActivityStore } from '@/store/terminal-activity-store'
import { useTerminalTypingStore } from '@/store/terminal-typing-store'
import { deliverTeamPrompt, onTeamChanged, type Delivery } from '@/tauri/agent-team'

const QUIET_MS = 2000
const PASTE_SETTLE_MS = 350
const PASTE_REPAINT_TIMEOUT_MS = 3000
const PASTE_RECHECK_MS = 100
const UNCONFIRMED_COMPOSER = 'Waiting for a confirmed agent input prompt'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function hold(delivery: Delivery, draftTail?: string): string | undefined {
  const id = delivery.terminalId
  const typing = useTerminalTypingStore.getState()
  if (typing.dirty[id] || Date.now() - (typing.lastKeyAt[id] ?? 0) < QUIET_MS) {
    return 'Waiting for the user to finish typing'
  }
  const state = useAgentStateStore.getState().byId[id]?.state
  if (state === 'blocked') return 'Waiting for the permission prompt to clear'
  if (state !== 'idle' || (draftTail === undefined && useTerminalActivityStore.getState().active[id])) {
    return 'Waiting for the agent to return to its prompt'
  }
  if (!getTeamComposerState(id, draftTail)) return UNCONFIRMED_COMPOSER
}

export function startAgentTeamDelivery(): () => void {
  const inFlight = new Set<string>()
  const quietSince = new Map<string, number>()
  const draftHolds = new Set<string>()
  const refresh = () => { void refreshTeams().catch(() => {}) }
  const unlisten = onTeamChanged(refresh)
  let disposed = false
  void unlisten.then(refresh, () => {})

  async function send(delivery: Delivery): Promise<void> {
    inFlight.add(delivery.terminalId)
    quietSince.delete(delivery.id)
    try {
      const draftTail = await deliverTeamPrompt(delivery, 'paste')
      if (draftTail === null) {
        draftHolds.add(delivery.id)
        return
      }
      draftHolds.delete(delivery.id)
      const repaintDeadline = Date.now() + PASTE_REPAINT_TIMEOUT_MS
      await delay(PASTE_SETTLE_MS)
      let reason = disposed ? 'Delivery stopped' : hold(delivery, draftTail)
      // The PTY write can finish before xterm paints the new composer.
      // Retry only the screen check. Other guards stop delivery immediately.
      while (reason === UNCONFIRMED_COMPOSER && Date.now() < repaintDeadline) {
        await delay(PASTE_RECHECK_MS)
        reason = disposed ? 'Delivery stopped' : hold(delivery, draftTail)
      }
      if (reason) {
        await deliverTeamPrompt(delivery, 'fail', `${reason}. Check the draft in the pane before submitting.`)
      } else {
        await deliverTeamPrompt(delivery, 'submit')
      }
    } catch (error) {
      await deliverTeamPrompt(delivery, 'fail', String(error)).catch(() => {})
    } finally {
      inFlight.delete(delivery.terminalId)
      refresh()
    }
  }

  const timer = setInterval(() => {
    const { snapshot, holds: previous } = useAgentTeamStore.getState()
    const actionable = new Set(snapshot.pending.map((delivery) => delivery.id))
    for (const id of quietSince.keys()) {
      if (!actionable.has(id)) quietSince.delete(id)
    }
    for (const id of draftHolds) {
      if (!actionable.has(id)) draftHolds.delete(id)
    }
    const holds: Record<string, string> = {}
    for (const delivery of snapshot.pending) {
      if (inFlight.has(delivery.terminalId)) {
        // Recheck readiness from scratch after the previous prompt is submitted.
        quietSince.delete(delivery.id)
        continue
      }
      const reason = hold(delivery)
      if (reason) {
        holds[delivery.id] = reason
        quietSince.delete(delivery.id)
        continue
      }
      if (draftHolds.has(delivery.id)) {
        holds[delivery.id] = 'Clear or submit the previous Agent Team draft first'
      }
      const since = quietSince.get(delivery.id)
      if (since === undefined) quietSince.set(delivery.id, Date.now())
      else if (Date.now() - since >= QUIET_MS) void send(delivery)
    }
    if (Object.keys(holds).length !== Object.keys(previous).length ||
        Object.entries(holds).some(([id, reason]) => previous[id] !== reason)) {
      useAgentTeamStore.setState({ holds })
    }
  }, 250)
  return () => {
    disposed = true
    clearInterval(timer)
    void unlisten.then((unsubscribe) => unsubscribe(), () => {})
  }
}
