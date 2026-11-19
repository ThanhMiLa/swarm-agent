import { create } from 'zustand'
import {
  DEFAULT_SCROLLING_PREF,
  readStoredScrollingPref,
  storeScrollingPref,
  normalizeAgentSensitivity,
  normalizeSensitivity,
  type ScrollingMode,
  type TerminalScrollingPref
} from '@/lib/terminal-scrolling'

export interface TerminalScrollingStore {
  scrolling: TerminalScrollingPref
  setMode: (mode: ScrollingMode) => void
  setSensitivity: (sensitivity: number) => void
  setAgentSensitivity: (agentId: string, sensitivity?: number) => void
  setSmoothMouseWheel: (enabled: boolean) => void
  setScrollingPref: (pref: Partial<TerminalScrollingPref>) => void
}

/**
 * Zustand store for terminal scrolling preferences.
 * Persists to localStorage and notifies subscribers immediately.
 */
export const useTerminalScrollingStore = create<TerminalScrollingStore>((set, get) => {
  const initial =
    typeof window === 'undefined'
      ? DEFAULT_SCROLLING_PREF
      : readStoredScrollingPref(window.localStorage)

  const persist = (next: TerminalScrollingPref) => {
    if (typeof window !== 'undefined') {
      storeScrollingPref(window.localStorage, next)
    }
    set({ scrolling: next })
  }

  return {
    scrolling: initial,
    setMode: (mode) => persist({ ...get().scrolling, mode }),
    setSensitivity: (sensitivity) =>
      persist({ ...get().scrolling, sensitivity: normalizeSensitivity(sensitivity) }),
    setAgentSensitivity: (agentId, sensitivity) => {
      const current = get().scrolling
      const agentSensitivity = { ...(current.agentSensitivity ?? DEFAULT_SCROLLING_PREF.agentSensitivity) }
      const normalized = normalizeAgentSensitivity(sensitivity)
      if (normalized === undefined) {
        delete agentSensitivity[agentId]
        persist({ ...current, agentSensitivity })
      } else {
        persist({ ...current, agentSensitivity: { ...agentSensitivity, [agentId]: normalized } })
      }
    },
    setSmoothMouseWheel: (smoothMouseWheel) =>
      persist({ ...get().scrolling, smoothMouseWheel }),
    setScrollingPref: (patch) => {
      const current = get().scrolling
      const next: TerminalScrollingPref = {
        ...current,
        mode: patch.mode ?? current.mode,
        sensitivity:
          patch.sensitivity !== undefined
            ? normalizeSensitivity(patch.sensitivity)
            : current.sensitivity,
        smoothMouseWheel: patch.smoothMouseWheel ?? current.smoothMouseWheel
      }
      persist(next)
    }
  }
})
