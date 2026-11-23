import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  activity,
  decisions,
  diagrams,
  diagramVersions,
  notifications,
  projects,
  reviewApprovals,
} from '../db/schema'
import { outbox } from '../email'
import { integrationSuite } from '../testing/pg'
import {
  findReviewSection,
  firstReviewer,
  mailedToken,
  reviewFixture,
  secondReviewer,
} from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
const day = 24 * 60 * 60 * 1000
const contentRevision = /^[0-9a-f]{64}$/
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

integrationSuite(url)('stakeholder approval', () => {
  let fixture: Awaited<ReturnType<typeof reviewFixture>>
  let seed: Awaited<ReturnType<typeof fixture.seed>>
  beforeAll(async () => {
    fixture = await reviewFixture(url as string)
  })
  beforeEach(async () => {
    seed = await fixture.seed()
  })
  afterAll(async () => fixture?.close())

  it('lets owners and editors send reviews, lets viewers read, and lets editors cancel', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    const { request, reviewers } = await seed.create({
      emails: [`  ${firstReviewer.toUpperCase()}  `, secondReviewer],
      as: 'editor',
    })
    expect(reviewers).toEqual([
      expect.objectContaining({
        email: firstReviewer,
        verifiedAt: null,
        approvedCount: 0,
        totalSections: 4,
      }),
      expect.objectContaining({
        email: secondReviewer,
        verifiedAt: null,
        approvedCount: 0,
        totalSections: 4,
      }),
    ])
    expect(outbox.map((message) => message.to).sort()).toEqual([firstReviewer, secondReviewer])
    const listed = (await seed.list('viewer')).requests
    expect(listed).toEqual([expect.objectContaining({ ...request, cancelledAt: null, reviewers })])
    expect(
      (
        await fixture.request(`/review-requests/${request.id}`, {
          as: 'editor',
          method: 'DELETE',
        })
      ).status,
    ).toBe(200)
    expect((await seed.list('owner')).requests[0]?.cancelledAt).toEqual(expect.any(String))
    const own = await seed.create({ as: 'owner' })
    expect(
      (
        await fixture.request(`/review-requests/${own.request.id}`, {
          as: 'owner',
          method: 'DELETE',
        })
      ).status,
    ).toBe(200)
  })

  it('validates the request before queuing mail', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    for (const json of [
      { emails: [] },
      { emails: ['invalid-email'] },
      { emails: [firstReviewer], dueDate: '2026-02-31' },
      { emails: [firstReviewer], workspaceId: seed.otherProject.workspaceId },
    ]) {
      const response = await fixture.request(seed.path, { as: 'owner', method: 'POST', json })
      expect(response.status).toBe(400)
    }
    expect(outbox).toEqual([])
  })

  it('uses 14 days unless the due date is later', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    const shortDue = new Date(Date.now() + day).toISOString().slice(0, 10)
    const longDue = new Date(Date.now() + 28 * day).toISOString().slice(0, 10)
    const noDue = await seed.create()
    const short = await seed.create({ dueDate: shortDue })
    const long = await seed.create({ dueDate: longDue })
    for (const { request } of [noDue, short]) {
      const duration = Date.parse(request.expiresAt) - Date.parse(request.createdAt)
      expect(duration).toBeGreaterThan(14 * day - 10_000)
      expect(duration).toBeLessThan(14 * day + 10_000)
    }
    const dueEnd = Date.parse(`${longDue}T23:59:59.999Z`)
    expect(Math.abs(Date.parse(long.request.expiresAt) - dueEnd)).toBeLessThan(1_001)
  })

  it('approves individual sections and the whole plan, and preserves a recorded change request', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const initial = await fixture.readReview(token, cookie)
    expect(initial.review).toMatchObject({
      requesterName: 'Maya Chen',
      reviewerEmail: firstReviewer,
      approvedCount: 0,
      totalSections: 4,
    })
    expect(initial.review.revision).toMatch(contentRevision)
    expect(initial.review.sections).toEqual([
      {
        key: 'brief',
        label: 'Brief',
        revision: expect.stringMatching(contentRevision),
        outcome: null,
        comment: null,
        updatedAt: null,
      },
      {
        key: 'milestones',
        label: 'Milestones',
        revision: expect.stringMatching(contentRevision),
        outcome: null,
        comment: null,
        updatedAt: null,
      },
      {
        key: expect.stringMatching(/^diagram:[A-Za-z0-9_-]{43}$/),
        label: 'Checkout flow',
        revision: expect.stringMatching(contentRevision),
        outcome: null,
        comment: null,
        updatedAt: null,
      },
      {
        key: expect.stringMatching(/^diagram:[A-Za-z0-9_-]{43}$/),
        label: 'Account flow',
        revision: expect.stringMatching(contentRevision),
        outcome: null,
        comment: null,
        updatedAt: null,
      },
    ])
    expect(initial).toMatchObject({
      brief: { problem: 'Customers need a self-serve portal.' },
      plan: { milestones: [expect.objectContaining({ title: 'Account settings' })] },
      diagrams: [
        expect.objectContaining({ name: 'Checkout flow' }),
        expect.objectContaining({ name: 'Account flow' }),
      ],
    })
    const brief = findReviewSection(initial, 'brief')
    const approveBrief = await fixture.approve(
      token,
      { section: brief.key, revision: brief.revision, outcome: 'approved' },
      {
        cookie,
      },
    )
    expect(approveBrief.status).toBe(200)
    expect(await approveBrief.json()).toMatchObject({
      ok: true,
      approvedCount: 1,
      totalSections: 4,
    })
    const checkout = initial.review.sections.find(({ label }) => label === 'Checkout flow')
    if (!checkout) throw new Error('Checkout flow section not found')
    const comment = 'Please include CSV export.'
    const change = await fixture.approve(
      token,
      { section: checkout.key, revision: checkout.revision, outcome: 'changes_requested', comment },
      { cookie },
    )
    expect(change.status).toBe(200)
    const afterChange = await fixture.readReview(token, cookie)
    expect(afterChange.review.approvedCount).toBe(1)
    expect(afterChange.review.sections).toContainEqual({
      key: 'brief',
      label: 'Brief',
      revision: brief.revision,
      outcome: 'approved',
      comment: null,
      updatedAt: expect.stringMatching(isoTimestamp),
    })
    expect(afterChange.review.sections).toContainEqual({
      key: checkout.key,
      label: 'Checkout flow',
      revision: checkout.revision,
      outcome: 'changes_requested',
      comment,
      updatedAt: expect.stringMatching(isoTimestamp),
    })
    const all = await fixture.approve(
      token,
      {
        section: 'all',
        outcome: 'approved',
        revision: afterChange.review.revision,
      },
      { cookie },
    )
    expect(all.status).toBe(200)
    expect(await all.json()).toMatchObject({ ok: true, approvedCount: 4, totalSections: 4 })
    expect(
      (await fixture.readReview(token, cookie)).review.sections.map((section) => section.outcome),
    ).toEqual(['approved', 'approved', 'approved', 'approved'])
    expect((await seed.list('viewer')).requests[0]?.reviewers).toEqual([
      expect.objectContaining({
        email: firstReviewer,
        verifiedAt: expect.any(String),
        approvedCount: 4,
        totalSections: 4,
      }),
    ])
    const timeline = await fixture.db
      .select()
      .from(activity)
      .where(eq(activity.projectId, seed.project.id))
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'review.approved', workspaceId: seed.project.workspaceId }),
        expect.objectContaining({
          type: 'review.changes_requested',
          workspaceId: seed.project.workspaceId,
        }),
      ]),
    )
    const log = await fixture.db
      .select()
      .from(decisions)
      .where(eq(decisions.projectId, seed.project.id))
    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'brief', outcome: 'approved' }),
        expect.objectContaining({ kind: 'diagram', outcome: 'changes_requested', reason: comment }),
      ]),
    )
    const inbox = await fixture.db
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceId, seed.project.workspaceId))
    expect(inbox).toHaveLength(3)
    expect(inbox.every((item) => item.userId === 'owner' && item.type === 'review_decision')).toBe(
      true,
    )
    expect(inbox.every((item) => timeline.some((entry) => entry.id === item.activityId))).toBe(true)
  })

  it('records plan-wide change requests without clearing individual approvals', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const loaded = await fixture.readReview(token, cookie)
    const briefSection = findReviewSection(loaded, 'brief')
    const brief = await fixture.approve(
      token,
      { section: briefSection.key, revision: briefSection.revision, outcome: 'approved' },
      {
        cookie,
      },
    )
    expect(brief.status).toBe(200)
    const comment = 'Please confirm how this will roll out.'
    const request = await fixture.approve(
      token,
      { section: 'all', revision: loaded.review.revision, outcome: 'changes_requested', comment },
      { cookie },
    )
    expect(request.status).toBe(200)
    expect(await request.json()).toMatchObject({ ok: true, approvedCount: 1, totalSections: 4 })
    const current = await fixture.readReview(token, cookie)
    expect(current.review.planChangeRequest).toMatchObject({ comment })
    expect(current.review.sections).toContainEqual(
      expect.objectContaining({
        key: 'brief',
        outcome: 'approved',
      }),
    )
    const timeline = await fixture.db
      .select()
      .from(activity)
      .where(eq(activity.projectId, seed.project.id))
    const changes = timeline.filter((entry) => entry.type === 'review.changes_requested')
    expect(changes).toHaveLength(1)
    const log = await fixture.db
      .select()
      .from(decisions)
      .where(eq(decisions.projectId, seed.project.id))
    expect(log.filter((entry) => entry.outcome === 'changes_requested')).toEqual([
      expect.objectContaining({ kind: 'plan', reason: comment }),
    ])
    const [change] = changes
    if (!change) throw new Error('Change request activity not found')
    const inbox = await fixture.db
      .select()
      .from(notifications)
      .where(eq(notifications.activityId, change.id))
    expect(inbox).toEqual([expect.objectContaining({ userId: 'owner', type: 'review_decision' })])

    const leadInbox = await fixture.request('/inbox?ws=northwind', { as: 'owner' })
    expect(leadInbox.status).toBe(200)
    expect(await leadInbox.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          type: 'review_decision',
          activityId: change.id,
          outcome: 'changes_requested',
          section: 'Plan',
          reviewComment: comment,
        }),
        expect.objectContaining({
          type: 'review_decision',
          outcome: 'approved',
          section: 'Brief',
          reviewComment: null,
        }),
      ]),
    })
  })

  it('keeps diagram section keys stable when a different diagram is deleted', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const diagramSection = (
      name: string,
      review: Awaited<ReturnType<typeof fixture.readReview>>,
    ) => {
      const section = review.review.sections.find(({ label }) => label === name)
      if (!section) throw new Error('Diagram section not found')
      return section
    }
    const initial = await fixture.readReview(token, cookie)
    const removed = diagramSection('Checkout flow', initial)
    const remaining = diagramSection('Account flow', initial)
    await fixture.db
      .update(diagrams)
      .set({ deletedAt: new Date() })
      .where(eq(diagrams.name, 'Checkout flow'))

    const review = await fixture.readReview(token, cookie)
    expect(diagramSection('Account flow', review).key).toBe(remaining.key)
    expect(review.review.sections.every((section) => section.key !== removed.key)).toBe(true)
    const stale = await fixture.approve(
      token,
      { section: removed.key, revision: removed.revision, outcome: 'approved' },
      { cookie },
    )
    expect(stale.ok).toBe(false)
    expect(stale.status).toBe(409)
    const approved = await fixture.approve(
      token,
      { section: remaining.key, revision: remaining.revision, outcome: 'approved' },
      { cookie },
    )
    expect(approved.status).toBe(200)
    const after = await fixture.readReview(token, cookie)
    expect(after.review.sections).toContainEqual(
      expect.objectContaining({
        label: 'Account flow',
        key: remaining.key,
        outcome: 'approved',
      }),
    )
  })

  it('rejects unknown sections and change requests without a comment', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const loaded = await fixture.readReview(token, cookie)
    const brief = findReviewSection(loaded, 'brief')
    for (const body of [
      { section: 'estimate', outcome: 'approved', revision: loaded.review.revision },
      { section: 'all', outcome: 'approved' },
      { section: 'all', outcome: 'changes_requested', revision: loaded.review.revision },
      { section: brief.key, outcome: 'changes_requested', revision: brief.revision, comment: '  ' },
      {
        section: brief.key,
        outcome: 'approved',
        revision: brief.revision,
        reviewerId: seed.otherProject.id,
      },
    ]) {
      const response = await fixture.approve(token, body, { cookie })
      expect(response.status).toBe(400)
    }
    expect((await fixture.readReview(token, cookie)).review.approvedCount).toBe(0)
  })

  it('rejects a stale Brief approval without writing a review or its side effects', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const loaded = await fixture.readReview(token, cookie)
    const brief = findReviewSection(loaded, 'brief')

    await fixture.db
      .update(projects)
      .set({ brief: { problem: 'Customers need a revised plan.' } })
      .where(eq(projects.id, seed.project.id))
    const stale = await fixture.approve(
      token,
      {
        section: brief.key,
        outcome: 'approved',
        revision: brief.revision,
      },
      { cookie },
    )
    expect(stale.status).toBe(409)
    expect(await fixture.db.select().from(reviewApprovals)).toEqual([])
    expect(await fixture.db.select().from(activity)).toEqual([])
    expect(await fixture.db.select().from(decisions)).toEqual([])
    expect(await fixture.db.select().from(notifications)).toEqual([])
  })

  it('rejects a stale whole-plan approval when saved diagram content changes without a key change', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const loaded = await fixture.readReview(token, cookie)
    const [chart] = await fixture.db
      .select({ id: diagrams.id })
      .from(diagrams)
      .where(eq(diagrams.name, 'Checkout flow'))
    if (!chart) throw new Error('Checkout flow diagram not found')
    await fixture.db.insert(diagramVersions).values({
      diagramId: chart.id,
      version: 2,
      scene: {
        nodes: [
          {
            id: 'changed-node',
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: { label: 'Revised checkout flow' },
          },
        ],
        edges: [],
      },
    })
    await fixture.db.update(diagrams).set({ currentVersion: 2 }).where(eq(diagrams.id, chart.id))

    const stale = await fixture.approve(
      token,
      {
        section: 'all',
        outcome: 'approved',
        revision: loaded.review.revision,
      },
      { cookie },
    )
    expect(stale.status).toBe(409)
    expect(await fixture.db.select().from(reviewApprovals)).toEqual([])
    expect(await fixture.db.select().from(activity)).toEqual([])
    expect(await fixture.db.select().from(decisions)).toEqual([])
    expect(await fixture.db.select().from(notifications)).toEqual([])
  })

  it('approves all 101 sections in a large review', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    const extra = await fixture.db
      .insert(diagrams)
      .values(
        Array.from({ length: 97 }, (_, index) => ({
          projectId: seed.project.id,
          name: `Extra diagram ${index + 1}`,
          type: 'flowchart' as const,
          currentVersion: 1,
        })),
      )
      .returning({ id: diagrams.id })
    await fixture.db.insert(diagramVersions).values(
      extra.map(({ id }) => ({
        diagramId: id,
        version: 1,
        scene: { nodes: [], edges: [] },
      })),
    )
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const loaded = await fixture.readReview(token, cookie)
    expect(loaded.review.totalSections).toBe(101)
    const approved = await fixture.approve(
      token,
      {
        section: 'all',
        outcome: 'approved',
        revision: loaded.review.revision,
      },
      { cookie },
    )
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({
      ok: true,
      approvedCount: 101,
      totalSections: 101,
    })
  })

  it('rejects approve-all if the shared sections changed after the reviewer loaded them', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const loaded = await fixture.readReview(token, cookie)

    const [newDiagram] = await fixture.db
      .insert(diagrams)
      .values({
        projectId: seed.project.id,
        name: 'New diagram',
        type: 'flowchart',
        currentVersion: 1,
      })
      .returning()
    if (!newDiagram) throw new Error('Diagram was not created')
    await fixture.db.insert(diagramVersions).values({
      diagramId: newDiagram.id,
      version: 1,
      scene: { nodes: [], edges: [] },
    })

    const stale = await fixture.approve(
      token,
      {
        section: 'all',
        outcome: 'approved',
        revision: loaded.review.revision,
      },
      { cookie },
    )
    expect(stale.status).toBe(409)
    expect(await fixture.db.select().from(reviewApprovals)).toEqual([])
    expect(await fixture.db.select().from(activity)).toEqual([])
  })
})
