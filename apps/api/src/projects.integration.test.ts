import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { memberships, projects, user, workspaces } from './db/schema'
import { createApp } from './index'
import { integrationSuite, openTestDb } from './testing/pg'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
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
  editor: { id: 'editor', email: 'editor@example.com', emailVerified: true },
  viewer: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
  outsider: { id: 'outsider', email: 'outsider@example.com', emailVerified: true },
}

suite('projects', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let current = people.owner
  let app: ReturnType<typeof createApp>
  beforeAll(async () => {
    db = await openTestDb(url as string)
    app = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
    })
  })
  beforeEach(async () => {
    await db.client.query('TRUNCATE users, workspaces, memberships, invites, rate_limits CASCADE')
    await db.db
      .insert(user)
      .values(Object.values(people).map((person) => ({ ...person, name: person.id })))
    const [ws] = await db.db
      .insert(workspaces)
      .values({ name: 'Northwind', slug: 'northwind' })
      .returning()
    if (!ws) throw new Error('Missing workspace')
    await db.db.insert(memberships).values([
      { workspaceId: ws.id, userId: 'owner', role: 'owner' },
      { workspaceId: ws.id, userId: 'viewer', role: 'viewer' },
      { workspaceId: ws.id, userId: 'editor', role: 'editor' },
    ])
    current = people.owner
  })
  afterAll(async () => db.close())
  it('creates uniquely keyed projects and lists tab counts', async () => {
    const create = () =>
      app.request(
        '/workspaces/northwind/projects',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: 'Customer portal',
            brief: 'A brief',
            leadId: 'owner',
            targetDate: null,
            template: 'blank',
          }),
        },
        env,
      )
    const first = await create()
    expect(first.status).toBe(201)
    const second = await create()
    expect(second.status).toBe(201)
    const a = (await first.json()) as { project: { key: string; brief: { problem: string } } }
    const b = (await second.json()) as { project: { key: string } }
    expect(a.project.brief).toEqual({ problem: 'A brief' })
    expect(a.project.key).toBe('CUSTOMER')
    expect(b.project.key).toBe('CUSTOMER2')
    const response = await app.request('/workspaces/northwind/projects', { headers }, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      counts: { all: 2, active: 0, mine: 2, starred: 0 },
      projects: [{ name: 'Customer portal' }, { name: 'Customer portal' }],
    })
  })
  it('enforces workspace isolation and creation permissions', async () => {
    const create = () =>
      app.request(
        '/workspaces/northwind/projects',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: 'New',
            brief: '',
            leadId: 'owner',
            targetDate: null,
            template: 'blank',
          }),
        },
        env,
      )
    current = people.outsider
    expect((await app.request('/workspaces/northwind/projects', { headers }, env)).status).toBe(404)
    expect((await create()).status).toBe(404)
    current = people.editor
    expect((await create()).status).toBe(201)
    current = people.viewer
    expect(
      (
        await app.request(
          '/workspaces/northwind/projects',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name: 'No',
              brief: '',
              leadId: 'owner',
              targetDate: null,
              template: 'blank',
            }),
          },
          env,
        )
      ).status,
    ).toBe(403)
  })
  it('keeps stars personal, rejects other workspaces, and excludes deleted projects', async () => {
    const response = await app.request(
      '/workspaces/northwind/projects',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Launch',
          brief: '',
          leadId: 'owner',
          targetDate: null,
          template: 'blank',
        }),
      },
      env,
    )
    const created = (await response.json()) as { project: { id: string } }
    const star = (method: string) =>
      app.request(`/projects/${created.project.id}/star`, { method, headers }, env)
    current = people.outsider
    expect((await star('PUT')).status).toBe(404)
    expect((await star('DELETE')).status).toBe(404)
    current = people.viewer
    expect((await star('PUT')).status).toBe(200)
    const viewerList = await app.request(
      '/workspaces/northwind/projects?view=starred',
      { headers },
      env,
    )
    expect(await viewerList.json()).toMatchObject({
      counts: { starred: 1 },
      projects: [{ id: created.project.id }],
    })
    current = people.owner
    const ownerList = await app.request(
      '/workspaces/northwind/projects?view=starred',
      { headers },
      env,
    )
    expect(await ownerList.json()).toMatchObject({ counts: { starred: 0 }, projects: [] })
    await db.db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, created.project.id))
    expect((await star('PUT')).status).toBe(404)
    const deletedList = await app.request('/workspaces/northwind/projects', { headers }, env)
    expect(await deletedList.json()).toMatchObject({ counts: { all: 0 }, projects: [] })
  })
  it('rejects leads outside the workspace and provides fixed templates', async () => {
    expect(
      (await app.request('/workspaces/northwind/projects?dueBefore=2026-99-99', { headers }, env))
        .status,
    ).toBe(400)
    const response = await app.request(
      '/workspaces/northwind/projects',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Launch',
          brief: '',
          leadId: 'outsider',
          targetDate: null,
          template: 'blank',
        }),
      },
      env,
    )
    expect(response.status).toBe(400)
    const result = await app.request('/templates', { headers }, env)
    expect(result.status).toBe(200)
    const body = (await result.json()) as { templates: unknown[] }
    expect(body.templates).toHaveLength(6)
  })
  it('filters projects and paginates without changing tab counts', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      const response = await app.request(
        '/workspaces/northwind/projects',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name,
            brief: '',
            leadId: 'owner',
            targetDate: '2026-12-01',
            template: 'blank',
          }),
        },
        env,
      )
      expect(response.status).toBe(201)
    }
    await db.db.update(projects).set({ status: 'planning' }).where(eq(projects.name, 'Alpha'))
    const first = await app.request(
      '/workspaces/northwind/projects?view=all&limit=2',
      { headers },
      env,
    )
    const page = (await first.json()) as {
      projects: { id: string }[]
      nextCursor: string
      counts: { all: number; active: number }
    }
    expect(page.projects).toHaveLength(2)
    expect(page.counts).toMatchObject({ all: 3, active: 1 })
    const second = await app.request(
      `/workspaces/northwind/projects?view=all&limit=2&cursor=${page.nextCursor}`,
      { headers },
      env,
    )
    const next = (await second.json()) as { projects: { id: string }[]; nextCursor: string | null }
    expect(next.projects).toHaveLength(1)
    expect(page.projects.map((item) => item.id)).not.toContain(next.projects[0]?.id)
    expect(next.nextCursor).toBeNull()
    const active = await app.request(
      '/workspaces/northwind/projects?view=active&dueBefore=2026-12-01',
      { headers },
      env,
    )
    expect(await active.json()).toMatchObject({
      counts: { all: 3, active: 1 },
      projects: [{ name: 'Alpha' }],
    })
    const missingCursor = await app.request(
      '/workspaces/northwind/projects?cursor=00000000-0000-4000-8000-000000000001',
      { headers },
      env,
    )
    expect(missingCursor.status).toBe(400)
  })
  it('paginates projects whose timestamps differ within one millisecond', async () => {
    for (const name of ['Alpha', 'Beta']) {
      await app.request(
        '/workspaces/northwind/projects',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name,
            brief: '',
            leadId: 'owner',
            targetDate: null,
            template: 'blank',
          }),
        },
        env,
      )
    }
    await db.client.query(
      "UPDATE projects SET updated_at = CASE WHEN title = 'Alpha' THEN '2026-01-01 00:00:00.000900+00'::timestamptz ELSE '2026-01-01 00:00:00.000800+00'::timestamptz END",
    )
    const first = await app.request('/workspaces/northwind/projects?limit=1', { headers }, env)
    const page = (await first.json()) as { nextCursor: string }
    const second = await app.request(
      `/workspaces/northwind/projects?limit=1&cursor=${page.nextCursor}`,
      { headers },
      env,
    )
    expect(await second.json()).toMatchObject({ projects: [{ name: 'Beta' }] })
  })
})
