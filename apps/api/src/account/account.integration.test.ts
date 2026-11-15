import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  activity,
  comments,
  decisions,
  invites,
  memberships,
  projects,
  session,
  tasks,
  user,
  workspaces,
} from '../db/schema'
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
integrationSuite(url)('account settings', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>,
    app: ReturnType<typeof createApp>,
    actor = 'owner',
    workspaceId = ''
  const req = (path: string, method = 'GET', body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: { origin: env.WEB_ORIGIN, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    )
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
    await db.client.query('TRUNCATE users,workspaces,rate_limits CASCADE')
    await db.db.insert(user).values(
      ['owner', 'other'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        image: 'https://example.com/photo',
      })),
    )
    const [ws] = await db.db.insert(workspaces).values({ name: 'Team', slug: 'team' }).returning()
    if (!ws) throw new Error('workspace')
    workspaceId = ws.id
    await db.db.insert(memberships).values({ workspaceId, userId: 'owner', role: 'owner' })
    actor = 'owner'
  })
  afterAll(async () => db.close())
  it('validates profile input and changes only the session user', async () => {
    for (const input of [
      { name: '' },
      { name: 'x'.repeat(81) },
      { timezone: 'Moon/Crater' },
      { id: 'other', name: 'Changed' },
      { email: 'other@example.com' },
    ])
      expect((await req('/me', 'PATCH', input)).status).toBe(400)
    const changed = await req('/me', 'PATCH', {
      name: 'Maya',
      timezone: 'Europe/Berlin',
      image: null,
    })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({
      user: { id: 'owner', name: 'Maya', timezone: 'Europe/Berlin', image: null },
    })
    expect((await db.db.select().from(user).where(eq(user.id, 'other')))[0]?.name).toBe('other')
    const me = await req('/me')
    expect(await me.json()).toMatchObject({
      user: { name: 'Maya', timezone: 'Europe/Berlin', image: null },
    })
  })
  it('returns drawn defaults and saves preferences only for the session user', async () => {
    const response = await req('/me/notification-settings')
    expect(response.status).toBe(200)
    const defaults = (await response.json()) as {
      settings: { type: string; email: boolean; inApp: boolean }[]
    }
    expect(defaults.settings).toEqual([
      { type: 'mention', email: true, inApp: true },
      { type: 'assigned', email: true, inApp: true },
      { type: 'draft_ready', email: false, inApp: true },
      { type: 'drift', email: true, inApp: true },
      { type: 'weekly_summary', email: true, inApp: false },
    ])
    const settings = defaults.settings.map((s) => ({ ...s, inApp: false }))
    expect((await req('/me/notification-settings', 'PUT', { settings })).status).toBe(200)
    expect(await (await req('/me/notification-settings')).json()).toEqual({ settings })
    actor = 'other'
    expect(await (await req('/me/notification-settings')).json()).toEqual(defaults)
    expect(
      (await req('/me/notification-settings', 'PUT', { userId: 'owner', settings })).status,
    ).toBe(400)
    expect((await req('/me/owner/notification-settings')).status).toBe(404)
  })
  it('blocks deletion while the only owner of a shared workspace', async () => {
    await db.db.insert(memberships).values({ workspaceId, userId: 'other', role: 'viewer' })
    expect((await req('/me', 'DELETE', { confirm: 'wrong' })).status).toBe(400)
    const response = await req('/me', 'DELETE', { confirm: 'delete' })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      workspaces: [{ id: workspaceId, name: 'Team', slug: 'team' }],
    })
    expect(await db.db.select().from(user)).toHaveLength(2)
  })
  it('deletes solo workspaces but keeps shared data with a deleted author and lead', async () => {
    const [shared] = await db.db
      .insert(workspaces)
      .values({ name: 'Shared', slug: 'shared' })
      .returning()
    if (!shared) throw new Error('workspace')
    await db.db.insert(memberships).values([
      { workspaceId: shared.id, userId: 'owner', role: 'editor' },
      { workspaceId: shared.id, userId: 'other', role: 'owner' },
    ])
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId: shared.id,
        key: 'KEEP',
        name: 'Keep',
        leadId: 'owner',
        brief: { problem: '' },
      })
      .returning()
    if (!project) throw new Error('project')
    const [task] = await db.db
      .insert(tasks)
      .values({ projectId: project.id, number: 1, title: 'Keep task', createdBy: 'owner' })
      .returning()
    if (!task) throw new Error('task')
    await db.db
      .insert(comments)
      .values({ projectId: project.id, authorId: 'owner', body: 'Keep comment' })
    await db.db.insert(activity).values({
      workspaceId: shared.id,
      projectId: project.id,
      actorId: 'owner',
      type: 'comment.added',
      payload: {},
    })
    await db.db.insert(invites).values({
      workspaceId: shared.id,
      email: 'invite@example.com',
      role: 'viewer',
      tokenHash: 'hash',
      invitedBy: 'owner',
      expiresAt: new Date(Date.now() + 60000),
    })
    await db.db.insert(session).values({
      id: 'old-session',
      userId: 'owner',
      token: 'token',
      expiresAt: new Date(Date.now() + 60000),
    })
    const [accepted] = await db.db
      .insert(decisions)
      .values({
        projectId: project.id,
        actorId: 'owner',
        kind: 'requirements',
        outcome: 'accepted',
      })
      .returning()
    if (!accepted) throw new Error('accepted decision')
    const [reversal] = await db.db
      .insert(decisions)
      .values({
        projectId: project.id,
        actorId: 'owner',
        kind: 'requirements',
        outcome: 'reversed',
        reversesDecisionId: accepted.id,
      })
      .returning()
    if (!reversal) throw new Error('reverse decision')
    expect((await req('/me', 'DELETE', { confirm: 'delete' })).status).toBe(200)
    expect(await db.db.select().from(decisions)).toMatchObject([
      { id: accepted.id, actorId: null, outcome: 'accepted' },
      { id: reversal.id, actorId: null, outcome: 'reversed', reversesDecisionId: accepted.id },
    ])
    expect(await db.db.select().from(workspaces)).toMatchObject([{ id: shared.id }])
    expect(await db.db.select().from(comments)).toMatchObject([
      { body: 'Keep comment', authorId: null },
    ])
    expect(await db.db.select().from(activity)).toMatchObject([{ actorId: null }])
    expect(await db.db.select().from(projects)).toMatchObject([{ id: project.id, leadId: null }])
    expect(await db.db.select().from(tasks)).toMatchObject([{ id: task.id, createdBy: null }])
    expect(await db.db.select().from(invites)).toHaveLength(0)
    expect(await db.db.select().from(session)).toHaveLength(0)
    actor = 'other'
    const commentResponse = await req(`/comments?target=project:${project.id}`)
    expect(commentResponse.status).toBe(200)
    expect(await commentResponse.json()).toMatchObject({
      comments: [{ authorName: 'Deleted user', authorId: null }],
    })
    const decisionLog = await req(`/projects/${project.id}/decisions`)
    expect(decisionLog.status).toBe(200)
    expect(await decisionLog.json()).toMatchObject({
      decisions: [
        { id: accepted.id, actorId: null, actorName: 'Deleted user' },
        {
          id: reversal.id,
          actorId: null,
          actorName: 'Deleted user',
          reversesDecisionId: accepted.id,
        },
      ],
    })
    const events = await req(`/projects/${project.id}/activity`)
    expect(await events.json()).toMatchObject({
      activity: [{ actorName: 'Deleted user', actorId: null }],
    })
  })
  it('distinguishes a deleted assignee from an unassigned task, then clears the marker on reassignment', async () => {
    await db.db.insert(memberships).values({ workspaceId, userId: 'other', role: 'owner' })
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId,
        key: 'TASK',
        name: 'Task history',
        leadId: 'other',
        brief: { problem: '' },
      })
      .returning()
    if (!project) throw new Error('project')
    const [assigned, unassigned] = await db.db
      .insert(tasks)
      .values([
        {
          projectId: project.id,
          number: 1,
          title: 'Assigned',
          createdBy: 'other',
          assigneeId: 'owner',
        },
        { projectId: project.id, number: 2, title: 'Unassigned', createdBy: 'other' },
      ])
      .returning()
    if (!assigned || !unassigned) throw new Error('tasks')
    expect((await req('/me', 'DELETE', { confirm: 'delete' })).status).toBe(200)
    actor = 'other'
    expect(await (await req(`/tasks/${assigned.id}`)).json()).toMatchObject({
      task: { assigneeId: null, assigneeDeleted: true, assigneeName: 'Deleted user' },
    })
    expect(await (await req(`/tasks/${unassigned.id}`)).json()).toMatchObject({
      task: { assigneeId: null, assigneeDeleted: false, assigneeName: null },
    })
    const reassigned = await req(`/tasks/${assigned.id}`, 'PATCH', { assigneeId: 'other' })
    expect(reassigned.status).toBe(200)
    expect(await reassigned.json()).toMatchObject({
      task: { assigneeId: 'other', assigneeDeleted: false, assigneeName: 'other' },
    })
  })
  it('rate limits account reads per person', async () => {
    for (let i = 0; i < 20; i++) expect((await req('/me')).status).toBe(200)
    expect((await req('/me')).status).toBe(429)
    actor = 'other'
    expect((await req('/me')).status).toBe(200)
  })
  it('rate limits profile and preferences before input validation', async () => {
    for (let i = 0; i < 20; i++) expect((await req('/me', 'PATCH', {})).status).toBe(400)
    expect((await req('/me', 'PATCH', {})).status).toBe(429)
  })
})
