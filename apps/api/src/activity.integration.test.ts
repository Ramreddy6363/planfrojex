import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { memberships, projects, user, workspaces } from './db/schema'
import { fixedDraftPlan } from './drafts/service'
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
const write = (method: string, body?: unknown): RequestInit => ({
  method,
  headers,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
type Event = {
  id: string
  actorId: string
  type: string
  category: string
  subject: string | null
  payload: Record<string, unknown>
  comment: { text: string } | null
}
type WriteBody = {
  task: { id: string }
  milestone: { id: string }
  risk: { id: string }
  comment: { id: string }
  decision: { id: string }
  draft: { id: string; status: string; changes: { id: string; kind: string }[] }
  diagram: { id: string }
}
integrationSuite(url)('project activity', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>
  let app: ReturnType<typeof createApp>
  let actor = 'owner',
    projectId = '',
    workspaceId = ''
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
      ['owner', 'editor', 'viewer', 'outsider'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
      })),
    )
    const spaces = await db.db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Acme', slug: 'acme' },
      ])
      .returning()
    if (!spaces[0] || !spaces[1]) throw new Error('Missing workspace')
    workspaceId = spaces[0].id
    await db.db.insert(memberships).values([
      { workspaceId, userId: 'owner', role: 'owner' },
      { workspaceId, userId: 'editor', role: 'editor' },
      { workspaceId, userId: 'viewer', role: 'viewer' },
      { workspaceId: spaces[1].id, userId: 'outsider', role: 'owner' },
    ])
    const [project] = await db.db
      .insert(projects)
      .values({
        workspaceId,
        name: 'Portal',
        key: 'PORT',
        leadId: 'owner',
        brief: { problem: 'Original private text' },
      })
      .returning()
    if (!project) throw new Error('Missing project')
    projectId = project.id
    actor = 'owner'
  })
  afterAll(async () => db.close())
  const request = async (path: string, method: string, body?: unknown, status = 200) => {
    const response = await app.request(path, write(method, body), env)
    expect(response.status, `${method} ${path}`).toBe(status)
    if (!response.headers.get('content-type')?.includes('json')) return {} as WriteBody
    return response.json() as Promise<WriteBody>
  }
  const activity = async (query = '') => {
    const response = await app.request(`/projects/${projectId}/activity${query}`, { headers }, env)
    expect(response.status).toBe(200)
    return response.json() as Promise<{ activity: Event[]; nextCursor: string | null }>
  }
  const startDraft = async (input?: unknown, target = app) => {
    const response = await target.request(
      `/projects/${projectId}/drafts`,
      write('POST', input),
      env,
    )
    expect(response.status).toBe(202)
    const { draft } = (await response.json()) as { draft: { id: string } }
    for (let n = 0; n < 200; n++) {
      const result = await request(`/drafts/${draft.id}`, 'GET')
      if (result.draft.status === 'ready')
        return result.draft as { id: string; changes: { id: string; kind: string }[] }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Draft timed out')
  }
  it('starts empty, isolates the endpoint, lets viewers read, and validates filters', async () => {
    expect((await activity()).activity).toEqual([])
    actor = 'outsider'
    expect((await app.request(`/projects/${projectId}/activity`, { headers }, env)).status).toBe(
      404,
    )
    actor = 'viewer'
    expect((await activity()).activity).toEqual([])
    for (const query of [
      '?actor=outsider',
      '?category=unknown',
      '?limit=101',
      '?cursor=bad',
      `?cursor=${encodeURIComponent(btoa(JSON.stringify({ time: '2026-02-30T10:00:00Z', id: projectId })))}`,
    ])
      expect(
        (await app.request(`/projects/${projectId}/activity${query}`, { headers }, env)).status,
      ).toBe(400)
  })
  it('records each listed project property and brief section without storing private text or no-op rows', async () => {
    for (const [body, type, before, after] of [
      [{ status: 'planning' }, 'project.status_changed', 'draft', 'planning'],
      [{ name: 'Portal 2' }, 'project.name_changed', 'Portal', 'Portal 2'],
      [{ leadId: 'editor' }, 'project.lead_changed', 'owner', 'editor'],
      [{ targetDate: '2026-12-12' }, 'project.target_date_changed', null, '2026-12-12'],
    ] as const) {
      await request(`/projects/${projectId}`, 'PATCH', body)
      const rows = (await activity('?category=project')).activity.filter((row) => row.type === type)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.payload).toMatchObject({ before, after })
    }
    await request(`/projects/${projectId}`, 'PATCH', { brief: { problem: 'New secret brief' } })
    await request(`/projects/${projectId}`, 'PATCH', { status: 'planning' })
    const events = (await activity()).activity
    expect(events).toHaveLength(5)
    expect(events.find((row) => row.type === 'project.brief_edited')?.payload).toEqual({
      section: 'problem',
    })
    expect(JSON.stringify(events)).not.toContain('New secret brief')
  })
  it('records task creation, changed fields and deletion exactly once', async () => {
    const { milestone } = await request(
      `/projects/${projectId}/milestones`,
      'POST',
      { title: 'Launch', status: 'planning' },
      201,
    )
    const { task } = await request(
      `/projects/${projectId}/tasks`,
      'POST',
      { title: 'Sign in' },
      201,
    )
    for (const [field, value] of [
      ['status', 'in_progress'],
      ['assigneeId', 'owner'],
      ['priority', 'high'],
      ['dueDate', '2026-12-01'],
      ['milestoneId', milestone.id],
    ] as const)
      await request(`/tasks/${task.id}`, 'PATCH', { [field]: value })
    await request(`/tasks/${task.id}`, 'PATCH', {
      title: 'Corrected title',
      description: 'private task text',
      status: 'in_progress',
    })
    await request(`/tasks/${task.id}`, 'DELETE')
    const rows = (await activity('?category=tasks')).activity
    expect(rows.map((row) => row.type).sort()).toEqual(
      [
        'task.created',
        'task.status_changed',
        'task.assignee_changed',
        'task.priority_changed',
        'task.due_date_changed',
        'task.milestone_changed',
        'task.deleted',
      ].sort(),
    )
    expect(rows.find((row) => row.type === 'task.status_changed')?.payload).toMatchObject({
      taskKey: 'PORT-1',
      before: 'todo',
      after: 'in_progress',
    })
    expect(rows.find((row) => row.type === 'task.assignee_changed')?.payload).toMatchObject({
      before: null,
      after: 'owner',
      afterName: 'owner',
    })
    expect(JSON.stringify(rows)).not.toContain('private task text')
  })
  it('hydrates current comment text and never returns deleted text', async () => {
    const { comment } = await request(
      '/comments',
      'POST',
      { target: `project:${projectId}`, body: 'Secret original comment', mentions: [] },
      201,
    )
    expect((await activity('?category=comments')).activity[0]?.comment?.text).toBe(
      'Secret original comment',
    )
    await request(`/comments/${comment.id}`, 'PATCH', { body: 'Current comment' })
    expect((await activity('?category=comments')).activity[0]?.comment?.text).toBe(
      'Current comment',
    )
    const saved = await db.client.query('SELECT payload FROM activity WHERE project_id=$1', [
      projectId,
    ])
    expect(JSON.stringify(saved.rows)).not.toContain('comment')
    await request(`/comments/${comment.id}`, 'DELETE')
    const rows = (await activity('?category=comments')).activity
    expect(rows).toHaveLength(1)
    expect(rows[0]?.comment).toBeNull()
    expect(JSON.stringify(rows)).not.toContain('Secret original comment')
    expect(JSON.stringify(rows)).not.toContain('Current comment')
    const { task } = await request(`/projects/${projectId}/tasks`, 'POST', { title: 'Task' }, 201)
    await request(
      '/comments',
      'POST',
      { target: `task:${task.id}`, body: 'Task comment', mentions: [] },
      201,
    )
    expect(
      (await activity('?category=comments')).activity.find(
        (row) => row.comment?.text === 'Task comment',
      )?.payload,
    ).toMatchObject({ taskKey: 'PORT-1' })
  })
  it('records plan sections, milestones, risks, draft decisions and undo without raw section content', async () => {
    await request(`/projects/${projectId}/plan/sections/requirements`, 'PATCH', {
      version: 0,
      content: ['Secret requirements'],
    })
    const { milestone } = await request(
      `/projects/${projectId}/milestones`,
      'POST',
      { title: 'Launch', status: 'planning' },
      201,
    )
    await request(`/milestones/${milestone.id}`, 'PATCH', { title: 'Public launch' })
    await request(`/milestones/${milestone.id}`, 'DELETE')
    const { risk } = await request(
      `/projects/${projectId}/risks`,
      'POST',
      { title: 'Delivery', severity: 'low' },
      201,
    )
    await request(`/risks/${risk.id}`, 'PATCH', { severity: 'high' })
    await request(`/risks/${risk.id}`, 'DELETE')
    const draft = await startDraft()
    const requirement = draft.changes.find((row) => row.kind === 'requirements'),
      story = draft.changes.find((row) => row.kind === 'stories')
    if (!requirement || !story) throw new Error('Missing changes')
    const { decision } = await request(
      `/drafts/${draft.id}/changes/${requirement.id}/accept`,
      'POST',
      {},
    )
    await request(`/drafts/${draft.id}/changes/${story.id}/reject`, 'POST', {})
    await request(`/drafts/${draft.id}/accept-all`, 'POST', {})
    await request(`/decisions/${decision.id}/undo`, 'POST')
    const rows = (await activity('?category=plan&limit=100')).activity
    const types = [
      'plan.section_edited',
      'plan.milestone_created',
      'plan.milestone_updated',
      'plan.milestone_deleted',
      'plan.risk_created',
      'plan.risk_updated',
      'plan.risk_deleted',
      'draft.started',
      'draft.accepted',
      'draft.rejected',
      'draft.accepted_all',
      'draft.undone',
    ]
    expect(rows.map((row) => row.type).sort()).toEqual(types.sort())
    expect(rows.find((row) => row.type === 'plan.milestone_updated')?.payload).toMatchObject({
      before: { title: 'Launch' },
      after: { title: 'Public launch' },
    })
    expect(JSON.stringify(rows)).not.toContain('Secret requirements')
  })
  it('records task milestone unlinking from deletion and draft acceptance, and relinking on undo', async () => {
    const { milestone } = await request(
      `/projects/${projectId}/milestones`,
      'POST',
      { title: 'Launch', status: 'planning' },
      201,
    )
    const { task } = await request(
      `/projects/${projectId}/tasks`,
      'POST',
      { title: 'Ship', milestoneId: milestone.id },
      201,
    )
    await request(`/milestones/${milestone.id}`, 'DELETE')
    expect(
      (await activity('?category=tasks')).activity.filter(
        (row) => row.type === 'task.milestone_changed',
      ),
    ).toMatchObject([{ payload: { before: milestone.id, after: null } }])
    const { milestone: next } = await request(
      `/projects/${projectId}/milestones`,
      'POST',
      { title: 'Next launch', status: 'planning' },
      201,
    )
    await request(`/tasks/${task.id}`, 'PATCH', { milestoneId: next.id })
    await db.client.query('DELETE FROM activity WHERE project_id=$1', [projectId])
    const unlinkApp = createApp({
      database: () => db.db,
      auth: () => ({ api: { getSession: async () => ({ user: { id: actor } }) } }) as never,
      draftModel: async () => ({ ...fixedDraftPlan, milestones: [] }),
    })
    const draft = await startDraft(undefined, unlinkApp),
      change = draft.changes.find((row) => row.kind === 'milestones')
    if (!change) throw new Error('Missing milestone change')
    const { decision } = await request(
      `/drafts/${draft.id}/changes/${change.id}/accept`,
      'POST',
      {},
    )
    await request(`/decisions/${decision.id}/undo`, 'POST')
    const changes = (await activity('?category=tasks')).activity.filter(
      (row) => row.type === 'task.milestone_changed',
    )
    expect(changes).toHaveLength(2)
    expect(changes.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: next.id,
          after: null,
          beforeName: 'Next launch',
          afterName: null,
        }),
        expect.objectContaining({
          before: null,
          after: next.id,
          beforeName: null,
          afterName: 'Next launch',
        }),
      ]),
    )
  })
  it('records diagram lifecycle versions and draft acceptance but not working-copy autosaves', async () => {
    const { diagram } = await request(
      `/projects/${projectId}/diagrams`,
      'POST',
      { name: 'Checkout', type: 'flowchart' },
      201,
    )
    await request(`/diagrams/${diagram.id}`, 'PUT', {
      sceneVersion: 0,
      scene: { nodes: [], edges: [] },
    })
    await request(`/diagrams/${diagram.id}/versions`, 'POST', { label: 'First' }, 201)
    await request(`/diagrams/${diagram.id}/versions/1/restore`, 'POST', undefined, 201)
    const draft = await startDraft({ kind: 'diagram', diagramId: diagram.id, prompt: 'Checkout' })
    const change = draft.changes[0]
    if (!change) throw new Error('Missing diagram draft')
    await request(`/drafts/${draft.id}/changes/${change.id}/accept`, 'POST', {})
    await request(`/diagrams/${diagram.id}`, 'DELETE')
    const rows = (await activity('?category=diagrams')).activity
    expect(rows.map((row) => row.type).sort()).toEqual(
      [
        'diagram.created',
        'diagram.version_saved',
        'diagram.restored',
        'diagram.draft_accepted',
        'diagram.deleted',
      ].sort(),
    )
    expect(rows.find((row) => row.type === 'diagram.version_saved')?.payload).toMatchObject({
      before: 0,
      after: 1,
    })
    expect(rows.find((row) => row.type === 'diagram.restored')?.payload).toMatchObject({
      before: 1,
      after: 2,
    })
    expect(rows.find((row) => row.type === 'diagram.draft_accepted')?.payload).toMatchObject({
      before: 2,
      after: 3,
    })
  })
  it('rolls back changes if activity cannot be written and writes no acceptance row on failed decisions', async () => {
    await db.client.query(
      "CREATE FUNCTION fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced activity failure'; END $$",
    )
    await db.client.query(
      'CREATE TRIGGER fail_activity BEFORE INSERT ON activity FOR EACH ROW EXECUTE FUNCTION fail_activity()',
    )
    await request(`/projects/${projectId}/tasks`, 'POST', { title: 'Never committed' }, 500)
    await db.client.query('DROP TRIGGER fail_activity ON activity')
    await db.client.query('DROP FUNCTION fail_activity()')
    expect(
      (await db.client.query('SELECT id FROM tasks WHERE project_id=$1', [projectId])).rowCount,
    ).toBe(0)
    expect((await activity()).activity).toHaveLength(0)
    const draft = await startDraft()
    const change = draft.changes[0]
    if (!change) throw new Error('Missing change')
    await db.client.query(
      "CREATE FUNCTION fail_activity_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced decision failure'; END $$",
    )
    await db.client.query(
      'CREATE TRIGGER fail_activity_decision BEFORE INSERT ON decisions FOR EACH ROW EXECUTE FUNCTION fail_activity_decision()',
    )
    await request(`/drafts/${draft.id}/changes/${change.id}/accept`, 'POST', {}, 500)
    await db.client.query('DROP TRIGGER fail_activity_decision ON decisions')
    await db.client.query('DROP FUNCTION fail_activity_decision()')
    expect((await activity()).activity.map((row) => row.type)).toEqual(['draft.started'])
  })
  it('filters actors and categories and paginates tied timestamps with no duplicates or gaps', async () => {
    for (let n = 0; n < 7; n++) {
      actor = n % 2 ? 'editor' : 'owner'
      await request(`/projects/${projectId}/tasks`, 'POST', { title: `Task ${n}` }, 201)
    }
    actor = 'owner'
    await request(`/projects/${projectId}`, 'PATCH', { status: 'planning' })
    const all = (await activity('?limit=100')).activity
    expect((await activity('?actor=editor&category=tasks')).activity).toHaveLength(3)
    await db.client.query(
      "UPDATE activity SET created_at='2026-11-14T10:00:00Z' WHERE project_id=$1",
      [projectId],
    )
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const page = await activity(
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      ids.push(...page.activity.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toHaveLength(all.length)
    expect(new Set(ids).size).toBe(all.length)
    expect([...ids].sort()).toEqual(all.map((row) => row.id).sort())
    // Preserve PostgreSQL's microseconds in cursors even though displayed dates use milliseconds.
    for (const [index, row] of all.entries())
      await db.client.query('UPDATE activity SET created_at=$1::timestamptz WHERE id=$2', [
        `2026-11-14T10:00:00.${String(index).padStart(6, '0')}Z`,
        row.id,
      ])
    const preciseIds: string[] = []
    cursor = null
    do {
      const page = await activity(
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      preciseIds.push(...page.activity.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(preciseIds).toHaveLength(all.length)
    expect(new Set(preciseIds).size).toBe(all.length)
    expect([...preciseIds].sort()).toEqual(all.map((row) => row.id).sort())
  })
})
