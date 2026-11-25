import { eq } from 'drizzle-orm'
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
  outsider: { id: 'outsider', email: 'outsider@example.com', emailVerified: true },
}
const post = (body?: unknown) => ({
  method: 'POST',
  headers,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const patch = (body: unknown) => ({ method: 'PATCH', headers, body: JSON.stringify(body) })
suite('project drafts and decisions', () => {
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
      { workspaceId: acme.id, userId: 'outsider', role: 'owner' },
    ])
    const rows = await db.db
      .insert(projects)
      .values([
        {
          workspaceId: northwind.id,
          key: 'PORT',
          name: 'Customer portal',
          leadId: 'owner',
          brief: {
            problem: 'Checkout is hard',
            goals: ['Support self-service checkout'],
            constraints: 'Must support low bandwidth',
            outOfScope: 'Subscriptions',
          },
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
    current = people.owner
  })
  afterAll(async () => db.close())

  const createDraft = async () => {
    const response = await app.request(`/projects/${projectId}/drafts`, post(), env)
    expect(response.status).toBe(202)
    const body = (await response.json()) as { draft: { id: string; status: string } }
    expect(body.draft.status).toBe('queued')
    return body.draft.id
  }
  const readDraft = async (id: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.request(`/drafts/${id}`, { headers }, env)
      if (response.status !== 200) throw new Error(`Draft read failed: ${response.status}`)
      const body = (await response.json()) as {
        draft: { status: string; changes: Array<{ id: string; kind: string; status: string }> }
      }
      if (body.draft.status === 'ready' || body.draft.status === 'failed') return body.draft
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Draft job did not finish')
  }

  it('creates a queued draft then stores validated changes without changing the plan', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    expect(draft.status).toBe('ready')
    expect(draft.changes.map((change) => change.kind)).toEqual([
      'requirements',
      'stories',
      'milestones',
      'risks',
      'stack',
      'estimate',
    ])
    const plan = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    const planBody = (await plan.json()) as { sections: Array<{ kind: string; content: unknown }> }
    expect(planBody.sections.find((section) => section.kind === 'requirements')?.content).toBeNull()
  })

  it('returns 404 to another workspace member on every draft and decision endpoint', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    const changeId = draft.changes[0]?.id
    if (!changeId) throw new Error('Missing draft change')
    const accepted = await app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
    expect(accepted.status).toBe(200)
    const decisionResponse = await app.request(`/projects/${projectId}/decisions`, { headers }, env)
    const decisionBody = (await decisionResponse.json()) as { decisions: Array<{ id: string }> }
    const decisionId = decisionBody.decisions[0]?.id
    if (!decisionId) throw new Error('Missing decision')
    current = people.outsider
    const paths: Array<[string, RequestInit]> = [
      [`/projects/${projectId}/drafts`, post()],
      [`/projects/${projectId}/drafts/active`, { headers }],
      [`/drafts/${id}`, { headers }],
      [`/drafts/${id}`, { method: 'DELETE', headers }],
      [`/drafts/${id}/changes/${changeId}/accept`, post({})],
      [`/drafts/${id}/changes/${changeId}/reject`, post({})],
      [`/drafts/${id}/accept-all`, post({})],
      [`/projects/${projectId}/decisions`, { headers }],
      [`/decisions/${decisionId}/undo`, post()],
    ]
    for (const [path, init] of paths) expect((await app.request(path, init, env)).status).toBe(404)
  })

  it('returns the unresolved plan draft so a reload can restore it', async () => {
    const active = async () =>
      (await (
        await app.request(`/projects/${projectId}/drafts/active`, { headers }, env)
      ).json()) as {
        draft: { id: string; status: string } | null
      }
    expect(await active()).toEqual({ draft: null })
    const id = await createDraft()
    const ready = await readDraft(id)
    expect((await active()).draft).toEqual({ id, status: 'ready' })
    current = people.viewer
    expect((await active()).draft?.id).toBe(id)
    current = people.owner
    const changes = ready.changes
    for (const change of changes.slice(0, -1))
      await app.request(`/drafts/${id}/changes/${change.id}/reject`, post({}), env)
    expect((await active()).draft?.id).toBe(id)
    const last = changes.at(-1)
    await app.request(`/drafts/${id}/changes/${last?.id}/reject`, post({}), env)
    expect(await active()).toEqual({ draft: null })
    const second = await createDraft()
    await readDraft(second)
    expect((await active()).draft?.id).toBe(second)
    await app.request(`/drafts/${second}`, { method: 'DELETE', headers }, env)
    expect(await active()).toEqual({ draft: null })
  })

  it('denies viewers every write while allowing them to read drafts and decisions', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    const changeId = draft.changes[0]?.id
    if (!changeId) throw new Error('Missing draft change')
    current = people.owner
    await app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
    const decisionsResponse = await app.request(
      `/projects/${projectId}/decisions`,
      { headers },
      env,
    )
    const decisionBody = (await decisionsResponse.json()) as { decisions: Array<{ id: string }> }
    const decisionId = decisionBody.decisions[0]?.id
    if (!decisionId) throw new Error('Missing decision')
    current = people.viewer
    expect((await app.request(`/drafts/${id}`, { headers }, env)).status).toBe(200)
    expect((await app.request(`/projects/${projectId}/decisions`, { headers }, env)).status).toBe(
      200,
    )
    const writes: Array<[string, RequestInit]> = [
      [`/projects/${projectId}/drafts`, post()],
      [`/drafts/${id}`, { method: 'DELETE', headers }],
      [`/drafts/${id}/changes/${changeId}/accept`, post({})],
      [`/drafts/${id}/changes/${changeId}/reject`, post({})],
      [`/drafts/${id}/accept-all`, post({})],
      [`/decisions/${decisionId}/undo`, post()],
    ]
    for (const [path, init] of writes) expect((await app.request(path, init, env)).status).toBe(403)
  })

  it('applies one accepted change and its decision atomically', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    const changeId = draft.changes.find((change) => change.kind === 'requirements')?.id
    if (!changeId) throw new Error('Missing requirements change')
    await db.client.query(
      `CREATE FUNCTION fail_decision_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced decision failure'; END $$`,
    )
    await db.client.query(
      'CREATE TRIGGER fail_decision BEFORE INSERT ON decisions FOR EACH ROW EXECUTE FUNCTION fail_decision_insert()',
    )
    const accept = await app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
    await db.client.query('DROP TRIGGER fail_decision ON decisions')
    await db.client.query('DROP FUNCTION fail_decision_insert()')
    expect(accept.status).toBe(500)
    const plan = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    const planBody = (await plan.json()) as { sections: Array<{ kind: string; content: unknown }> }
    expect(planBody.sections.find((section) => section.kind === 'requirements')?.content).toBeNull()
    const decisions = await db.client.query('SELECT id FROM decisions WHERE project_id = $1', [
      projectId,
    ])
    expect(decisions.rowCount).toBe(0)
    const refreshed = await readDraft(id)
    expect(refreshed.changes.find((change) => change.id === changeId)?.status).toBe('pending')
  })

  it('rejects an accept when that plan section changed after drafting', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    const changeId = draft.changes.find((change) => change.kind === 'requirements')?.id
    if (!changeId) throw new Error('Missing requirements change')
    const edited = await app.request(
      `/projects/${projectId}/plan/sections/requirements`,
      patch({ version: 0, content: ['A newer requirement'] }),
      env,
    )
    expect(edited.status).toBe(200)
    const response = await app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
    expect(response.status).toBe(409)
    const plan = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    const body = (await plan.json()) as { sections: Array<{ kind: string; content: unknown }> }
    expect(body.sections.find((section) => section.kind === 'requirements')?.content).toEqual([
      'A newer requirement',
    ])
  })

  it('limits draft creation to 20 per workspace each hour', async () => {
    for (let i = 0; i < 20; i += 1)
      expect((await app.request(`/projects/${projectId}/drafts`, post(), env)).status).toBe(202)
    expect((await app.request(`/projects/${projectId}/drafts`, post(), env)).status).toBe(429)
  })

  it('marks invalid model output failed without writing any changes', async () => {
    let receivedBrief: unknown
    const broken = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
      draftModel: async (brief) => {
        receivedBrief = brief
        return { requirements: [{ unexpected: 'object' }] }
      },
    })
    const response = await broken.request(`/projects/${projectId}/drafts`, post(), env)
    expect(response.status).toBe(202)
    const body = (await response.json()) as { draft: { id: string } }
    const draft = await readDraft(body.draft.id)
    expect(draft.status).toBe('failed')
    expect(draft.changes).toEqual([])
    expect(receivedBrief).toEqual({
      problem: 'Checkout is hard',
      goals: ['Support self-service checkout'],
      constraints: 'Must support low bandwidth',
      outOfScope: 'Subscriptions',
    })
  })

  it('does not assign a risk to a member removed after drafting', async () => {
    const memberOwnedPlan = {
      requirements: [],
      stories: [],
      milestones: [],
      risks: [{ title: 'Email delay', severity: 'medium', ownerId: 'editor', decideBy: null }],
      stack: [],
      estimate: { value: '1 week', note: '' },
    }
    const modelApp = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
      draftModel: async () => memberOwnedPlan,
    })
    const created = await modelApp.request(`/projects/${projectId}/drafts`, post(), env)
    const createdBody = (await created.json()) as { draft: { id: string } }
    const draft = await readDraft(createdBody.draft.id)
    const changeId = draft.changes.find((change) => change.kind === 'risks')?.id
    if (!changeId) throw new Error('Missing risks change')
    await db.db.delete(memberships).where(eq(memberships.userId, 'editor'))
    const accepted = await modelApp.request(
      `/drafts/${createdBody.draft.id}/changes/${changeId}/accept`,
      post({}),
      env,
    )
    expect(accepted.status).toBe(409)
    const plan = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    expect(((await plan.json()) as { risks: unknown[] }).risks).toEqual([])
  })

  it('restores task milestone links when undo reverses a milestone removal', async () => {
    const createdMilestone = await app.request(
      `/projects/${projectId}/milestones`,
      post({ title: 'First release', status: 'planning', dueDate: null }),
      env,
    )
    const milestone = (await createdMilestone.json()) as { milestone: { id: string } }
    const createdTask = await app.request(
      `/projects/${projectId}/tasks`,
      post({ title: 'Prepare launch', description: '', milestoneId: milestone.milestone.id }),
      env,
    )
    const task = (await createdTask.json()) as { task: { id: string } }
    const noMilestonesPlan = {
      requirements: [],
      stories: [],
      milestones: [],
      risks: [],
      stack: [],
      estimate: { value: '1 week', note: '' },
    }
    const modelApp = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
      draftModel: async () => noMilestonesPlan,
    })
    const createdDraft = await modelApp.request(`/projects/${projectId}/drafts`, post(), env)
    const createdDraftBody = (await createdDraft.json()) as { draft: { id: string } }
    const draft = await readDraft(createdDraftBody.draft.id)
    const changeId = draft.changes.find((change) => change.kind === 'milestones')?.id
    if (!changeId) throw new Error('Missing milestones change')
    await modelApp.request(
      `/drafts/${createdDraftBody.draft.id}/changes/${changeId}/accept`,
      post({}),
      env,
    )
    const changedTask = await app.request(`/tasks/${task.task.id}`, { headers }, env)
    expect(
      ((await changedTask.json()) as { task: { milestoneId: string | null } }).task.milestoneId,
    ).toBeNull()
    const decisionResponse = await app.request(`/projects/${projectId}/decisions`, { headers }, env)
    const decision = ((await decisionResponse.json()) as { decisions: Array<{ id: string }> })
      .decisions[0]
    if (!decision) throw new Error('Missing milestone decision')
    const undone = await modelApp.request(`/decisions/${decision.id}/undo`, post(), env)
    expect(undone.status).toBe(200)
    const restoredTask = await app.request(`/tasks/${task.task.id}`, { headers }, env)
    expect(
      ((await restoredTask.json()) as { task: { milestoneId: string | null } }).task.milestoneId,
    ).toBe(milestone.milestone.id)
  })

  it('undoes an accepted change by applying its before value and appending a reverse decision', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    const changeId = draft.changes.find((change) => change.kind === 'requirements')?.id
    if (!changeId) throw new Error('Missing requirements change')
    await app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
    const decisionsResponse = await app.request(
      `/projects/${projectId}/decisions`,
      { headers },
      env,
    )
    const decisionsBody = (await decisionsResponse.json()) as { decisions: Array<{ id: string }> }
    const decisionId = decisionsBody.decisions[0]?.id
    if (!decisionId) throw new Error('Missing decision')
    const undone = await app.request(`/decisions/${decisionId}/undo`, post(), env)
    expect(undone.status).toBe(200)
    const decisions = await app.request(`/projects/${projectId}/decisions`, { headers }, env)
    const decisionsAfterUndo = (await decisions.json()) as {
      decisions: Array<{ outcome: string; reversesDecisionId: string | null }>
    }
    expect(decisionsAfterUndo.decisions).toContainEqual(
      expect.objectContaining({ outcome: 'reversed', reversesDecisionId: decisionId }),
    )
    const plan = await app.request(`/projects/${projectId}/plan`, { headers }, env)
    const planBody = (await plan.json()) as { sections: Array<{ kind: string; content: unknown }> }
    expect(planBody.sections.find((section) => section.kind === 'requirements')?.content).toBeNull()
    const reaccepted = await app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
    expect(reaccepted.status).toBe(200)
  })

  it('rejects one section, accepts the rest together, and discards without deleting decisions', async () => {
    const id = await createDraft()
    const draft = await readDraft(id)
    const storiesId = draft.changes.find((change) => change.kind === 'stories')?.id
    if (!storiesId) throw new Error('Missing stories change')
    expect(
      (await app.request(`/drafts/${id}/changes/${storiesId}/reject`, post({}), env)).status,
    ).toBe(200)
    const accepted = await app.request(`/drafts/${id}/accept-all`, post({}), env)
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ accepted: 5 })
    expect((await app.request(`/drafts/${id}`, { headers }, env)).status).toBe(200)
    expect((await app.request(`/drafts/${id}`, { method: 'DELETE', headers }, env)).status).toBe(
      200,
    )
    const decisions = await db.client.query('SELECT outcome FROM decisions WHERE project_id = $1', [
      projectId,
    ])
    expect(decisions.rows.map((row) => row.outcome).sort()).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'rejected',
    ])
    const discarded = await app.request(`/drafts/${id}`, { headers }, env)
    const discardedBody = (await discarded.json()) as { draft: { status: string } }
    expect(discardedBody.draft.status).toBe('discarded')
  })

  it('serializes a manual milestone edit with accepting a draft', async () => {
    const created = await app.request(
      `/projects/${projectId}/milestones`,
      post({ title: 'First release', status: 'planning', dueDate: null }),
      env,
    )
    const createdBody = (await created.json()) as { milestone: { id: string } }
    const id = await createDraft()
    const draft = await readDraft(id)
    const changeId = draft.changes.find((change) => change.kind === 'milestones')?.id
    if (!changeId) throw new Error('Missing milestones change')
    const worker = new Client({
      connectionString: url,
      application_name: 'planfrojex-plan-race-test',
    })
    const observer = new Client({ connectionString: url })
    await worker.connect()
    await observer.connect()
    await worker.query(`SET search_path TO ${db.schemaName}`)
    await observer.query(`SET search_path TO ${db.schemaName}`)
    const workerPidRow = (await worker.query('SELECT pg_backend_pid() AS "workerPid"')).rows[0] as
      | { workerPid: number }
      | undefined
    if (!workerPidRow) throw new Error('Missing worker database connection')
    const { workerPid } = workerPidRow
    await db.client.query(`
      CREATE FUNCTION pause_manual_milestone_edit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.title = 'Manual edit' THEN
          PERFORM pg_notify('milestone_edit_started', 'started');
          PERFORM pg_sleep(3);
        END IF;
        RETURN NEW;
      END $$`)
    await db.client.query(
      'CREATE TRIGGER pause_manual_edit BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION pause_manual_milestone_edit()',
    )
    const concurrentDb = drizzle(worker, { schema })
    const concurrentApp = createApp({
      database: () => concurrentDb,
      auth: () => ({ api: { getSession: async () => ({ user: current }) } }) as never,
    })
    try {
      const update = concurrentApp.request(
        `/milestones/${createdBody.milestone.id}`,
        patch({ title: 'Manual edit' }),
        env,
      )
      let updateQuery = ''
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await observer.query(
          `SELECT query FROM pg_stat_activity WHERE pid = $1 AND state = 'active'`,
          [workerPid],
        )
        updateQuery = String(result.rows[0]?.query ?? '')
        if (updateQuery.toLowerCase().startsWith('update "milestones"')) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (!updateQuery.toLowerCase().startsWith('update "milestones"'))
        throw new Error(`Manual edit did not reach its update query: ${updateQuery}`)
      const accept = app.request(`/drafts/${id}/changes/${changeId}/accept`, post({}), env)
      const [updated, accepted] = await Promise.all([update, accept])
      expect(updated.status).toBe(200)
      expect(accepted.status).toBe(409)
      const reread = await app.request(`/projects/${projectId}/plan`, { headers }, env)
      const plan = (await reread.json()) as { milestones: Array<{ title: string }> }
      expect(plan.milestones[0]?.title).toBe('Manual edit')
    } finally {
      await db.client.query('DROP TRIGGER pause_manual_edit ON milestones')
      await db.client.query('DROP FUNCTION pause_manual_milestone_edit()')
      await worker.end()
      await observer.end()
    }
  })
})
