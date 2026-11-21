function hasBlockingDismissCue(agent: string | undefined, lines: string[]): boolean {
  return lines.some((line, index) => {
    if (!/esc to dismiss/i.test(line)) return false
    if (agent !== 'antigravity') return true

    // This Antigravity notice is inline above the composer. The user can
    // still type in the prompt beneath it. Other dismiss cues remain guards.
    const notice = lines.slice(Math.max(0, index - 3), index)
      .map((part) => part.replace(/^[\s┃│]+/, '').trim())
      .join(' ')
    return !/Auto is now the default agent mode Press Shift\+Tab to switch agent modes, or change Agent Mode in \/config\.$/i.test(notice)
  })
}

interface TeamDraft {
  // Screen rows up to the current cursor, including only columns before it.
  beforeCursor: string[]
  expectedTail: string
}

const CODEX_COLLAPSED_PASTE = /^\s*›\s*\[Pasted Content \d+ chars\]\s*$/
const ANTIGRAVITY_COLLAPSED_PASTE = /^\s*>\s*\[Pasted text #\d+ \+\d+ lines?\]\s*$/
const CLAUDE_COLLAPSED_PASTE = /^\s*❯\s*\[Pasted text #\d+(?:\s+\+\d+\s+lines?)?\]\s*$/

function stripRowChrome(row: string, isCursorRow: boolean): string {
  // Drop TUI box-drawing gutters and right-edge scroll arrows (↑/↓) so line
  // wrapping inside a bordered or scrollable composer still matches expectedTail.
  let cleaned = row.replace(/^\s*[│┃]/, '')
  if (!isCursorRow) {
    cleaned = cleaned.replace(/\s+[↑↓]\s*$/, '')
  }
  return cleaned
}

function isCollapsedPaste(pattern: RegExp, beforeCursor: string[]): boolean {
  const cursorLine = beforeCursor.at(-1) ?? ''
  if (pattern.test(cursorLine)) return true
  if (!cursorLine.trimEnd().endsWith(']')) return false
  const wrapped = beforeCursor
    .slice(-2)
    .map((line) => line.replace(/^\s*[│┃]/, '').trim())
    .join(' ')
  return pattern.test(wrapped)
}

function isPastedDraft(agent: string | undefined, draft: TeamDraft): boolean {
  const tail = draft.expectedTail
  const lastIndex = draft.beforeCursor.length - 1
  const normalized = draft.beforeCursor
    .map((row, index) => stripRowChrome(row, index === lastIndex))
    .join('')
    .replace(/\s/g, '')
  if (tail && normalized.endsWith(tail)) return true

  // CLIs can hide the paste body behind a token. Only accept the
  // token at the cursor, after SwarmAgent has written its own draft.
  switch (agent) {
    case 'codex':
      return isCollapsedPaste(CODEX_COLLAPSED_PASTE, draft.beforeCursor)
    case 'antigravity':
      return isCollapsedPaste(ANTIGRAVITY_COLLAPSED_PASTE, draft.beforeCursor)
    case 'claude-code':
      return isCollapsedPaste(CLAUDE_COLLAPSED_PASTE, draft.beforeCursor)
    default:
      return false
  }
}

/** CLI input cues visible near the cursor. A shell's prompt or a quiet
 * alternate screen alone does not authorize an automated Enter. */
export function isAgentComposer(agent: string | undefined, lines: string[], draft?: TeamDraft): boolean {
  const screen = lines.join('\n')
  if (/permission required|requesting permission|allow command\?|enter to confirm|enter to select|enter to submit|esc to cancel|do you want to proceed\?|trust this directory|trust the contents|trust this folder|select login method/i.test(screen) || hasBlockingDismissCue(agent, lines)) return false

  const hasPrompt = (mark: RegExp) => lines.some((line) => mark.test(line))
  switch (agent) {
    case 'codex':
      if (draft !== undefined) return isPastedDraft(agent, draft)
      return !lines.some((line) => CODEX_COLLAPSED_PASTE.test(line)) &&
        hasPrompt(/^\s*›(?:\s|$)/) &&
        /for shortcuts|context (?:left|used)|context window|Ask Codex/i.test(screen)
    case 'opencode':
      if (draft !== undefined && isPastedDraft(agent, draft)) return true
      return /ctrl\+p\s+commands|tab\s+agents/i.test(screen) ||
        (/ctrl\+p/i.test(screen) && /shift\+tab/i.test(screen))
    case 'antigravity':
      if (draft !== undefined) return isPastedDraft(agent, draft)
      return /\?\s+for shortcuts|enter to send/i.test(screen) &&
        (hasPrompt(/^\s*[❯›>](?:\s|$)/) || /type (?:your|a) (?:message|prompt)/i.test(screen))
    case 'claude-code':
      if (draft !== undefined) return isPastedDraft(agent, draft)
      return !lines.some((line) => CLAUDE_COLLAPSED_PASTE.test(line)) &&
        hasPrompt(/^\s*❯(?:\s|$)/) &&
        /\?\s+for shortcuts|shift\+tab to cycle|bypass permissions on|accept edits on|plan mode on|mcp\s+[✓…✗]/i.test(screen)
    default:
      return false
  }
}
