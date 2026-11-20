import type { ITerminalOptions, ITheme } from '@xterm/xterm'
import { JETBRAINS_NERD_FONT_STACK, type TerminalTextPref } from './terminal-text'

/**
 * The profile's Light/Dark palettes are identical (the unsuffixed colors
 * are inactive). The calibrated macOS colors were converted to sRGB, with
 * a small foreground boost to match the appearance of iTerm2's native text.
 */
export const ITERM2_DARK_THEME = {
  background: '#0d0d0d',
  foreground: '#ebebeb',
  cursor: '#ffa827',
  cursorAccent: '#000000',
  selectionBackground: '#444444',
  selectionForeground: '#ffffff',
  black: '#222222',
  red: '#f92a72',
  green: '#a6e22e',
  yellow: '#ffa827',
  blue: '#ae81ff',
  magenta: '#f92a72',
  cyan: '#66d9ef',
  white: '#cfcfc2',
  brightBlack: '#75715e',
  brightRed: '#f92a72',
  brightGreen: '#a6e22e',
  brightYellow: '#e6db74',
  brightBlue: '#ae81ff',
  brightMagenta: '#f92a72',
  brightCyan: '#66d9ef',
  brightWhite: '#f8f8f2'
} as const satisfies ITheme

/** Separate normal and bold weights compensate for thinner WebView strokes.
 * The contrast floor also catches low-contrast RGB colors from terminal apps. */
export const ITERM2_RENDERING = {
  fontWeight: 800,
  fontWeightBold: 1000,
  minimumContrastRatio: 4
} as const satisfies Pick<ITerminalOptions, 'fontWeight' | 'fontWeightBold' | 'minimumContrastRatio'>

export const ITERM2_TEXT_PRESET = {
  fontFamily: JETBRAINS_NERD_FONT_STACK,
  fontSize: 14,
  lineHeight: 1
} as const satisfies Pick<TerminalTextPref, 'fontFamily' | 'fontSize' | 'lineHeight'>
