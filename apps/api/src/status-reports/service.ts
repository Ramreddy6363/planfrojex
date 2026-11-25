import { z } from '@hono/zod-openapi'
import {
  and,
  asc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm'
import { notificationDefaults } from '../account/preferences'
import type { ActivityTx } from '../activity/service'
import type { Db } from '../db'
import {
  activity,
  decisions,
  draftChanges,
  drafts,
  emailUnsubscribes,
  memberships,
  milestones,
  notificationSettings,
  projects,
  reviewers,
  reviewRequests,
  risks,
  shareLinks,
  statusReportDeliveries,
  statusReports,
  tasks,
  user,
  workspaces,
} from '../db/schema'
import { evaluateDrift } from '../drift/rules'
import { readDrift } from '../drift/service'
import { sendStatusEmail } from '../email'
import type { Env } from '../env'
import { hash } from '../reviews/service'
import { buildStatusReport, formatReportDate, renderStatusEmail, type StatusReport } from './report'

export const unsubscribePath = '/public/status-reports/unsubscribe'
export const weeklyStatusCron = '0 9 * * 1'
type StatusProject = { id: string; workspaceId: string }
const day = 86_400_000
const dateOnly = (date: Date) => date.toISOString().slice(0, 10)
const offsetDays = (date: Date, n: number) => new Date(date.getTime() + n * day)
const startOfWeek = (date: Date) =>
  offsetDays(new Date(dateOnly(date)), -((date.getUTCDay() + 6) % 7))
const between = (
  date: typeof decisions.createdAt | typeof activity.createdAt,
  from: Date,
  to: Date,
) => and(gte(date, from), lt(date, to))
const normalized = (email: string) => email.trim().toLowerCase()
const recipientHash = (email: string, projectId: string) =>
  hash(`weekly-status-recipient:${projectId}:${normalized(email)}`)

async function deliveryToken(
  reportId: string,
  digest: string,
  secret: string,
  purpose: 'unsubscribe' | 'public-share',
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`weekly-status:${purpose}:${reportId}:${digest}`),
    ),
  )
  return btoa(String.fromCharCode(...signature))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

const sections = {
  requirements: 'Requirements',
  stories: 'User stories',
  milestones: 'Milestones',
  risks: 'Risks',
  stack: 'Tech stack',
  estimate: 'Estimate',
  diagram: 'Diagram',
  brief: 'Brief',
  plan: 'Plan',
} as const
const outcomes = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  reversed: 'Reversed a change to',
  approved: 'Approved',
  changes_requested: 'Requested changes to',
} as const
const dueDate = z.iso.date().nullable()
const milestoneState = z.array(z.object({ id: z.uuid(), code: z.string(), dueDate }))
const milestoneSnapshot = z.object({ plan: milestoneState })
const milestoneEdit = z.object({
  before: z.object({ dueDate }),
  after: z.object({ dueDate }),
})
const riskChange = z.object({
  kind: z.literal('risk_severity'),
  code: z.string(),
  title: z.string(),
  after: z.enum(['low', 'medium', 'high', 'critical']),
})

function historicalMilestoneDates(change: {
  before: unknown
  appliedSnapshot: unknown
  outcome: string
}) {
  const before = milestoneState.safeParse(change.before)
  const after = milestoneSnapshot.safeParse(change.appliedSnapshot)
  if (!before.success || !after.success) return []
  const earlier = change.outcome === 'reversed' ? after.data.plan : before.data
  const later = change.outcome === 'reversed' ? before.data : after.data.plan
  const byId = new Map(earlier.map(({ id, dueDate }) => [id, dueDate]))
  return later.flatMap(({ id, code, dueDate }) => {
    const previous = byId.get(id)
    return previous && dueDate && previous !== dueDate ? [{ id, code, previous, dueDate }] : []
  })
}

