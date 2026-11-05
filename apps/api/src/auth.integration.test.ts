import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { env as processEnv } from 'node:process'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createAuth } from './auth'
import * as schema from './db/schema'
import { integrationSuite } from './testing/pg'

const url = processEnv.PLANFROJEX_TEST_DATABASE_URL
const suite = integrationSuite(url)
suite('email code authentication against PostgreSQL', () => {
  let client: Client
  let code = ''
  beforeAll(async () => {
    client = new Client({ connectionString: url })
    await client.connect()
    const schemaName = `auth_test_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA ${schemaName}`)
    await client.query(`SET search_path TO ${schemaName}`)
    const migration = await readFile('migrations/0000_kind_thunderbolt.sql', 'utf8')
    await client.query(migration.replaceAll('"public".', ''))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const payload = JSON.parse(String(init.body)) as { text: string }
        code = payload.text.match(/\b\d{6}\b/)?.[0] ?? ''
        return new Response('{}', { status: 200 })
      }),
    )
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await client?.end()
  })
  it('stores a hashed code, signs in once, and rejects reuse', async () => {
    const auth = createAuth(
      {
        DATABASE_URL: 'unused',
        BETTER_AUTH_SECRET: 'a-long-random-test-secret-at-least-32-bytes-long',
        BETTER_AUTH_URL: 'http://localhost:8787',
        WEB_ORIGIN: 'http://localhost:5173',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        RESEND_API_KEY: 'test',
        EMAIL_FROM: 'test@example.com',
        ANTHROPIC_API_KEY: '',
      },
      drizzle(client, { schema }),
    )
    const call = (path: string, body: unknown) =>
      auth.handler(
        new Request(`http://localhost:8787/api/auth/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
          body: JSON.stringify(body),
        }),
      )
    const sent = await call('email-otp/send-verification-otp', {
      email: 'person@example.com',
      type: 'sign-in',
    })
    expect(sent.status).toBe(200)
    expect(code).toMatch(/^\d{6}$/)
    const stored = await client.query(
      'SELECT value, extract(epoch from (expires_at - now())) AS remaining FROM verifications',
    )
    expect(stored.rows[0].value).not.toContain(code)
    expect(Number(stored.rows[0].remaining)).toBeGreaterThan(590)
    expect(Number(stored.rows[0].remaining)).toBeLessThanOrEqual(600)
    const valid = await call('sign-in/email-otp', { email: 'person@example.com', otp: code })
    expect(valid.status).toBe(200)
    expect(valid.headers.get('set-cookie')).toContain('HttpOnly')
    const signedIn = (await valid.json()) as { user: { id: string } }
    const context = await auth.$context
    expect(context.options.account?.encryptOAuthTokens).toBe(true)
    const googleAccount = await context.internalAdapter.createAccount({
      userId: signedIn.user.id,
      accountId: 'google-account-test',
      providerId: 'google',
    })
    expect(googleAccount.providerId).toBe('google')
    const reused = await call('sign-in/email-otp', { email: 'person@example.com', otp: code })
    expect(reused.status).not.toBe(200)

    await client.query('DELETE FROM rate_limits')
    expect(
      (
        await call('email-otp/send-verification-otp', {
          email: 'expired@example.com',
          type: 'sign-in',
        })
      ).status,
    ).toBe(200)
    await client.query("UPDATE verifications SET expires_at = now() - interval '1 second'")
    expect(
      (await call('sign-in/email-otp', { email: 'expired@example.com', otp: code })).status,
    ).not.toBe(200)

    await client.query('DELETE FROM rate_limits')
    expect(
      (
        await call('email-otp/send-verification-otp', {
          email: 'attempts@example.com',
          type: 'sign-in',
        })
      ).status,
    ).toBe(200)
    const wrong = code === '000000' ? '000001' : '000000'
    for (let i = 0; i < 3; i++) {
      await client.query('DELETE FROM rate_limits')
      expect(
        (await call('sign-in/email-otp', { email: 'attempts@example.com', otp: wrong })).status,
      ).not.toBe(200)
    }
    await client.query('DELETE FROM rate_limits')
    expect(
      (await call('sign-in/email-otp', { email: 'attempts@example.com', otp: code })).status,
    ).not.toBe(200)
  })
  it('answers 429 once one client sends too many code attempts', async () => {
    await client.query('DELETE FROM rate_limits')
    const auth = createAuth(
      {
        DATABASE_URL: 'unused',
        BETTER_AUTH_SECRET: 'a-long-random-test-secret-at-least-32-bytes-long',
        BETTER_AUTH_URL: 'http://localhost:8787',
        WEB_ORIGIN: 'http://localhost:5173',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        RESEND_API_KEY: 'test',
        EMAIL_FROM: 'test@example.com',
        ANTHROPIC_API_KEY: '',
      },
      drizzle(client, { schema }),
    )
    const verify = async () =>
      (
        await auth.handler(
          new Request('http://localhost:8787/api/auth/sign-in/email-otp', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:5173',
              'cf-connecting-ip': '203.0.113.50',
            },
            body: JSON.stringify({ email: 'limit@example.com', otp: '000000' }),
          }),
        )
      ).status
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push(await verify())
    expect(statuses).toContain(429)
    expect(statuses[0]).not.toBe(429)
  })
})
