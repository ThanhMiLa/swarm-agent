import { create } from 'zustand'
import {
  DEFAULT_STYLE,
  applyStyleToDom,
  readStoredItermRenderer,
  readStoredStyle,
  storeItermRenderer,
  storeStyle,
  type ItermRenderer,
  type Style
} from '@/lib/appearance'

export interface AppearanceStore {
  style: Style
  itermRenderer: ItermRenderer
  setStyle: (style: Style) => void
  setItermRenderer: (renderer: ItermRenderer) => void
}

/**
 * The active visual style. Reads the persisted choice on first creation and
 * writes every change back to localStorage. Renderer-only — touches `window`
 * directly.
 */
export const useAppearanceStore = create<AppearanceStore>((set) => {
  const initial =
    typeof window === 'undefined' ? DEFAULT_STYLE : readStoredStyle(window.localStorage)

  if (typeof document !== 'undefined') {
    applyStyleToDom(initial)
  }

  return {
    style: initial,
    itermRenderer: typeof window === 'undefined' ? 'webgl' : readStoredItermRenderer(window.localStorage),
    setItermRenderer: (itermRenderer) => {
      if (typeof window !== 'undefined') storeItermRenderer(window.localStorage, itermRenderer)
      set({ itermRenderer })
    },
    setStyle: (style) => {
      if (typeof window !== 'undefined') {
        storeStyle(window.localStorage, style)
      }
      applyStyleToDom(style)
      set({ style })
    }
  }
})
