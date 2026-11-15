import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  activity,
  comments,
  decisions,
  diagrams,
  diagramVersions,
  draftChanges,
  drafts,
  invites,
  memberships,
  milestones,
  notifications,
  planSections,
  projects,
  rateLimit,
  risks,
  stars,
  tasks,
  user,
  workspaces,
} from '../db/schema'
import { createApp } from '../index'
import { integrationSuite, openTestDb } from '../testing/pg'

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
suite('workspace settings', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  let actor = 'owner'
  let workspaceId = ''
  let otherWorkspaceId = ''
  const request = (method: string, body: unknown, slug = 'northwind') =>
    app.request(`/workspaces/${slug}`, { method, headers, body: JSON.stringify(body) }, env)

  beforeAll(async () => {
    db = await openTestDb(url as string)
    app = createApp({
      database: () => db.db,
      auth: () =>
        ({
          api: {
            getSession: async () => ({
              user: { id: actor, name: actor, email: `${actor}@example.com`, emailVerified: true },
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
    const [workspace, other] = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Other', slug: 'other' },
      ])
      .returning()
    if (!workspace || !other) throw new Error('Missing workspace')
    workspaceId = workspace.id
    otherWorkspaceId = other.id
    await db.db.insert(memberships).values([
      { workspaceId, userId: 'owner', role: 'owner' },
      { workspaceId, userId: 'editor', role: 'editor' },
      { workspaceId, userId: 'viewer', role: 'viewer' },
      { workspaceId: otherWorkspaceId, userId: 'other', role: 'owner' },
    ])
    actor = 'owner'
  })
  afterAll(async () => db.close())

  it('returns 404 to another workspace member on both writes', async () => {
    actor = 'other'
    expect((await request('PATCH', { name: 'Changed' })).status).toBe(404)
    expect((await request('DELETE', { confirm: 'Northwind' })).status).toBe(404)
    expect(
      await db.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    ).toMatchObject([{ name: 'Northwind' }])
  })
  it.each(['editor', 'viewer'])('denies %s both writes', async (role) => {
    actor = role
    expect((await request('PATCH', { name: 'Changed' })).status).toBe(403)
    expect((await request('DELETE', { confirm: 'Northwind' })).status).toBe(403)
  })
  it('renames and changes the slug without keeping the old URL', async () => {
    const rename = await request('PATCH', { name: '  Northwind Studio  ' })
    expect(rename.status).toBe(200)
    expect(await rename.json()).toMatchObject({ workspace: { name: 'Northwind Studio' } })
    const moved = await request('PATCH', { slug: 'northwind-studio' })
    expect(moved.status).toBe(200)
    expect(await moved.json()).toMatchObject({
      workspace: { id: workspaceId, slug: 'northwind-studio', role: 'owner' },
    })
    expect((await app.request('/workspaces/northwind', {}, env)).status).toBe(404)
    expect((await app.request('/workspaces/northwind-studio', {}, env)).status).toBe(200)
    expect((await request('PATCH', { name: 'Again' })).status).toBe(404)
    expect((await request('DELETE', { confirm: 'Northwind Studio' })).status).toBe(404)
    expect(await db.db.select().from(activity)).toHaveLength(0)
  })
  it('rejects reserved, invalid, and taken URLs and invalid names', async () => {
    for (const slug of ['api', 'auth', 'sign-in', 'onboarding', 'ab', 'Bad URL', 'bad--url'])
      expect((await request('PATCH', { slug })).status).toBe(400)
    expect((await request('PATCH', { slug: 'other' })).status).toBe(409)
    await db.db.delete(rateLimit)
    for (const name of ['', ' ', 'www.example.com', 'https://example.com', 'x'.repeat(61)])
      expect((await request('PATCH', { name })).status).toBe(400)
    expect((await request('PATCH', {})).status).toBe(400)
  })
  it('requires the current workspace name and protects personal workspaces', async () => {
    expect((await request('DELETE', { confirm: 'northwind' })).status).toBe(400)
    expect((await request('DELETE', { confirm: 'Northwind ' })).status).toBe(400)
    await db.db.update(workspaces).set({ isPersonal: true }).where(eq(workspaces.id, workspaceId))
    expect((await request('DELETE', { confirm: 'Northwind' })).status).toBe(409)
    expect(
      await db.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    ).toHaveLength(1)
  })

  async function seedWorkspaceData(id: string, actorId: string) {
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId: id,
        key: 'BILL',
        name: 'Billing',
        leadId: actorId,
        brief: { problem: 'Invoices' },
      })
      .returning()
    if (!project) throw new Error('Missing project')
    const [milestone] = await db.db
      .insert(milestones)
      .values({ projectId: project.id, code: 'M1', title: 'Launch' })
      .returning()
    if (!milestone) throw new Error('Missing milestone')
    const [task] = await db.db
      .insert(tasks)
      .values({
        projectId: project.id,
        milestoneId: milestone.id,
        number: 1,
        title: 'Work',
        createdBy: actorId,
      })
      .returning()
    if (!task) throw new Error('Missing task')
    const [comment] = await db.db
      .insert(comments)
      .values({
        projectId: project.id,
        target: 'task',
        taskId: task.id,
        authorId: actorId,
        body: 'Comment',
      })
      .returning()
    if (!comment) throw new Error('Missing comment')
    await db.db
      .insert(comments)
      .values({ projectId: project.id, authorId: actorId, body: 'Brief comment' })
    await db.db
      .insert(planSections)
      .values({ projectId: project.id, kind: 'requirements', content: [] })
    await db.db
      .insert(risks)
      .values({ projectId: project.id, code: 'R1', title: 'Risk', ownerId: actorId })
    const [diagram] = await db.db
      .insert(diagrams)
      .values({ projectId: project.id, name: 'Flow', type: 'flowchart', createdBy: actorId })
      .returning()
    if (!diagram) throw new Error('Missing diagram')
    await db.db
      .insert(diagramVersions)
      .values({ diagramId: diagram.id, version: 1, scene: { nodes: [], edges: [] } })
    const [draft] = await db.db
      .insert(drafts)
      .values({ projectId: project.id, diagramId: diagram.id, model: 'fake', createdBy: actorId })
      .returning()
    if (!draft) throw new Error('Missing draft')
    const [change] = await db.db
      .insert(draftChanges)
      .values({ draftId: draft.id, kind: 'requirements', after: [] })
      .returning()
    if (!change) throw new Error('Missing change')
    await db.db.insert(decisions).values({
      projectId: project.id,
      draftChangeId: change.id,
      actorId,
      kind: 'requirements',
      outcome: 'accepted',
    })
    const [event] = await db.db
      .insert(activity)
      .values({
        workspaceId: id,
        projectId: project.id,
        actorId,
        type: 'comment.created',
        subject: comment.id,
        payload: {},
      })
      .returning()
    if (!event) throw new Error('Missing activity')
    await db.db
      .insert(notifications)
      .values({ userId: actorId, workspaceId: id, type: 'mention', activityId: event.id })
    await db.db.insert(stars).values({ userId: actorId, projectId: project.id })
    await db.db.insert(invites).values({
      workspaceId: id,
      email: 'pending@example.com',
      role: 'viewer',
      tokenHash: id,
      invitedBy: actorId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    return project.id
  }

  it('hard deletes the entire workspace graph and leaves another workspace untouched', async () => {
    await seedWorkspaceData(workspaceId, 'owner')
    const otherProjectId = await seedWorkspaceData(otherWorkspaceId, 'other')
    expect((await request('DELETE', { confirm: 'Northwind' })).status).toBe(200)
    expect(await db.db.select().from(workspaces)).toMatchObject([{ id: otherWorkspaceId }])
    for (const table of [
      projects,
      tasks,
      milestones,
      risks,
      planSections,
      diagrams,
      diagramVersions,
      drafts,
      draftChanges,
      decisions,
      activity,
      notifications,
      invites,
      stars,
    ])
      expect(await db.db.select().from(table)).toHaveLength(1)
    expect(await db.db.select().from(comments)).toHaveLength(2)
    expect(await db.db.select().from(projects)).toMatchObject([{ id: otherProjectId }])
    expect(await db.db.select().from(memberships)).toMatchObject([
      { workspaceId: otherWorkspaceId },
    ])
    expect(await db.db.select().from(user)).toHaveLength(4)
    expect((await request('DELETE', { confirm: 'Northwind' })).status).toBe(404)
  })
  it('limits each write to ten requests per person per minute', async () => {
    for (let i = 0; i < 10; i++)
      expect((await request('PATCH', { name: 'Northwind' })).status).toBe(200)
    expect((await request('PATCH', { name: 'Northwind' })).status).toBe(429)
    for (let i = 0; i < 10; i++)
      expect((await request('DELETE', { confirm: 'Wrong' })).status).toBe(400)
    expect((await request('DELETE', { confirm: 'Wrong' })).status).toBe(429)
    actor = 'other'
    expect((await request('PATCH', { name: 'Other renamed' }, 'other')).status).toBe(200)
    expect((await request('DELETE', { confirm: 'Other renamed' }, 'other')).status).toBe(200)
  })
  it('rate limits malformed request bodies before returning validation errors', async () => {
    for (let i = 0; i < 10; i++) expect((await request('PATCH', {})).status).toBe(400)
    expect((await request('PATCH', {})).status).toBe(429)
    for (let i = 0; i < 10; i++)
      expect((await request('DELETE', { confirm: 123 })).status).toBe(400)
    expect((await request('DELETE', { confirm: 123 })).status).toBe(429)
  })
})
