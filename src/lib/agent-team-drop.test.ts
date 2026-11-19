import { describe, expect, it } from 'vitest'
import { AGENT_TEAM_DROP_ID, resolveDragEnd } from './agent-team-drop'

describe('Agent Team drop routing', () => {
  it('joins the active workspace team on a panel drop', () => {
    expect(resolveDragEnd('pane-a', AGENT_TEAM_DROP_ID)).toEqual({ kind: 'join', leafId: 'pane-a' })
  })

  it('reorders another pane and ignores an empty or self drop', () => {
    expect(resolveDragEnd('pane-a', 'pane-b')).toEqual({
      kind: 'reorder', activeLeafId: 'pane-a', overLeafId: 'pane-b'
    })
    expect(resolveDragEnd('pane-a', 'pane-a')).toEqual({ kind: 'none' })
    expect(resolveDragEnd('pane-a', null)).toEqual({ kind: 'none' })
  })
})
