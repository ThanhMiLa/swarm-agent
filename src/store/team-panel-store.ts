import { create } from 'zustand'

interface TeamPanelState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useTeamPanelStore = create<TeamPanelState>((set) => ({
  open: true,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open }))
}))
