import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fit: vi.fn(),
  activateWebgl: vi.fn(),
  disposeWebgl: vi.fn(),
  terminals: [] as any[]
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options: Record<string, unknown>) {
      this.terminalOptions = { ...options }
      mocks.terminals.push(this)
    }
    dataListeners: ((data: string) => void)[] = []
    binaryListeners: ((data: string) => void)[] = []
    wheelHandler?: (event: any) => boolean
    cols = 80
    rows = 24
    private terminalOptions: Record<string, unknown>
    get options() { return this.terminalOptions }
    set options(options: Record<string, unknown>) { Object.assign(this.terminalOptions, options) }
    parser = { registerOscHandler: vi.fn() }
    unicode = { register: vi.fn(), activeVersion: '6' }
    buffer = { active: { type: 'normal', baseY: 0 }, onBufferChange: vi.fn() }
    loadAddon(addon: { activate?: (term: unknown) => void }): void { addon.activate?.(this) }
    open = vi.fn()
    reset = vi.fn()
    dispose = vi.fn()
    onTitleChange = vi.fn()
    onData = vi.fn((cb: (data: string) => void) => { this.dataListeners.push(cb); return { dispose: vi.fn() } })
    onBinary = vi.fn((cb: (data: string) => void) => { this.binaryListeners.push(cb); return { dispose: vi.fn() } })
    registerLinkProvider = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    attachCustomWheelEventHandler = vi.fn((cb: (event: any) => boolean) => { this.wheelHandler = cb })
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    term!: { cols: number }
    activate(term: { cols: number }): void { this.term = term }
    fit(): void {
      mocks.fit()
      // A changing grid makes every fit observable at the IPC boundary too.
      this.term.cols += 1
    }
  }
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    activate = mocks.activateWebgl
    onContextLoss = vi.fn()
    dispose = mocks.disposeWebgl
  }
}))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@/tauri/terminal', () => ({
  createTerminal: vi.fn().mockResolvedValue({ ok: true }),
  killTerminal: vi.fn().mockResolvedValue(undefined),
  resizeTerminal: vi.fn().mockResolvedValue(undefined),
  writeTerminal: vi.fn().mockResolvedValue(undefined),
  writeTerminalBytes: vi.fn().mockResolvedValue(undefined),
  ackTerminalOutput: vi.fn().mockResolvedValue(undefined)
}))

import { createTerminal, killTerminal, resizeTerminal, writeTerminal, writeTerminalBytes } from '@/tauri/terminal'
import { ITERM2_DARK_THEME, ITERM2_TEXT_PRESET } from './iterm2-preset'
import { useAppearanceStore } from '@/store/appearance-store'
import { useTerminalTextStore } from '@/store/terminal-text-store'
import { useTerminalTypingStore } from '@/store/terminal-typing-store'
import { useTerminalScrollingStore } from '@/store/terminal-scrolling-store'
import { useTerminalTitleStore } from '@/store/terminal-title-store'
import {
  applyTerminalStyle,
  attachTerminal,
  beginLayoutTransition,
  detachTerminal,
  disposeOrphanTerminals,
  disposeTerminal,
  endLayoutTransition,
  refitAttachedTerminals,
  respawnTerminal,
  suspendLayoutRefits,
  VSCODE_DARK_THEME
} from './terminal-registry'

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
let observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[]

function frame(): void {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((fn) => fn(0))
}

function attach(id = 'one'): void {
  attachTerminal(id, { appendChild: vi.fn() } as unknown as HTMLElement, {})
}

beforeEach(() => {
  vi.useFakeTimers()
  frames.clear()
  mocks.terminals.length = 0
  observers = []
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++nextFrame, fn)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    documentElement: { setAttribute: vi.fn() },
    createElement: () => ({
      style: {}, isConnected: true, clientWidth: 800, clientHeight: 600,
      addEventListener: vi.fn(), remove: vi.fn()
    })
  })
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn()
    observe = vi.fn()
    constructor(callback: () => void) { observers.push({ callback, disconnect: this.disconnect }) }
  })
  attach()
  vi.clearAllMocks()
})

