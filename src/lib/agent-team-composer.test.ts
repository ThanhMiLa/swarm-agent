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

  it('recognizes Claude Code composer without accepting shell or bare prompts', () => {
    expect(isAgentComposer('claude-code', ['❯ ', '? for shortcuts'])).toBe(true)
    expect(isAgentComposer('claude-code', ['❯ ', '  ▸▸ bypass permissions on (shift+tab to cycle)'])).toBe(true)
    expect(isAgentComposer('claude-code', ['❯ ', '  accept edits on · mcp ✓ swarm_agent_team'])).toBe(true)
    expect(isAgentComposer('claude-code', ['❯ ', '  plan mode on'])).toBe(true)
    expect(isAgentComposer('claude-code', ['❯ '])).toBe(false)
    expect(isAgentComposer('claude-code', ['username@machine project %'])).toBe(false)
  })

  it.each([
    'Do you want to proceed?',
    'Enter to select',
    'Enter to submit',
    'Esc to cancel',
    'Yes, trust this folder'
  ])('rejects %s blocking dialog for Claude Code both idle and with a pasted draft', (dialogCue) => {
    const draft = { beforeCursor: ['Read-only task', 'hello'], expectedTail: 'taskhello' }
    expect(isAgentComposer('claude-code', ['❯ ', '? for shortcuts', dialogCue])).toBe(false)
    expect(isAgentComposer('claude-code', ['❯ hello', dialogCue], draft)).toBe(false)
  })

  it('recognizes the pasted claude-code draft and rejects mismatched tails', () => {
    const beforeCursor = ['Read-only task. Do not edit files.', 'Task:', 'hello']
    const lines = [...beforeCursor, '  ▸▸ bypass permissions on']
    const draft = { beforeCursor, expectedTail: 'noteditfiles.Task:hello' }
    expect(isAgentComposer('claude-code', lines, draft)).toBe(true)
    expect(isAgentComposer('claude-code', lines, { ...draft, expectedTail: 'anotherdraft' })).toBe(false)
  })

  it('recognizes a Claude Code collapsed paste token only at the active cursor', () => {
    const token = '❯ [Pasted text #1 +15 lines]'
    const lines = ['Done', token, '  ▸▸ bypass permissions on (shift+tab to cycle)']
    const draft = { beforeCursor: lines.slice(0, 2), expectedTail: 'nevermatchesrawtext' }

    expect(isAgentComposer('claude-code', lines, draft)).toBe(true)
    expect(isAgentComposer('claude-code', [...lines, '? for shortcuts'])).toBe(false)
    expect(isAgentComposer('claude-code', lines, { ...draft, beforeCursor: [token, '❯ '] })).toBe(false)
    expect(isAgentComposer('claude-code', [...lines, 'Esc to cancel'], draft)).toBe(false)
    expect(isAgentComposer('claude-code', ['❯ [Pasted text #2]'], { beforeCursor: ['❯ [Pasted text #2]'], expectedTail: 'tail' })).toBe(true)
  })

  it('ignores TUI scroll arrows and box gutters when matching pasted drafts', () => {
    const beforeCursor = [
      '│ Task:                       ↑',
      '│ call team_report_result     ↓',
      '│ with task_id abc-123.'
    ]
    const draft = { beforeCursor, expectedTail: 'resultwithtask_idabc-123.' }
    expect(isAgentComposer('codex', beforeCursor, draft)).toBe(true)
    expect(isAgentComposer('opencode', beforeCursor, draft)).toBe(true)
    expect(isAgentComposer('opencode', [...beforeCursor, 'Permission required'], draft)).toBe(false)
  })

  it('recognizes wrapped collapsed paste tokens only at the active cursor', () => {
    const wrapped = ['› [Pasted Content 1039', '  chars]']
    const draft = { beforeCursor: wrapped, expectedTail: 'nevermatchesrawtext' }
    expect(isAgentComposer('codex', wrapped, draft)).toBe(true)
    expect(isAgentComposer('codex', [...wrapped, '› '], { ...draft, beforeCursor: [...wrapped, '› '] })).toBe(false)
  })
})
