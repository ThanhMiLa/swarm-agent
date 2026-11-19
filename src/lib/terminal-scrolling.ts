/**
 * Terminal scrolling preference definitions, validation and persistence.
 * Decoupled from React and xterm so it is easily unit-tested.
 */

export type ScrollingMode = 'enhanced' | 'compatibility'

export interface TerminalScrollingPref {
  /**
   * 'enhanced': normalized deltaMode, no 30% reduction heuristic, queueing up to 32 reports/frame.
   * 'compatibility': native xterm wheel handling, sensitivity 1.0, animation duration 0.
   */
  mode: ScrollingMode
  /**
   * Scroll multiplier: range 0.25 - 3.0, step 0.25.
   */
  sensitivity: number
  /** Per-preset overrides. An empty map makes every agent inherit sensitivity. */
  agentSensitivity?: Record<string, number>
  /**
   * Whether physical mouse wheel is smoothly animated over 100 ms.
   * Direct trackpad gestures remain direct without added inertia.
   * Default true.
   */
  smoothMouseWheel: boolean
}

export const SCROLLING_STORAGE_KEY = 'swarmterm:terminal-scrolling'

export const SENSITIVITY_MIN = 0.25
export const SENSITIVITY_MAX = 3.0
export const SENSITIVITY_STEP = 0.25
export const AGENT_SENSITIVITY_STEP = 0.05
export const SMOOTH_SCROLL_DURATION_MS = 100
const DEFAULT_AGENT_SENSITIVITY: Readonly<Record<string, number>> = { codex: 1.2 }

export const DEFAULT_SCROLLING_PREF: TerminalScrollingPref = {
  mode: 'enhanced',
  sensitivity: 1,
  agentSensitivity: DEFAULT_AGENT_SENSITIVITY,
  smoothMouseWheel: true
}

/** Clamp and snap sensitivity to valid step boundaries (0.25 - 3.0) */
export function normalizeSensitivity(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_SCROLLING_PREF.sensitivity
  return snapSensitivity(value, SENSITIVITY_STEP)
}

function snapSensitivity(value: number, step: number): number {
  const clamped = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, value))
  const stepped = Math.round(clamped / step) * step
  return Number(stepped.toFixed(2))
}

export function normalizeAgentSensitivity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? snapSensitivity(value, AGENT_SENSITIVITY_STEP)
    : undefined
}

export function agentSensitivityOverride(pref: TerminalScrollingPref, agentId: string): number | undefined {
  const overrides = pref.agentSensitivity ?? DEFAULT_AGENT_SENSITIVITY
  return Object.prototype.hasOwnProperty.call(overrides, agentId) ? overrides[agentId] : undefined
}

export function effectiveSensitivity(pref: TerminalScrollingPref, agentId?: string): number {
  if (pref.mode === 'compatibility') return 1
  return (agentId ? agentSensitivityOverride(pref, agentId) : undefined) ?? pref.sensitivity
}

function parseAgentSensitivity(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    const sensitivity = normalizeAgentSensitivity(raw)
    return sensitivity === undefined ? [] : [[id, sensitivity]]
  }))
}

/** Validate and parse stored scrolling preferences */
export function parseStoredScrollingPref(raw: string | null): TerminalScrollingPref {
  if (!raw) return DEFAULT_SCROLLING_PREF
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalScrollingPref>
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SCROLLING_PREF

    const mode: ScrollingMode = parsed.mode === 'compatibility' ? 'compatibility' : 'enhanced'
    const sensitivity = normalizeSensitivity(parsed.sensitivity)
    const smoothMouseWheel =
      typeof parsed.smoothMouseWheel === 'boolean' ? parsed.smoothMouseWheel : DEFAULT_SCROLLING_PREF.smoothMouseWheel

    const agentSensitivity = parseAgentSensitivity(parsed.agentSensitivity)
    return { mode, sensitivity, smoothMouseWheel, ...(agentSensitivity && { agentSensitivity }) }
  } catch {
    return DEFAULT_SCROLLING_PREF
  }
}

/** Read preference from localStorage */
export function readStoredScrollingPref(storage?: Storage): TerminalScrollingPref {
  if (!storage) return DEFAULT_SCROLLING_PREF
  return parseStoredScrollingPref(storage.getItem(SCROLLING_STORAGE_KEY))
}

/** Store preference to localStorage */
export function storeScrollingPref(storage: Storage, pref: TerminalScrollingPref): void {
  try {
    storage.setItem(SCROLLING_STORAGE_KEY, JSON.stringify(pref))
  } catch (err) {
    console.warn('[terminal-scrolling] failed to save preference', err)
  }
}

/**
 * Compute the effective xterm options from the scrolling preference.
 * In compatibility mode: sensitivity is 1.0, smoothScrollDuration is 0.
 * In enhanced mode, presets may override sensitivity and smooth mouse wheel can be enabled.
 */
export function effectiveScrollOptions(pref: TerminalScrollingPref, agentId?: string): {
  scrollSensitivity: number
  smoothScrollDuration: number
  mode: ScrollingMode
  enhancedWheel: boolean
} {
  if (pref.mode === 'compatibility') {
    return {
      scrollSensitivity: 1.0,
      smoothScrollDuration: 0,
      mode: 'compatibility',
      enhancedWheel: false
    }
  }
  return {
    scrollSensitivity: effectiveSensitivity(pref, agentId),
    smoothScrollDuration: pref.smoothMouseWheel ? SMOOTH_SCROLL_DURATION_MS : 0,
    mode: 'enhanced',
    enhancedWheel: true
  }
}
