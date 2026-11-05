import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendCode } from './auth'
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
afterEach(() => vi.restoreAllMocks())
describe('code delivery', () => {
  it('prints a code in local development when Resend is not configured', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendCode(env, 'test@example.com', '123456')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('123456'))
  })
  it('never logs a code for production without Resend', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      sendCode(
        { ...env, BETTER_AUTH_URL: 'https://api.example.com' },
        'test@example.com',
        '123456',
      ),
    ).rejects.toThrow('Email delivery is not configured')
    expect(log).not.toHaveBeenCalled()
  })
})
