import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  decisions,
  draftChanges,
  drafts,
  externalLinks,
  milestones,
  risks,
  tasks,
} from '../db/schema'
import { runScheduledChecks } from '../index'
import { testEnv, webhook } from '../integrations/test-fixture'
import { integrationSuite } from '../testing/pg'
import { driftFixture } from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
integrationSuite(url)('project drift', () => {
  let fixture: Awaited<ReturnType<typeof driftFixture>>
  beforeEach(async () => {
    fixture = await driftFixture(url as string)
  })
  afterEach(async () => fixture?.database.close())

  async function checkImportedIssue() {
    const { db, project, milestone } = fixture
    const integration = await fixture.connect()
    const [task] = await db
      .insert(tasks)
      .values({
        projectId: project.id,
        number: 2,
        title: 'Imported task',
      })
      .returning()
    if (!task) throw new Error('Missing imported task')
    const link = {
      source: 'imported' as const,
      taskId: task.id,
      sourceMilestoneId: milestone.id,
      externalId: 'imported-linear-issue',
    }
    await db.insert(externalLinks).values({ ...link, integrationId: integration.id })
    const checked = await fixture.action()
    expect(checked.status).toBe(200)
    const { report } = (await checked.json()) as {
      report: { id: string; changes: Array<{ id: string; kind: string }> }
    }
    const changeId = report.changes.find(({ kind }) => kind === 'milestone_tasks')?.id
    expect(changeId).toBeDefined()
    return { integration, task, link, report, changeId }
  }

  it('stores suggested changes without changing the plan, then accepts them with a reason', async () => {
    const { db, project, milestone, risk } = fixture
    expect(await (await fixture.get()).json()).toMatchObject({
      report: null,
      linearConnected: false,
    })
    const checked = await fixture.action({ action: 'check' }, 'editor')
    expect(checked.status).toBe(200)
    const { report } = (await checked.json()) as { report: { id: string } }
    expect(report).toMatchObject({
      checkedAgainstLinearAt: null,
      findings: [{ kind: 'milestone_late', done: 0, total: 1 }, { kind: 'risk_overdue' }],
      changes: [
        { kind: 'milestone_date', before: milestone.dueDate, status: 'pending' },
        { kind: 'risk_severity', before: 'medium', after: 'high', status: 'pending' },
      ],
    })
    expect(await db.select().from(draftChanges)).toHaveLength(2)
    expect(await db.select().from(milestones)).toMatchObject([{ dueDate: milestone.dueDate }])
    expect(await db.select().from(risks)).toMatchObject([{ severity: risk.severity }])
    const accepted = await fixture.action({
      action: 'accept',
      reportId: report.id,
      reason: 'Reviewed',
    })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ report: null })
    expect((await db.select().from(milestones))[0]?.dueDate).not.toBe(milestone.dueDate)
    expect(await db.select().from(risks)).toMatchObject([{ severity: 'high' }])
    const logged = await fixture.request(`/projects/${project.id}/decisions`)
    expect(await logged.json()).toMatchObject({
      decisions: [
        { kind: 'milestones', outcome: 'accepted', reason: 'Reviewed' },
        { kind: 'risks', outcome: 'accepted', reason: 'Reviewed' },
      ],
    })
    expect(await (await fixture.action({ action: 'check' })).json()).toMatchObject({ report: null })
  })

  it('rolls back all changed rows and decisions when a later log insert fails', async () => {
    const { db, project, milestone, risk } = fixture
    const { report } = (await (await fixture.action()).json()) as { report: { id: string } }
    await fixture.database.client.query(
      "ALTER TABLE decisions ADD CONSTRAINT test_reject_drift_risk CHECK (kind <> 'risks') NOT VALID",
    )
    expect((await fixture.action({ action: 'accept', reportId: report.id })).status).toBe(500)
    expect(await db.select().from(milestones).where(eq(milestones.id, milestone.id))).toMatchObject(
      [{ dueDate: milestone.dueDate }],
    )
    expect(await db.select().from(risks).where(eq(risks.id, risk.id))).toMatchObject([
      { severity: risk.severity },
    ])
    expect(await db.select().from(decisions).where(eq(decisions.projectId, project.id))).toEqual([])
    expect(await db.select().from(draftChanges)).toMatchObject([
      { status: 'pending' },
      { status: 'pending' },
    ])
  })

  it('keeps a dismissed report hidden until the underlying findings change', async () => {
    const { db, project, milestone } = fixture
    const { report } = (await (await fixture.action()).json()) as { report: { id: string } }
    expect(
      await (await fixture.action({ action: 'dismiss', reportId: report.id })).json(),
    ).toMatchObject({ report: null })
    expect(await (await fixture.action()).json()).toMatchObject({ report: null })
    await db.insert(tasks).values({
      projectId: project.id,
      milestoneId: milestone.id,
      number: 2,
      title: 'Another billing task',
    })
    const next = (await (await fixture.action()).json()) as { report: { id: string } }
    expect(next.report.id).not.toBe(report.id)
    expect(next.report).toMatchObject({ findings: [{ total: 2 }, { kind: 'risk_overdue' }] })
  })

  it('reviews changes one at a time and rejects attempts to replay a decision', async () => {
    const { db, project, milestone, risk } = fixture
    const { report } = (await (await fixture.action()).json()) as {
      report: { id: string; changes: { id: string }[] }
    }
    const accept = { action: 'accept_change', reportId: report.id, changeId: report.changes[0]?.id }
    const accepted = await fixture.action(accept)
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({
      report: { changes: [{ status: 'accepted' }, { status: 'pending' }] },
    })
    expect((await fixture.action(accept)).status).toBe(409)
    const rejected = await fixture.action({
      action: 'reject_change',
      reportId: report.id,
      changeId: report.changes[1]?.id,
    })
    expect(rejected.status).toBe(200)
    expect(await rejected.json()).toMatchObject({ report: null })
    expect(
      (await db.select().from(milestones).where(eq(milestones.id, milestone.id)))[0]?.dueDate,
    ).not.toBe(milestone.dueDate)
    expect(await db.select().from(risks).where(eq(risks.id, risk.id))).toMatchObject([
      { severity: risk.severity },
    ])
    expect(
      await db
        .select()
        .from(decisions)
        .where(and(eq(decisions.projectId, project.id), eq(decisions.kind, 'risks'))),
    ).toMatchObject([{ outcome: 'rejected' }])
  })

  it('does not overwrite a milestone manually moved after the check', async () => {
    const { db, milestone, risk } = fixture
    const { report } = (await (await fixture.action()).json()) as { report: { id: string } }
    await db
      .update(milestones)
      .set({ dueDate: '2099-11-27' })
      .where(eq(milestones.id, milestone.id))
    expect((await fixture.action({ action: 'accept', reportId: report.id })).status).toBe(409)
    expect(await db.select().from(risks)).toMatchObject([{ severity: risk.severity }])
    expect(await db.select().from(decisions)).toEqual([])
  })

  it('refreshes an open diff after a risk priority changes without resolving its finding', async () => {
    const { db, risk } = fixture
    const { report } = (await (await fixture.action()).json()) as { report: { id: string } }
    await db.update(risks).set({ severity: 'high' }).where(eq(risks.id, risk.id))
    expect((await fixture.action({ action: 'accept', reportId: report.id })).status).toBe(409)
    const refreshed = (await (await fixture.action()).json()) as { report: { id: string } }
    expect(refreshed.report.id).not.toBe(report.id)
    expect(refreshed.report).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ kind: 'risk_severity', before: 'high', after: 'critical' }),
      ]),
    })
  })

  it('publishes only the reviewed milestone and keeps the undo snapshot', async () => {
    const { db, milestone, project } = fixture
    const [unreviewed] = await db
      .insert(milestones)
      .values({ projectId: project.id, code: 'M2', title: 'Unreviewed milestone' })
      .returning()
    if (!unreviewed) throw new Error('Missing second milestone')
    await db.insert(tasks).values({
      projectId: project.id,
      milestoneId: unreviewed.id,
      number: 2,
      title: 'Unreviewed task',
    })

    const { report } = (await (await fixture.action()).json()) as {
      report: { id: string; changes: Array<{ id: string; kind: string }> }
    }
    const changeId = report.changes.find(({ kind }) => kind === 'milestone_date')?.id
    expect(
      (await fixture.action({ action: 'accept_change', reportId: report.id, changeId })).status,
    ).toBe(200)

    const { id } = await fixture.connect()
    expect(
      (
        await fixture.request(`/integrations/${id}`, 'PATCH', 'owner', {
          options: { pushMilestones: true },
        })
      ).status,
    ).toBe(200)
    expect((await fixture.request(`/integrations/${id}/sync`, 'POST')).status).toBe(200)
    expect([...fixture.fake.projects.values()].map(({ name }) => name)).toEqual([milestone.title])
    expect([...fixture.fake.issues.values()].map(({ title }) => title)).toEqual(['Fix billing'])

    const [decision] = await db.select().from(decisions).where(eq(decisions.kind, 'milestones'))
    expect((await fixture.request(`/decisions/${decision?.id}/undo`, 'POST')).status).toBe(200)
    expect(await db.select().from(milestones).where(eq(milestones.id, milestone.id))).toMatchObject(
      [{ dueDate: milestone.dueDate }],
    )
  })

  it('accepts visible local changes after the workspace disconnects Linear', async () => {
    const { integration, task, report } = await checkImportedIssue()
    expect((await fixture.request(`/integrations/${integration.id}`, 'DELETE')).status).toBe(200)
    const visible = await (await fixture.get()).json()
    expect(visible).toMatchObject({
      linearConnected: false,
      report: { id: report.id, changes: [{ kind: 'milestone_date' }, { kind: 'risk_severity' }] },
    })
    const accepted = await fixture.action({ action: 'accept', reportId: report.id })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ report: null })
    expect(await fixture.db.select().from(tasks).where(eq(tasks.id, task.id))).toMatchObject([
      { milestoneId: null },
    ])
    expect(
      await fixture.db.select().from(decisions).where(eq(decisions.projectId, fixture.project.id)),
    ).toMatchObject([
      { kind: 'milestones', outcome: 'accepted' },
      { kind: 'risks', outcome: 'accepted' },
    ])
  })

  it('rejects decisions for a tracker change generated by another Linear connection', async () => {
    const { integration, task, link, report, changeId } = await checkImportedIssue()
    expect((await fixture.request(`/integrations/${integration.id}`, 'DELETE')).status).toBe(200)
    const reopened = await fixture.connect()
    expect(reopened.id).not.toBe(integration.id)
    await fixture.db.insert(externalLinks).values({ ...link, integrationId: reopened.id })
    const visible = await (await fixture.get()).json()
    expect(visible).toMatchObject({
      linearConnected: true,
      report: { id: report.id, changes: [{ kind: 'milestone_date' }, { kind: 'risk_severity' }] },
    })
    expect(
      (await fixture.action({ action: 'accept_change', reportId: report.id, changeId })).status,
    ).toBe(409)
    expect(
      (await fixture.action({ action: 'reject_change', reportId: report.id, changeId })).status,
    ).toBe(409)
    const checked = await fixture.action()
    expect(checked.status).toBe(200)
    const fresh = (await checked.json()) as { report: { id: string } }
    expect(fresh.report.id).not.toBe(report.id)
    expect(
      (await fixture.action({ action: 'accept_change', reportId: report.id, changeId })).status,
    ).toBe(409)
    expect(await fixture.db.select().from(tasks).where(eq(tasks.id, task.id))).toMatchObject([
      { milestoneId: null },
    ])
    expect(await fixture.db.select().from(decisions)).toEqual([])
  })

  it('checks drift after manual sync and a linked webhook, and suggests the issue source milestone', async () => {
    const { db, milestone, project, workspace } = fixture
    const [draft] = await db
      .insert(drafts)
      .values({ projectId: project.id, model: 'fixture', status: 'ready' })
      .returning()
    if (!draft) throw new Error('Missing accepted plan draft')
    await db.insert(draftChanges).values({
      draftId: draft.id,
      kind: 'milestones',
      status: 'accepted',
      after: [],
      appliedSnapshot: { plan: [{ id: milestone.id }] },
    })
    const { id } = await fixture.connect()
    const endpoint = `/integrations/${id}`
    expect(
      (
        await fixture.request(endpoint, 'PATCH', 'owner', {
          options: { pushMilestones: true, importIssues: true },
        })
      ).status,
    ).toBe(200)
    expect((await fixture.request(`${endpoint}/sync`, 'POST')).status).toBe(200)
    expect(await (await fixture.get()).json()).toMatchObject({
      linearConnected: true,
      report: { checkedAgainstLinearAt: expect.any(String) },
    })
    const [remoteProject] = fixture.fake.projects.keys()
    if (!remoteProject) throw new Error('No linked Linear project')
    const issue = {
      id: 'linear-added-task',
      projectId: remoteProject,
      title: 'New requirement',
      description: '',
      dueDate: null,
      stateId: 'fake-in-progress',
      assigneeId: null,
      updatedAt: new Date().toISOString(),
    }
    fixture.fake.issues.set(issue.id, issue)
    expect(
      (
        await webhook(fixture, {
          type: 'Issue',
          action: 'create',
          organizationId: `fake-org-${workspace.id}`,
          webhookTimestamp: Date.now(),
          data: { id: issue.id, teamId: `fake-team-${workspace.id}` },
        })
      ).status,
    ).toBe(200)
    expect(
      await db.select().from(externalLinks).where(eq(externalLinks.externalId, issue.id)),
    ).toMatchObject([{ source: 'imported', sourceMilestoneId: milestone.id }])
    const { report } = (await (await fixture.get()).json()) as {
      report: { id: string; changes: { id: string; kind: string }[] }
    }
    expect(report).toMatchObject({
      findings: expect.arrayContaining([
        {
          kind: 'linear_tasks',
          milestoneId: milestone.id,
          milestoneCode: milestone.code,
          tasks: [expect.objectContaining({ key: 'PORT-2', title: issue.title })],
        },
      ]),
      changes: expect.arrayContaining([
        expect.objectContaining({ kind: 'milestone_tasks', code: milestone.code }),
      ]),
    })
    const changeId = report.changes.find(({ kind }) => kind === 'milestone_tasks')?.id
    expect(
      (await fixture.action({ action: 'accept_change', reportId: report.id, changeId })).status,
    ).toBe(200)
    expect(
      await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, project.id), eq(tasks.number, 2))),
    ).toMatchObject([{ milestoneId: milestone.id }])
    expect((await fixture.request(endpoint, 'DELETE')).status).toBe(200)
    const noLinear = await (await fixture.get()).json()
    expect(noLinear).toMatchObject({
      linearConnected: false,
      report: { checkedAgainstLinearAt: null },
    })
    expect(JSON.stringify(noLinear)).not.toContain(issue.title)
  })

  it('does not borrow another project’s webhook sync time during a manual check', async () => {
    const { db, project, sibling, workspace, milestone } = fixture
    const [otherMilestone] = await db
      .insert(milestones)
      .values({
        projectId: sibling.id,
        title: 'Other project launch',
        code: 'M1',
        dueDate: '2020-11-21',
      })
      .returning()
    if (!otherMilestone) throw new Error('Missing other project milestone')
    await db.insert(tasks).values({
      projectId: sibling.id,
      milestoneId: otherMilestone.id,
      number: 1,
      title: 'Other project task',
    })
    for (const next of [
      { projectId: project.id, milestoneId: milestone.id },
      { projectId: sibling.id, milestoneId: otherMilestone.id },
    ]) {
      const [draft] = await db
        .insert(drafts)
        .values({
          projectId: next.projectId,
          model: 'fixture',
          status: 'ready',
        })
        .returning()
      if (!draft) throw new Error('Missing accepted plan draft')
      await db.insert(draftChanges).values({
        draftId: draft.id,
        kind: 'milestones',
        status: 'accepted',
        after: [],
        appliedSnapshot: { plan: [{ id: next.milestoneId }] },
      })
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const initialTime = '2026-11-24T10:00:00.000Z'
      vi.setSystemTime(new Date(initialTime))
      const { id } = await fixture.connect()
      const endpoint = `/integrations/${id}`
      expect(
        (
          await fixture.request(endpoint, 'PATCH', 'owner', {
            options: { pushMilestones: true, importIssues: true },
          })
        ).status,
      ).toBe(200)
      expect((await fixture.request(`${endpoint}/sync`, 'POST')).status).toBe(200)
      const siblingPath = `/projects/${sibling.id}/drift`
      expect(await (await fixture.request(siblingPath)).json()).toMatchObject({
        report: { checkedAgainstLinearAt: initialTime },
      })
      const linked = [...fixture.fake.projects.values()].find(
        ({ name }) => name === milestone.title,
      )
      if (!linked) throw new Error('No linked Linear project')
      const webhookTime = '2026-11-24T10:05:00.000Z'
      vi.setSystemTime(new Date(webhookTime))
      const issue = {
        id: 'project-a-issue',
        projectId: linked.id,
        title: 'New requirement',
        description: '',
        dueDate: null,
        stateId: 'fake-in-progress',
        assigneeId: null,
        updatedAt: webhookTime,
      }
      fixture.fake.issues.set(issue.id, issue)
      expect(
        (
          await webhook(fixture, {
            type: 'Issue',
            action: 'create',
            organizationId: `fake-org-${workspace.id}`,
            webhookTimestamp: Date.now(),
            data: { id: issue.id, teamId: `fake-team-${workspace.id}` },
          })
        ).status,
      ).toBe(200)
      expect(await (await fixture.get()).json()).toMatchObject({
        report: { checkedAgainstLinearAt: webhookTime },
      })
      expect(
        (await fixture.request(endpoint, 'PATCH', 'owner', { options: { pullStatus: false } }))
          .status,
      ).toBe(200)
      const recheckTime = '2026-11-24T10:10:00.000Z'
      vi.setSystemTime(new Date(recheckTime))
      expect(
        (
          await webhook(fixture, {
            type: 'Issue',
            action: 'update',
            organizationId: `fake-org-${workspace.id}`,
            webhookTimestamp: Date.now(),
            data: { id: issue.id, teamId: `fake-team-${workspace.id}` },
          })
        ).status,
      ).toBe(200)
      expect(await (await fixture.get()).json()).toMatchObject({
        report: { checkedAgainstLinearAt: recheckTime },
      })
      expect(await (await fixture.request(`${siblingPath}/check`, 'POST')).json()).toMatchObject({
        report: { checkedAgainstLinearAt: initialTime },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks projects without a Linear connection during the daily job', async () => {
    expect(runScheduledChecks).toBeTypeOf('function')
    await runScheduledChecks(fixture.db, testEnv)
    expect(await (await fixture.get()).json()).toMatchObject({
      report: {
        checkedAgainstLinearAt: null,
        findings: [{ kind: 'milestone_late' }, { kind: 'risk_overdue' }],
      },
    })
  })
})
