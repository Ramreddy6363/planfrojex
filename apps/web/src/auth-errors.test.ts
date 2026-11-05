import { describe, expect, it } from 'vitest'
import {
  codeVerificationMessage,
  invitationMessage,
  inviteAcceptMessage,
  requestCodeMessage,
  workspaceCreationMessage,
} from './auth-errors'

describe('plain-language authentication errors', () => {
  it('explains wrong, expired, and limited codes without backend terms', () => {
    expect(codeVerificationMessage({ code: 'INVALID_OTP', message: 'Invalid OTP' })).toBe(
      'That code didn’t work. Check it and try again.',
    )
    expect(codeVerificationMessage({ code: 'OTP_EXPIRED' })).toBe(
      'That code has expired. Request a new code.',
    )
    expect(codeVerificationMessage({ status: 429 })).toBe(
      'Too many attempts. Wait a few minutes, then request a new code.',
    )
    expect(codeVerificationMessage({ status: 500 })).toBe('We couldn’t check your code. Try again.')
  })
  it('explains a code-send limit and a taken workspace URL', () => {
    expect(requestCodeMessage({ status: 429 })).toBe(
      'Too many codes requested. Wait a few minutes and try again.',
    )
    expect(workspaceCreationMessage({ status: 409 })).toBe(
      'That workspace URL is taken. Try another.',
    )
    expect(invitationMessage({ status: 429 })).toBe(
      'Too many invitations sent. Wait a few minutes and try again.',
    )
  })
  it('explains why an invitation could not be accepted', () => {
    expect(inviteAcceptMessage({ status: 400 })).toBe(
      'This invitation is invalid, has expired, or was sent to a different email.',
    )
    expect(inviteAcceptMessage({ status: 403 })).toBe(
      'Verify your email before accepting this invitation.',
    )
    expect(inviteAcceptMessage({ status: 500 })).toBe(
      'We couldn’t accept this invitation. Try again.',
    )
  })
  it('says links are not allowed in workspace names', () => {
    expect(workspaceCreationMessage({ status: 400 }, 'See https://evil.example')).toBe(
      'Workspace names can’t contain links. Remove the link and try again.',
    )
    expect(workspaceCreationMessage({ status: 400 }, 'visit www.evil.example')).toContain('links')
    expect(workspaceCreationMessage({ status: 400 }, 'Northwind')).toBe(
      'Check the workspace name and URL, then try again.',
    )
  })
})
