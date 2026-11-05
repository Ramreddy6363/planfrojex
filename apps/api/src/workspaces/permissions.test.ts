import { describe, expect, it } from 'vitest'
import { canInvite } from './permissions'

describe('workspace permissions', () => {
  it('only allows owners to invite', () => {
    expect(canInvite('owner')).toBe(true)
    expect(canInvite('editor')).toBe(false)
    expect(canInvite('viewer')).toBe(false)
  })
})