afterEach(() => {
  disposeOrphanTerminals(new Set())
  endLayoutTransition()
  frame()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Antigravity pane titles', () => {
  it('uses the tracked conversation title in place of the shell launch command', () => {
    attachTerminal('agy', { appendChild: vi.fn() } as unknown as HTMLElement, {
      agentId: 'antigravity',
      initialCommand: 'agy --conversation previous'
    })
    const onOutput = vi.mocked(createTerminal).mock.lastCall![2]
    const onTitle = mocks.terminals.at(-1).onTitleChange.mock.calls[0][0]
    const currentTitle = () => useTerminalTitleStore.getState().titles.agy
    const conversation = (sessionId: string, title?: string) => onOutput({
      type: 'conversation',
      payload: { agentId: 'antigravity', sessionId, title }
    })

    onTitle('clear; command agy --log-file "$SWARM_AGENT_AGY_LOG" --conversation previous ;')
    expect(currentTitle()).toBeUndefined()
    conversation('previous', 'Tích hợp VNPAY')
    expect(currentTitle()).toBe('Tích hợp VNPAY')
    conversation('previous', 'Đổi tên phiên')
    expect(currentTitle()).toBe('Đổi tên phiên')
    conversation('next')
    expect(currentTitle()).toBeUndefined()
    conversation('next', 'Next conversation')

    onTitle('Custom terminal title')
    expect(currentTitle()).toBe('Custom terminal title')
    onTitle('')
    expect(currentTitle()).toBe('Next conversation')

    respawnTerminal('agy', { agentId: 'codex', initialCommand: 'codex' })
    conversation('next', 'Stale Antigravity title')
    expect(currentTitle()).toBeUndefined()
  })
})

describe('iTerm2 appearance', () => {
  it('applies the richer rendering to both live and new terminals without changing text prefs', () => {
    const term = mocks.terminals[0]
    const { style, setStyle } = useAppearanceStore.getState()
    const text = useTerminalTextStore.getState().text
    try {
      setStyle('iterm2-dark')
      attach('two')

      for (const entry of mocks.terminals) {
        expect(entry.options).toMatchObject({
          theme: ITERM2_DARK_THEME,
          cursorBlink: false,
          fontWeight: 800,
          fontWeightBold: 1000,
          minimumContrastRatio: 4,
          fontFamily: text.fontFamily,
          fontSize: text.fontSize,
          lineHeight: text.lineHeight
        })
      }

      applyTerminalStyle('vscode-dark')
      expect(term.options).toMatchObject({
        theme: VSCODE_DARK_THEME,
        cursorBlink: true,
        fontWeight: 'normal',
        fontWeightBold: 'bold',
        minimumContrastRatio: 1
      })
    } finally {
      setStyle(style)
    }
  })

  it('applies the profile typography to live terminals in one refit without changing ligatures', () => {
    const store = useTerminalTextStore.getState()
    store.setLigatures(true)
    mocks.fit.mockClear()
    try {
      store.applyTypography(ITERM2_TEXT_PRESET)
      expect(mocks.terminals[0].options).toMatchObject(ITERM2_TEXT_PRESET)
      expect(useTerminalTextStore.getState().text.ligatures).toBe(true)
      expect(mocks.fit).toHaveBeenCalledTimes(1)
    } finally {
      store.reset()
    }
  })

  it('switches existing panes to DOM only for iTerm2 Dark without restarting them', () => {
    const { style, itermRenderer, setStyle, setItermRenderer } = useAppearanceStore.getState()
    const existing = mocks.terminals[0]
    try {
      setItermRenderer('dom')
      expect(mocks.disposeWebgl).not.toHaveBeenCalled()

      setStyle('iterm2-dark')
      expect(mocks.disposeWebgl).toHaveBeenCalledOnce()
      attach('two') // starts in DOM without briefly creating a GPU renderer
      expect(mocks.activateWebgl).not.toHaveBeenCalled()

      const createCount = vi.mocked(createTerminal).mock.calls.length
      setItermRenderer('webgl')
      expect(mocks.activateWebgl.mock.calls.map(([term]) => term)).toEqual(mocks.terminals)
      setItermRenderer('dom')
      expect(mocks.disposeWebgl).toHaveBeenCalledTimes(3)
      mocks.activateWebgl.mockClear()

      setStyle('vscode-dark')
      expect(mocks.activateWebgl.mock.calls.map(([term]) => term)).toEqual(mocks.terminals)
      expect(mocks.terminals[0]).toBe(existing)
      expect(existing.dispose).not.toHaveBeenCalled()
      expect(createTerminal).toHaveBeenCalledTimes(createCount)
      expect(killTerminal).not.toHaveBeenCalled()
    } finally {
      setItermRenderer(itermRenderer)
      setStyle(style)
    }
  })
})

