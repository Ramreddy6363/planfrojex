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
const headers = { origin: env.WEB_ORIGIN, 'content-type': 'application/json' }
const people = {
  owner: { id: 'owner', email: 'owner@example.com', emailVerified: true },
  editor: { id: 'editor', email: 'editor@example.com', emailVerified: true },
  viewer: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
  other: { id: 'other', email: 'other@example.com', emailVerified: true },
}
const post = (body: unknown) => ({ method: 'POST', headers, body: JSON.stringify(body) })
const patch = (body: unknown) => ({ method: 'PATCH', headers, body: JSON.stringify(body) })

suite('project plan', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let current = people.owner
  let app: ReturnType<typeof createApp>
  let projectId = ''
  let otherProjectId = ''

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
    const rows = await db.db
      .insert(projects)
      .values([
        {
          workspaceId: northwind.id,
          key: 'PORT',
          name: 'Customer portal',
          leadId: 'owner',
          brief: { problem: 'Checkout is hard' },
        },
        {
          workspaceId: northwind.id,
          key: 'BILL',
          name: 'Billing',
          leadId: 'owner',
          brief: { problem: 'Billing is hard' },
        },
      ])
      .returning()
    if (!rows[0] || !rows[1]) throw new Error('Missing test projects')
    projectId = rows[0].id
    otherProjectId = rows[1].id
    current = people.owner
  })
  afterAll(async () => db.close())

  const createMilestone = async (project = projectId) => {
    const response = await app.request(
      `/projects/${project}/milestones`,
      post({ title: 'Private beta', status: 'planning', dueDate: '2027-01-15' }),
      env,
    )
    const body = (await response.json()) as { milestone?: { id: string } }
    return { response, milestone: body.milestone }
  }
  const createRisk = async (project = projectId) => {
    const response = await app.request(
      `/projects/${project}/risks`,
      post({ title: 'Vendor delay', severity: 'high', ownerId: 'editor', decideBy: '2027-01-10' }),
      env,
    )
    const body = (await response.json()) as { risk?: { id: string } }
    return { response, risk: body.risk }
  }

  it('returns plan sections, milestones and risks to workspace members', async () => {
    const response = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sections: [
        expect.objectContaining({ kind: 'requirements', version: 0 }),
        expect.objectContaining({ kind: 'stories', version: 0 }),
        expect.objectContaining({ kind: 'stack', version: 0 }),
        expect.objectContaining({ kind: 'estimate', version: 0 }),
      ],
      milestones: [],
      risks: [],
    })
  })

  it('keeps the last-change actor after the last milestone is deleted', async () => {
    const { response, milestone } = await createMilestone()
    expect(response.status).toBe(201)
    const afterCreate = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    expect(await afterCreate.json()).toMatchObject({
      lastChanged: { by: 'owner' },
    })
    const removed = await app.request(
      `/milestones/${milestone?.id}`,
      { method: 'DELETE', headers },
      env,
    )
    expect(removed.status).toBe(200)
    const afterDelete = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    expect(await afterDelete.json()).toMatchObject({
      lastChanged: { by: 'owner' },
      milestones: [],
    })
  })

  it('rejects a stale plan section version without overwriting the latest content', async () => {
    const initial = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    const body = (await initial.json()) as { sections: Array<{ kind: string; version: number }> }
    const version = body.sections.find((section) => section.kind === 'requirements')?.version
    expect(version).toBeDefined()
    const first = await app.request(
      `/projects/${projectId}/plan/sections/requirements`,
      patch({ version, content: ['Use email sign-in'] }),
      env,
    )
    expect(first.status).toBe(200)
    const stale = await app.request(
      `/projects/${projectId}/plan/sections/requirements`,
      patch({ version, content: ['Overwrite stale content'] }),
      env,
    )
    expect(stale.status).toBe(409)
    const refreshed = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    const refreshedBody = (await refreshed.json()) as {
      sections: Array<{ kind: string; content: unknown }>
    }
    expect(
      refreshedBody.sections.find((section) => section.kind === 'requirements')?.content,
    ).toEqual(['Use email sign-in'])
  })

  it('allows owners and editors to change plan data, but denies every write to viewers', async () => {
    const milestone = await createMilestone()
    const risk = await createRisk()
    expect(milestone.response.status).toBe(201)
    expect(risk.response.status).toBe(201)
    current = people.editor
    expect(
      (
        await app.request(
          `/projects/${projectId}/plan/sections/requirements`,
          patch({ version: 0, content: ['Editor requirement'] }),
          env,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await app.request(
          `/projects/${projectId}/milestones`,
          post({ title: 'Release', status: 'planning' }),
          env,
        )
      ).status,
    ).toBe(201)
    expect(
      (
        await app.request(
          `/milestones/${milestone.milestone?.id}`,
          patch({ title: 'Beta release' }),
          env,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await app.request(
          `/projects/${projectId}/risks`,
          post({ title: 'Vendor delay', severity: 'medium', ownerId: 'owner' }),
          env,
        )
      ).status,
    ).toBe(201)
    expect(
      (await app.request(`/risks/${risk.risk?.id}`, patch({ title: 'Updated delay' }), env)).status,
    ).toBe(200)
    current = people.viewer
    const writeResponses = await Promise.all([
      app.request(
        `/projects/${projectId}/plan/sections/requirements`,
        patch({ version: 0, content: ['Viewer edit'] }),
        env,
      ),
      app.request(`/projects/${projectId}/milestones`, post({ title: 'Blocked' }), env),
      app.request(`/milestones/${milestone.milestone?.id}`, patch({ title: 'Blocked' }), env),
      app.request(`/milestones/${milestone.milestone?.id}`, { method: 'DELETE', headers }, env),
      app.request(`/projects/${projectId}/risks`, post({ title: 'Blocked' }), env),
      app.request(`/risks/${risk.risk?.id}`, patch({ title: 'Blocked' }), env),
      app.request(`/risks/${risk.risk?.id}`, { method: 'DELETE', headers }, env),
    ])
    expect(writeResponses.map((response) => response.status)).toEqual(Array(7).fill(403))
  })

  it('requires a risk owner to belong to the project workspace', async () => {
    const response = await app.request(
      `/projects/${projectId}/risks`,
      post({ title: 'No owner', severity: 'medium', ownerId: 'other' }),
      env,
    )
    expect(response.status).toBe(400)
    const { risk } = await createRisk()
    const patchResponse = await app.request(`/risks/${risk?.id}`, patch({ ownerId: 'other' }), env)
    expect(patchResponse.status).toBe(400)
  })

  it('returns 404 to another workspace member for every plan, milestone and risk endpoint', async () => {
    const { milestone } = await createMilestone()
    const { risk } = await createRisk()
    current = people.other
    const responses = await Promise.all([
      app.request(`/projects/${projectId}/plan`, { headers }, env),
      app.request(
        `/projects/${projectId}/plan/sections/requirements`,
        patch({ version: 0, content: ['Hidden'] }),
        env,
      ),
      app.request(`/projects/${projectId}/milestones`, post({ title: 'Hidden' }), env),
      app.request(`/milestones/${milestone?.id}`, patch({ title: 'Hidden' }), env),
      app.request(`/milestones/${milestone?.id}`, { method: 'DELETE', headers }, env),
      app.request(`/projects/${projectId}/risks`, post({ title: 'Hidden' }), env),
      app.request(`/risks/${risk?.id}`, patch({ title: 'Hidden' }), env),
      app.request(`/risks/${risk?.id}`, { method: 'DELETE', headers }, env),
    ])
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(404))
  })

  it('prevents cross-project milestone assignment and clears task links when deleting a milestone', async () => {
    const firstMilestone = await createMilestone()
    const secondMilestone = await createMilestone(otherProjectId)
    const [task] = await db.db
      .insert(tasks)
      .values({ projectId, number: 1, title: 'Link milestone', createdBy: 'owner' })
      .returning()
    if (!task || !firstMilestone.milestone || !secondMilestone.milestone)
      throw new Error('Missing test rows')
    const wrong = await app.request(
      `/tasks/${task.id}`,
      patch({ milestoneId: secondMilestone.milestone.id }),
      env,
    )
    expect(wrong.status).toBe(400)
    current = people.viewer
    const forbidden = await app.request(
      `/tasks/${task.id}`,
      patch({ milestoneId: firstMilestone.milestone.id }),
      env,
    )
    expect(forbidden.status).toBe(403)
    current = people.owner
    const valid = await app.request(
      `/tasks/${task.id}`,
      patch({ milestoneId: firstMilestone.milestone.id }),
      env,
    )
    expect(valid.status).toBe(200)
    const removed = await app.request(
      `/milestones/${firstMilestone.milestone.id}`,
      { method: 'DELETE', headers },
      env,
    )
    expect(removed.status).toBe(200)
    const [refreshed] = await db.db.select().from(tasks)
    expect(refreshed?.milestoneId).toBeNull()
  })
})
