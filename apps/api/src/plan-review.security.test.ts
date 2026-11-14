import { afterAll, beforeAll, expect, it } from 'vitest'
import { memberships, projects, user, workspaces } from './db/schema'
import { createApp } from './index'
import { integrationSuite, openTestDb } from './testing/pg'

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
const headers = { origin: env.WEB_ORIGIN, 'content-type': 'application/json' }
integrationSuite(url)('plan review reproductions', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  let projectId: string
  beforeAll(async () => {
    db = await openTestDb(url as string)
    await db.db.insert(user).values({
      id: 'review-owner',
      name: 'Review Owner',
      email: 'review@example.com',
      emailVerified: true,
    })
    const [workspace] = await db.db
      .insert(workspaces)
      .values({ name: 'Review', slug: 'review' })
      .returning()
    if (!workspace) throw new Error('Missing workspace')
    await db.db
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: 'review-owner', role: 'owner' })
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        key: 'REV',
        name: 'Review',
        leadId: 'review-owner',
        brief: { problem: '' },
      })
      .returning()
    if (!project) throw new Error('Missing project')
    projectId = project.id
    app = createApp({
      database: () => db.db,
      auth: () =>
        ({
          api: {
            getSession: async () => ({
              user: { id: 'review-owner', email: 'review@example.com', emailVerified: true },
            }),
          },
        }) as never,
    })
  })
  afterAll(async () => db.close())
  const write = (path: string, method: string, body: unknown) =>
    app.request(path, { method, headers, body: JSON.stringify(body) }, env)

  it('rejects object values that cannot be rendered as requirement text', async () => {
    const response = await write(`/projects/${projectId}/plan/sections/requirements`, 'PATCH', {
      version: 0,
      content: [{ bad: 'object child' }],
    })
    expect(response.status).toBe(400)
  })
  it('rejects a nonzero initial section version', async () => {
    const response = await write(`/projects/${projectId}/plan/sections/stories`, 'PATCH', {
      version: 99,
      content: ['Stale writer'],
    })
    expect(response.status).toBe(409)
  })
  for (const collection of ['milestones', 'risks']) {
    it(`can create ${collection} after deleting an earlier row`, async () => {
      const create = () =>
        write(`/projects/${projectId}/${collection}`, 'POST', { title: 'Review record' })
      const first = await create()
      const firstBody = (await first.json()) as Record<string, { id: string }>
      const second = await create()
      expect(second.status).toBe(201)
      const id = firstBody[collection === 'milestones' ? 'milestone' : 'risk']?.id
      await app.request(`/${collection}/${id}`, { method: 'DELETE', headers }, env)
      const third = await create()
      expect(third.status).toBe(201)
    })
  }
})