describe('terminal layout refits', () => {
  it('coalesces a ResizeObserver burst to one fit and IPC per frame', () => {
    for (let i = 0; i < 30; i++) observers[0].callback()
    expect(mocks.fit).not.toHaveBeenCalled()
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
    expect(resizeTerminal).toHaveBeenCalledTimes(1)
    observers[0].callback()
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(2)
  })

  it('performs zero intermediate fits/IPC and one final fit per attached terminal', () => {
    attach('two')
    vi.clearAllMocks()
    // Even an already queued observer frame must be cancelled on begin.
    observers.forEach((ro) => ro.callback())
    beginLayoutTransition()
    for (let i = 0; i < 25; i++) {
      observers.forEach((ro) => ro.callback())
      refitAttachedTerminals() // focus/visibility changes must respect the lock too
      vi.advanceTimersByTime(8)
      frame()
    }
    expect(mocks.fit).not.toHaveBeenCalled()
    expect(resizeTerminal).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    // Observer delivery at the final size must share the global refit.
    observers.forEach((ro) => ro.callback())
    expect(mocks.fit).not.toHaveBeenCalled()
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(2)
    expect(resizeTerminal).toHaveBeenCalledTimes(2)
    endLayoutTransition() // late transitionend must not fit again after timeout
    vi.advanceTimersByTime(220)
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(2)
  })

  it('ends early via transitionend without another refit from the timeout', () => {
    beginLayoutTransition()
    vi.advanceTimersByTime(200)
    endLayoutTransition()
    endLayoutTransition()
    observers[0].callback()
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(220)
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
  })

  it('resets the deadline and cancels a pending final refit on a new transition', () => {
    beginLayoutTransition()
    vi.advanceTimersByTime(200)
    beginLayoutTransition()
    vi.advanceTimersByTime(219)
    frame()
    expect(mocks.fit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    beginLayoutTransition()
    frame()
    expect(mocks.fit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(220)
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
  })

  it('keeps refits locked when another sidebar finishes before the latest transition', () => {
    const left = beginLayoutTransition()
    vi.advanceTimersByTime(100)
    const right = beginLayoutTransition()
    vi.advanceTimersByTime(100)
    endLayoutTransition(left)
    observers[0].callback()
    frame()
    expect(mocks.fit).not.toHaveBeenCalled()
    expect(resizeTerminal).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    endLayoutTransition(right)
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
  })

  it('fits only after a sidebar resize ends, even if an overlapping animation finishes first', () => {
    observers[0].callback()
    const release = suspendLayoutRefits()
    beginLayoutTransition()
    vi.advanceTimersByTime(1000)
    observers[0].callback()
    refitAttachedTerminals()
    frame()
    expect(mocks.fit).not.toHaveBeenCalled()
    expect(resizeTerminal).not.toHaveBeenCalled()

    release()
    release()
    observers[0].callback()
    frame()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
    expect(resizeTerminal).toHaveBeenCalledTimes(1)
  })

  it.each(['detach', 'dispose'] as const)('cancels pending observer refits on %s', (action) => {
    observers[0].callback()
    if (action === 'detach') detachTerminal('one')
    else disposeTerminal('one')
    frame()
    expect(mocks.fit).not.toHaveBeenCalled()
    expect(resizeTerminal).not.toHaveBeenCalled()
    expect(observers[0].disconnect).toHaveBeenCalledOnce()
  })

  it('does not fit a terminal detached during a layout transition', () => {
    beginLayoutTransition()
    detachTerminal('one')
    vi.advanceTimersByTime(220)
    frame()
    expect(mocks.fit).not.toHaveBeenCalled()
    expect(resizeTerminal).not.toHaveBeenCalled()
  })
})

describe('source-only mouse routing through the production registry', () => {
  it('does not treat native SGR mouse reports as typing', () => {
    const term = mocks.terminals.at(-1)!
    const typing = vi.spyOn(useTerminalTypingStore.getState(), 'noteInput')
    for (const cb of term.dataListeners) cb('\x1b[<65;10;5M')
    expect(writeTerminal).toHaveBeenCalledWith('one', '\x1b[<65;10;5M')
    expect(typing).not.toHaveBeenCalled()
    typing.mockRestore()
  })

  it('keeps compatibility wheel fallback source-only while ordinary keyboard input still marks typing', async () => {
    useTerminalScrollingStore.setState({ scrolling: { mode: 'compatibility', sensitivity: 1.5, smoothMouseWheel: true } })
    const term = mocks.terminals.at(-1)!
    const typing = vi.spyOn(useTerminalTypingStore.getState(), 'noteInput')
    term.wheelHandler!({ deltaY: 120, deltaMode: 0 })
    for (const cb of term.dataListeners) cb('\x1b[A')
    expect(typing).not.toHaveBeenCalled()
    await Promise.resolve()
    for (const cb of term.dataListeners) cb('hello')
    expect(typing).toHaveBeenCalledWith('one', 'hello', undefined)
    typing.mockRestore()
    useTerminalScrollingStore.setState({ scrolling: { mode: 'enhanced', sensitivity: 1.5, smoothMouseWheel: true } })
  })

  it('preserves raw legacy mouse bytes without typing updates', () => {
    const term = mocks.terminals.at(-1)!
    const typing = vi.spyOn(useTerminalTypingStore.getState(), 'noteInput')
    for (const cb of term.binaryListeners) cb('\x1b[M`'+String.fromCharCode(183)+'!')
    expect(writeTerminalBytes).toHaveBeenCalledWith('one', [27, 91, 77, 96, 183, 33])
    expect(typing).not.toHaveBeenCalled()
    typing.mockRestore()
  })
})
