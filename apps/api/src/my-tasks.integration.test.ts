import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { activity, memberships, projects, tasks, user, workspaces } from './db/schema'
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
  other: { id: 'other', email: 'other@example.com', emailVerified: true },
}
type Page = {
  tasks: { id: string; title: string; projectId: string; key: string }[]
  counts: { assigned: number; created: number; completed: number }
  nextCursor: string | null
}

suite('my tasks', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  let current = people.owner
  let taskNumber = 0
  let projectId = '',
    secondProjectId = '',
    foreignProjectId = '',
    deletedProjectId = ''
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
    const [northwind, acme] = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Acme', slug: 'acme' },
      ])
      .returning()
    if (!northwind || !acme) throw new Error('Missing workspace')
    await db.db.insert(memberships).values([
      { workspaceId: northwind.id, userId: 'owner', role: 'owner' },
      { workspaceId: northwind.id, userId: 'editor', role: 'editor' },
      { workspaceId: northwind.id, userId: 'viewer', role: 'viewer' },
      { workspaceId: acme.id, userId: 'other', role: 'owner' },
    ])
    const rows = await db.db
      .insert(projects)
      .values([
        {
          workspaceId: northwind.id,
          key: 'PORT',
          name: 'Portal',
          leadId: 'owner',
          brief: { problem: '' },
        },
        {
          workspaceId: northwind.id,
          key: 'WEB',
          name: 'Website',
          leadId: 'owner',
          brief: { problem: '' },
        },
        {
          workspaceId: acme.id,
          key: 'OTHER',
          name: 'Other',
          leadId: 'other',
          brief: { problem: '' },
        },
        {
          workspaceId: northwind.id,
          key: 'GONE',
          name: 'Deleted',
          leadId: 'owner',
          brief: { problem: '' },
          deletedAt: new Date(),
        },
      ])
      .returning()
    const [portal, website, foreign, deleted] = rows
    if (!portal || !website || !foreign || !deleted) throw new Error('Missing project')
    projectId = portal.id
    secondProjectId = website.id
    foreignProjectId = foreign.id
    deletedProjectId = deleted.id
    taskNumber = 0
    current = people.owner
  })
  afterAll(async () => db.close())
  const add = async (title: string, input: Partial<typeof tasks.$inferInsert> = {}) => {
    const [row] = await db.db
      .insert(tasks)
      .values({
        projectId,
        title,
        number: ++taskNumber,
        createdBy: 'editor',
        assigneeId: 'owner',
        ...input,
      })
      .returning()
    if (!row) throw new Error('Missing task')
    return row
  }
  const get = (query = '') => app.request(`/me/tasks?ws=northwind${query}`, { headers }, env)
  const page = async (query = '') => {
    const response = await get(query)
    expect(response.status).toBe(200)
    return (await response.json()) as Page
  }

  it('requires membership, allows viewers, and never exposes tasks in other or deleted workspaces/projects', async () => {
    await add('Visible')
    await add('Foreign', { projectId: foreignProjectId })
    await add('Deleted', { projectId: deletedProjectId })
    expect((await page()).tasks.map((task) => task.title)).toEqual(['Visible'])
    current = people.other
    expect((await get()).status).toBe(404)
    current = people.viewer
    await add('Viewer task', { assigneeId: 'viewer' })
    expect((await page()).tasks.map((task) => task.title)).toEqual(['Viewer task'])
  })

  it('returns the right tasks and counts for all tabs, with completed tasks restricted to 90 days', async () => {
    await add('Assigned todo')
    await add('Assigned in progress', { status: 'in_progress' })
    await add('Created', { createdBy: 'owner', assigneeId: 'editor' })
    await add('Both', { createdBy: 'owner' })
    await add('Done', { status: 'done', updatedAt: new Date() })
    await add('Old done', { status: 'done', updatedAt: new Date(Date.now() - 91 * 86400000) })
    await add('Another user done', { status: 'done', assigneeId: 'editor' })
    const assigned = await page()
    expect(assigned.counts).toEqual({ assigned: 3, created: 2, completed: 1 })
    expect(assigned.tasks.map((task) => task.title).sort()).toEqual([
      'Assigned in progress',
      'Assigned todo',
      'Both',
    ])
    expect((await page('&view=created')).tasks.map((task) => task.title).sort()).toEqual([
      'Both',
      'Created',
    ])
    expect((await page('&view=completed')).tasks.map((task) => task.title)).toEqual(['Done'])
    expect(assigned.tasks[0]).toMatchObject({ projectId, key: expect.stringMatching(/^PORT-/) })
  })

  it('does not treat an unrelated edit as a recent completion', async () => {
    const completedAt = new Date(Date.now() - 91 * 86400000)
    const task = await add('Old transitioned task', { status: 'done', updatedAt: completedAt })
    const createdDone = await add('Old created-done task', {
      status: 'done',
      updatedAt: completedAt,
    })
    const [project] = await db.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
    if (!project) throw new Error('Missing project')
    await db.db.insert(activity).values([
      {
        workspaceId: project.workspaceId,
        projectId,
        actorId: 'owner',
        type: 'task.status_changed',
        subject: task.id,
        payload: { before: 'todo', after: 'done' },
        createdAt: completedAt,
      },
      {
        workspaceId: project.workspaceId,
        projectId,
        actorId: 'owner',
        type: 'task.created',
        subject: createdDone.id,
        payload: { after: { status: 'done' } },
        createdAt: completedAt,
      },
    ])
    for (const oldTask of [task, createdDone]) {
      const response = await app.request(
        `/tasks/${oldTask.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ title: `Renamed ${oldTask.title}` }) },
        env,
      )
      expect(response.status).toBe(200)
    }
    const completed = await page('&view=completed')
    expect(completed.tasks).toEqual([])
    expect(completed.counts.completed).toBe(0)
  })

  it('validates the project filter against the verified workspace and applies it to tasks and counts', async () => {
    await add('Portal')
    await add('Website', { projectId: secondProjectId })
    const filtered = await page(`&project=${secondProjectId}`)
    expect(filtered.tasks.map((task) => task.title)).toEqual(['Website'])
    expect(filtered.counts).toEqual({ assigned: 1, created: 0, completed: 0 })
    expect((await get(`&project=${foreignProjectId}`)).status).toBe(404)
    expect((await get(`&project=${deletedProjectId}`)).status).toBe(404)
    expect((await get('&project=invalid')).status).toBe(400)
  })

  it('paginates due dates, null dates, and tied completed timestamps without gaps or duplicates', async () => {
    const rows = []
    for (const dueDate of ['2026-11-01', '2026-11-01', '2026-11-02', null, null])
      rows.push(await add(`Task ${rows.length}`, { dueDate, createdBy: 'owner' }))
    const collect = async (view: string) => {
      const ids: string[] = []
      let cursor: string | null = null
      do {
        const data: Page = await page(
          `&view=${view}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
        expect(data.counts.assigned + data.counts.completed).toBe(5)
        ids.push(...data.tasks.map((task) => task.id))
        cursor = data.nextCursor
      } while (cursor)
      return ids
    }
    const openIds = await collect('assigned')
    expect(openIds).toHaveLength(5)
    expect(new Set(openIds).size).toBe(5)
    expect(openIds.slice(0, 2).sort()).toEqual(
      rows
        .slice(0, 2)
        .map((task) => task.id)
        .sort(),
    )
    expect(await collect('created')).toEqual(openIds)
    await db.client.query(
      "UPDATE tasks SET status = 'done', updated_at = date_trunc('day', now()) + interval '0.123456 seconds'",
    )
    const doneIds = await collect('completed')
    expect(doneIds.sort()).toEqual(rows.map((task) => task.id).sort())
    expect((await get('&cursor=garbage')).status).toBe(400)
    expect((await get('&limit=101')).status).toBe(400)
    expect((await get('&limit=0')).status).toBe(400)
  })

  it('reuses task status writes with exactly one activity row and viewer protection', async () => {
    const task = await add('Complete me')
    const patch = (status = 'done') =>
      app.request(
        `/tasks/${task.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ status }) },
        env,
      )
    current = people.viewer
    expect((await patch()).status).toBe(403)
    current = people.owner
    expect((await patch()).status).toBe(200)
    expect(await db.db.select().from(activity)).toMatchObject([
      { type: 'task.status_changed', subject: task.id, payload: { before: 'todo', after: 'done' } },
    ])
    expect((await page()).counts).toEqual({ assigned: 0, created: 0, completed: 1 })
    expect((await patch('todo')).status).toBe(200)
    expect((await page()).counts).toEqual({ assigned: 1, created: 0, completed: 0 })
    expect(await db.db.select().from(activity)).toHaveLength(2)
  })
})
