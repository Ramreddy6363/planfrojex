import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  activity,
  comments,
  draftChanges,
  drafts,
  memberships,
  notifications,
  projects,
  tasks,
  user,
  workspaces,
} from './db/schema'
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
type Item = {
  id: string
  type: string
  target: string | null
  readAt: string | null
  task: { id: string } | null
  comment: { body: string } | null
}
type Inbox = { items: Item[]; unreadCount: number; nextCursor: string | null }
suite('inbox notifications', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>,
    app: ReturnType<typeof createApp>,
    workspaceId = '',
    otherWorkspaceId = '',
    projectId = '',
    taskId = '',
    actor = 'owner'
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
    const [ws, other] = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Other', slug: 'other' },
      ])
      .returning()
    if (!ws || !other) throw new Error('missing workspace')
    workspaceId = ws.id
    otherWorkspaceId = other.id
    await db.db.insert(memberships).values([
      { workspaceId, userId: 'owner', role: 'owner' },
      { workspaceId, userId: 'editor', role: 'editor' },
      { workspaceId, userId: 'viewer', role: 'viewer' },
      { workspaceId: other.id, userId: 'other', role: 'owner' },
    ])
    const [p] = await db.db
      .insert(projects)
      .values({ workspaceId, key: 'PORT', name: 'Portal', leadId: 'owner', brief: { problem: '' } })
      .returning()
    if (!p) throw new Error('missing project')
    projectId = p.id
    const [t] = await db.db
      .insert(tasks)
      .values({ projectId, number: 1, title: 'Task', createdBy: 'owner' })
      .returning()
    if (!t) throw new Error('missing task')
    taskId = t.id
    actor = 'owner'
  })
  afterAll(async () => db.close())
  const request = (path: string, method = 'GET', body?: unknown) =>
    app.request(
      path,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      env,
    )
  const inbox = async () => {
    const r = await request('/inbox?ws=northwind')
    expect(r.status).toBe(200)
    return (await r.json()) as Inbox
  }
  const comment = async (mentions: string[] = [], target = `project:${projectId}`) => {
    const r = await request('/comments', 'POST', { target, body: 'A comment', mentions })
    expect(r.status).toBe(201)
    return ((await r.json()) as { comment: { id: string } }).comment.id
  }
  it('notifies mentions and prior thread participants exactly once, skipping self and mention/reply duplicates', async () => {
    actor = 'editor'
    await comment()
    actor = 'viewer'
    await comment()
    actor = 'owner'
    const id = await comment(['editor', 'owner'])
    actor = 'editor'
    let data = await inbox()
    expect(data.items).toHaveLength(2)
    expect(data.items.filter((i) => i.type === 'mention')).toHaveLength(1)
    expect(data.items.filter((i) => i.type === 'reply')).toHaveLength(1)
    actor = 'owner'
    expect((await inbox()).items).toHaveLength(0)
    await request(`/comments/${id}`, 'PATCH', { mentions: ['editor', 'viewer'] })
    await request(`/comments/${id}`, 'PATCH', { mentions: ['editor'] })
    await request(`/comments/${id}`, 'PATCH', { mentions: ['editor', 'viewer'] })
    actor = 'viewer'
    data = await inbox()
    expect(data.items.filter((i) => i.type === 'mention')).toHaveLength(1)
  })
  it('creates one mention when an older comment gains a mention', async () => {
    const [old] = await db.db
      .insert(comments)
      .values({ projectId, authorId: 'owner', body: 'Older comment' })
      .returning()
    if (!old) throw new Error('comment')
    await request(`/comments/${old.id}`, 'PATCH', { mentions: ['editor'] })
    await request(`/comments/${old.id}`, 'PATCH', { mentions: ['editor'] })
    actor = 'editor'
    expect((await inbox()).items.map((i) => i.type)).toEqual(['mention'])
  })
  it('only notifies mentions newly added by an edit', async () => {
    actor = 'editor'
    const id = await comment(['editor'])
    actor = 'owner'
    expect((await request(`/comments/${id}`, 'PATCH', { mentions: ['editor'] })).status).toBe(200)
    actor = 'editor'
    expect((await inbox()).items).toEqual([])
  })
  it('notifies assignment once and never self assignment', async () => {
    expect((await request(`/tasks/${taskId}`, 'PATCH', { assigneeId: 'editor' })).status).toBe(200)
    await request(`/tasks/${taskId}`, 'PATCH', { assigneeId: 'editor' })
    actor = 'editor'
    expect((await inbox()).items.map((i) => i.type)).toEqual(['assigned'])
    await request(`/tasks/${taskId}`, 'PATCH', { assigneeId: null })
    await request(`/tasks/${taskId}`, 'PATCH', { assigneeId: 'editor' })
    expect((await inbox()).items).toHaveLength(1)
  })
  it('notifies the starter about accepted and rejected draft sections', async () => {
    const [d] = await db.db
      .insert(drafts)
      .values({ projectId, model: 'fake', createdBy: 'editor', status: 'ready' })
      .returning()
    if (!d) throw new Error('draft')
    const [change] = await db.db
      .insert(draftChanges)
      .values({ draftId: d.id, kind: 'requirements', before: null, after: ['One'], baseVersion: 0 })
      .returning()
    if (!change) throw new Error('change')
    expect((await request(`/drafts/${d.id}/changes/${change.id}/reject`, 'POST', {})).status).toBe(
      200,
    )
    const [accepted] = await db.db
      .insert(draftChanges)
      .values({
        draftId: d.id,
        kind: 'stories',
        before: { version: 0, content: null },
        after: ['A story'],
        baseVersion: 0,
      })
      .returning()
    if (!accepted) throw new Error('change')
    expect(
      (await request(`/drafts/${d.id}/changes/${accepted.id}/accept`, 'POST', {})).status,
    ).toBe(200)
    actor = 'editor'
    expect((await inbox()).items.map((i) => i.type)).toEqual(['draft_decision', 'draft_decision'])
  })
  it('rolls back notifications with their domain change', async () => {
    await db.client.query(
      "CREATE FUNCTION fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced notification failure'; END; $$",
    )
    await db.client.query(
      'CREATE TRIGGER fail_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_notification()',
    )
    try {
      expect((await request(`/tasks/${taskId}`, 'PATCH', { assigneeId: 'editor' })).status).toBe(
        500,
      )
      expect(
        (await db.client.query('SELECT assignee_id FROM tasks WHERE id=$1', [taskId])).rows[0]
          .assignee_id,
      ).toBeNull()
      expect(await db.db.select().from(activity)).toHaveLength(0)
    } finally {
      await db.client.query('DROP FUNCTION fail_notification() CASCADE')
    }
  })
  it('guards ownership and current membership on list/read, and read-all stays scoped', async () => {
    await comment(['editor', 'viewer'])
    actor = 'editor'
    const item = (await inbox()).items[0]
    if (!item) throw new Error('item')
    actor = 'viewer'
    expect((await request(`/inbox/${item.id}/read`, 'POST')).status).toBe(404)
    actor = 'other'
    expect((await request('/inbox?ws=northwind')).status).toBe(404)
    expect((await request(`/inbox/${item.id}/read`, 'POST')).status).toBe(404)
    expect((await request('/inbox/read-all?ws=northwind', 'POST')).status).toBe(404)
    await db.db
      .insert(memberships)
      .values({ workspaceId: otherWorkspaceId, userId: 'editor', role: 'editor' })
    const [otherProject] = await db.db
      .insert(projects)
      .values({
        workspaceId: otherWorkspaceId,
        key: 'OTHER',
        name: 'Other project',
        leadId: 'other',
        brief: { problem: '' },
      })
      .returning()
    if (!otherProject) throw new Error('project')
    const [otherEvent] = await db.db
      .insert(activity)
      .values({
        workspaceId: otherWorkspaceId,
        projectId: otherProject.id,
        actorId: 'other',
        type: 'task.assignee_changed',
        payload: { after: 'editor' },
      })
      .returning()
    if (!otherEvent) throw new Error('activity')
    await db.db.insert(notifications).values({
      workspaceId: otherWorkspaceId,
      userId: 'editor',
      activityId: otherEvent.id,
      type: 'assigned',
    })
    actor = 'editor'
    expect((await request(`/inbox/${item.id}/read`, 'POST')).status).toBe(200)
    expect((await request('/inbox/read-all?ws=northwind', 'POST')).status).toBe(200)
    const otherInbox = await request('/inbox?ws=other')
    expect(((await otherInbox.json()) as Inbox).unreadCount).toBe(1)
    expect((await inbox()).unreadCount).toBe(0)
    actor = 'viewer'
    expect((await inbox()).unreadCount).toBe(1)
    await db.client.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2', [
      workspaceId,
      'editor',
    ])
    actor = 'editor'
    expect((await request('/inbox?ws=northwind')).status).toBe(404)
    expect((await request(`/inbox/${item.id}/read`, 'POST')).status).toBe(404)
  })
  it('never returns deleted comment text', async () => {
    const id = await comment(['editor'])
    await request(`/comments/${id}`, 'DELETE')
    actor = 'editor'
    const data = await inbox()
    expect(data.items[0]?.comment).toBeNull()
    expect(JSON.stringify(data)).not.toContain('A comment')
  })
  it('keeps deleted task notifications pointed at the unavailable task, never the project brief', async () => {
    await comment(['editor'], `task:${taskId}`)
    expect((await request(`/tasks/${taskId}`, 'PATCH', { assigneeId: 'editor' })).status).toBe(200)
    expect((await request(`/tasks/${taskId}`, 'DELETE')).status).toBe(200)
    actor = 'editor'
    const items = (await inbox()).items
    expect(items).toHaveLength(2)
    expect(items.map((item) => ({ type: item.type, target: item.target }))).toEqual([
      { type: 'assigned', target: `task:${taskId}` },
      { type: 'mention', target: `task:${taskId}` },
    ])
    expect(items.every((item) => item.task === null && item.comment === null)).toBe(true)
  })
  it('paginates tied timestamps with no duplicate or missing items', async () => {
    for (let i = 0; i < 5; i++) await comment(['editor'])
    actor = 'editor'
    await db.client.query(
      "UPDATE notifications SET created_at=date_trunc('day',now()) + interval '0.123456 seconds'",
    )
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const r = await request(
        `/inbox?ws=northwind&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      expect(r.status).toBe(200)
      const data = (await r.json()) as Inbox
      ids.push(...data.items.map((i) => i.id))
      cursor = data.nextCursor
    } while (cursor)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect((await request('/inbox?ws=northwind&limit=101')).status).toBe(400)
    expect((await request('/inbox?ws=northwind&cursor=bad')).status).toBe(400)
  })
})
