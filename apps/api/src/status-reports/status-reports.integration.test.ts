import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  activity,
  decisions,
  draftChanges,
  drafts,
  memberships,
  milestones,
  notificationSettings,
  reviewers,
  reviewRequests,
  statusReportDeliveries,
  statusReports,
  tasks,
  user,
} from '../db/schema'
import { outbox } from '../email'
import { dispatchScheduledChecks } from '../index'
import { testEnv } from '../integrations/test-fixture'
import { integrationSuite } from '../testing/pg'
import { runWeeklyStatusEmails } from './service'
import { lastFriday, monday, statusFixture } from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
integrationSuite(url)('weekly status report delivery', () => {
  let fixture: Awaited<ReturnType<typeof statusFixture>>
  beforeEach(async () => {
    fixture = await statusFixture(url as string)
    outbox.length = 0
  })
  afterEach(async () => {
    vi.useRealTimers()
    await fixture?.database.close()
  })

  it('previews current project data without sending or adding to sent history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(lastFriday)
    const { db, project, milestone, workspace } = fixture
    await db.insert(activity).values({
      projectId: project.id,
      workspaceId: workspace.id,
      type: 'plan.milestone_updated',
      subject: milestone.id,
      payload: { before: { dueDate: '2026-11-21' }, after: { dueDate: '2026-11-26' } },
      createdAt: lastFriday,
    })
    const response = await fixture.preview('editor')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      report: {
        week: '2026-11-16',
        status: 'on_track',
        body: {
          projectName: 'Weekly portal',
          milestones: [{ code: 'M2', oldDueDate: '2026-11-21', done: 1, total: 2 }],
          decisions: [],
          nextWeek: expect.stringContaining('Send invoice'),
        },
      },
    })
    expect(outbox).toHaveLength(0)
    expect(await (await fixture.list('viewer')).json()).toEqual({ reports: [] })
  })

  it('only sends active projects with last-week activity and sends each eligible recipient once', async () => {
    const { db, project } = fixture
    const review = await fixture.addReview()
    await db.insert(reviewers).values([
      {
        requestId: review.id,
        email: 'outside@example.com',
        tokenHash: 'external-a',
        verifiedAt: lastFriday,
      },
      {
        requestId: review.id,
        email: 'owner@example.com',
        tokenHash: 'external-b',
        verifiedAt: lastFriday,
      },
      { requestId: review.id, email: 'unverified@example.com', tokenHash: 'external-c' },
      {
        requestId: review.id,
        email: 'viewer@example.com',
        tokenHash: 'external-d',
        verifiedAt: lastFriday,
      },
    ])
    await db.insert(notificationSettings).values([
      { userId: 'editor', type: 'weekly_summary', email: false, inApp: false },
      { userId: 'viewer', type: 'weekly_summary', email: false, inApp: false },
    ])
    await db.insert(decisions).values({
      projectId: project.id,
      actorId: 'owner',
      kind: 'requirements',
      outcome: 'accepted',
      reason: 'Do not include private reasons',
      createdAt: lastFriday,
    })
    await dispatchScheduledChecks(db, testEnv, {
      cron: '0 9 * * 1',
      scheduledTime: monday.getTime(),
    })
    expect(outbox.map(({ to }) => to).sort()).toEqual([
      'outside@example.com',
      'owner@example.com',
      'second-owner@example.com',
    ])
    const externalMail = outbox.find(({ to }) => to === 'outside@example.com')
    expect(externalMail?.text).not.toContain('Accepted the Requirements section')
    expect(externalMail?.text).not.toContain('Send invoice')
    expect(externalMail?.text).toMatch(
      /Open the plan: http:\/\/localhost:5173\/share\/[A-Za-z0-9_-]{43}/,
    )
    const shareToken = externalMail?.text.match(
      /Open the plan: http:\/\/localhost:5173\/share\/([A-Za-z0-9_-]{43})/,
    )?.[1]
    const unsubscribeToken = externalMail?.text.match(
      /Unsubscribe: http:\/\/localhost:8787\/public\/status-reports\/unsubscribe\/([A-Za-z0-9_-]{43})/,
    )?.[1]
    if (!shareToken) throw new Error('Missing public plan link for reviewer')
    if (!unsubscribeToken) throw new Error('Missing unsubscribe link for reviewer')
    expect(shareToken).not.toBe(unsubscribeToken)
    expect((await fixture.request(`/public/share/${unsubscribeToken}`)).status).toBe(404)
    const publicPlan = await fixture.request(`/public/share/${shareToken}`)
    expect(publicPlan.status).toBe(200)
    const publicBody = await publicPlan.json()
    expect(publicBody).toMatchObject({
      project: { name: 'Weekly portal' },
      plan: { milestones: [{ title: 'Billing' }] },
    })
    expect(JSON.stringify(publicBody)).not.toContain('Send invoice')
    const [replacement] = await db
      .insert(reviewRequests)
      .values({
        workspaceId: fixture.workspace.id,
        projectId: project.id,
        shareTokenHash: 'status-fixture-share-hash',
        expiresAt: new Date('2026-12-31T00:00:00Z'),
      })
      .returning()
    if (!replacement) throw new Error('Missing replacement review')
    expect((await fixture.request(`/review-requests/${review.id}`, 'DELETE', 'owner')).status).toBe(
      200,
    )
    expect((await fixture.request(`/public/share/${shareToken}`)).status).toBe(404)
    for (const mail of outbox) {
      expect(mail.subject).toContain('Weekly portal')
      expect(mail.html).toContain('Open the plan')
      expect(mail.html).toContain('Unsubscribe')
      expect(JSON.stringify(mail)).not.toContain('SECRET')
      expect(JSON.stringify(mail)).not.toContain('Do not include private reasons')
      for (const { to } of outbox)
        expect(`${mail.subject}\n${mail.text}\n${mail.html}`).not.toContain(to)
    }
    const ownerMail = outbox.find(({ to }) => to === 'owner@example.com')
    expect(ownerMail?.text).toContain('Accepted the Requirements section')
    expect(ownerMail?.text).toContain('Send invoice')
    expect(await (await fixture.list()).json()).toMatchObject({
      reports: [{ week: '2026-11-16', recipientsCount: 3, sentAt: expect.any(String) }],
    })
    expect(
      await (await fixture.request(`/projects/${fixture.quiet.id}/status-reports`)).json(),
    ).toEqual({ reports: [] })
    expect(
      await (await fixture.request(`/projects/${fixture.archived.id}/status-reports`)).json(),
    ).toEqual({ reports: [] })
  })

  it('preserves the earlier date and describes milestone decisions from draft snapshots', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(lastFriday)
    const { db, project, milestone } = fixture
    const [draft] = await db
      .insert(drafts)
      .values({
        projectId: project.id,
        kind: 'drift',
        status: 'ready',
        model: 'fixture',
      })
      .returning()
    if (!draft) throw new Error('Missing draft')
    const [change] = await db
      .insert(draftChanges)
      .values({
        draftId: draft.id,
        kind: 'milestones',
        status: 'accepted',
        before: [{ id: milestone.id, code: 'M2', title: 'Billing', dueDate: '2026-11-21' }],
        after: { kind: 'milestone_date', targetId: milestone.id },
        appliedSnapshot: {
          plan: [{ id: milestone.id, code: 'M2', title: 'Billing', dueDate: '2026-11-26' }],
        },
      })
      .returning()
    await db.insert(decisions).values({
      projectId: project.id,
      actorId: 'owner',
      kind: 'milestones',
      outcome: 'accepted',
      draftChangeId: change?.id,
      createdAt: lastFriday,
    })
    expect(await (await fixture.preview()).json()).toMatchObject({
      report: {
        body: {
          milestones: [{ code: 'M2', oldDueDate: '2026-11-21' }],
          decisions: [expect.stringContaining('Moved M2 to Nov 26')],
        },
      },
    })
  })

  it('words rejected drift suggestions as drift, not as plan-draft sections', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(lastFriday)
    const { db, project, milestone } = fixture
    const [draft] = await db
      .insert(drafts)
      .values({ projectId: project.id, kind: 'drift', status: 'ready', model: 'rules' })
      .returning()
    if (!draft) throw new Error('Missing draft')
    const changes = await db
      .insert(draftChanges)
      .values([
        {
          draftId: draft.id,
          kind: 'milestones',
          status: 'rejected',
          driftKey: '1:m',
          before: '2026-11-21',
          after: {
            kind: 'milestone_date',
            targetId: milestone.id,
            code: 'M2',
            title: 'Billing',
            before: '2026-11-21',
            after: '2026-11-26',
          },
        },
        {
          draftId: draft.id,
          kind: 'risks',
          status: 'rejected',
          driftKey: '3:r',
          before: 'medium',
          after: {
            kind: 'risk_severity',
            targetId: milestone.id,
            code: 'R1',
            title: 'SSO',
            before: 'medium',
            after: 'high',
            decideBy: '2026-11-20',
            ownerName: null,
          },
        },
      ])
      .returning()
    await db.insert(decisions).values(
      changes.map((change) => ({
        projectId: project.id,
        actorId: 'owner',
        kind: change.kind,
        outcome: 'rejected' as const,
        draftChangeId: change.id,
        createdAt: lastFriday,
      })),
    )
    const { report } = (await (await fixture.preview()).json()) as {
      report: { body: { decisions: string[] } }
    }
    const text = report.body.decisions.join('\n')
    expect(text).toContain('Rejected the suggested date change for M2 Billing')
    expect(text).toContain('Rejected raising R1 SSO to High')
    expect(text).not.toContain('section')
  })

  it('does not show a milestone as moved when it returned to its original date', async () => {
    const { db, project, milestone, workspace } = fixture
    await db
      .update(milestones)
      .set({ dueDate: '2026-11-28' })
      .where(eq(milestones.id, milestone.id))
    await db.insert(activity).values({
      projectId: project.id,
      workspaceId: workspace.id,
      type: 'plan.milestone_updated',
      subject: milestone.id,
      payload: { before: { dueDate: '2026-11-26' }, after: { dueDate: '2026-11-28' } },
      createdAt: new Date('2026-11-19T10:00:00Z'),
    })
    await db
      .update(milestones)
      .set({ dueDate: '2026-11-26' })
      .where(eq(milestones.id, milestone.id))
    await db.insert(activity).values({
      projectId: project.id,
      workspaceId: workspace.id,
      type: 'plan.milestone_updated',
      subject: milestone.id,
      payload: { before: { dueDate: '2026-11-28' }, after: { dueDate: '2026-11-26' } },
      createdAt: new Date('2026-11-20T10:00:00Z'),
    })
    expect(await (await fixture.preview()).json()).toMatchObject({
      report: { body: { milestones: [{ dueDate: '2026-11-26', oldDueDate: null }] } },
    })
  })

  it('claims a project week only once, even when two runs overlap', async () => {
    const { db } = fixture
    await Promise.all([
      runWeeklyStatusEmails(db, testEnv, monday),
      runWeeklyStatusEmails(db, testEnv, monday),
    ])
    await runWeeklyStatusEmails(db, testEnv, monday)
    expect(outbox).toHaveLength(4)
    expect(new Set(outbox.map((mail) => mail.to)).size).toBe(4)
    const result = (await (await fixture.list()).json()) as { reports: unknown[] }
    expect(result).toMatchObject({ reports: [{ week: '2026-11-16', recipientsCount: 4 }] })
    expect(result.reports).toHaveLength(1)
  })

  it('retries a failed recipient without duplicating recipients the provider already accepted', async () => {
    const delivered = new Set<string>()
    const attempted: { to: string; key: string }[] = []
    let failFirst = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        const key = headers.get('Idempotency-Key')
        if (!key) throw new Error('Missing idempotency key')
        const body = JSON.parse(String(init?.body)) as { to: string[] }
        attempted.push({ to: body.to[0] ?? '', key })
        if (failFirst) {
          failFirst = false
          return { ok: false }
        }
        delivered.add(key)
        return { ok: true }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await dispatchScheduledChecks(fixture.db, env, {
      cron: '0 9 * * 1',
      scheduledTime: monday.getTime(),
    })
    await fixture.db.insert(decisions).values({
      projectId: fixture.project.id,
      actorId: 'owner',
      kind: 'requirements',
      outcome: 'accepted',
      createdAt: monday,
    })
    await dispatchScheduledChecks(fixture.db, env, {
      cron: '0 3 * * *',
      scheduledTime: new Date('2026-11-24T03:00:00Z').getTime(),
    })
    expect(attempted).toHaveLength(5)
    expect(delivered.size).toBe(4)
    expect(attempted[0]?.to).toBe(attempted.at(-1)?.to)
    expect(attempted[0]?.key).toBe(attempted.at(-1)?.key)
    expect(await (await fixture.list()).json()).toMatchObject({
      reports: [{ recipientsCount: 4, sentAt: expect.any(String) }],
    })
  })

  it('narrows a pending member delivery to reviewer permissions before retrying', async () => {
    const { db, workspace } = fixture
    const review = await fixture.addReview()
    await db.insert(reviewers).values({
      requestId: review.id,
      email: 'owner@example.com',
      tokenHash: 'external-owner',
      verifiedAt: lastFriday,
    })
    await db.insert(decisions).values({
      projectId: fixture.project.id,
      actorId: 'owner',
      kind: 'requirements',
      outcome: 'accepted',
      createdAt: lastFriday,
    })
    const ownerPayloads: { text: string; html: string }[] = []
    let failOwner = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          to: string[]
          text: string
          html: string
        }
        if (body.to[0] === 'owner@example.com') {
          ownerPayloads.push(body)
          if (failOwner) {
            failOwner = false
            return { ok: false }
          }
        }
        return { ok: true }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await dispatchScheduledChecks(db, env, {
      cron: '0 9 * * 1',
      scheduledTime: monday.getTime(),
    })
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, 'owner'), eq(memberships.workspaceId, workspace.id)))
    await dispatchScheduledChecks(db, env, {
      cron: '0 3 * * *',
      scheduledTime: new Date('2026-11-24T03:00:00Z').getTime(),
    })
    expect(ownerPayloads).toHaveLength(2)
    expect(ownerPayloads[0]?.text).toContain('Accepted the Requirements section')
    expect(ownerPayloads[0]?.text).toContain('Send invoice')
    expect(ownerPayloads[1]?.text).not.toContain('Accepted the Requirements section')
    expect(ownerPayloads[1]?.text).not.toContain('Send invoice')
    expect(ownerPayloads[1]?.text).toContain('/share/')
    const shareToken = ownerPayloads[1]?.text.match(
      /Open the plan: http:\/\/localhost:5173\/share\/([A-Za-z0-9_-]{43})/,
    )?.[1]
    expect(shareToken).toBeTruthy()
    expect((await fixture.request(`/public/share/${shareToken}`)).status).toBe(200)
  })

  it('refreshes an expired sending claim to the current reviewer scope', async () => {
    const { db, workspace, project } = fixture
    const review = await fixture.addReview()
    await db.insert(reviewers).values({
      requestId: review.id,
      email: 'owner@example.com',
      tokenHash: 'stale-claim-reviewer',
      verifiedAt: lastFriday,
    })
    await db.insert(decisions).values({
      projectId: project.id,
      actorId: 'owner',
      kind: 'requirements',
      outcome: 'accepted',
      createdAt: lastFriday,
    })
    let failOwner = true
    const ownerBodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { to: string[]; text: string }
        if (body.to[0] === 'owner@example.com') {
          ownerBodies.push(body.text)
          if (failOwner) {
            failOwner = false
            return { ok: false }
          }
        }
        return { ok: true }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await dispatchScheduledChecks(db, env, { cron: '0 9 * * 1', scheduledTime: monday.getTime() })
    await db
      .update(statusReportDeliveries)
      .set({ state: 'sending', claimedAt: new Date('2026-11-23T10:00:00Z') })
      .where(eq(statusReportDeliveries.state, 'pending'))
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, 'owner'), eq(memberships.workspaceId, workspace.id)))
    await dispatchScheduledChecks(db, env, {
      cron: '0 3 * * *',
      scheduledTime: new Date('2026-11-24T03:00:00Z').getTime(),
    })
    expect(ownerBodies).toHaveLength(2)
    expect(ownerBodies[1]).not.toContain('Accepted the Requirements section')
    expect(ownerBodies[1]).not.toContain('Send invoice')
    const shareToken = ownerBodies[1]?.match(
      /Open the plan: http:\/\/localhost:5173\/share\/([A-Za-z0-9_-]{43})/,
    )?.[1]
    expect(shareToken).toBeTruthy()
    expect((await fixture.request(`/public/share/${shareToken}`)).status).toBe(200)
    const [replacement] = await db
      .insert(reviewRequests)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        shareTokenHash: 'status-fixture-share-hash',
        expiresAt: new Date('2026-12-31T00:00:00Z'),
      })
      .returning()
    expect(replacement).toBeTruthy()
    if (!replacement) throw new Error('Missing replacement request')
    await db.insert(reviewers).values({
      requestId: replacement.id,
      email: 'owner@example.com',
      tokenHash: 'replacement-reviewer-token',
      verifiedAt: lastFriday,
    })
    await db
      .update(statusReportDeliveries)
      .set({ reviewRequestId: replacement.id })
      .where(eq(statusReportDeliveries.reviewRequestId, review.id))
    await db
      .update(reviewRequests)
      .set({ cancelledAt: new Date('2026-11-25T04:00:00Z') })
      .where(eq(reviewRequests.id, review.id))
    expect((await fixture.request(`/public/share/${shareToken}`)).status).toBe(404)
    const deliveries = await db
      .select({ state: statusReportDeliveries.state })
      .from(statusReportDeliveries)
    expect(deliveries.every(({ state }) => state !== 'sending')).toBe(true)
  })

  it('cancels an expired delivery when the recipient is no longer eligible', async () => {
    const { db, workspace } = fixture
    let editorAttempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { to: string[] }
        if (body.to[0] === 'editor@example.com') {
          editorAttempts += 1
          return { ok: false }
        }
        return { ok: true }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await dispatchScheduledChecks(db, env, { cron: '0 9 * * 1', scheduledTime: monday.getTime() })
    const [pending] = await db
      .select({ id: statusReportDeliveries.id })
      .from(statusReportDeliveries)
      .where(eq(statusReportDeliveries.state, 'pending'))
    if (!pending) throw new Error('Expected one failed delivery')
    await db
      .update(statusReportDeliveries)
      .set({ state: 'sending', claimedAt: new Date('2026-11-24T00:00:00Z') })
      .where(eq(statusReportDeliveries.id, pending.id))
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, 'editor'), eq(memberships.workspaceId, workspace.id)))
    await dispatchScheduledChecks(db, env, {
      cron: '0 3 * * *',
      scheduledTime: new Date('2026-11-25T03:00:00Z').getTime(),
    })
    expect(editorAttempts).toBe(1)
    const [delivery] = await db
      .select({ state: statusReportDeliveries.state })
      .from(statusReportDeliveries)
      .where(eq(statusReportDeliveries.id, pending.id))
    expect(delivery?.state).toBe('cancelled')
  })

  it('rechecks membership before each email instead of sending a queued full report after removal', async () => {
    const { db, workspace } = fixture
    const sentTo: string[] = []
    let removed = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { to: string[] }
        sentTo.push(body.to[0] ?? '')
        if (!removed) {
          removed = true
          await db.delete(memberships).where(eq(memberships.workspaceId, workspace.id))
        }
        return { ok: true }
      }),
    )
    await runWeeklyStatusEmails(
      db,
      { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' },
      monday,
    )
    expect(sentTo).toHaveLength(1)
  })

  it('rechecks reviewer expiry at dispatch instead of using the cron start time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(monday)
    const { db } = fixture
    const review = await fixture.addReview()
    await db
      .update(reviewRequests)
      .set({ expiresAt: new Date(monday.getTime() + 1_000) })
      .where(eq(reviewRequests.id, review.id))
    await db.insert(reviewers).values({
      requestId: review.id,
      email: 'outside@example.com',
      tokenHash: 'expires-during-delivery',
      verifiedAt: lastFriday,
    })
    const sentTo: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { to: string[] }
        sentTo.push(body.to[0] ?? '')
        if (sentTo.length === 1) vi.setSystemTime(new Date(monday.getTime() + 2_000))
        return { ok: true }
      }),
    )
    await runWeeklyStatusEmails(
      db,
      { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' },
      monday,
    )
    expect(sentTo).not.toContain('outside@example.com')
  })

  it('uses the saved full snapshot when a reviewer becomes a member before retry', async () => {
    const { db, project, workspace } = fixture
    const review = await fixture.addReview()
    await db.insert(reviewers).values({
      requestId: review.id,
      email: 'outside@example.com',
      tokenHash: 'reviewer-becomes-member',
      verifiedAt: lastFriday,
    })
    const outsideBodies: string[] = []
    let failFirst = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { to: string[]; text: string }
        if (body.to[0] === 'outside@example.com') {
          outsideBodies.push(body.text)
          if (failFirst) {
            failFirst = false
            return { ok: false, status: 503 }
          }
        }
        return { ok: true }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await runWeeklyStatusEmails(db, env, monday)
    expect(outsideBodies[0]).not.toContain('Send invoice')
    await db.insert(user).values({
      id: 'former-reviewer-member',
      name: 'Outside Reviewer',
      email: 'outside@example.com',
      emailVerified: true,
    })
    await db.insert(memberships).values({
      workspaceId: workspace.id,
      userId: 'former-reviewer-member',
      role: 'editor',
    })
    await db
      .update(tasks)
      .set({ title: 'Revised after the Monday report' })
      .where(eq(tasks.projectId, project.id))
    await dispatchScheduledChecks(db, env, {
      cron: '0 3 * * *',
      scheduledTime: new Date('2026-11-24T03:00:00Z').getTime(),
    })
    expect(outsideBodies).toHaveLength(2)
    expect(outsideBodies[1]).toContain('Send invoice')
    expect(outsideBodies[1]).not.toContain('Revised after the Monday report')
  })

  it('does not retry an ambiguous provider delivery after the provider key may have expired', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1
        return { ok: false, status: 503 }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await runWeeklyStatusEmails(fixture.db, env, monday)
    expect(attempts).toBeGreaterThan(0)
    const firstAttemptCount = attempts
    await dispatchScheduledChecks(fixture.db, env, {
      cron: '0 3 * * *',
      scheduledTime: new Date('2026-11-25T09:00:00Z').getTime(),
    })
    expect(attempts).toBe(firstAttemptCount)
    const deliveries = await fixture.db
      .select({ state: statusReportDeliveries.state })
      .from(statusReportDeliveries)
    expect(deliveries.every(({ state }) => state === 'unknown')).toBe(true)
  })
  it('finishes a report whose deliveries never succeeded and does not claim it again', async () => {
    const { db, project, workspace } = fixture
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1
        return { ok: false, status: 503 }
      }),
    )
    const env = { ...testEnv, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'from@example.com' }
    await runWeeklyStatusEmails(db, env, monday)
    await runWeeklyStatusEmails(db, env, new Date('2026-11-25T09:00:00Z'), true)
    const [report] = await db
      .select()
      .from(statusReports)
      .where(eq(statusReports.projectId, project.id))
    expect(report?.sentAt).not.toBeNull()
    expect(report?.recipientsCount).toBe(0)
    expect(await (await fixture.list('viewer')).json()).toEqual({ reports: [] })
    const before = attempts
    await db.insert(user).values({ id: 'late', name: 'Late', email: 'late@example.com' })
    await db
      .insert(memberships)
      .values({ userId: 'late', workspaceId: workspace.id, role: 'editor' })
    await runWeeklyStatusEmails(db, env, new Date('2026-11-26T03:00:00Z'), true)
    expect(attempts).toBe(before)
  })

  it('ignores an unsent report from five weeks ago when a member joins', async () => {
    const { db, project, workspace } = fixture
    // Build a real report, then age it to five weeks ago with nothing delivered.
    await runWeeklyStatusEmails(db, testEnv, monday)
    outbox.length = 0
    await db.delete(statusReportDeliveries)
    await db
      .update(statusReports)
      .set({ week: '2026-10-19', sentAt: null })
      .where(eq(statusReports.projectId, project.id))
    await db.insert(user).values({ id: 'late', name: 'Late', email: 'late@example.com' })
    await db
      .insert(memberships)
      .values({ userId: 'late', workspaceId: workspace.id, role: 'editor' })
    await runWeeklyStatusEmails(db, testEnv, new Date('2026-11-25T03:00:00Z'), true)
    expect(outbox).toHaveLength(0)
    const [report] = await db
      .select()
      .from(statusReports)
      .where(eq(statusReports.projectId, project.id))
    expect(report?.sentAt).toBeNull()
  })
})
