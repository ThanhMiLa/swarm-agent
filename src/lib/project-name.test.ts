import { describe, it, expect } from 'vitest'
import { projectNameFor } from './project-name'

describe('projectNameFor', () => {
  it('names the project after the folder', () => {
    expect(projectNameFor('C:/dev/myapp', [])).toBe('myapp')
  })

  it('handles unix paths and trailing separators', () => {
    expect(projectNameFor('/Users/me/projects/swarm-agent/', [])).toBe('swarm-agent')
  })

  it('suffixes (1) when the folder name is already taken', () => {
    expect(projectNameFor('C:/dev/myapp', ['myapp'])).toBe('myapp (1)')
  })

  it('counts up past every taken suffix', () => {
    expect(projectNameFor('C:/dev/myapp', ['myapp', 'myapp (1)', 'myapp (2)'])).toBe(
      'myapp (3)'
    )
  })

  it('fills the first free gap rather than the highest suffix', () => {
    expect(projectNameFor('C:/dev/myapp', ['myapp', 'myapp (2)'])).toBe('myapp (1)')
  })

  it('ignores unrelated names', () => {
    expect(projectNameFor('C:/dev/myapp', ['other', 'myapp-web'])).toBe('myapp')
  })

  it('falls back to "Project" when no folder is given', () => {
    expect(projectNameFor('   ', [])).toBe('Project')
  })

  it('de-dupes the fallback name too', () => {
    expect(projectNameFor('', ['Project'])).toBe('Project (1)')
  })

  it('names a drive root after the drive', () => {
    expect(projectNameFor('C:/', [])).toBe('C:')
  })
})
