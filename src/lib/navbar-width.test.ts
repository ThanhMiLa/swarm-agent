import { describe, expect, it } from 'vitest'
import {
  clampNavbarWidth,
  DEFAULT_NAVBAR_WIDTH,
  MAX_NAVBAR_WIDTH,
  MIN_NAVBAR_WIDTH,
  readStoredNavbarWidth
} from './navbar-width'

describe('Projects sidebar width', () => {
  it('rounds pointer measurements and clamps to the supported range', () => {
    expect(clampNavbarWidth(290.6)).toBe(291)
    expect(clampNavbarWidth(120)).toBe(MIN_NAVBAR_WIDTH)
    expect(clampNavbarWidth(500)).toBe(MAX_NAVBAR_WIDTH)
  })

  it('restores the saved width and clamps out-of-range storage', () => {
    expect(readStoredNavbarWidth({ getItem: () => '320' })).toBe(320)
    expect(readStoredNavbarWidth({ getItem: () => '500' })).toBe(MAX_NAVBAR_WIDTH)
  })

  it.each([null, '', 'invalid', 'Infinity'])('defaults for invalid or missing storage: %s', (value) => {
    expect(readStoredNavbarWidth({ getItem: () => value })).toBe(DEFAULT_NAVBAR_WIDTH)
  })
})
