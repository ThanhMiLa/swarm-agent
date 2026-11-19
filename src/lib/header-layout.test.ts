import { describe, it, expect } from 'vitest'
import { resolveHeaderLevel, shortenPath } from './header-layout'

it('collapses the shell before the folder as the terminal header narrows', () => {
  expect(resolveHeaderLevel(400)).toEqual({ showFolderPath: true, showShellLabel: true })
  expect(resolveHeaderLevel(200)).toEqual({ showFolderPath: true, showShellLabel: false })
  expect(resolveHeaderLevel(150)).toEqual({ showFolderPath: false, showShellLabel: false })
})

describe('shortenPath', () => {
  it('returns the trailing segment of a posix path', () => {
    expect(shortenPath('/home/duong/project')).toBe('project')
  })

  it('returns the trailing segment of a windows path', () => {
    expect(shortenPath('C:\\Project\\2026\\swarm-agent')).toBe('swarm-agent')
  })

  it('ignores a trailing separator', () => {
    expect(shortenPath('/home/duong/project/')).toBe('project')
  })

  it('returns the input when there is no separator', () => {
    expect(shortenPath('project')).toBe('project')
  })
})
