import { createHash } from 'node:crypto'
import { env as processEnv } from 'node:process'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import * as schema from '../db/schema'
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
  it('returns only id, email, emailVerified and name for the user in /me', async () => {
    current = { ...people.owner, name: 'Owner', image: 'x' } as typeof current
    const me = (await (await call('/me')).json()) as { user: unknown }
    expect(me.user).toEqual({ ...people.owner, name: 'Owner' })
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

  it('lists members to members and hides them from other workspaces', async () => {
    const response = await call('/workspaces/northwind/members')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ members: [{ id: 'owner', role: 'owner' }] })
    as('outsider')
    expect((await call('/workspaces/northwind/members')).status).toBe(404)
  })

  it('lets an owner change a member role but protects the last owner', async () => {
    const [workspace] = await test.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, 'northwind'))
    await test.db
      .insert(memberships)
      .values({ workspaceId: workspace!.id, userId: 'editor', role: 'editor' })
    const change = (id: string, role: string) =>
      routes.request(
        `/workspaces/northwind/members/${id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ role }),
        },
        env,
      )
    expect((await change('editor', 'viewer')).status).toBe(200)
    expect((await membersOf('editor'))[0]?.role).toBe('viewer')
    expect((await change('owner', 'viewer')).status).toBe(409)
    as('editor')
    expect((await change('owner', 'editor')).status).toBe(403)
    as('outsider')
    expect((await change('owner', 'editor')).status).toBe(404)
  })

  it('lets an owner remove a member but not the last owner', async () => {
    const [workspace] = await test.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, 'northwind'))
    await test.db
      .insert(memberships)
      .values({ workspaceId: workspace!.id, userId: 'viewer', role: 'viewer' })
    const remove = (id: string) =>
      routes.request(`/workspaces/northwind/members/${id}`, { method: 'DELETE', headers }, env)
    expect((await remove('owner')).status).toBe(409)
    as('viewer')
    expect((await remove('owner')).status).toBe(403)
    as('outsider')
    expect((await remove('viewer')).status).toBe(404)
    as('owner')
    expect((await remove('viewer')).status).toBe(200)
    expect(await membersOf('viewer')).toHaveLength(0)
  })

  it('lists pending invitations only for the owner', async () => {
    await seedInvite('ab'.repeat(32))
    expect((await call('/workspaces/northwind/invites')).status).toBe(200)
    as('outsider')
    expect((await call('/workspaces/northwind/invites')).status).toBe(404)
    const [workspace] = await test.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, 'northwind'))
    await test.db
      .insert(memberships)
      .values({ workspaceId: workspace!.id, userId: 'viewer', role: 'viewer' })
    as('viewer')
    expect((await call('/workspaces/northwind/invites')).status).toBe(403)
  })

  it('resends with a fresh token and can revoke an invitation', async () => {
    const oldToken = 'ab'.repeat(32)
    await seedInvite(oldToken)
    const [row] = await test.db.select().from(invites)
    const resend = () =>
      routes.request(`/invites/${row!.id}/resend`, { method: 'POST', headers }, env)
    const revoke = () => routes.request(`/invites/${row!.id}`, { method: 'DELETE', headers }, env)
    as('outsider')
    expect((await resend()).status).toBe(404)
    expect((await revoke()).status).toBe(404)
    as('owner')
    expect((await resend()).status).toBe(200)
    const [changed] = await test.db.select().from(invites)
    expect(changed?.tokenHash).not.toBe(sha(oldToken))
    const token = outbox[0]?.text.match(/\/invite\/([0-9a-f]{64})/)?.[1]
    expect(token).toBeTruthy()
    as('invitee')
    expect((await accept(oldToken)).status).toBe(400)
    as('owner')
    expect((await revoke()).status).toBe(200)
    expect((await resend()).status).toBe(400)
    as('invitee')
    expect((await accept(token as string)).status).toBe(400)
  })

  it.each(['editor', 'viewer'] as const)('%s cannot resend or revoke invitations', async (role) => {
    await seedInvite('ab'.repeat(32))
    const [invitation] = await test.db.select().from(invites)
    if (!invitation) throw new Error('Missing test invitation')
    await test.db
      .insert(memberships)
      .values({ workspaceId: invitation.workspaceId, userId: role, role })
    as(role)
    expect(
      (await routes.request(`/invites/${invitation.id}/resend`, { method: 'POST', headers }, env))
        .status,
    ).toBe(403)
    expect(
      (await routes.request(`/invites/${invitation.id}`, { method: 'DELETE', headers }, env))
        .status,
    ).toBe(403)
  })

  it('keeps the original token when resending fails', async () => {
    const oldToken = 'cd'.repeat(32)
    await seedInvite(oldToken)
    const [row] = await test.db.select().from(invites)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    )
    try {
      const response = await routes.request(
        `/invites/${row!.id}/resend`,
        { method: 'POST', headers },
        { ...env, RESEND_API_KEY: 'key', EMAIL_FROM: 'from@example.com' },
      )
      expect(response.status).toBe(502)
      const [unchanged] = await test.db.select().from(invites)
      expect(unchanged?.tokenHash).toBe(sha(oldToken))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not send two links when resends race', async () => {
    await seedInvite('ab'.repeat(32))
    const [invitation] = await test.db.select().from(invites)
    if (!invitation) throw new Error('Missing test invitation')
    const clients = [new Client({ connectionString: url }), new Client({ connectionString: url })]
    const { rows } = await test.client.query('SELECT current_schema() AS name')
    await Promise.all(
      clients.map(async (client) => {
        await client.connect()
        await client.query("SELECT set_config('search_path', $1, false)", [rows[0].name])
      }),
    )
    try {
      await test.client.query('BEGIN')
      await test.client.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [
        invitation.workspaceId,
      ])
      const requests = clients.map((client) => {
        const app = createWorkspaceRoutes({
          database: () => drizzle(client, { schema }),
          auth: () => ({ api: { getSession: async () => ({ user: people.owner }) } }) as never,
        })
        return Promise.resolve(
          app.request(`/invites/${invitation.id}/resend`, { method: 'POST', headers }, env),
        )
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      await test.client.query('COMMIT')
      const responses = await Promise.all(requests)
      expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
      expect(outbox).toHaveLength(1)
    } finally {
      await test.client.query('ROLLBACK')
      await Promise.all(clients.map((client) => client.end()))
    }
  })

  it('keeps one owner when two owners demote themselves concurrently', async () => {
    const [workspace] = await test.db.select().from(workspaces)
    if (!workspace) throw new Error('Missing test workspace')
    await test.db
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: 'editor', role: 'owner' })
    const clients = [new Client({ connectionString: url }), new Client({ connectionString: url })]
    const { rows } = await test.client.query('SELECT current_schema() AS name')
    await Promise.all(
      clients.map(async (client) => {
        await client.connect()
        await client.query("SELECT set_config('search_path', $1, false)", [rows[0].name])
      }),
    )
    try {
      const responses = await Promise.all(
        clients.map((client, index) => {
          const person = index === 0 ? people.owner : people.editor
          const app = createWorkspaceRoutes({
            database: () => drizzle(client, { schema }),
            auth: () => ({ api: { getSession: async () => ({ user: person }) } }) as never,
          })
          return app.request(
            `/workspaces/northwind/members/${person.id}`,
            { method: 'PATCH', headers, body: JSON.stringify({ role: 'viewer' }) },
            env,
          )
        }),
      )
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      const remaining = await test.db
        .select()
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspace.id), eq(memberships.role, 'owner')))
      expect(remaining).toHaveLength(1)
    } finally {
      await Promise.all(clients.map((client) => client.end()))
    }
  })

  it('allows invitation acceptance while a resend waits on the invitation', async () => {
    await seedInvite('ab'.repeat(32))
    const [invitation] = await test.db.select().from(invites)
    if (!invitation) throw new Error('Missing test invitation')
    const second = new Client({ connectionString: url })
    await second.connect()
    const { rows } = await test.client.query('SELECT current_schema() AS name')
    await second.query("SELECT set_config('search_path', $1, false)", [rows[0].name])
    const app = createWorkspaceRoutes({
      database: () => drizzle(second, { schema }),
      auth: () => ({ api: { getSession: async () => ({ user: people.owner }) } }) as never,
    })
    try {
      await test.client.query('BEGIN')
      await test.client.query('SELECT id FROM invites WHERE id = $1 FOR UPDATE', [invitation.id])
      const resend = Promise.resolve(
        app.request(`/invites/${invitation.id}/resend`, { method: 'POST', headers }, env),
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      await test.client.query("SET LOCAL lock_timeout = '300ms'")
      await test.client.query(
        "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, 'invitee', 'editor')",
        [invitation.workspaceId],
      )
      await test.client.query('COMMIT')
      expect((await resend).status).toBe(200)
    } finally {
      await test.client.query('ROLLBACK')
      await second.end()
    }
  })

  it('does not resend after the acting owner is concurrently demoted', async () => {
    await seedInvite('ef'.repeat(32))
    const [invitation] = await test.db.select().from(invites)
    if (!invitation) throw new Error('Missing test invitation')
    await test.db
      .insert(memberships)
      .values({ workspaceId: invitation.workspaceId, userId: 'editor', role: 'owner' })
    const second = new Client({ connectionString: url })
    await second.connect()
    const { rows } = await test.client.query('SELECT current_schema() AS name')
    await second.query("SELECT set_config('search_path', $1, false)", [rows[0].name])
    const concurrentRoutes = createWorkspaceRoutes({
      database: () => drizzle(second, { schema }),
      auth: () => ({ api: { getSession: async () => ({ user: people.editor }) } }) as never,
    })
    try {
      await test.client.query('BEGIN')
      await test.client.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [
        invitation.workspaceId,
      ])
      await test.client.query(
        "UPDATE memberships SET role = 'viewer' WHERE workspace_id = $1 AND user_id = 'editor'",
        [invitation.workspaceId],
      )
      let finished = false
      const pending = Promise.resolve(
        concurrentRoutes.request(
          `/invites/${invitation.id}/resend`,
          { method: 'POST', headers },
          env,
        ),
      ).then((response) => {
        finished = true
        return response
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(finished).toBe(false)
      await test.client.query('COMMIT')
      expect((await pending).status).toBe(403)
      expect(outbox).toHaveLength(0)
    } finally {
      await test.client.query('ROLLBACK')
      await second.end()
    }
  })
})