const driftChange = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('milestone_date'),
    code: z.string(),
    title: z.string(),
    after: z.iso.date(),
  }),
  z.object({
    kind: z.literal('risk_severity'),
    code: z.string(),
    title: z.string(),
    after: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  z.object({
    kind: z.literal('milestone_tasks'),
    code: z.string(),
    tasks: z.array(z.unknown()),
  }),
])
const capitalized = (value: string) => `${value[0]?.toUpperCase()}${value.slice(1)}`

// Drift suggestions are reviewed like plan sections but are not plan-draft sections.
function driftDecisionText(row: Decision) {
  const change = driftChange.safeParse(row.after)
  if (!change.success) return null
  const verb = row.outcome === 'rejected' ? 'Rejected' : 'Accepted'
  const { data } = change
  if (data.kind === 'milestone_date')
    return `${verb} the suggested date change for ${data.code} ${data.title} to ${formatReportDate(data.after)}.`
  if (data.kind === 'risk_severity')
    return `${verb} raising ${data.code} ${data.title} to ${capitalized(data.after)}.`
  return `${verb} adding ${data.tasks.length} tracker ${data.tasks.length === 1 ? 'task' : 'tasks'} to ${data.code}.`
}

type Decision = Pick<typeof decisions.$inferSelect, 'kind' | 'outcome' | 'createdAt'> & {
  draftKind: string | null
  name: string | null
  before: unknown
  after: unknown
  appliedSnapshot: unknown
}
function decisionText(row: Decision) {
  let summary = `${outcomes[row.outcome]} the ${sections[row.kind]} section.`
  const drift = row.draftKind === 'drift' ? driftDecisionText(row) : null
  if (drift) summary = drift
  if (row.kind === 'milestones' && (row.outcome === 'accepted' || row.outcome === 'reversed')) {
    const dates = historicalMilestoneDates(row)
    if (dates.length)
      summary = dates
        .map(({ code, dueDate }) => `Moved ${code} to ${formatReportDate(dueDate)}.`)
        .join(' ')
  }
  if (row.kind === 'risks' && row.outcome === 'accepted') {
    const change = riskChange.safeParse(row.after)
    if (change.success) {
      const { code, title, after } = change.data
      summary = `Raised ${code} ${title} to ${after[0]?.toUpperCase()}${after.slice(1)}.`
    }
  }
  const name = row.name && !row.name.includes('@') ? `${row.name}, ` : ''
  return `${summary} ${name}${formatReportDate(row.createdAt)}`
}

function oldDates(
  decisionRows: Decision[],
  milestoneEvents: { id: string | null; payload: unknown; createdAt: Date }[],
) {
  const manual = milestoneEvents.flatMap(({ id, payload, createdAt }) => {
    const event = milestoneEdit.safeParse(payload)
    if (!id || !event.success) return []
    const { before, after } = event.data
    return before.dueDate && before.dueDate !== after.dueDate
      ? [{ id, previous: before.dueDate, dueDate: after.dueDate, createdAt }]
      : []
  })
  const accepted = decisionRows.flatMap((row) =>
    row.kind === 'milestones' && (row.outcome === 'accepted' || row.outcome === 'reversed')
      ? historicalMilestoneDates(row).map((change) => ({ ...change, createdAt: row.createdAt }))
      : [],
  )
  const dates = new Map<string, { first: string; last: string | null }>()
  for (const { id, previous, dueDate } of [...manual, ...accepted].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    const current = dates.get(id)
    dates.set(id, { first: current?.first ?? previous, last: dueDate })
  }
  return new Map(
    [...dates].flatMap(([id, value]) =>
      value.last && value.first !== value.last ? [[id, value.first]] : [],
    ),
  )
}

