/** Available visual styles for the app. */
export type Style = 'vscode-dark' | 'terminal-black' | 'iterm2-dark'
export type ItermRenderer = 'webgl' | 'dom'

/** The style used when nothing is persisted yet. */
export const DEFAULT_STYLE: Style = 'vscode-dark'

/** localStorage key the style preference is persisted under. */
export const APPEARANCE_STORAGE_KEY = 'cc-appearance-style'
export const ITERM_RENDERER_STORAGE_KEY = 'cc-iterm-renderer'

/** Minimal storage surface — lets tests pass a fake in place of localStorage. */
export interface AppearanceStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** All known style ids — used to validate persisted values. */
export const KNOWN_STYLES: readonly Style[] = ['vscode-dark', 'terminal-black', 'iterm2-dark'] as const

export function isStyle(value: string | null): value is Style {
  return value !== null && (KNOWN_STYLES as readonly string[]).includes(value)
}

/** Read the persisted style, defaulting to DEFAULT_STYLE for missing/invalid values. */
export function readStoredStyle(storage: AppearanceStorage): Style {
  const raw = storage.getItem(APPEARANCE_STORAGE_KEY)
  return isStyle(raw) ? raw : DEFAULT_STYLE
}

/** Persist the chosen style. */
export function storeStyle(storage: AppearanceStorage, style: Style): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, style)
}

export function readStoredItermRenderer(storage: AppearanceStorage): ItermRenderer {
  return storage.getItem(ITERM_RENDERER_STORAGE_KEY) === 'dom' ? 'dom' : 'webgl'
}

export function storeItermRenderer(storage: AppearanceStorage, renderer: ItermRenderer): void {
  storage.setItem(ITERM_RENDERER_STORAGE_KEY, renderer)
}

/** Synchronously apply the style attribute to the root document element. */
export function applyStyleToDom(style: Style): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-style', style)
}
