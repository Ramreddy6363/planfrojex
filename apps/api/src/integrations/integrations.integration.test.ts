import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { draftChanges, drafts, milestones, projects, tasks } from '../db/schema'
import { integrationSuite } from '../testing/pg'
import { listPath, trackerFixture, webhook } from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
integrationSuite(url)('Linear tracker settings', () => {
  let fixture: Awaited<ReturnType<typeof trackerFixture>>
  beforeAll(async () => {
    fixture = await trackerFixture(url as string)
  })
  afterAll(async () => fixture?.database.close())

  it('connects, validates status mappings, runs sync, and removes stored credentials on disconnect', async () => {
    expect(await (await fixture.request(listPath)).json()).toEqual({
      configured: true,
      integration: null,
    })
    const integration = await fixture.connect()
    const root = `/integrations/${integration.id}`
    expect(integration.states.map(({ name }) => name)).toEqual([
      'Todo',
      'In Progress',
      'Done',
      'Canceled',
    ])
    const incorrect = await fixture.request(root, 'PATCH', 'owner', {
      statusMapping: { planning: 'other-team-state' },
    })
    expect(incorrect.status).toBe(400)
    const changed = await fixture.request(root, 'PATCH', 'owner', {
      options: { pushMilestones: false, pullStatus: true, importIssues: true },
      statusMapping: { planning: integration.states[0]?.id },
    })
    expect(changed.status).toBe(200)
    const result = await fixture.request(`${root}/sync`, 'POST')
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ integration: { lastSyncedAt: expect.any(String) } })
    const stored = await fixture.database.client.query(
      'SELECT encrypted_credentials FROM integrations',
    )
    expect(stored.rows[0]?.encrypted_credentials).toBeTruthy()
    expect(stored.rows[0]?.encrypted_credentials).not.toContain('fake-linear-token')
    expect((await fixture.request(root, 'DELETE')).status).toBe(200)
    const removed = await fixture.database.client.query('SELECT id FROM integrations')
    expect(removed.rowCount).toBe(0)
  })
})

