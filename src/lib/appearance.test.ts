import { describe, it, expect, vi } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_STYLE,
  ITERM_RENDERER_STORAGE_KEY,
  KNOWN_STYLES,
  applyStyleToDom,
  readStoredItermRenderer,
  readStoredStyle,
  storeStyle,
  storeItermRenderer,
  type AppearanceStorage
} from './appearance'

/** An in-memory AppearanceStorage backed by a plain object. */
function fakeStorage(initial: Record<string, string> = {}): AppearanceStorage {
  const data: Record<string, string> = { ...initial }
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    }
  }
}

describe('DEFAULT_STYLE', () => {
  it('is "vscode-dark"', () => {
    expect(DEFAULT_STYLE).toBe('vscode-dark')
  })
})

describe('KNOWN_STYLES', () => {
  it('includes the built-in themes', () => {
    expect(KNOWN_STYLES).toEqual(['vscode-dark', 'terminal-black', 'iterm2-dark'])
  })
})

describe('readStoredStyle', () => {
  it('returns DEFAULT_STYLE when nothing is stored', () => {
    expect(readStoredStyle(fakeStorage())).toBe(DEFAULT_STYLE)
  })

  it('returns DEFAULT_STYLE for an unknown stored value', () => {
    expect(readStoredStyle(fakeStorage({ [APPEARANCE_STORAGE_KEY]: 'banana' }))).toBe(DEFAULT_STYLE)
  })

  it('falls back to DEFAULT_STYLE for the legacy "default" value (migration)', () => {
    expect(readStoredStyle(fakeStorage({ [APPEARANCE_STORAGE_KEY]: 'default' }))).toBe(DEFAULT_STYLE)
  })

  it('returns the stored vscode-dark style', () => {
    expect(readStoredStyle(fakeStorage({ [APPEARANCE_STORAGE_KEY]: 'vscode-dark' }))).toBe(
      'vscode-dark'
    )
  })

  it('returns the stored terminal-black style', () => {
    expect(readStoredStyle(fakeStorage({ [APPEARANCE_STORAGE_KEY]: 'terminal-black' }))).toBe(
      'terminal-black'
    )
  })
})

describe('storeStyle', () => {
  it('persists the style under the storage key', () => {
    const storage = fakeStorage()
    storeStyle(storage, 'vscode-dark')
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('vscode-dark')
    storeStyle(storage, 'terminal-black')
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('terminal-black')
  })

  it('round-trips the iTerm2 style', () => {
    const storage = fakeStorage()
    storeStyle(storage, 'iterm2-dark')
    expect(readStoredStyle(storage)).toBe('iterm2-dark')
  })
})

describe('iTerm2 renderer preference', () => {
  it('defaults to WebGL for new or invalid values', () => {
    expect(readStoredItermRenderer(fakeStorage())).toBe('webgl')
    expect(readStoredItermRenderer(fakeStorage({ [ITERM_RENDERER_STORAGE_KEY]: 'invalid' }))).toBe('webgl')
  })

  it('persists a DOM selection independently of the theme', () => {
    const storage = fakeStorage()
    storeItermRenderer(storage, 'dom')
    storeStyle(storage, 'terminal-black')
    expect(readStoredItermRenderer(storage)).toBe('dom')
    storeItermRenderer(storage, 'webgl')
    expect(readStoredItermRenderer(storage)).toBe('webgl')
  })
})

describe('applyStyleToDom', () => {
  it('does not throw when document is undefined', () => {
    expect(() => applyStyleToDom('terminal-black')).not.toThrow()
  })

  it('sets data-style attribute when document is defined', () => {
    const fakeDoc = {
      documentElement: {
        setAttribute: vi.fn()
      }
    }
    vi.stubGlobal('document', fakeDoc)
    try {
      applyStyleToDom('terminal-black')
      expect(fakeDoc.documentElement.setAttribute).toHaveBeenCalledWith('data-style', 'terminal-black')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
