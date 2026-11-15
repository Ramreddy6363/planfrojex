import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { memberships, projects, tasks, user, workspaces } from './db/schema'
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
type Results = {
  projects: { id: string; key: string; name: string; status: string }[]
  tasks: {
    id: string
    key: string
    title: string
    status: string
    projectId: string
    projectName: string
  }[]
}
suite('workspace search', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>, app: ReturnType<typeof createApp>
  let actor = 'owner',
    workspaceId = '',
    otherWorkspaceId = '',
    billingId = ''
  beforeAll(async () => {
    db = await openTestDb(url as string)
    app = createApp({
      database: () => db.db,
      auth: () =>
        ({
          api: {
            getSession: async () => ({
              user: { id: actor, email: `${actor}@example.com`, emailVerified: true },
            }),
          },
        }) as never,
    })
  })
  beforeEach(async () => {
    await db.client.query('TRUNCATE users, workspaces, memberships, invites, rate_limits CASCADE')
    await db.db.insert(user).values(
      ['owner', 'editor', 'viewer', 'other'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
      })),
    )
    const [a, b] = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Other', slug: 'other' },
      ])
      .returning()
    if (!a || !b) throw new Error('workspace')
    workspaceId = a.id
    otherWorkspaceId = b.id
    await db.db.insert(memberships).values([
      { workspaceId, userId: 'owner', role: 'owner' },
      { workspaceId, userId: 'editor', role: 'editor' },
      { workspaceId, userId: 'viewer', role: 'viewer' },
      { workspaceId: otherWorkspaceId, userId: 'other', role: 'owner' },
    ])
    const [p] = await db.db
      .insert(projects)
      .values({
        workspaceId,
        key: 'BILL',
        name: 'Billing migration',
        leadId: 'owner',
        brief: { problem: 'invoices' },
        tags: ['payments'],
      })
      .returning()
    if (!p) throw new Error('project')
    billingId = p.id
    await db.db.insert(tasks).values({
      projectId: billingId,
      number: 12,
      title: 'Approve invoice email',
      description: 'invoice review',
      createdBy: 'owner',
    })
    actor = 'owner'
  })
  afterAll(async () => db.close())
  const get = (q: string) =>
    app.request(`/workspaces/northwind/search?q=${encodeURIComponent(q)}`, {}, env)
  const search = async (q: string) => {
    const response = await get(q)
    expect(response.status).toBe(200)
    return (await response.json()) as Results
  }
  it('isolates the workspace and allows each member role', async () => {
    for (const id of ['owner', 'editor', 'viewer']) {
      actor = id
      expect((await search('bill')).projects.map((p) => p.id)).toEqual([billingId])
    }
    actor = 'other'
    expect((await get('bill')).status).toBe(404)
  })
  it('excludes other workspace and deleted projects and their tasks', async () => {
    const rows = await db.db
      .insert(projects)
      .values([
        {
          workspaceId: otherWorkspaceId,
          key: 'FOREIGN',
          name: 'Billing foreign',
          leadId: 'other',
          brief: { problem: '' },
        },
        {
          workspaceId,
          key: 'DELETED',
          name: 'Billing deleted',
          leadId: 'owner',
          brief: { problem: '' },
          deletedAt: new Date(),
        },
      ])
      .returning()
    await db.db.insert(tasks).values(
      rows.map((p) => ({
        projectId: p.id,
        number: 1,
        title: 'Billing hidden task',
        createdBy: 'owner',
      })),
    )
    const results = await search('bill')
    expect(results.projects.map((p) => p.id)).toEqual([billingId])
    expect(results.tasks.map((t) => t.projectId)).toEqual([billingId])
  })
  it('supports project prefix, brief and tags, task description, exact task keys, ranking and limits', async () => {
    expect((await search('invoi')).projects.map((p) => p.id)).toEqual([billingId])
    expect((await search('paym')).projects.map((p) => p.id)).toEqual([billingId])
    expect((await search('problem')).projects).toEqual([])
    expect((await search('bill')).tasks.map((t) => t.key)).toContain('BILL-12')
    expect((await search('bill-1')).tasks.map((t) => t.key)).toEqual(['BILL-12'])
    expect((await search('bill-12')).tasks.map((t) => t.key)).toEqual(['BILL-12'])
    for (let i = 0; i < 9; i++) {
      await db.db.insert(projects).values({
        workspaceId,
        key: `B${i}`,
        name: `Other billing ${i}`,
        leadId: 'owner',
        brief: { problem: 'billing' },
      })
      await db.db.insert(tasks).values({
        projectId: billingId,
        number: i + 20,
        title: `Billing task ${i}`,
        createdBy: 'owner',
      })
    }
    const result = await search('bill')
    expect(result.projects).toHaveLength(5)
    expect(result.projects[0]?.id).toBe(billingId)
    expect(result.tasks).toHaveLength(8)
    await db.db
      .insert(tasks)
      .values({ projectId: billingId, number: 60, title: 'BILL-12 follow up', createdBy: 'owner' })
    expect((await search('BILL-12')).tasks[0]?.key).toBe('BILL-12')
  })
  it('returns 200 for punctuation, validates query lengths, and has no query syntax errors', async () => {
    for (const q of ["'", ':', '&', '|', '!', '(', ')', "bill' : & | ! ( )", '東京'])
      expect((await get(q)).status).toBe(200)
    expect((await get('')).status).toBe(400)
    expect((await get(' '.repeat(4))).status).toBe(400)
    expect((await get('x'.repeat(101))).status).toBe(400)
    expect((await get(`bill${' '.repeat(100)}`)).status).toBe(400)
  })
  it('limits search to 60 requests per minute for one person', async () => {
    for (let i = 0; i < 60; i++) expect((await get('bill')).status).toBe(200)
    expect((await get('bill')).status).toBe(429)
    actor = 'viewer'
    expect((await get('bill')).status).toBe(200)
  })
})
