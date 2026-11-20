import { createHash, createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  diagrams,
  diagramVersions,
  memberships,
  projects,
  tasks,
  user,
  workspaces,
} from './db/schema'
import { createApp } from './index'
import { integrationSuite, openTestDb } from './testing/pg'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
const env = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'test',
  BETTER_AUTH_SECRET: 'share-test-secret-that-is-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:8787',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  ANTHROPIC_API_KEY: '',
}
integrationSuite(url)('share links', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>,
    app: ReturnType<typeof createApp>,
    actor = 'owner'
  beforeAll(async () => {
    db = await openTestDb(url as string)
    app = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: { id: actor } }) } }) as never,
    })
  })
  beforeEach(async () => {
    await db.client.query('TRUNCATE users, workspaces, memberships, rate_limits CASCADE')
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
    if (!ws || !other) throw new Error('workspace')
    await db.db.insert(memberships).values([
      { workspaceId: ws.id, userId: 'owner', role: 'owner' },
      { workspaceId: ws.id, userId: 'editor', role: 'editor' },
      { workspaceId: ws.id, userId: 'viewer', role: 'viewer' },
      { workspaceId: other.id, userId: 'other', role: 'owner' },
    ])
    await db.db.insert(projects).values({
      workspaceId: ws.id,
      key: 'ABC',
      name: 'Project',
      leadId: 'owner',
      brief: { problem: 'A problem' },
    })
    actor = 'owner'
  })
  afterAll(async () => db.close())
  const path = '/workspaces/northwind/projects/ABC/share'
  const request = (path: string, method = 'GET', body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: {
          origin: env.WEB_ORIGIN,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
    )
  const enable = () => request(path, 'PUT', { enabled: true, include: ['brief', 'plan'] })
  it('protects workspace and project access for all share endpoints', async () => {
    actor = 'other'
    expect((await request(path)).status).toBe(404)
    expect((await enable()).status).toBe(404)
    expect((await request(path, 'DELETE')).status).toBe(404)
    expect((await request('/workspaces/northwind/share-links')).status).toBe(404)
    actor = 'editor'
    expect((await request(path, 'DELETE')).status).toBe(403)
    expect((await request(path, 'PUT', { enabled: false, include: ['brief'] })).status).toBe(200)
    actor = 'viewer'
    expect((await request(path)).status).toBe(403)
    expect((await enable()).status).toBe(403)
    expect((await request(path, 'DELETE')).status).toBe(403)
    expect((await request('/workspaces/northwind/share-links')).status).toBe(200)
  })
  it('rejects cross-origin writes', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const response = await app.request(
        path,
        {
          method,
          headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
          body:
            method === 'PUT' ? JSON.stringify({ enabled: true, include: ['brief'] }) : undefined,
        },
        env,
      )
      expect(response.status).toBe(403)
    }
  })
  it('stores only a secret-keyed visitor digest for public rate limiting', async () => {
    const ip = '192.0.2.91'
    const created = await enable()
    const { token } = (await created.json()) as { token: string }
    const response = await app.request(
      `/share/${token}`,
      { headers: { 'CF-Connecting-IP': ip } },
      env,
    )
    expect(response.status).toBe(200)
    const limits = await db.client.query<{ key: string }>('SELECT key FROM rate_limits')
    const digest = createHmac('sha256', env.BETTER_AUTH_SECRET)
      .update(`public-share:${ip}`)
      .digest('hex')
    const expected = createHash('sha256').update(digest).digest('hex')
    expect(limits.rows).toEqual([{ key: `planfrojex:public-share:${expected}` }])
    expect(limits.rows[0]?.key).not.toContain(createHash('sha256').update(ip).digest('hex'))
    expect(JSON.stringify(limits.rows)).not.toContain(ip)
  })
  it('returns diagram geometry with transient indices and no database identifiers', async () => {
    const [project] = await db.db.select().from(projects)
    if (!project) throw new Error('project')
    const [diagram] = await db.db
      .insert(diagrams)
      .values({ projectId: project.id, name: 'Flow', type: 'flowchart', currentVersion: 1 })
      .returning()
    if (!diagram) throw new Error('diagram')
    await db.db.insert(diagramVersions).values({
      diagramId: diagram.id,
      version: 1,
      scene: {
        nodes: [
          {
            id: 'private-node',
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: { label: 'Start' },
          },
          {
            id: 'private-target',
            type: 'rectangle',
            position: { x: 10, y: 10 },
            data: { label: 'End' },
          },
        ],
        edges: [{ id: 'private-edge', source: 'private-node', target: 'private-target' }],
      },
    })
    const created = await request(path, 'PUT', { enabled: true, include: ['diagrams'] })
    const { token } = (await created.json()) as { token: string }
    const response = await app.request(
      `/share/${token}`,
      { headers: { 'CF-Connecting-IP': '192.0.2.45' } },
      env,
    )
    const data = (await response.json()) as { diagrams: { scene: { edges: unknown[] } }[] }
    expect(data.diagrams[0]?.scene.edges).toEqual([{ source: 0, target: 1 }])
    const encoded = JSON.stringify(data)
    expect(encoded).not.toMatch(
      /"id"|private-node|private-edge|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )
    const limits = await db.client.query('SELECT key FROM rate_limits')
    expect(JSON.stringify(limits.rows)).not.toContain('192.0.2.45')
  })
  it('only exposes included sections and scopes the settings list', async () => {
    const [project] = await db.db.select().from(projects)
    if (!project) throw new Error('project')
    await db.db
      .insert(tasks)
      .values({ projectId: project.id, number: 1, title: 'Task', createdBy: 'owner' })
    const created = await request(path, 'PUT', { enabled: true, include: ['tasks'] })
    const { token } = (await created.json()) as { token: string }
    const first = (await (await request(`/share/${token}`)).json()) as Record<string, unknown>
    expect(first.tasks).toEqual([{ key: 'ABC-1', title: 'Task', status: 'todo' }])
    for (const key of ['brief', 'plan', 'diagrams']) expect(first).not.toHaveProperty(key)
    const updated = await request(path, 'PUT', {
      enabled: true,
      include: ['brief', 'plan', 'diagrams'],
    })
    expect(await updated.json()).not.toHaveProperty('token')
    const second = (await (await request(`/share/${token}`)).json()) as Record<string, unknown>
    for (const key of ['brief', 'plan', 'diagrams']) expect(second).toHaveProperty(key)
    expect(second).not.toHaveProperty('tasks')
    const [otherWs] = await db.db.select().from(workspaces).where(eq(workspaces.slug, 'other'))
    if (!otherWs) throw new Error('workspace')
    await db.db.insert(projects).values({
      workspaceId: otherWs.id,
      key: 'XYZ',
      name: 'Other project',
      brief: { problem: 'Other' },
    })
    actor = 'other'
    expect(
      (
        await request('/workspaces/other/projects/XYZ/share', 'PUT', {
          enabled: true,
          include: ['brief'],
        })
      ).status,
    ).toBe(200)
    const otherList = (await (await request('/workspaces/other/share-links')).json()) as {
      links: { projectKey: string }[]
    }
    expect(otherList.links.map((link) => link.projectKey)).toEqual(['XYZ'])
    actor = 'viewer'
    const ownList = (await (await request('/workspaces/northwind/share-links')).json()) as {
      links: { projectKey: string }[]
    }
    expect(ownList.links.map((link) => link.projectKey)).toEqual(['ABC'])
  })
  it('limits public requests per IP and returns the same error for deleted projects', async () => {
    const { token } = (await (await enable()).json()) as { token: string }
    const unknown = await (await request('/share/unknown')).json()
    await db.db.update(projects).set({ deletedAt: new Date() })
    const deleted = await request(`/share/${token}`)
    expect(deleted.status).toBe(404)
    expect(await deleted.json()).toEqual(unknown)
    for (let i = 0; i < 60; i++) {
      expect(
        (
          await app.request(
            '/share/unknown',
            { headers: { 'CF-Connecting-IP': '198.51.100.2' } },
            env,
          )
        ).status,
      ).toBe(404)
    }
    const limited = await app.request(
      '/share/unknown',
      { headers: { 'CF-Connecting-IP': '198.51.100.2' } },
      env,
    )
    expect(limited.status).toBe(429)
    expect(limited.headers.get('x-robots-tag')).toBe('noindex')
    expect(limited.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it('keeps only a hash, counts views, revokes and rotates tokens', async () => {
    const created = await enable()
    expect(created.status).toBe(200)
    const { token } = (await created.json()) as { token: string }
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await db.client.query('SELECT token_hash FROM share_links')
    expect(stored.rows[0].token_hash).not.toContain(token)
    expect(JSON.stringify(await (await request(path)).json())).not.toContain(token)
    const publicResponse = await request(`/share/${token}`)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.headers.get('x-robots-tag')).toBe('noindex')
    expect(publicResponse.headers.get('referrer-policy')).toBe('no-referrer')
    const payload = (await publicResponse.json()) as Record<string, unknown>
    expect(payload.brief).toEqual({ problem: 'A problem' })
    expect(payload).not.toHaveProperty('tasks')
    expect(JSON.stringify(payload)).not.toContain('@example.com')
    const share = (await (await request(path)).json()) as { share: { viewCount: number } }
    expect(share.share.viewCount).toBe(1)
    expect((await request(path, 'DELETE')).status).toBe(200)
    const revoked = await request(`/share/${token}`)
    const unknown = await request('/share/unknown')
    expect(revoked.status).toBe(404)
    expect(await revoked.json()).toEqual(await unknown.json())
    const next = (await (await enable()).json()) as { token: string }
    expect(next.token).not.toBe(token)
  })
})

it('requires a session for project share', async () => {
  const app = createApp({
    database: () => null as never,
    auth: () => ({ api: { getSession: async () => null } }) as never,
  })
  expect((await app.request('/workspaces/northwind/projects/ABC/share', {}, env)).status).toBe(401)
})

it('returns the same public error and privacy headers for an unknown link', async () => {
  const db = {
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ count: 1 }] }) }),
    }),
  }
  const app = createApp({ database: () => db as never })
  const response = await app.request('/share/unknown', {}, env)
  expect(response.headers.get('x-robots-tag')).toBe('noindex')
})
