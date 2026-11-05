import { createHash } from 'node:crypto'
import { env as processEnv } from 'node:process'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { invites, memberships, user as users, workspaces } from '../db/schema'
import { outbox } from '../email'
import { consumeRateLimit } from '../rate-limit'
import { integrationSuite, openTestDb } from '../testing/pg'
import { createWorkspaceRoutes } from './routes'

const url = processEnv.PLANFROJEX_TEST_DATABASE_URL
const suite = integrationSuite(url)
const env = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'test',
  BETTER_AUTH_SECRET: '',
  BETTER_AUTH_URL: 'http://localhost:8787',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  ANTHROPIC_API_KEY: '',
}
const headers = { origin: env.WEB_ORIGIN, 'content-type': 'application/json' }
const people = {
  owner: { id: 'owner', email: 'owner@example.com', emailVerified: true },
  outsider: { id: 'outsider', email: 'other@example.com', emailVerified: true },
  invitee: { id: 'invitee', email: 'invitee@example.com', emailVerified: true },
  editor: { id: 'editor', email: 'editor@example.com', emailVerified: true },
  viewer: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
}
const sha = (token: string) => createHash('sha256').update(token).digest('hex')

suite('workspace routes against PostgreSQL', () => {
  let test: Awaited<ReturnType<typeof openTestDb>>
  let current: { id: string; email: string; emailVerified: boolean } = people.owner
  let routes: ReturnType<typeof createWorkspaceRoutes>
  const as = (who: keyof typeof people) => {
    current = people[who]
  }
  const call = (path: string, body?: unknown) =>
    routes.request(
      path,
      body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) },
      env,
    )
  const invite = (slug: string, emails: string[], role = 'editor') =>
    call(`/workspaces/${slug}/invites`, { emails, role })
  const accept = (token: string) => call('/invites/accept', { token })
  async function seedInvite(token: string, patch: Partial<typeof invites.$inferInsert> = {}) {
    const [workspace] = await test.client
      .query("SELECT id FROM workspaces WHERE slug = 'northwind'")
      .then((r) => r.rows)
    await test.db.insert(invites).values({
      workspaceId: workspace.id,
      email: 'invitee@example.com',
      role: 'editor',
      tokenHash: sha(token),
      invitedBy: 'owner',
      expiresAt: new Date(Date.now() + 86_400_000),
      ...patch,
    })
  }
  const membersOf = async (userId: string) =>
    test.db.select().from(memberships).where(eq(memberships.userId, userId))

  beforeAll(async () => {
    test = await openTestDb(url as string)
    routes = createWorkspaceRoutes({
      database: () => test.db,
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
    })
  })
  // Every test starts from the same data, so each passes when run alone.
  beforeEach(async () => {
    await test.client.query(
      'TRUNCATE users, workspaces, memberships, invites, rate_limits RESTART IDENTITY CASCADE',
    )
    await test.db.insert(users).values(
      Object.values(people).map((p) => ({
        id: p.id,
        name: p.id,
        email: p.email,
        emailVerified: true,
      })),
    )
    const [workspace] = await test.db
      .insert(workspaces)
      .values({ name: 'Northwind', slug: 'northwind' })
      .returning({ id: workspaces.id })
    await test.db
      .insert(memberships)
      .values({ workspaceId: workspace?.id as string, userId: 'owner', role: 'owner' })
    outbox.length = 0
    as('owner')
  })
  afterAll(async () => {
    await test.close()
  })

  it('creates the workspace and owner together, and lists it in /me', async () => {
    as('owner')
    const created = await call('/workspaces', {
      name: 'Acme',
      slug: 'acme',
      isPersonal: false,
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { workspace: { id: string } }
    expect(body.workspace.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/)
    const visible = await call('/workspaces/acme')
    expect(((await visible.json()) as { workspace: { role: string } }).workspace.role).toBe('owner')
    const me = (await (await call('/me')).json()) as {
      workspaces: { slug: string; role: string }[]
    }
    expect(me.workspaces).toMatchObject([
      { slug: 'northwind', role: 'owner' },
      { slug: 'acme', role: 'owner' },
    ])
    const taken = await call('/workspaces', { name: 'Again', slug: 'northwind', isPersonal: false })
    expect(taken.status).toBe(409)
    expect(await test.db.select().from(memberships)).toHaveLength(2)
  })
  it('returns only id, email and emailVerified for the user in /me', async () => {
    current = { ...people.owner, name: 'Owner', image: 'x' } as typeof current
    const me = (await (await call('/me')).json()) as { user: unknown }
    expect(me.user).toEqual(people.owner)
  })
  it('answers 404 for unknown paths, signed in or not', async () => {
    expect((await call('/nope')).status).toBe(404)
    expect((await call('/nope', {})).status).toBe(404)
  })
  it('keeps the workspace name out of the invitation subject', async () => {
    expect((await invite('northwind', ['new@example.com'])).status).toBe(201)
    expect(outbox[0]?.subject).not.toContain('Northwind')
  })
  it('hides the workspace and invites from a member of another workspace with 404', async () => {
    as('outsider')
    expect((await call('/workspaces/northwind')).status).toBe(404)
    expect((await invite('northwind', ['invitee@example.com'])).status).toBe(404)
    expect(await test.db.select().from(invites)).toHaveLength(0)
    const me = (await (await call('/me')).json()) as { workspaces: unknown[] }
    expect(me.workspaces).toEqual([])
  })
  it.each(['editor', 'viewer'] as const)('does not let a %s invite (403)', async (role) => {
    const [row] = await test.client
      .query("SELECT id FROM workspaces WHERE slug = 'northwind'")
      .then((r) => r.rows)
    await test.db.insert(memberships).values({ workspaceId: row.id, userId: role, role })
    as(role)
    expect((await call('/workspaces/northwind')).status).toBe(200)
    expect((await invite('northwind', ['new@example.com'])).status).toBe(403)
    expect(await test.db.select().from(invites)).toHaveLength(0)
  })
  it.each([
    ['another email', async () => as('outsider'), 'ab'.repeat(32), {}],
    [
      'expired',
      async () => as('invitee'),
      'cd'.repeat(32),
      { expiresAt: new Date(Date.now() - 1000) },
    ],
    ['revoked', async () => as('invitee'), 'ef'.repeat(32), { status: 'revoked' as const }],
  ])(
    'rejects an invitation that is %s and adds no membership',
    async (_name, who, token, patch) => {
      await seedInvite(token, patch)
      await who()
      expect((await accept(token)).status).toBe(400)
      expect(await membersOf('outsider')).toHaveLength(0)
      expect(await membersOf('invitee')).toHaveLength(0)
      // clear the pending invite for the next case
      await test.db.delete(invites).where(eq(invites.tokenHash, sha(token)))
    },
  )
  it('accepts an invitation once and only for its verified email', async () => {
    const token = '12'.repeat(32)
    await seedInvite(token)
    as('invitee')
    expect((await accept(token)).status).toBe(200)
    expect(await membersOf('invitee')).toMatchObject([{ role: 'editor' }])
    expect((await accept(token)).status).toBe(400)
    expect(await membersOf('invitee')).toHaveLength(1)
    expect((await call('/workspaces/northwind')).status).toBe(200)
  })
  it('rejects an invitation for an unverified email', async () => {
    const token = '34'.repeat(32)
    await seedInvite(token, { email: 'unverified@example.com' })
    current = { id: 'outsider', email: 'unverified@example.com', emailVerified: false }
    expect((await accept(token)).status).toBe(403)
    expect(await membersOf('outsider')).toHaveLength(0)
  })
  it('enforces persistent rate limits in PostgreSQL', async () => {
    expect(await consumeRateLimit(test.db, 'test', 'subject', 1, 2, 60_000)).toBe(true)
    expect(await consumeRateLimit(test.db, 'test', 'subject', 1, 2, 60_000)).toBe(true)
    expect(await consumeRateLimit(test.db, 'test', 'subject', 1, 2, 60_000)).toBe(false)
    expect(await consumeRateLimit(test.db, 'test', 'subject', 1, 2, 0)).toBe(true)
  })
  it('normalizes and deduplicates invitations while storing only token hashes', async () => {
    as('owner')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    outbox.length = 0
    const send = () => invite('northwind', ['  NEW@Example.com ', 'new@example.com'], 'viewer')
    expect((await send()).status).toBe(201)
    expect(((await (await send()).json()) as { created: number }).created).toBe(0)
    expect(outbox).toHaveLength(1)
    const rows = await test.db.select().from(invites).where(eq(invites.email, 'new@example.com'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/)
    expect(outbox[0]?.text).not.toContain(rows[0]?.tokenHash)
    expect(outbox[0]?.text).toContain('/invite/')
    log.mockRestore()
  })
  it('rolls the invitation back when its email cannot be sent', async () => {
    as('owner')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    )
    const res = await routes.request(
      '/workspaces/northwind/invites',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ emails: ['fails@example.com'], role: 'editor' }),
      },
      { ...env, RESEND_API_KEY: 'key', EMAIL_FROM: 'from@example.com' },
    )
    vi.unstubAllGlobals()
    expect(res.status).toBe(502)
    expect(
      await test.db.select().from(invites).where(eq(invites.email, 'fails@example.com')),
    ).toHaveLength(0)
  })
  it('limits invitation sending per user', async () => {
    as('owner')
    await test.client.query('DELETE FROM rate_limits')
    const batch = (n: number) => Array.from({ length: 20 }, (_, i) => `bulk${n}-${i}@example.com`)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await invite('northwind', batch(1))).status).toBe(201)
    expect((await invite('northwind', batch(2))).status).toBe(201)
    expect((await invite('northwind', batch(3))).status).toBe(429)
    log.mockRestore()
    expect(
      await test.db
        .select()
        .from(invites)
        .where(and(eq(invites.email, 'bulk3-0@example.com'))),
    ).toHaveLength(0)
  })
})
