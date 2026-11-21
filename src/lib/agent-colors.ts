/** Agent label colors, chosen for readability against the app's dark themes. */
const AGENT_TEXT_COLORS: Record<string, string> = {
  'claude-code': 'text-[#e89b79]',
  codex: 'text-[#f0f0f0]',
  antigravity: 'text-[#64b5f6]',
  opencode: 'text-[#e86624]',
  copilot: 'text-[#e4e4e7]',
  qwen: 'text-[#a994ff]',
  amp: 'text-[#f2877d]',
  gemini: 'text-[#79adff]',
  cursor: 'text-[#e4e4e7]',
  omp: 'text-[#c5a3ff]'
}

/** Plain terminals and unknown agents inherit the surrounding text color. */
export function agentTextColor(agentId: string): string {
  return AGENT_TEXT_COLORS[agentId] ?? ''
}
