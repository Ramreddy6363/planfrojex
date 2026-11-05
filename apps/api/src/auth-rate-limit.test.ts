import { describe, expect, it, vi } from 'vitest'

const { limit, handler } = vi.hoisted(() => ({ limit: vi.fn(), handler: vi.fn() }))
vi.mock('./rate-limit', () => ({ consumeRateLimit: limit }))
vi.mock('./auth', () => ({ createAuth: () => ({ handler, api: { getSession: vi.fn() } }) }))

import { createApp } from './index'

const app = createApp({ database: () => ({}) as never })

describe('email code delivery limit', () => {
  it.each([
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/check-verification-otp',
  ])('does not expose the password route %s', async (path) => {
    const response = await app.request(`/api/auth${path}`, { method: 'POST' }, {
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'test',
    } as never)
    expect(response.status).toBe(404)
  })
  it('returns 429 before sending when the email is over its limit', async () => {
    limit.mockResolvedValue(false)
    const response = await app.request(
      '/api/auth/email-otp/send-verification-otp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({ email: ' User@Example.com ', type: 'sign-in' }),
      },
      { WEB_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'test' } as never,
    )
    expect(response.status).toBe(429)
    expect(limit.mock.calls[0]?.[2]).toBe('user@example.com')
    expect(handler).not.toHaveBeenCalled()
  })
})
