export const AGENT_TEAM_DROP_ID = 'agent-team-dropzone'

export type DragEndAction =
  | { kind: 'join'; leafId: string }
  | { kind: 'reorder'; activeLeafId: string; overLeafId: string }
  | { kind: 'none' }

export function resolveDragEnd(activeId: string, overId: string | null): DragEndAction {
  if (overId === AGENT_TEAM_DROP_ID) return { kind: 'join', leafId: activeId }
  if (overId !== null && overId !== activeId) {
    return { kind: 'reorder', activeLeafId: activeId, overLeafId: overId }
  }
  return { kind: 'none' }
}
