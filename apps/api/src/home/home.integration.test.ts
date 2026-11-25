import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { activity, memberships, projects, user, workspaces } from '../db/schema'
import { createApp } from '../index'
import { integrationSuite, openTestDb } from '../testing/pg'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
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
type Item = { id: string; type: string; actorName: string; projectId: string; projectName: string }

integrationSuite(url)('workspace recent activity', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  let actor = 'owner'
  beforeAll(async () => {
    db = await openTestDb(url as string)
    app = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: { id: actor } }) } }) as never,
    })
  })
  beforeEach(async () => {
    await db.client.query('TRUNCATE users, workspaces, rate_limits CASCADE')
    await db.db.insert(user).values(
      ['owner', 'outsider'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
      })),
    )
    const spaces = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Acme', slug: 'acme' },
      ])
      .returning()
    const [north, acme] = spaces
    if (!north || !acme) throw new Error('Missing workspace')
    await db.db.insert(memberships).values([
      { workspaceId: north.id, userId: 'owner', role: 'owner' },
      { workspaceId: acme.id, userId: 'outsider', role: 'owner' },
    ])
    const made = await db.db
      .insert(projects)
      .values([
        {
          workspaceId: north.id,
          name: 'Portal',
          key: 'PORT',
          leadId: 'owner',
          brief: { problem: '' },
        },
        {
          workspaceId: acme.id,
          name: 'Secret',
          key: 'SEC',
          leadId: 'outsider',
          brief: { problem: '' },
        },
      ])
      .returning()
    const [portal, secret] = made
    if (!portal || !secret) throw new Error('Missing project')
    await db.db.insert(activity).values([
      {
        workspaceId: north.id,
        projectId: portal.id,
        actorId: 'owner',
        type: 'task.created',
        payload: {},
      },
      {
        workspaceId: acme.id,
        projectId: secret.id,
        actorId: 'outsider',
        type: 'task.created',
        payload: {},
      },
    ])
    actor = 'owner'
  })
  afterAll(async () => db.close())
  const get = (path = '/workspaces/northwind/activity') => app.request(path, {}, env)
  it('lists only this workspace activity with project names', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const { activity: items } = (await response.json()) as { activity: Item[] }
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'task.created',
      actorName: 'owner',
      projectName: 'Portal',
    })
  })
  it('gives a member of another workspace 404', async () => {
    actor = 'outsider'
    expect((await get()).status).toBe(404)
  })
  it('rejects a bad limit', async () => {
    expect((await get('/workspaces/northwind/activity?limit=101')).status).toBe(400)
  })
})
