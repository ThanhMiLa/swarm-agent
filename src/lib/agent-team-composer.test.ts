import { describe, expect, it } from 'vitest'
import { isAgentComposer } from './agent-team-composer'

describe('Agent Team input readiness', () => {
  it('recognizes Codex and OpenCode composer cues without treating the shell prompt as an agent', () => {
    expect(isAgentComposer('codex', ['› Ask Codex to do anything', '? for shortcuts'])).toBe(true)
    expect(isAgentComposer('opencode', ['Ask anything… "Fix broken tests"', 'shift+tab', 'ctrl+p'])).toBe(true)
    expect(isAgentComposer('codex', ['username@machine project %'])).toBe(false)
  })

  it('never treats trust, permission or onboarding dialogs as a composer', () => {
    const draft = { beforeCursor: ['Last line of task'], expectedTail: 'lineoftask' }
    expect(isAgentComposer('antigravity', ['Do you trust the contents of this project?', '> Yes, I trust this folder'])).toBe(false)
    expect(isAgentComposer('opencode', ['Permission required', 'shift+tab', 'ctrl+p'], draft)).toBe(false)
    expect(isAgentComposer('antigravity', ['Last line of task', 'esc to dismiss'], draft)).toBe(false)
  })

  it('keeps the Antigravity composer usable under the inline agent-mode notice', () => {
    const lines = [
      '┃ Auto is now the default agent mode',
      '┃ Press Shift+Tab to switch agent modes, or change Agent Mode in /config.',
      '┃ esc to dismiss',
      '─────────',
      '> Auto mode: edits & safe commands auto-approved (shift+tab to cycle)',
      '─────────',
      '? for shortcuts'
    ]
    expect(isAgentComposer('antigravity', lines)).toBe(true)
    expect(isAgentComposer('antigravity', [...lines, 'Permission required'])).toBe(false)
  })

  it.each([
    ['codex', '1 warning · f2 to view'],
    ['antigravity', 'auto · Gemini 4 Neon · xhigh']
  ])('recognizes the pasted %s draft after the shortcut footer disappears', (agent, footer) => {
    const beforeCursor = ['Read-only task. Do not edit files.', 'Task:', 'hello']
    const lines = [...beforeCursor, footer]
    const draft = { beforeCursor, expectedTail: 'noteditfiles.Task:hello' }
    expect(isAgentComposer(agent, lines, draft)).toBe(true)
    expect(isAgentComposer(agent, lines, { ...draft, expectedTail: 'anotherdraft' })).toBe(false)
    expect(isAgentComposer(agent, [...lines, 'Enter to confirm'], draft)).toBe(false)
  })

  it('recognizes a long Codex review paste only when the token is at the active cursor', () => {
    const token = '› [Pasted Content 1039 chars]'
    const lines = ['Worked for 10s', token, 'GPT-6.1 medium']
    const draft = { beforeCursor: lines.slice(0, 2), expectedTail: '"tests":[]}}]' }

    expect(isAgentComposer('codex', lines, draft)).toBe(true)
    expect(isAgentComposer('codex', [...lines, '? for shortcuts'])).toBe(false)
    expect(isAgentComposer('codex', lines, { ...draft, beforeCursor: [token, '› '] })).toBe(false)
    expect(isAgentComposer('codex', [...lines, 'Enter to confirm'], draft)).toBe(false)
  })

  it('recognizes an Antigravity paste collapsed into a composer token', () => {
    const beforeCursor = ['> [Pasted text #1 +12 lines]']
    const lines = [...beforeCursor, 'auto · Gemini 4 Neon · xhigh']
    const draft = { beforeCursor, expectedTail: 'noteditfiles.Task:hello' }
    expect(isAgentComposer('antigravity', lines, draft)).toBe(true)
    expect(isAgentComposer('antigravity', [...lines, 'esc to dismiss'], draft)).toBe(false)
    expect(isAgentComposer('antigravity', lines)).toBe(false)
  })
})
