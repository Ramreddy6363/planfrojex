import { describe, expect, it } from 'vitest'
import { RequestError } from './api'
import { genericError, UserError, userMessage } from './user-error'

describe('messages shown to people', () => {
  it('shows only messages a screen wrote on purpose', () => {
    expect(userMessage(new UserError('Could not sign out. Try again.'))).toBe(
      'Could not sign out. Try again.',
    )
  })
  it('hides network and raw API errors behind the generic text', () => {
    expect(userMessage(new TypeError('Failed to fetch'))).toBe(genericError)
    expect(userMessage(new RequestError('Invitation expired', 400))).toBe(genericError)
    expect(userMessage('boom')).toBe(genericError)
  })
})
