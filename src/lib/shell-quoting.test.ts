import { describe, expect, it } from 'vitest'
import { quoteForShell, shellFlavor } from '@/lib/shell-quoting'

describe('shellFlavor', () => {
  it('maps posix-family shells', () => {
    expect(shellFlavor('git-bash', true)).toBe('posix')
    expect(shellFlavor('wsl', true)).toBe('posix')
  })
  it('maps powershell family', () => {
    expect(shellFlavor('powershell', true)).toBe('powershell')
    expect(shellFlavor('pwsh', false)).toBe('powershell')
  })
  it('maps the unix-native shells to posix', () => {
    expect(shellFlavor('zsh', false)).toBe('posix')
    expect(shellFlavor('bash', false)).toBe('posix')
    expect(shellFlavor('fish', false)).toBe('posix')
  })
  it('maps cmd', () => {
    expect(shellFlavor('cmd', true)).toBe('cmd')
  })
  it('default shell follows the platform', () => {
    expect(shellFlavor('default', true)).toBe('powershell')
    expect(shellFlavor('default', false)).toBe('posix')
    expect(shellFlavor(undefined, false)).toBe('posix')
  })
})

describe('quoteForShell', () => {
  it('posix single-quotes and escapes embedded quotes', () => {
    expect(quoteForShell("don't stop", 'posix')).toBe("'don'\\''t stop'")
  })
  it('powershell doubles embedded single quotes', () => {
    expect(quoteForShell("don't stop", 'powershell')).toBe("'don''t stop'")
  })
  it('cmd double-quotes and downgrades embedded double quotes', () => {
    expect(quoteForShell('say "hi"', 'cmd')).toBe(`"say 'hi'"`)
  })
})