async function readReport(
  db: Db,
  scope: StatusProject,
  week: Date,
  now: Date,
  webOrigin: string,
  publicInclude?: string[],
) {
  const projectWhere = and(
    eq(projects.id, scope.id),
    eq(projects.workspaceId, scope.workspaceId),
    isNull(projects.deletedAt),
  )
  const [project] = await db
    .select({ name: projects.name, targetDate: projects.targetDate, slug: workspaces.slug })
    .from(projects)
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(projectWhere)
  if (!project) return null
  const nextWeek = offsetDays(week, 7)
  const until = new Date(Math.min(nextWeek.getTime(), now.getTime() + 1))
  const milestoneRows = await db
    .select({
      id: milestones.id,
      code: milestones.code,
      title: milestones.title,
      dueDate: milestones.dueDate,
      status: milestones.status,
      done: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')`.mapWith(Number),
      total: sql<number>`count(${tasks.id})`.mapWith(Number),
    })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .leftJoin(tasks, and(eq(tasks.milestoneId, milestones.id), eq(tasks.projectId, projects.id)))
    .where(projectWhere)
    .groupBy(milestones.id)
    .orderBy(asc(milestones.position), asc(milestones.id))
  const riskRows = await db
    .select({
      id: risks.id,
      code: risks.code,
      title: risks.title,
      severity: risks.severity,
      decideBy: risks.decideBy,
    })
    .from(risks)
    .innerJoin(projects, eq(projects.id, risks.projectId))
    .where(projectWhere)
    .orderBy(asc(risks.code))
  const decisionRows = await db
    .select({
      kind: decisions.kind,
      outcome: decisions.outcome,
      createdAt: decisions.createdAt,
      name: user.name,
      draftKind: drafts.kind,
      before: sql`case when ${drafts.id} is not null then ${draftChanges.before} end`,
      after: sql`case when ${drafts.id} is not null then ${draftChanges.after} end`,
      appliedSnapshot: sql`case when ${drafts.id} is not null then ${draftChanges.appliedSnapshot} end`,
    })
    .from(decisions)
    .innerJoin(projects, eq(projects.id, decisions.projectId))
    .leftJoin(
      memberships,
      and(
        eq(memberships.workspaceId, projects.workspaceId),
        eq(memberships.userId, decisions.actorId),
      ),
    )
    .leftJoin(user, eq(user.id, memberships.userId))
    .leftJoin(draftChanges, eq(draftChanges.id, decisions.draftChangeId))
    .leftJoin(drafts, and(eq(drafts.id, draftChanges.draftId), eq(drafts.projectId, projects.id)))
    .where(and(projectWhere, between(decisions.createdAt, week, until)))
    .orderBy(asc(decisions.createdAt), asc(decisions.id))
  const milestoneEvents = await db
    .select({ id: activity.subject, payload: activity.payload, createdAt: activity.createdAt })
    .from(activity)
    .where(
      and(
        eq(activity.projectId, scope.id),
        eq(activity.workspaceId, scope.workspaceId),
        eq(activity.type, 'plan.milestone_updated'),
        between(activity.createdAt, week, until),
      ),
    )
    .orderBy(asc(activity.createdAt), asc(activity.id))
  const upcoming = await db
    .select({ title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        projectWhere,
        ne(tasks.status, 'done'),
        gte(tasks.dueDate, dateOnly(nextWeek)),
        lt(tasks.dueDate, dateOnly(offsetDays(nextWeek, 7))),
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.number))
  const drift = await readDrift(db, { projectId: scope.id, workspaceId: scope.workspaceId }, false)
  const findings = [
    ...evaluateDrift(
      {
        milestones: [],
        risks: riskRows.map((risk) => ({ ...risk, ownerName: null })),
        importedTasks: [],
        linearConnected: false,
      },
      now,
    ).findings,
    ...(drift.report?.findings.filter(({ kind }) => kind === 'linear_tasks') ?? []),
  ]
  const external = publicInclude !== undefined
  const visibleFindings = external
    ? findings.filter((finding) =>
        finding.kind === 'milestone_late'
          ? publicInclude.includes('plan')
          : finding.kind === 'linear_tasks' && publicInclude.includes('tasks'),
      )
    : findings
  const visibleDecisions = decisionRows.filter((row) => {
    if (!external) return true
    if (row.kind === 'brief') return publicInclude.includes('brief')
    if (row.kind === 'milestones') return publicInclude.includes('plan')
    if (row.kind === 'diagram') return publicInclude.includes('diagrams')
    return false
  })
  const moved = oldDates(visibleDecisions, milestoneEvents)
  return buildStatusReport({
    projectName: project.name,
    targetDate: project.targetDate,
    week: dateOnly(week),
    asOf: dateOnly(now),
    planUrl: new URL(`/${encodeURIComponent(project.slug)}/projects/${scope.id}/plan`, webOrigin)
      .href,
    milestones: (external && !publicInclude.includes('plan') ? [] : milestoneRows).map((row) => ({
      ...row,
      oldDueDate: moved.get(row.id) ?? null,
    })),
    findings: visibleFindings,
    decisions: visibleDecisions.map(decisionText),
    upcomingTasks:
      external && !publicInclude.includes('tasks') ? [] : upcoming.map(({ title }) => title),
    openRisks: external ? [] : riskRows.map(({ title }) => title),
  })
}

