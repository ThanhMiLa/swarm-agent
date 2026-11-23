import { create } from 'zustand'

/**
 * Per-terminal header titles, keyed by terminalId. Runtime state that lives
 * OUTSIDE the layout tree — mirroring terminal-registry's xterm instances and
 * the terminal registry, keyed by terminalId. The registry resolves titles
 * from terminal output and tracked conversations. Titles survive pane
 * re-parenting (split collapse) and are cleared when the terminal respawns.
 */
export interface TerminalTitleStore {
  titles: Record<string, string>
  setTitle: (terminalId: string, title: string) => void
  clearTitle: (terminalId: string) => void
}

export const useTerminalTitleStore = create<TerminalTitleStore>((set) => ({
  titles: {},

  setTitle: (terminalId, title) =>
    set((s) => ({ titles: { ...s.titles, [terminalId]: title } })),

  clearTitle: (terminalId) =>
    set((s) => {
      if (!(terminalId in s.titles)) return s
      const titles = { ...s.titles }
      delete titles[terminalId]
      return { titles }
    }),
}))
