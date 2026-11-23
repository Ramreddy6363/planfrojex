import { afterEach, describe, expect, it, vi } from 'vitest'
import { outbox, sendInvite, sendReviewCode, sendReviewInvitations } from './email'
import type { Env } from './env'

const env: Env['Bindings'] = {
  DATABASE_URL: '',
  BETTER_AUTH_SECRET: '',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  ANTHROPIC_API_KEY: '',
}
afterEach(() => {
  outbox.length = 0
  vi.restoreAllMocks()
})
describe('invitation delivery', () => {
  it('delivers a development invitation without external credentials', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = 'private-workspace-invite'
    await sendInvite(env, 'person@example.com', 'Northwind', token)
    expect(outbox[0]?.text).toContain(`http://localhost:5173/invite/${token}`)
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(token)
  })
  it('does not deliver via the development fallback in production', async () => {
    await expect(
      sendInvite({ ...env, ENVIRONMENT: 'production' }, 'person@example.com', 'Northwind', 'abc'),
    ).rejects.toThrow('Email delivery is not configured')
  })
})

describe('review email delivery', () => {
  const recipients = [
    { email: 'first-reviewer@example.com', token: 'first-private-review-token' },
    { email: 'second-reviewer@example.com', token: 'second-private-review-token' },
  ]

  it('puts one individually addressed invitation per reviewer in the development outbox', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const [first, second] = recipients
    if (!first || !second) throw new Error('Expected two reviewers')
    const code = '987654'

    await sendReviewInvitations(env, recipients, 'Maya Chen', 'Portal', null)
    await sendReviewCode(env, first.email, code)

    expect(outbox.map((message) => message.to)).toEqual([first.email, second.email, first.email])
    expect(outbox[0]?.text).toContain(`http://localhost:5173/share/${first.token}?review=1`)
    expect(outbox[0]?.text).not.toContain(second.token)
    expect(outbox[1]?.text).toContain(`http://localhost:5173/share/${second.token}?review=1`)
    expect(outbox[1]?.text).not.toContain(first.token)
    expect(outbox[2]?.text).toContain(code)
    expect(fetch).not.toHaveBeenCalled()

    const consoleMessages = JSON.stringify([...log.mock.calls, ...warn.mock.calls])
    for (const privateValue of [first.token, second.token, code])
      expect(consoleMessages).not.toContain(privateValue)
  })

  it('sends all review invitations in one Resend batch with a separate envelope for each person', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const production: Env['Bindings'] = {
      ...env,
      ENVIRONMENT: 'production',
      EMAIL_FROM: 'PlanFrojex <plans@example.com>',
      RESEND_API_KEY: 'fake-test-key',
    }
    const dueDate = '2026-12-12'

    await sendReviewInvitations(production, recipients, 'Maya Chen', 'Portal', dueDate)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetch.mock.calls[0] ?? []
    expect(endpoint).toBe('https://api.resend.com/emails/batch')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer fake-test-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual(
      recipients.map(({ email, token }) => ({
        from: production.EMAIL_FROM,
        to: [email],
        subject: 'You have a plan to review in PlanFrojex',
        text: `Maya Chen asked you to review Portal by ${dueDate}.\n\nOpen your review: http://localhost:5173/share/${token}?review=1`,
      })),
    )
    expect(outbox).toEqual([])
  })
})