export const previewStatusReport = (db: Db, scope: StatusProject, now: Date, webOrigin: string) =>
  readReport(db, scope, startOfWeek(now), now, webOrigin)

async function recipients(tx: ActivityTx, scope: StatusProject, now: Date) {
  const members = await tx
    .select({ email: user.email, preference: notificationSettings.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .leftJoin(
      notificationSettings,
      and(
        eq(notificationSettings.userId, user.id),
        eq(notificationSettings.type, 'weekly_summary'),
      ),
    )
    .where(eq(memberships.workspaceId, scope.workspaceId))
  const verifiedReviewers = await tx
    .selectDistinct({
      email: reviewers.email,
      reviewRequestId: reviewRequests.id,
      shareInclude: shareLinks.include,
      shareTokenHash: reviewRequests.shareTokenHash,
    })
    .from(reviewRequests)
    .innerJoin(reviewers, eq(reviewRequests.id, reviewers.requestId))
    .innerJoin(
      shareLinks,
      and(
        eq(shareLinks.projectId, reviewRequests.projectId),
        eq(shareLinks.workspaceId, reviewRequests.workspaceId),
        eq(shareLinks.tokenHash, reviewRequests.shareTokenHash),
      ),
    )
    .where(
      and(
        eq(reviewRequests.projectId, scope.id),
        eq(reviewRequests.workspaceId, scope.workspaceId),
        isNull(reviewRequests.cancelledAt),
        gt(reviewRequests.expiresAt, now),
        isNull(shareLinks.revokedAt),
        isNotNull(reviewers.verifiedAt),
      ),
    )
  const defaultEmail = notificationDefaults.find(({ type }) => type === 'weekly_summary')?.email
  const optedOut = new Set(
    members.filter(({ preference }) => preference === false).map(({ email }) => normalized(email)),
  )
  const byEmail = new Map<
    string,
    {
      email: string
      reviewRequestId: string | null
      shareInclude: string[] | null
      shareTokenHash: string | null
    }
  >()
  for (const member of members) {
    const email = normalized(member.email)
    if ((member.preference ?? defaultEmail) && !optedOut.has(email))
      byEmail.set(email, {
        email,
        reviewRequestId: null,
        shareInclude: null,
        shareTokenHash: null,
      })
  }
  for (const reviewer of verifiedReviewers) {
    const email = normalized(reviewer.email)
    if (!optedOut.has(email) && !byEmail.has(email))
      byEmail.set(email, {
        email,
        reviewRequestId: reviewer.reviewRequestId,
        shareInclude: reviewer.shareInclude,
        shareTokenHash: reviewer.shareTokenHash,
      })
  }
  return Promise.all(
    [...byEmail.values()].map(async (recipient) => ({
      ...recipient,
      recipientHash: await recipientHash(recipient.email, scope.id),
    })),
  )
}

async function claimReport(
  db: Db,
  scope: StatusProject,
  env: Env['Bindings'],
  week: Date,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, scope.id),
          eq(projects.workspaceId, scope.workspaceId),
          eq(projects.status, 'in-progress'),
          isNull(projects.deletedAt),
        ),
      )
      .for('no key update')
    if (!project) return null
    const [existing] = await tx
      .select()
      .from(statusReports)
      .where(and(eq(statusReports.projectId, scope.id), eq(statusReports.week, dateOnly(week))))
      .for('update')
    if (existing?.sentAt) return null
    const report = existing
      ? {
          week: existing.week,
          status: existing.status,
          subject: existing.subject,
          body: existing.body,
        }
      : await readReport(tx, scope, week, now, env.WEB_ORIGIN)
    if (!report) return null
    const eligible = await recipients(tx, scope, now)
    const optedOut = new Set(
      (
        await tx
          .select({ recipientHash: emailUnsubscribes.recipientHash })
          .from(emailUnsubscribes)
          .where(
            and(
              eq(emailUnsubscribes.projectId, scope.id),
              isNotNull(emailUnsubscribes.unsubscribedAt),
            ),
          )
      ).map((row) => row.recipientHash),
    )
    const eligibleRecipients = eligible.filter(({ recipientHash }) => !optedOut.has(recipientHash))
    if (!existing && !eligibleRecipients.length) return null
    const [reportRow] = existing
      ? [existing]
      : await tx
          .insert(statusReports)
          .values({ ...report, projectId: scope.id })
          .onConflictDoNothing({ target: [statusReports.projectId, statusReports.week] })
          .returning()
    if (!reportRow) return null
    const expiredClaim = new Date(now.getTime() - 10 * 60_000)
    const retryCutoff = new Date(now.getTime() - 23 * 60 * 60_000)
    const deliveryValues = await Promise.all(
      eligibleRecipients.map(async (recipient) => ({
        reportId: reportRow.id,
        recipientHash: recipient.recipientHash,
        shareInclude: recipient.shareInclude,
        shareTokenHash: recipient.shareTokenHash,
        reviewRequestId: recipient.reviewRequestId,
        report: await (async () => {
          if (!recipient.shareInclude) return report
          const scoped = await readReport(
            tx,
            scope,
            week,
            now,
            env.WEB_ORIGIN,
            recipient.shareInclude,
          )
          if (!scoped) throw new Error('Project report could not be created')
          return scoped
        })(),
        state: 'pending' as const,
      })),
    )
    if (deliveryValues.length)
      await tx
        .insert(statusReportDeliveries)
        .values(deliveryValues)
        .onConflictDoUpdate({
          target: [statusReportDeliveries.reportId, statusReportDeliveries.recipientHash],
          set: {
            shareInclude: sql`excluded.share_include`,
            shareTokenHash: sql`excluded.share_token_hash`,
            reviewRequestId: sql`excluded.review_request_id`,
            report: sql`excluded.report`,
          },
          setWhere: sql`${statusReportDeliveries.state} in ('pending', 'cancelled') OR (${statusReportDeliveries.state} = 'sending' AND ${statusReportDeliveries.claimedAt} < ${expiredClaim})`,
        })
    const eligibleHashes = eligibleRecipients.map(({ recipientHash }) => recipientHash)
    if (eligibleHashes.length)
      await tx
        .update(statusReportDeliveries)
        .set({ state: 'pending', claimedAt: null })
        .where(
          and(
            eq(statusReportDeliveries.reportId, reportRow.id),
            sql`(${statusReportDeliveries.state} = 'cancelled' OR (${statusReportDeliveries.state} = 'sending' AND ${statusReportDeliveries.claimedAt} < ${expiredClaim}))`,
            inArray(statusReportDeliveries.recipientHash, eligibleHashes),
          ),
        )
    if (!eligibleHashes.length)
      await tx
        .update(statusReportDeliveries)
        .set({ state: 'cancelled', claimedAt: null })
        .where(
          and(
            eq(statusReportDeliveries.reportId, reportRow.id),
            sql`(${statusReportDeliveries.state} = 'pending' OR (${statusReportDeliveries.state} = 'sending' AND ${statusReportDeliveries.claimedAt} < ${expiredClaim}))`,
          ),
        )
    else
      await tx
        .update(statusReportDeliveries)
        .set({ state: 'cancelled', claimedAt: null })
        .where(
          and(
            eq(statusReportDeliveries.reportId, reportRow.id),
            sql`(${statusReportDeliveries.state} = 'pending' OR (${statusReportDeliveries.state} = 'sending' AND ${statusReportDeliveries.claimedAt} < ${expiredClaim}))`,
            notInArray(statusReportDeliveries.recipientHash, eligibleHashes),
          ),
        )
    await tx
      .update(statusReportDeliveries)
      .set({ state: 'unknown', claimedAt: null })
      .where(
        and(
          eq(statusReportDeliveries.reportId, reportRow.id),
          sql`((${statusReportDeliveries.state} = 'pending' AND ${statusReportDeliveries.firstAttemptAt} < ${retryCutoff}) OR (${statusReportDeliveries.state} = 'sending' AND ${statusReportDeliveries.claimedAt} < ${expiredClaim} AND ${statusReportDeliveries.firstAttemptAt} < ${retryCutoff}))`,
        ),
      )
    const claimed = await tx
      .update(statusReportDeliveries)
      .set({
        state: 'sending',
        claimedAt: now,
        firstAttemptAt: sql`coalesce(${statusReportDeliveries.firstAttemptAt}, ${now})`,
      })
      .where(
        and(
          eq(statusReportDeliveries.reportId, reportRow.id),
          sql`(${statusReportDeliveries.state} = 'pending' OR (${statusReportDeliveries.state} = 'sending' AND ${statusReportDeliveries.claimedAt} < ${expiredClaim}))`,
        ),
      )
      .returning()
    const byHash = new Map(
      eligibleRecipients.map((recipient) => [recipient.recipientHash, recipient]),
    )
    return {
      id: reportRow.id,
      report,
      recipients: claimed.flatMap((delivery) => {
        const recipient = byHash.get(delivery.recipientHash)
        return recipient
          ? [
              {
                email: recipient.email,
                recipientHash: delivery.recipientHash,
                shareInclude: delivery.shareInclude,
                shareTokenHash: delivery.shareTokenHash,
                reviewRequestId: delivery.reviewRequestId,
                deliveryId: delivery.id,
                report: delivery.report,
              },
            ]
          : []
      }),
    }
  })
}

