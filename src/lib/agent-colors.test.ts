import { describe, expect, it } from 'vitest'
import { agentTextColor } from './agent-colors'
import { TEMPLATES } from './templates'

describe('agentTextColor', () => {
  it('assigns a color to every AI agent', () => {
    for (const template of TEMPLATES.filter((item) => item.command !== null)) {
      expect(agentTextColor(template.id)).toMatch(/^text-\[#[0-9a-f]{6}\]$/)
    }
  })

  it('keeps the plain terminal and unknown agents neutral', () => {
    expect(agentTextColor('terminal')).toBe('')
    expect(agentTextColor('unknown')).toBe('')
  })

  it('distinguishes Claude and OpenCode orange', () => {
    expect(agentTextColor('claude-code')).not.toBe(agentTextColor('opencode'))
  })
})
