import { describe, expect, it } from 'vitest'
import { chooseWorkspace } from './last-workspace'

describe('last workspace', () => {
  it('selects the last accessible workspace and ignores stale choices', () => {
    const workspaces = [{ slug: 'first' }, { slug: 'last' }]
    expect(chooseWorkspace(workspaces, 'last')).toBe('last')
    expect(chooseWorkspace(workspaces, 'removed')).toBe('first')
    expect(chooseWorkspace([], 'last')).toBeUndefined()
  })
})