async function prepareDelivery(
  db: Db,
  scope: StatusProject,
  week: Date,
  env: Env['Bindings'],
  now: Date,
  canonicalReport: StatusReport,
  deliveryId: string,
  recipientHashValue: string,
) {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(statusReportDeliveries)
      .where(eq(statusReportDeliveries.id, deliveryId))
      .for('update')
    if (!delivery || delivery.state !== 'sending') return null
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, scope.id),
          eq(projects.workspaceId, scope.workspaceId),
          eq(projects.status, 'in-progress'),
          isNull(projects.deletedAt),
        ),
      )
    const [unsubscribe] = await tx
      .select({ tokenHash: emailUnsubscribes.tokenHash })
      .from(emailUnsubscribes)
      .where(
        and(
          eq(emailUnsubscribes.projectId, scope.id),
          eq(emailUnsubscribes.recipientHash, recipientHashValue),
          isNotNull(emailUnsubscribes.unsubscribedAt),
        ),
      )
      .limit(1)
    const checkedAt = new Date()
    const recipient = project
      ? (await recipients(tx, scope, checkedAt)).find(
          ({ recipientHash: value }) => value === recipientHashValue,
        )
      : undefined
    if (!recipient || unsubscribe) {
      await tx
        .update(statusReportDeliveries)
        .set({ state: 'cancelled', claimedAt: null })
        .where(eq(statusReportDeliveries.id, deliveryId))
      return null
    }
    const report = recipient.shareInclude
      ? await readReport(tx, scope, week, now, env.WEB_ORIGIN, recipient.shareInclude)
      : canonicalReport
    if (!report) {
      await tx
        .update(statusReportDeliveries)
        .set({ state: 'cancelled', claimedAt: null })
        .where(eq(statusReportDeliveries.id, deliveryId))
      return null
    }
    await tx
      .update(statusReportDeliveries)
      .set({
        shareInclude: recipient.shareInclude,
        shareTokenHash: recipient.shareTokenHash,
        reviewRequestId: recipient.reviewRequestId,
        report,
      })
      .where(eq(statusReportDeliveries.id, deliveryId))
    return { ...recipient, deliveryId, report }
  })
}

