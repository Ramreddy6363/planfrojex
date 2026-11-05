import { afterEach, describe, expect, it, vi } from 'vitest'
import { outbox, sendInvite } from './email'
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
    await sendInvite(env, 'person@example.com', 'Northwind', 'abc')
    expect(outbox[0]?.text).toContain('http://localhost:5173/invite/abc')
    expect(log).toHaveBeenCalled()
  })
  it('does not deliver via the development fallback in production', async () => {
    await expect(
      sendInvite({ ...env, ENVIRONMENT: 'production' }, 'person@example.com', 'Northwind', 'abc'),
    ).rejects.toThrow('Email delivery is not configured')
  })
})
