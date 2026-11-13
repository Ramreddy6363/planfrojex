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
  other: { id: 'other', email: 'other@example.com', emailVerified: true },
}
const json = (body: unknown) => ({ method: 'POST', headers, body: JSON.stringify(body) })

suite('project brief', () => {
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
    current = people.owner
    const [created] = await db.db
      .insert(projects)
      .values({
        workspaceId: northwind.id,
        key: 'PORTAL',
        name: 'Customer portal',
        leadId: 'owner',
        brief: { problem: 'Legacy problem only' },
      })
      .returning()
    if (!created) throw new Error('Missing test project')
    projectId = created.id
  })
  afterAll(async () => db.close())

  it('reads a legacy brief and resolves properties in the member workspace', async () => {
    const response = await app.request(`/projects/${projectId}`, { headers }, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      project: {
        id: projectId,
        name: 'Customer portal',
        brief: { problem: 'Legacy problem only', goals: [], constraints: '', outOfScope: '' },
        tags: [],
        createdBy: null,
        leadName: 'owner',
        starred: false,
      },
    })
  })

  it('lets owners and editors update properties while denying viewers', async () => {
    const patch = (body: unknown) =>
      app.request(
        `/projects/${projectId}`,
        { method: 'PATCH', headers, body: JSON.stringify(body) },
        env,
      )
    current = people.viewer
    expect((await patch({ name: 'Viewer edit' })).status).toBe(403)
    current = people.editor
    const response = await patch({
      name: 'Portal refresh',
      status: 'planning',
      leadId: 'editor',
      targetDate: '2026-12-12',
      brief: {
        problem: 'New problem',
        goals: ['Goal one'],
        constraints: 'Keep current IDs',
        outOfScope: 'Billing changes',
      },
      tags: ['web', 'billing'],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      project: {
        name: 'Portal refresh',
        status: 'planning',
        leadId: 'editor',
        targetDate: '2026-12-12',
        brief: {
          problem: 'New problem',
          goals: ['Goal one'],
          constraints: 'Keep current IDs',
          outOfScope: 'Billing changes',
        },
        tags: ['web', 'billing'],
      },
    })
    expect((await patch({ brief: { goals: ['Updated goal'] } })).status).toBe(200)
    const secondSection = await patch({ brief: { problem: 'Updated problem' } })
    expect(secondSection.status).toBe(200)
    expect(await secondSection.json()).toMatchObject({
      project: {
        brief: {
          problem: 'Updated problem',
          goals: ['Updated goal'],
          constraints: 'Keep current IDs',
          outOfScope: 'Billing changes',
        },
      },
    })
    expect((await patch({ leadId: 'other' })).status).toBe(400)
    expect((await patch({ tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`) })).status).toBe(
      400,
    )
  })

  it('returns 404 for a member of another workspace on every project and comment endpoint', async () => {
    const created = await app.request(
      '/comments',
      json({ target: `project:${projectId}`, body: 'A workspace comment', mentions: [] }),
      env,
    )
    expect(created.status).toBe(201)
    const result = (await created.json()) as { comment: { id: string } }
    const commentId = result.comment.id
    current = people.other
    const getComments = () => app.request(`/comments?target=project:${projectId}`, { headers }, env)
    const postComment = () =>
      app.request(
        '/comments',
        json({ target: `project:${projectId}`, body: 'Cross-workspace', mentions: [] }),
        env,
      )
    const patchComment = () =>
      app.request(
        `/comments/${commentId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body: 'Changed' }),
        },
        env,
      )
    const deleteComment = () =>
      app.request(`/comments/${commentId}`, { method: 'DELETE', headers }, env)
    expect((await app.request(`/projects/${projectId}`, { headers }, env)).status).toBe(404)
    expect(
      (
        await app.request(
          `/projects/${projectId}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ name: 'Hidden' }),
          },
          env,
        )
      ).status,
    ).toBe(404)
    expect((await getComments()).status).toBe(404)
    expect((await postComment()).status).toBe(404)
    expect((await patchComment()).status).toBe(404)
    expect((await deleteComment()).status).toBe(404)
  })

  it('allows workspace members to comment but only the author to edit or delete', async () => {
    current = people.viewer
    const created = await app.request(
      '/comments',
      json({
        target: `project:${projectId}`,
        body: 'Question for @editor',
        mentions: ['editor'],
      }),
      env,
    )
    expect(created.status).toBe(201)
    const result = (await created.json()) as { comment: { id: string; mentions: string[] } }
    expect(result.comment.mentions).toEqual(['editor'])
    const list = await app.request(`/comments?target=project:${projectId}`, { headers }, env)
    expect(await list.json()).toMatchObject({
      comments: [{ id: result.comment.id, authorId: 'viewer', authorName: 'viewer' }],
    })
    current = people.editor
    expect(
      (
        await app.request(
          `/comments/${result.comment.id}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ body: 'Edited' }),
          },
          env,
        )
      ).status,
    ).toBe(403)
    expect(
      (await app.request(`/comments/${result.comment.id}`, { method: 'DELETE', headers }, env))
        .status,
    ).toBe(403)
    current = people.viewer
    expect(
      (
        await app.request(
          `/comments/${result.comment.id}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ body: 'Edited by author' }),
          },
          env,
        )
      ).status,
    ).toBe(200)
    expect(
      (await app.request(`/comments/${result.comment.id}`, { method: 'DELETE', headers }, env))
        .status,
    ).toBe(200)
    expect(
      (
        await app.request(
          '/comments',
          json({ target: `project:${projectId}`, body: 'Bad mention', mentions: ['other'] }),
          env,
        )
      ).status,
    ).toBe(400)
  })
})