export async function runWeeklyStatusEmails(
  db: Db,
  env: Env['Bindings'],
  now: Date,
  pendingOnly = false,
) {
  const end = startOfWeek(now)
  const week = offsetDays(end, -7)
  const jobs = new Map<string, { project: StatusProject; week: Date }>()
  if (!pendingOnly) {
    const active = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(
        and(
          eq(projects.status, 'in-progress'),
          isNull(projects.deletedAt),
          exists(
            db
              .select({ id: activity.id })
              .from(activity)
              .where(
                and(
                  eq(activity.projectId, projects.id),
                  eq(activity.workspaceId, projects.workspaceId),
                  between(activity.createdAt, week, end),
                ),
              ),
          ),
        ),
      )
    for (const project of active) jobs.set(`${project.id}:${dateOnly(week)}`, { project, week })
  }
  const pending = await db
    .select({
      projectId: statusReports.projectId,
      workspaceId: projects.workspaceId,
      week: statusReports.week,
    })
    .from(statusReports)
    .innerJoin(projects, eq(projects.id, statusReports.projectId))
    .where(
      and(
        isNull(statusReports.sentAt),
        // Older weeks are abandoned: a report built from today's data would be misleading.
        gte(statusReports.week, dateOnly(offsetDays(end, -14))),
        eq(projects.status, 'in-progress'),
        isNull(projects.deletedAt),
      ),
    )
  for (const row of pending) {
    const pendingWeek = new Date(`${row.week}T00:00:00Z`)
    jobs.set(`${row.projectId}:${row.week}`, {
      project: { id: row.projectId, workspaceId: row.workspaceId },
      week: pendingWeek,
    })
  }

  for (const { project, week: reportWeek } of jobs.values()) {
    try {
      const claim = await claimReport(db, project, env, reportWeek, now)
      if (!claim) continue
      for (const queuedRecipient of claim.recipients) {
        const recipient = await prepareDelivery(
          db,
          project,
          reportWeek,
          env,
          now,
          claim.report,
          queuedRecipient.deliveryId,
          queuedRecipient.recipientHash,
        )
        if (!recipient) continue
        const { email, recipientHash, shareInclude, deliveryId, report: deliveryReport } = recipient
        const tokenScope = `${recipientHash}:${recipient.reviewRequestId ?? 'member'}`
        const unsubscribeToken = await deliveryToken(
          claim.id,
          tokenScope,
          env.BETTER_AUTH_SECRET,
          'unsubscribe',
        )
        const planToken = shareInclude
          ? await deliveryToken(claim.id, tokenScope, env.BETTER_AUTH_SECRET, 'public-share')
          : null
        await db
          .insert(emailUnsubscribes)
          .values({
            tokenHash: await hash(unsubscribeToken),
            projectId: project.id,
            recipientHash,
            deliveryId,
            shareTokenHash: planToken ? await hash(planToken) : null,
            shareReviewRequestId: planToken ? recipient.reviewRequestId : null,
          })
          .onConflictDoUpdate({
            target: emailUnsubscribes.tokenHash,
            set: {
              deliveryId,
              shareTokenHash: planToken ? await hash(planToken) : null,
              shareReviewRequestId: planToken ? recipient.reviewRequestId : null,
            },
          })
        const report = {
          ...deliveryReport,
          body: {
            ...deliveryReport.body,
            planUrl: shareInclude
              ? new URL(`/share/${planToken}`, env.WEB_ORIGIN).href
              : deliveryReport.body.planUrl,
          },
        }
        const unsubscribeUrl = new URL(
          `${unsubscribePath}/${unsubscribeToken}`,
          env.BETTER_AUTH_URL,
        ).href
        try {
          await sendStatusEmail(
            env,
            {
              to: email,
              subject: report.subject,
              ...renderStatusEmail(report, unsubscribeUrl),
            },
            `weekly-status/${claim.id}/${recipientHash}`,
          )
          await db
            .update(statusReportDeliveries)
            .set({ state: 'sent', sentAt: now, claimedAt: null })
            .where(eq(statusReportDeliveries.id, deliveryId))
        } catch {
          await db
            .update(statusReportDeliveries)
            .set({ state: 'pending', claimedAt: null })
            .where(eq(statusReportDeliveries.id, deliveryId))
          console.error('A weekly status email could not be delivered.')
        }
      }
      const [unfinished] = await db
        .select({ id: statusReportDeliveries.id })
        .from(statusReportDeliveries)
        .where(
          and(
            eq(statusReportDeliveries.reportId, claim.id),
            sql`${statusReportDeliveries.state} in ('pending', 'sending')`,
          ),
        )
        .limit(1)
      if (!unfinished) {
        const sentRows = await db
          .select({ id: statusReportDeliveries.id })
          .from(statusReportDeliveries)
          .where(
            and(
              eq(statusReportDeliveries.reportId, claim.id),
              eq(statusReportDeliveries.state, 'sent'),
            ),
          )
        if (sentRows.length)
          await db
            .update(statusReports)
            .set({ sentAt: now, recipientsCount: sentRows.length })
            .where(and(eq(statusReports.id, claim.id), eq(statusReports.projectId, project.id)))
        else {
          const [attempted] = await db
            .select({ id: statusReportDeliveries.id })
            .from(statusReportDeliveries)
            .where(eq(statusReportDeliveries.reportId, claim.id))
            .limit(1)
          // Every delivery ended cancelled or unknown: finish the report so it is not retried forever.
          // A report with no deliveries stays pending; a later run can re-evaluate eligibility.
          if (attempted)
            await db
              .update(statusReports)
              .set({ sentAt: now, recipientsCount: 0 })
              .where(and(eq(statusReports.id, claim.id), eq(statusReports.projectId, project.id)))
        }
      }
    } catch {
      console.error('A weekly status report could not be processed.')
    }
  }
}

