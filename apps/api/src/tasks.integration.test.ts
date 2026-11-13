import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import * as schema from './db/schema'
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
  other: { id: 'other', email: 'other@example.com', emailVerified: true },
}
const json = (body: unknown) => ({ method: 'POST', headers, body: JSON.stringify(body) })

suite('project tasks', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let current = people.owner
  let app: ReturnType<typeof createApp>
  let projectId = ''

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
    if (!northwind || !acme) throw new Error('Missing test workspaces')
    await db.db.insert(memberships).values([
      { workspaceId: northwind.id, userId: 'owner', role: 'owner' },
      { workspaceId: northwind.id, userId: 'editor', role: 'editor' },
      { workspaceId: northwind.id, userId: 'viewer', role: 'viewer' },
      { workspaceId: acme.id, userId: 'other', role: 'owner' },
    ])
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId: northwind.id,
        key: 'PORT',
        name: 'Customer portal',
        leadId: 'owner',
        brief: { problem: 'Checkout is hard' },
      })
      .returning()
    if (!project) throw new Error('Missing test project')
    projectId = project.id
    current = people.owner
  })
  afterAll(async () => db.close())

  const createTask = async (
    title = 'Build sign-in page',
    extra: Record<string, unknown> = {},
    client = app,
  ) => {
    const response = await client.request(
      `/projects/${projectId}/tasks`,
      json({ title, description: '', ...extra }),
      env,
    )
    const raw = await response.text()
    let body: { task?: { id: string; number: number } } = {}
    try {
      body = JSON.parse(raw) as typeof body
    } catch {
      // Keep non-JSON error responses available to the failing assertion below.
    }
    return { response, body: body.task, raw }
  }

  it('keeps task numbers unique when two tasks are created at once', async () => {
    const secondClient = new Client({ connectionString: url })
    await secondClient.connect()
    await secondClient.query(`SET search_path TO ${db.schemaName}`)
    const secondApp = createApp({
      database: () => drizzle(secondClient, { schema }),
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
    })
    const [first, second] = await Promise.all([
      createTask('Build sign-in page'),
      createTask('Add reset flow', {}, secondApp),
    ])
    await secondClient.end()
    expect(first.response.status, first.raw).toBe(201)
    expect(second.response.status, second.raw).toBe(201)
    expect(first.body?.number).not.toBe(second.body?.number)
  })

  it('lets owners and editors create and edit tasks while viewers can only read and comment', async () => {
    current = people.viewer
    expect((await createTask()).response.status).toBe(403)
    current = people.owner
    const created = await createTask('Build sign-in page', {
      assigneeId: 'editor',
      priority: 'high',
    })
    expect(created.response.status, created.raw).toBe(201)
    const taskId = created.body?.id as string
    current = people.viewer
    expect((await app.request(`/tasks/${taskId}`, { headers }, env)).status).toBe(200)
    const patch = () =>
      app.request(
        `/tasks/${taskId}`,
        { method: 'PATCH', headers, body: JSON.stringify({ title: 'Viewer changed this' }) },
        env,
      )
    const remove = () => app.request(`/tasks/${taskId}`, { method: 'DELETE', headers }, env)
    expect((await patch()).status).toBe(403)
    expect((await remove()).status).toBe(403)
  })

  it('requires task assignees to be members of the project workspace', async () => {
    const { response } = await createTask('Build sign-in page', { assigneeId: 'other' })
    expect(response.status).toBe(400)
  })

  it('reorders a task within a status column without changing neighboring order', async () => {
    const first = await createTask('First')
    const second = await createTask('Second')
    const third = await createTask('Third')
    const moved = await app.request(
      `/tasks/${third.body?.id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'todo', position: 0, title: 'Renamed third' }),
      },
      env,
    )
    expect(moved.status).toBe(200)
    const response = await app.request(`/projects/${projectId}/tasks`, { headers }, env)
    const body = (await response.json()) as { tasks: Array<{ title: string }> }
    expect(body.tasks.map((task) => task.title)).toEqual(['Renamed third', 'First', 'Second'])
    expect([first.response.status, second.response.status]).toEqual([201, 201])
  })

  it('returns 404 to another workspace member on every task and task-comment endpoint', async () => {
    const { response, body, raw } = await createTask()
    expect(response.status, raw).toBe(201)
    const taskId = body?.id as string
    const commentResponse = await app.request(
      '/comments',
      json({ target: `task:${taskId}`, body: 'Question for @editor', mentions: ['editor'] }),
      env,
    )
    expect(commentResponse.status).toBe(201)
    const commentId = ((await commentResponse.json()) as { comment: { id: string } }).comment.id
    current = people.other
    const create = () => app.request(`/projects/${projectId}/tasks`, json({ title: 'Hidden' }), env)
    const update = () =>
      app.request(
        `/tasks/${taskId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title: 'Hidden' }),
        },
        env,
      )
    const listComments = () => app.request(`/comments?target=task:${taskId}`, { headers }, env)
    const createComment = () =>
      app.request(
        '/comments',
        json({ target: `task:${taskId}`, body: 'Hidden comment', mentions: [] }),
        env,
      )
    const updateComment = () =>
      app.request(
        `/comments/${commentId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body: 'Hidden comment' }),
        },
        env,
      )
    const deleteComment = () =>
      app.request(`/comments/${commentId}`, { method: 'DELETE', headers }, env)
    expect((await app.request(`/projects/${projectId}/tasks`, { headers }, env)).status).toBe(404)
    expect((await create()).status).toBe(404)
    expect((await app.request(`/tasks/${taskId}`, { headers }, env)).status).toBe(404)
    expect((await update()).status).toBe(404)
    expect((await app.request(`/tasks/${taskId}`, { method: 'DELETE', headers }, env)).status).toBe(
      404,
    )
    expect((await listComments()).status).toBe(404)
    expect((await createComment()).status).toBe(404)
    expect((await updateComment()).status).toBe(404)
    expect((await deleteComment()).status).toBe(404)
  })

  it('supports comments on tasks and lets owners manage another member’s comment', async () => {
    const { response, body, raw } = await createTask()
    expect(response.status, raw).toBe(201)
    const taskId = body?.id as string
    current = people.viewer
    const comment = await app.request(
      '/comments',
      json({ target: `task:${taskId}`, body: 'Question for @editor', mentions: ['editor'] }),
      env,
    )
    expect(comment.status, await comment.clone().text()).toBe(201)
    const commentId = ((await comment.json()) as { comment: { id: string } }).comment.id
    const list = await app.request(`/comments?target=task:${taskId}`, { headers }, env)
    expect(await list.json()).toMatchObject({
      comments: [{ id: commentId, authorId: 'viewer', mentions: ['editor'] }],
    })
    current = people.owner
    expect(
      (
        await app.request(
          `/comments/${commentId}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ body: 'Updated by owner' }),
          },
          env,
        )
      ).status,
    ).toBe(200)
    expect(
      (await app.request(`/comments/${commentId}`, { method: 'DELETE', headers }, env)).status,
    ).toBe(200)
  })

  it('hard deletes a task and no longer returns it', async () => {
    const { response, body, raw } = await createTask()
    expect(response.status, raw).toBe(201)
    const taskId = body?.id as string
    const deleted = await app.request(`/tasks/${taskId}`, { method: 'DELETE', headers }, env)
    expect(deleted.status, await deleted.text()).toBe(200)
    expect((await app.request(`/tasks/${taskId}`, { headers }, env)).status).toBe(404)
  })
})
