import { nameHasLink } from '@planfrojex/api/rules'

type Failure = { status?: number; code?: string; message?: string }

export function codeVerificationMessage(error: Failure): string {
  if (error.status === 429) return 'Too many attempts. Wait a few minutes, then request a new code.'
  if (error.code === 'OTP_EXPIRED' || /expir/i.test(error.message ?? ''))
    return 'That code has expired. Request a new code.'
  if (error.code === 'INVALID_OTP' || /invalid.*(otp|code)/i.test(error.message ?? ''))
    return 'That code didn’t work. Check it and try again.'
  return 'We couldn’t check your code. Try again.'
}

export function requestCodeMessage(error: Failure): string {
  if (error.status === 429) return 'Too many codes requested. Wait a few minutes and try again.'
  return 'We couldn’t send a code. Try again.'
}

export function workspaceCreationMessage(error: Failure, name = ''): string {
  if (error.status === 409) return 'That workspace URL is taken. Try another.'
  if (error.status === 400 && nameHasLink(name))
    return 'Workspace names can’t contain links. Remove the link and try again.'
  if (error.status === 400) return 'Check the workspace name and URL, then try again.'
  return 'We couldn’t create your workspace. Try again.'
}

export function invitationMessage(error: Failure): string {
  if (error.status === 429) return 'Too many invitations sent. Wait a few minutes and try again.'
  if (error.status === 400) return 'Check the email addresses, then try again.'
  if (error.status === 403) return 'Only workspace owners can send invitations.'
  return 'We couldn’t send your invitations. Try again.'
}

export function inviteAcceptMessage(error: Failure): string {
  if (error.status === 403) return 'Verify your email before accepting this invitation.'
  if (error.status === 400)
    return 'This invitation is invalid, has expired, or was sent to a different email.'
  return 'We couldn’t accept this invitation. Try again.'
}

export const googleSignInMessage = 'We couldn’t sign you in with Google. Try again.'