export async function confirmUnsubscribe(db: Db, token: string, submit: boolean) {
  const tokenHash = await hash(token)
  const lookup = async (database: Db) =>
    (
      await database
        .select({ projectId: projects.id, recipientHash: emailUnsubscribes.recipientHash })
        .from(emailUnsubscribes)
        .innerJoin(projects, eq(projects.id, emailUnsubscribes.projectId))
        .where(and(eq(emailUnsubscribes.tokenHash, tokenHash), isNull(projects.deletedAt)))
    )[0]
  const target = await lookup(db)
  if (!target) return false
  const matching = and(
    eq(emailUnsubscribes.projectId, target.projectId),
    eq(emailUnsubscribes.recipientHash, target.recipientHash),
  )
  const alreadyUnsubscribed = async (database: Db) =>
    (
      await database
        .select({ tokenHash: emailUnsubscribes.tokenHash })
        .from(emailUnsubscribes)
        .where(and(matching, isNotNull(emailUnsubscribes.unsubscribedAt)))
        .limit(1)
    ).length > 0
  if (!submit) return !(await alreadyUnsubscribed(db))
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, target.projectId), isNull(projects.deletedAt)))
      .for('no key update')
    if (!project || (await alreadyUnsubscribed(tx))) return false
    const applied = await tx
      .update(emailUnsubscribes)
      .set({ unsubscribedAt: new Date() })
      .where(
        and(
          matching,
          eq(emailUnsubscribes.tokenHash, tokenHash),
          isNull(emailUnsubscribes.unsubscribedAt),
        ),
      )
      .returning({ tokenHash: emailUnsubscribes.tokenHash })
    return applied.length > 0
  })
}
