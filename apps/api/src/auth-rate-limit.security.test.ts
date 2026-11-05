import { env as processEnv } from 'node:process'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createAuth } from './auth'
import { createApp } from './index'
import { integrationSuite, openTestDb } from './testing/pg'

const url = processEnv.PLANFROJEX_TEST_DATABASE_URL
const suite = integrationSuite(url)
const env = {
  DATABASE_URL: 'unused',
  BETTER_AUTH_SECRET: 'a-long-random-test-secret-at-least-32-bytes-long',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: 'test',
  EMAIL_FROM: 'test@example.com',
  ANTHROPIC_API_KEY: '',
}

suite('per-email code limit cannot be bypassed', () => {
  let test: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  beforeAll(async () => {
    test = await openTestDb(url as string)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('{}')
      }),
    )
    app = createApp({
      database: () => test.db as never,
      auth: (e) => createAuth(e, test.db as never),
    })
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await test?.close()
  })

  const send = (email: string, xff: string) =>
    app.request(
      'http://localhost:8787/api/auth/email-otp/send-verification-otp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: env.WEB_ORIGIN,
          'x-forwarded-for': xff,
          'cf-connecting-ip': xff.split(', ').pop() as string,
        },
        body: JSON.stringify({ email, type: 'sign-in' }),
      },
      env,
    )

  it('keeps a separate code-request bucket per real client behind Cloudflare', async () => {
    await test.client.query('DELETE FROM rate_limits')
    vi.stubEnv('NODE_ENV', 'production')
    try {
      // Cloudflare appends the real client IP to any X-Forwarded-For the client sent: "<forged>, <real>".
      // An attacker at 198.51.100.1 sends three requests.
      for (let i = 0; i < 3; i++) await send(`spam${i}@example.com`, `1.1.1.1, 198.51.100.1`)
      // A different person, behind a proxy that also sets X-Forwarded-For, asks for their own code.
      const victim = await send('victim@example.com', '10.1.2.3, 203.0.113.9')
      expect(victim.status).toBe(200)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