integrationSuite(url)('Linear tracker synchronization', () => {
  let fixture: Awaited<ReturnType<typeof trackerFixture>>
  beforeEach(async () => {
    fixture = await trackerFixture(url as string)
  })
  afterEach(async () => fixture?.database.close())

  async function addAcceptedProject(key: string, title = 'Accepted') {
    const { db, workspace } = fixture
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        key,
        name: key,
        brief: { problem: '' },
        leadId: 'owner',
      })
      .returning()
    if (!project) throw new Error('Missing project')
    const [accepted, manual] = await db
      .insert(milestones)
      .values([
        { projectId: project.id, title, code: 'M1', dueDate: '2026-12-01' },
        { projectId: project.id, title: 'Manual', code: 'M2' },
      ])
      .returning()
    if (!accepted || !manual) throw new Error('Missing milestones')
    const [draft] = await db
      .insert(drafts)
      .values({
        projectId: project.id,
        status: 'ready',
        model: 'fixture',
        createdBy: 'owner',
      })
      .returning()
    if (!draft) throw new Error('Missing draft')
    await db.insert(draftChanges).values({
      draftId: draft.id,
      kind: 'milestones',
      status: 'accepted',
      after: [{ title }],
      appliedSnapshot: { plan: [{ id: accepted.id }] },
    })
    return { project, accepted }
  }

  const issue = (id: string, projectId: string) => ({
    id,
    projectId,
    title: 'From Linear',
    description: 'Outside the plan',
    dueDate: null,
    stateId: 'fake-in-progress',
    assigneeId: null,
    updatedAt: new Date().toISOString(),
  })
  const event = (id: string, teamId?: string) => ({
    action: 'update',
    type: 'Issue',
    organizationId: `fake-org-${fixture.workspace.id}`,
    webhookTimestamp: Date.now(),
    data: { id, teamId },
  })

  it('connects without publishing any milestones until the owner opts in', async () => {
    await addAcceptedProject('PORT')
    const { id } = await fixture.connect()
    const list = await fixture.request(listPath)
    expect(await list.json()).toMatchObject({ integration: { options: { pushMilestones: false } } })
    expect((await fixture.request(`/integrations/${id}/sync`, 'POST')).status).toBe(200)
    expect(fixture.fake.projects.size).toBe(0)
  })

  it('relinks an imported task after reconnect when the issue moved to another mapped project', async () => {
    const first = await addAcceptedProject('FIRST', 'First milestone')
    await addAcceptedProject('SECOND', 'Second milestone')
    const enableSync = async (id: string) => {
      expect(
        (
          await fixture.request(`/integrations/${id}`, 'PATCH', 'owner', {
            options: { pushMilestones: true, importIssues: true },
          })
        ).status,
      ).toBe(200)
      return () => fixture.request(`/integrations/${id}/sync`, 'POST')
    }
    const old = await fixture.connect()
    const sync = await enableSync(old.id)
    expect((await sync()).status).toBe(200)
    const fromProject = [...fixture.fake.projects.values()].find(
      (row) => row.name === 'First milestone',
    )
    const toProject = [...fixture.fake.projects.values()].find(
      (row) => row.name === 'Second milestone',
    )
    if (!fromProject || !toProject) throw new Error('Expected both external projects')
    const imported = issue('moved-issue', fromProject.id)
    fixture.fake.issues.set(imported.id, imported)
    expect((await sync()).status).toBe(200)
    expect(await fixture.db.select().from(tasks)).toMatchObject([{ projectId: first.project.id }])
    expect((await fixture.request(`/integrations/${old.id}`, 'DELETE')).status).toBe(200)
    imported.projectId = toProject.id
    const connected = await fixture.connect()
    const syncAgain = await enableSync(connected.id)
    expect((await syncAgain()).status).toBe(200)
    const local = await fixture.db.select().from(tasks)
    expect(local).toHaveLength(1)
    expect(local[0]?.projectId).toBe(first.project.id)
    const links = await fixture.database.client.query(
      'SELECT task_id FROM external_links WHERE external_id = $1',
      [imported.id],
    )
    expect(links.rows).toEqual([{ task_id: local[0]?.id }])
  })

  it('limits a webhook to the signed issue and connected team', async () => {
    await addAcceptedProject('PORT')
    const { id } = await fixture.connect()
    expect(
      (
        await fixture.request(`/integrations/${id}`, 'PATCH', 'owner', {
          options: { pushMilestones: true, importIssues: true },
        })
      ).status,
    ).toBe(200)
    expect((await fixture.request(`/integrations/${id}/sync`, 'POST')).status).toBe(200)
    const [remoteId] = fixture.fake.projects.keys()
    if (!remoteId) throw new Error('Expected a mapped Linear project')
    fixture.fake.issues.set('untouched', issue('untouched', remoteId))
    fixture.fake.issues.set('changed', issue('changed', remoteId))
    const projectsRead = vi.spyOn(fixture.fake.provider, 'projectsInTeam')
    const issuesRead = vi.spyOn(fixture.fake.provider, 'issuesInTeam')
    const teamId = `fake-team-${fixture.workspace.id}`
    expect((await webhook(fixture, event('changed', 'different-team'))).status).toBe(200)
    expect(issuesRead).not.toHaveBeenCalled()
    expect((await webhook(fixture, event('changed', teamId))).status).toBe(200)
    expect(issuesRead).toHaveBeenCalledTimes(1)
    expect(issuesRead).toHaveBeenCalledWith(expect.any(String), teamId, [], ['changed'])
    expect(projectsRead).not.toHaveBeenCalled()
    const links = await fixture.database.client.query(
      'SELECT external_id FROM external_links WHERE task_id IS NOT NULL',
    )
    expect(links.rows).toEqual([{ external_id: 'changed' }])
  })

  it('pushes accepted milestones and their tasks, pulls mapped status, and imports once', async () => {
    const { db, workspace } = fixture
    const { project, accepted } = await addAcceptedProject('PORT')
    const [task] = await db
      .insert(tasks)
      .values({
        projectId: project.id,
        milestoneId: accepted.id,
        number: 1,
        title: 'Create account',
        assigneeId: 'owner',
        dueDate: '2026-11-30',
      })
      .returning()
    if (!task) throw new Error('Missing task')

    const integration = await fixture.connect()
    const root = `/integrations/${integration.id}`
    expect(
      (await fixture.request(root, 'PATCH', 'owner', { options: { pushMilestones: true } })).status,
    ).toBe(200)
    const sync = () => fixture.request(`${root}/sync`, 'POST')
    expect((await sync()).status).toBe(200)
    expect((await sync()).status).toBe(200)
    const arr = await fixture.database.client.query('SELECT * FROM external_links')
    expect(arr.rows).toHaveLength(2)
    const remoteProject = arr.rows.find((x) => x.milestone_id === accepted.id)
    const remoteTask = arr.rows.find((x) => x.task_id === task.id)
    expect(remoteProject?.external_id).toBeTruthy()
    expect(remoteTask?.external_id).toBeTruthy()
    expect(fixture.fake.projects.get(remoteProject.external_id)).toMatchObject({
      name: 'Accepted',
      targetDate: '2026-12-01',
      leadId: 'fake-user-owner@example.com',
    })
    expect(fixture.fake.issues.get(remoteTask.external_id)).toMatchObject({
      title: 'Create account',
      dueDate: '2026-11-30',
      assigneeId: 'fake-user-owner@example.com',
    })

    expect(
      (await fixture.request(root, 'PATCH', 'owner', { options: { importIssues: true } })).status,
    ).toBe(200)
    const remoteIssue = fixture.fake.issues.get(remoteTask.external_id)
    if (!remoteIssue) throw new Error('Expected synced issue')
    remoteIssue.stateId = 'fake-done'
    fixture.fake.issues.set('external-new', issue('external-new', remoteProject.external_id))

    const payload = event(remoteTask.external_id)
    await fixture.database.client.query(
      "ALTER TABLE activity ADD CONSTRAINT test_reject_tracker_activity CHECK (type NOT LIKE 'task.%') NOT VALID",
    )
    expect((await webhook(fixture, payload)).status).toBe(502)
    expect(await db.select().from(tasks)).toMatchObject([{ status: 'todo' }])
    await fixture.database.client.query(
      'ALTER TABLE activity DROP CONSTRAINT test_reject_tracker_activity',
    )
    expect((await webhook(fixture, payload)).status).toBe(200)
    expect((await sync()).status).toBe(200)
    const after = await db.select().from(tasks)
    expect(after).toHaveLength(2)
    expect(after.find((x) => x.id === task.id)?.status).toBe('done')
    expect(after.find((x) => x.title === 'From Linear')).toMatchObject({
      status: 'in_progress',
      milestoneId: null,
    })
    const result = await fixture.database.client.query(
      'SELECT type, actor_id, workspace_id FROM activity ORDER BY created_at, id',
    )
    expect(result.rows).toEqual([
      { type: 'task.status_changed', actor_id: null, workspace_id: workspace.id },
      { type: 'task.created', actor_id: null, workspace_id: workspace.id },
    ])
  })
})
