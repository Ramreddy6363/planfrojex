import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
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
const write = (method: string, body?: unknown) => ({
  method,
  headers,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const scene = {
  nodes: [{ id: 'a', type: 'rectangle', position: { x: 0, y: 0 }, data: { label: 'Start' } }],
  edges: [],
}
type Diagram = { id: string; sceneVersion: number; scene: unknown; currentVersion: number }
integrationSuite(url)('project diagrams', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  let actor = 'owner'
  let projectId = ''
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
      ['owner', 'viewer', 'outsider'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
      })),
    )
    const rows = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Acme', slug: 'acme' },
      ])
      .returning()
    if (!rows[0] || !rows[1]) throw new Error('Missing workspaces')
    await db.db.insert(memberships).values([
      { workspaceId: rows[0].id, userId: 'owner', role: 'owner' },
      { workspaceId: rows[0].id, userId: 'viewer', role: 'viewer' },
      { workspaceId: rows[1].id, userId: 'outsider', role: 'owner' },
    ])
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId: rows[0].id,
        name: 'Portal',
        key: 'PORT',
        leadId: 'owner',
        brief: { problem: 'A checkout' },
      })
      .returning()
    if (!project) throw new Error('Missing project')
    projectId = project.id
    actor = 'owner'
  })
  afterAll(async () => db.close())
  const createDiagram = async () => {
    const response = await app.request(
      `/projects/${projectId}/diagrams`,
      write('POST', { name: 'Checkout', type: 'flowchart' }),
      env,
    )
    expect(response.status).toBe(201)
    return ((await response.json()) as { diagram: Diagram }).diagram
  }
  const draftDiagram = async (diagramId: string, target = app) => {
    const response = await target.request(
      `/projects/${projectId}/drafts`,
      write('POST', { kind: 'diagram', diagramId, prompt: 'Show checkout flow' }),
      env,
    )
    expect(response.status).toBe(202)
    const body = (await response.json()) as { draft: { id: string } }
    for (let n = 0; n < 200; n++) {
      const read = await app.request(`/drafts/${body.draft.id}`, { headers }, env)
      const result = (await read.json()) as {
        draft: {
          id: string
          status: string
          changes: { id: string; kind: string; after: unknown }[]
        }
      }
      if (['ready', 'failed'].includes(result.draft.status)) return result.draft
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Draft timed out')
  }
  it('isolates every diagram endpoint from other workspace members and soft deletes', async () => {
    const d = await createDiagram()
    await app.request(`/diagrams/${d.id}/versions`, write('POST', { label: 'Release' }), env)
    actor = 'outsider'
    for (const [path, init] of [
      [`/projects/${projectId}/diagrams`, { headers }],
      [`/projects/${projectId}/diagrams`, write('POST', { name: 'X', type: 'flowchart' })],
      [`/diagrams/${d.id}`, { headers }],
      [`/diagrams/${d.id}`, write('PUT', { scene, sceneVersion: 0 })],
      [`/diagrams/${d.id}`, write('DELETE')],
      [`/diagrams/${d.id}/versions`, { headers }],
      [`/diagrams/${d.id}/versions`, write('POST', {})],
      [`/diagrams/${d.id}/versions/1/restore`, write('POST')],
    ] as Array<[string, RequestInit]>)
      expect((await app.request(path, init, env)).status, path).toBe(404)
    actor = 'owner'
    expect((await app.request(`/diagrams/${d.id}`, write('DELETE'), env)).status).toBe(200)
    expect((await app.request(`/diagrams/${d.id}`, { headers }, env)).status).toBe(404)
    expect(
      (await db.client.query('SELECT deleted_at FROM diagrams WHERE id = $1', [d.id])).rows[0]
        ?.deleted_at,
    ).not.toBeNull()
  })
  it('denies viewers every write and permits diagram reads', async () => {
    const d = await createDiagram()
    actor = 'viewer'
    for (const path of [
      `/projects/${projectId}/diagrams`,
      `/diagrams/${d.id}`,
      `/diagrams/${d.id}/versions`,
    ])
      expect((await app.request(path, { headers }, env)).status).toBe(200)
    for (const [path, init] of [
      [`/projects/${projectId}/diagrams`, write('POST', { name: 'X', type: 'flowchart' })],
      [`/diagrams/${d.id}`, write('PUT', { scene, sceneVersion: 0 })],
      [`/diagrams/${d.id}`, write('DELETE')],
      [`/diagrams/${d.id}/versions`, write('POST', {})],
      [`/diagrams/${d.id}/versions/1/restore`, write('POST')],
      [`/projects/${projectId}/drafts`, write('POST', { kind: 'diagram', diagramId: d.id })],
    ] as Array<[string, RequestInit]>)
      expect((await app.request(path, init, env)).status, path).toBe(403)
  })
  it('autosaves with a scene version check and rejects scenes over 1 MB', async () => {
    const d = await createDiagram()
    const updated = await app.request(
      `/diagrams/${d.id}`,
      write('PUT', { scene, sceneVersion: 0 }),
      env,
    )
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { diagram: Diagram }).diagram.sceneVersion).toBe(1)
    expect(
      (
        await app.request(
          `/diagrams/${d.id}`,
          write('PUT', { scene: { nodes: [], edges: [] }, sceneVersion: 0 }),
          env,
        )
      ).status,
    ).toBe(409)
    const large = {
      nodes: Array.from({ length: 1000 }, (_, n) => ({
        id: `n${n}`,
        type: 'rectangle',
        position: { x: 0, y: 0 },
        data: { label: 'x'.repeat(1500) },
      })),
      edges: [],
    }
    expect(
      (await app.request(`/diagrams/${d.id}`, write('PUT', { scene: large, sceneVersion: 1 }), env))
        .status,
    ).toBe(413)
    const read = await app.request(`/diagrams/${d.id}`, { headers }, env)
    expect(((await read.json()) as { diagram: Diagram }).diagram.scene).toEqual(scene)
  })
  it('restore creates a new version without rewriting history', async () => {
    const d = await createDiagram()
    await app.request(`/diagrams/${d.id}`, write('PUT', { scene, sceneVersion: 0 }), env)
    expect(
      (await app.request(`/diagrams/${d.id}/versions`, write('POST', { label: 'Launch' }), env))
        .status,
    ).toBe(201)
    await app.request(
      `/diagrams/${d.id}`,
      write('PUT', { scene: { nodes: [], edges: [] }, sceneVersion: 1 }),
      env,
    )
    const restored = await app.request(`/diagrams/${d.id}/versions/1/restore`, write('POST'), env)
    expect(restored.status).toBe(201)
    const read = await app.request(`/diagrams/${d.id}`, { headers }, env)
    expect(((await read.json()) as { diagram: Diagram }).diagram).toMatchObject({
      scene,
      currentVersion: 2,
      sceneVersion: 3,
    })
    const history = await db.client.query(
      'SELECT version, label, scene FROM diagram_versions WHERE diagram_id = $1 ORDER BY version',
      [d.id],
    )
    expect(history.rows).toEqual([
      { version: 1, label: 'Launch', scene },
      { version: 2, label: null, scene },
    ])
  })
  it('prunes older unnamed versions while keeping all named versions and latest 50 unnamed', async () => {
    const d = await createDiagram()
    await app.request(`/diagrams/${d.id}/versions`, write('POST', { label: 'Keep me' }), env)
    for (let n = 0; n < 52; n++)
      expect((await app.request(`/diagrams/${d.id}/versions`, write('POST', {}), env)).status).toBe(
        201,
      )
    const rows = await db.client.query(
      'SELECT version, label FROM diagram_versions WHERE diagram_id = $1 ORDER BY version',
      [d.id],
    )
    expect(rows.rowCount).toBe(51)
    expect(rows.rows[0]).toEqual({ version: 1, label: 'Keep me' })
    expect(rows.rows[1]?.version).toBe(4)
  })
  it('accepts diagram drafts atomically and leaves the working copy unchanged until accepted', async () => {
    const d = await createDiagram()
    const draft = await draftDiagram(d.id)
    expect(draft.status).toBe('ready')
    expect(draft.changes[0]?.kind).toBe('diagram')
    actor = 'outsider'
    for (const [path, init] of [
      [`/projects/${projectId}/drafts`, write('POST', { kind: 'diagram', diagramId: d.id })],
      [`/drafts/${draft.id}`, { headers }],
      [`/drafts/${draft.id}`, write('DELETE')],
      [`/drafts/${draft.id}/changes/${draft.changes[0]?.id}/accept`, write('POST', {})],
      [`/drafts/${draft.id}/changes/${draft.changes[0]?.id}/reject`, write('POST', {})],
      [`/drafts/${draft.id}/accept-all`, write('POST', {})],
    ] as Array<[string, RequestInit]>)
      expect((await app.request(path, init, env)).status, path).toBe(404)
    actor = 'viewer'
    expect((await app.request(`/drafts/${draft.id}`, { headers }, env)).status).toBe(200)
    for (const [path, init] of [
      [`/drafts/${draft.id}`, write('DELETE')],
      [`/drafts/${draft.id}/changes/${draft.changes[0]?.id}/accept`, write('POST', {})],
      [`/drafts/${draft.id}/changes/${draft.changes[0]?.id}/reject`, write('POST', {})],
      [`/drafts/${draft.id}/accept-all`, write('POST', {})],
    ] as Array<[string, RequestInit]>)
      expect((await app.request(path, init, env)).status, path).toBe(403)
    actor = 'owner'
    const read = await app.request(`/diagrams/${d.id}`, { headers }, env)
    expect(((await read.json()) as { diagram: Diagram }).diagram.scene).toEqual({
      nodes: [],
      edges: [],
    })
    await db.client.query(
      `CREATE FUNCTION fail_diagram_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$`,
    )
    await db.client.query(
      'CREATE TRIGGER fail_diagram_decision BEFORE INSERT ON decisions FOR EACH ROW EXECUTE FUNCTION fail_diagram_decision()',
    )
    const change = draft.changes[0]
    if (!change) throw new Error('Missing change')
    const fail = await app.request(
      `/drafts/${draft.id}/changes/${change.id}/accept`,
      write('POST', {}),
      env,
    )
    await db.client.query('DROP TRIGGER fail_diagram_decision ON decisions')
    await db.client.query('DROP FUNCTION fail_diagram_decision()')
    expect(fail.status).toBe(500)
    expect(
      (await db.client.query('SELECT id FROM diagram_versions WHERE diagram_id = $1', [d.id]))
        .rowCount,
    ).toBe(0)
    expect(
      (await db.client.query('SELECT id FROM decisions WHERE project_id = $1', [projectId]))
        .rowCount,
    ).toBe(0)
    const accepted = await app.request(
      `/drafts/${draft.id}/changes/${change.id}/accept`,
      write('POST', {}),
      env,
    )
    expect(accepted.status).toBe(200)
    expect(
      (await db.client.query('SELECT id FROM diagram_versions WHERE diagram_id = $1', [d.id]))
        .rowCount,
    ).toBe(1)
  })
  it('does not accept a draft over a newer working copy', async () => {
    const d = await createDiagram()
    const draft = await draftDiagram(d.id)
    await app.request(`/diagrams/${d.id}`, write('PUT', { scene, sceneVersion: 0 }), env)
    const change = draft.changes[0]
    if (!change) throw new Error('Missing draft change')
    expect(
      (await app.request(`/drafts/${draft.id}/changes/${change.id}/accept`, write('POST', {}), env))
        .status,
    ).toBe(409)
    expect(
      (await db.client.query('SELECT id FROM diagram_versions WHERE diagram_id = $1', [d.id]))
        .rowCount,
    ).toBe(0)
    expect(
      (await db.client.query('SELECT scene FROM diagrams WHERE id = $1', [d.id])).rows[0]?.scene,
    ).toEqual(scene)
  })
  it('shares the 20 per hour workspace draft allowance between plans and diagrams', async () => {
    const d = await createDiagram()
    expect((await app.request(`/projects/${projectId}/drafts`, write('POST'), env)).status).toBe(
      202,
    )
    for (let n = 0; n < 19; n++)
      expect(
        (
          await app.request(
            `/projects/${projectId}/drafts`,
            write('POST', { kind: 'diagram', diagramId: d.id }),
            env,
          )
        ).status,
      ).toBe(202)
    expect(
      (
        await app.request(
          `/projects/${projectId}/drafts`,
          write('POST', { kind: 'diagram', diagramId: d.id }),
          env,
        )
      ).status,
    ).toBe(429)
  })
  it('invalid diagram model JSON writes no changes or versions', async () => {
    const d = await createDiagram()
    const broken = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: { id: actor } }) } }) as never,
      diagramDraftModel: async () => ({ nodes: [{ unexpected: true }], edges: [] }),
    })
    const draft = await draftDiagram(d.id, broken)
    expect(draft.status).toBe('failed')
    expect(draft.changes).toEqual([])
    expect(
      (await db.client.query('SELECT id FROM diagram_versions WHERE diagram_id = $1', [d.id]))
        .rowCount,
    ).toBe(0)
  })
})
