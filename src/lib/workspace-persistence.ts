import { collectLeaves, findLeaf, type LayoutNode } from './layout-tree'
import { isValidSessionId } from './resume-command'
import { KNOWN_SHELLS } from './terminal-pref'
import { DEFAULT_TEMPLATE_ID, templateById } from './templates'
import type { AppState, Project, Workspace } from '@/store/app-store'

const KEY = 'swarm-agent.workspace-state.v1'
export type SavedWorkspaces = Pick<AppState, 'projects' | 'workspaces' | 'activeWorkspaceId'>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value)
}

function path(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && !value.includes('\0')
}

/** Persist layout and opaque session IDs only, never commands, chat text or PTY state. */
export function writeWorkspaceState(storage: Pick<Storage, 'setItem'>, state: SavedWorkspaces): void {
  function archive(layout: LayoutNode): LayoutNode {
    if (layout.type === 'split') {
      return { ...layout, children: [archive(layout.children[0]), archive(layout.children[1])] }
    }
    const agent = layout.agentId ?? DEFAULT_TEMPLATE_ID
    const resume = layout.observedConversation?.id ?? layout.resumeSessionId
    return {
      type: 'leaf',
      id: layout.id,
      terminalId: layout.terminalId,
      agentId: layout.agentId,
      shellId: layout.shellId,
      cwd: layout.observedConversation?.cwd || layout.cwd,
      resumeSessionId: resume && isValidSessionId(agent, resume) ? resume : undefined
    }
  }
  try {
    storage.setItem(KEY, JSON.stringify({
      projects: state.projects,
      workspaces: state.workspaces.map((w) => ({ ...w, layout: archive(w.layout) })),
      activeWorkspaceId: state.activeWorkspaceId
    }))
  } catch (error) {
    console.warn('Could not save workspace state:', error)
  }
}

export function readWorkspaceState(storage: Pick<Storage, 'getItem'>): SavedWorkspaces | undefined {
  try {
    const raw = storage.getItem(KEY)
    if (!raw || raw.length > 4_000_000) return
    const data: unknown = JSON.parse(raw)
    if (!record(data) || !Array.isArray(data.projects) || !Array.isArray(data.workspaces)) return
    const projects: Project[] = []
    const projectIds = new Set<string>()
    for (const p of data.projects) {
      if (!record(p) || !id(p.id) || projectIds.has(p.id) || typeof p.name !== 'string' || !path(p.cwd)) continue
      projectIds.add(p.id)
      projects.push({
        id: p.id,
        name: p.name,
        cwd: p.cwd,
        nextWorkspaceNumber: Number.isSafeInteger(p.nextWorkspaceNumber) &&
          (p.nextWorkspaceNumber as number) > 0 ? p.nextWorkspaceNumber as number : 1
      })
    }
    const terminalIds = new Set<string>()
    const nodeIds = new Set<string>()
    const workspaceIds = new Set<string>()
    const workspaces: Workspace[] = []
    for (const w of data.workspaces) {
      if (!record(w) || !id(w.id) || workspaceIds.has(w.id) || !id(w.projectId) ||
          !projectIds.has(w.projectId) || typeof w.name !== 'string') continue
      // Commit IDs only after a whole tree validates, so a bad pane can't
      // prevent otherwise valid workspaces from loading.
      const nextNodes = new Set<string>()
      const nextTerminals = new Set<string>()
      function decode(node: unknown, depth: number): LayoutNode | undefined {
        if (!record(node) || depth > 64 || !id(node.id) || nodeIds.has(node.id) ||
            nextNodes.has(node.id)) return
        nextNodes.add(node.id)
        if (node.type === 'leaf') {
          if (!id(node.terminalId) || terminalIds.has(node.terminalId) ||
              nextTerminals.has(node.terminalId)) return
          nextTerminals.add(node.terminalId)
          const agent = templateById(typeof node.agentId === 'string' ? node.agentId : DEFAULT_TEMPLATE_ID)
          const resumeSessionId = typeof node.resumeSessionId === 'string' &&
            isValidSessionId(agent.id, node.resumeSessionId) ? node.resumeSessionId : undefined
          return {
            type: 'leaf',
            id: node.id,
            terminalId: node.terminalId,
            agentId: agent.id,
            cwd: path(node.cwd) ? node.cwd : undefined,
            shellId: KNOWN_SHELLS.find((s) => s.id === node.shellId)?.id,
            resumeSessionId,
            needsConversationChoice: agent.command !== null && !resumeSessionId
          }
        }
        if (node.type !== 'split' || (node.direction !== 'horizontal' && node.direction !== 'vertical') ||
            !Array.isArray(node.children) || node.children.length !== 2) return
        const left = decode(node.children[0], depth + 1)
        const right = decode(node.children[1], depth + 1)
        if (!left || !right) return
        const a = Array.isArray(node.sizes) ? node.sizes[0] : null
        const size = typeof a === 'number' && Number.isFinite(a) && a > 0 && a < 100 ? a : 50
        return { type: 'split', id: node.id, direction: node.direction, sizes: [size, 100 - size], children: [left, right] }
      }
      const layout = decode(w.layout, 0)
      if (!layout) continue
      nextNodes.forEach((value) => nodeIds.add(value))
      nextTerminals.forEach((value) => terminalIds.add(value))
      workspaceIds.add(w.id)
      const focusedLeafId = typeof w.focusedLeafId === 'string' && findLeaf(layout, w.focusedLeafId)
        ? w.focusedLeafId : collectLeaves(layout)[0].id
      workspaces.push({ id: w.id, projectId: w.projectId, name: w.name, layout, focusedLeafId })
    }
    const activeWorkspaceId = typeof data.activeWorkspaceId === 'string' && workspaceIds.has(data.activeWorkspaceId)
      ? data.activeWorkspaceId : workspaces[0]?.id ?? ''
    return { projects, workspaces, activeWorkspaceId }
  } catch {
    return undefined
  }
}
