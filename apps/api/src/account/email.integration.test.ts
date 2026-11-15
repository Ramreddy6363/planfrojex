import { like } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createAuth } from '../auth'
import { session, user, verification } from '../db/schema'
import { createApp } from '../index'
import { integrationSuite, openTestDb } from '../testing/pg'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
const env = {
  DATABASE_URL: 'test',
  BETTER_AUTH_SECRET: 'a-long-test-secret-with-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: 'test',
  EMAIL_FROM: 'test@example.com',
  ANTHROPIC_API_KEY: '',
}
integrationSuite(url)('account email change', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>,
    auth: ReturnType<typeof createAuth>,
    app: ReturnType<typeof createApp>,
    code = '',
    cookie = '',
    userId = ''
  const req = (path: string, body: unknown, sessionCookie = cookie) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: {
          origin: env.WEB_ORIGIN,
          'content-type': 'application/json',
          cookie: sessionCookie,
        },
        body: JSON.stringify(body),
      },
      env,
    )
  beforeAll(async () => {
    db = await openTestDb(url as string)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const payload = JSON.parse(String(init.body)) as { text: string }
        code = payload.text.match(/\b\d{6}\b/)?.[0] ?? ''
        return new Response('{}', { status: 200 })
      }),
    )
    auth = createAuth(env, db.db)
    app = createApp({ database: () => db.db, auth: () => auth })
  })
  beforeEach(async () => {
    await db.client.query('TRUNCATE users,verifications,rate_limits CASCADE')
    await req(
      '/api/auth/email-otp/send-verification-otp',
      { email: 'owner@example.com', type: 'sign-in' },
      '',
    )
    const result = await req(
      '/api/auth/sign-in/email-otp',
      { email: 'owner@example.com', otp: code },
      '',
    )
    expect(result.status).toBe(200)
    cookie = result.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    userId = ((await result.json()) as { user: { id: string } }).user.id
    await db.client.query('DELETE FROM rate_limits')
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await db.close()
  })
  it('uses a hashed six-digit code, changes only after verification and revokes other sessions', async () => {
    await db.db.insert(session).values({
      id: 'other-session',
      userId,
      token: 'other-token',
      expiresAt: new Date(Date.now() + 600_000),
    })
    expect((await req('/me/email/start', { email: ' NEW@example.com ' })).status).toBe(200)
    expect(code).toMatch(/^\d{6}$/)
    const [otp] = await db.db
      .select()
      .from(verification)
      .where(like(verification.identifier, 'change-email%'))
    if (!otp) throw new Error('otp')
    expect(otp.value).not.toContain(code)
    expect(otp.expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000)
    expect((await db.db.select().from(user))[0]?.email).toBe('owner@example.com')
    const wrong = code === '000000' ? '000001' : '000000'
    expect((await req('/me/email/verify', { code: wrong })).status).toBe(400)
    const verified = await req('/me/email/verify', { code })
    expect(verified.status).toBe(200)
    expect((await db.db.select().from(user))[0]?.email).toBe('new@example.com')
    expect(await db.db.select().from(session)).toHaveLength(1)
    expect((await db.db.select().from(session))[0]?.id).not.toBe('other-session')
    expect((await req('/me/email/verify', { code })).status).toBe(400)
  })
  it('rejects expired codes and locks after five incorrect tries', async () => {
    expect((await req('/me/email/start', { email: 'expired@example.com' })).status).toBe(200)
    await db.db.update(verification).set({ expiresAt: new Date(Date.now() - 1000) })
    expect((await req('/me/email/verify', { code })).status).toBe(400)
    expect((await req('/me/email/start', { email: 'tries@example.com' })).status).toBe(200)
    const wrong = code === '000000' ? '000001' : '000000'
    for (let i = 0; i < 5; i++)
      expect((await req('/me/email/verify', { code: wrong })).status).toBe(400)
    expect((await req('/me/email/verify', { code })).status).toBe(400)
    expect((await db.db.select().from(user))[0]?.email).toBe('owner@example.com')
  })
  it('keeps email verification session-bound and returns 409 if the destination becomes taken', async () => {
    expect((await req('/me/email/start', { email: 'pending@example.com' })).status).toBe(200)
    const pendingCode = code
    const originalCookie = cookie
    await req(
      '/api/auth/email-otp/send-verification-otp',
      { email: 'stranger@example.com', type: 'sign-in' },
      '',
    )
    const signedIn = await req(
      '/api/auth/sign-in/email-otp',
      { email: 'stranger@example.com', otp: code },
      '',
    )
    expect(signedIn.status).toBe(200)
    const strangerCookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    expect((await req('/me/email/verify', { code: pendingCode }, strangerCookie)).status).toBe(400)
    await db.db
      .insert(user)
      .values({ id: 'claimed', name: 'Claimed', email: 'pending@example.com' })
    expect((await req('/me/email/verify', { code: pendingCode }, originalCookie)).status).toBe(409)
    expect(
      (
        await req(
          '/api/auth/email-otp/request-email-change',
          { newEmail: 'bypass@example.com' },
          originalCookie,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await req(
          '/api/auth/email-otp/change-email',
          { newEmail: 'pending@example.com', otp: pendingCode },
          originalCookie,
        )
      ).status,
    ).toBe(404)
  })
  it('deleting the account revokes its current session', async () => {
    const removed = await app.request(
      '/me',
      {
        method: 'DELETE',
        headers: { origin: env.WEB_ORIGIN, 'content-type': 'application/json', cookie },
        body: JSON.stringify({ confirm: 'delete' }),
      },
      env,
    )
    expect(removed.status).toBe(200)
    expect((await app.request('/me', { headers: { cookie } }, env)).status).toBe(401)
  })
  it('rejects taken addresses, rate limits starts, and binds pending destination to the session user', async () => {
    await db.db.insert(user).values({ id: 'taken', name: 'Taken', email: 'taken@example.com' })
    expect((await req('/me/email/start', { email: 'taken@example.com' })).status).toBe(409)
    expect((await req('/me/email/start', { email: 'free@example.com' })).status).toBe(200)
    expect((await req('/me/email/start', { email: 'other@example.com' })).status).toBe(200)
    expect((await req('/me/email/start', { email: 'fourth@example.com' })).status).toBe(429)
    expect((await req('/me/email/start', { email: 'stranger@example.com' }, '')).status).toBe(401)
    expect((await req('/me/email/verify', { code }, '')).status).toBe(401)
    expect((await req('/me/email/start', { email: 'x@example.com', userId: 'taken' })).status).toBe(
      429,
    )
  })
})
