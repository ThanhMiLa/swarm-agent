export const NAVBAR_WIDTH_STORAGE_KEY = 'cc-navbar-width'
export const DEFAULT_NAVBAR_WIDTH = 224
export const MIN_NAVBAR_WIDTH = 180
export const MAX_NAVBAR_WIDTH = 400

export function clampNavbarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_NAVBAR_WIDTH
  return Math.min(MAX_NAVBAR_WIDTH, Math.max(MIN_NAVBAR_WIDTH, Math.round(width)))
}

export function readStoredNavbarWidth(storage: Pick<Storage, 'getItem'>): number {
  const raw = storage.getItem(NAVBAR_WIDTH_STORAGE_KEY)
  return raw?.trim() ? clampNavbarWidth(Number(raw)) : DEFAULT_NAVBAR_WIDTH
}
