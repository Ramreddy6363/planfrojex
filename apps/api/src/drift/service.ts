import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { type ActivityTx, recordActivity } from '../activity/service'
import type { Db } from '../db'
import {
  decisions,
  draftChanges,
  drafts,
  driftReports,
  externalLinks,
  integrations,
  memberships,
  milestones,
  projects,
  risks,
  tasks,
  user,
} from '../db/schema'
import {
  currentSnapshot,
  currentTaskMilestones,
  recordMilestoneTaskChanges,
} from '../drafts/routes'
import { type DriftFinding, evaluateDrift, findingsFingerprint, type ProposedChange } from './rules'

type Scope = { projectId: string; workspaceId: string }
type Report = typeof driftReports.$inferSelect
type Change = typeof draftChanges.$inferSelect
type Connection = { id: string; destination: string }

export type DriftAction =
  | { action: 'check' }
  | { action: 'dismiss'; reportId: string }
  | { action: 'accept'; reportId: string; reason?: string }
  | {
      action: 'accept_change' | 'reject_change'
      reportId: string
      changeId: string
      reason?: string
    }

export class StaleDriftReport extends Error {}

async function connection(db: Db, workspaceId: string, lock = false): Promise<Connection | null> {
  const query = db
    .select({
      id: integrations.id,
      teamId: integrations.teamId,
    })
    .from(integrations)
    .where(
      and(
        eq(integrations.workspaceId, workspaceId),
        eq(integrations.provider, 'linear'),
        isNotNull(integrations.encryptedCredentials),
        isNotNull(integrations.teamId),
      ),
    )
  const [row] = await (lock ? query.for('share') : query)
  return row ? { id: row.id, destination: `${row.id}:${row.teamId}` } : null
}

export const lockDriftConnection = (tx: ActivityTx, workspaceId: string) =>
  connection(tx, workspaceId, true)

function visibleFindings(report: Report, destination: string | null) {
  return destination && destination === report.linearDestination
    ? report.findings
    : report.findings.filter(({ kind }) => kind !== 'linear_tasks')
}

function changeIsVisible(row: Change, report: Report, destination: string | null) {
  return (
    proposed(row).kind !== 'milestone_tasks' ||
    (destination && destination === report.linearDestination)
  )
}

async function latestReport(db: Db, { projectId }: Scope) {
  const [row] = await db
    .select()
    .from(driftReports)
    .where(eq(driftReports.projectId, projectId))
    .orderBy(desc(driftReports.createdAt), desc(driftReports.id))
    .limit(1)
  return row
}

async function draftRows(db: Db, report: Report) {
  if (!report.draftId) return []
  return db
    .select()
    .from(draftChanges)
    .where(eq(draftChanges.draftId, report.draftId))
    .orderBy(draftChanges.createdAt, draftChanges.driftKey)
}

function keyFor(change: ProposedChange) {
  const order = { milestone_date: 1, milestone_tasks: 2, risk_severity: 3 }
  return `${order[change.kind]}:${change.targetId}`
}

function proposed(row: Change) {
  return row.after as ProposedChange
}

function publicChange(row: Change) {
  const change = proposed(row)
  const common = { id: row.id, status: row.status, code: change.code, title: change.title }
  switch (change.kind) {
    case 'milestone_date':
      return { ...common, kind: change.kind, before: change.before, after: change.after }
    case 'milestone_tasks':
      return { ...common, kind: change.kind, tasks: change.tasks }
    case 'risk_severity':
      return {
        ...common,
        kind: change.kind,
        before: change.before,
        after: change.after,
        ownerName: change.ownerName,
      }
  }
}

export async function readDrift(db: Db, scope: Scope, canManage: boolean) {
  const connected = await connection(db, scope.workspaceId)
  const report = await latestReport(db, scope)
  const base = { linearConnected: Boolean(connected), canManage }
  if (report?.status !== 'open') return { ...base, report: null }
  const destination = connected?.destination ?? null
  const appliesToLinear = Boolean(connected && connected.destination === report.linearDestination)
  const findings = visibleFindings(report, destination)
  if (!findings.length) return { ...base, report: null }
  const changes = (await draftRows(db, report))
    .filter((row) => changeIsVisible(row, report, destination))
    .map(publicChange)
  return {
    ...base,
    report: {
      id: report.id,
      checkedAt: report.checkedAt.toISOString(),
      checkedAgainstLinearAt: appliesToLinear
        ? (report.checkedAgainstLinearAt?.toISOString() ?? null)
        : null,
      findings,
      changes,
    },
  }
}

async function driftFacts(tx: ActivityTx, { projectId, workspaceId }: Scope) {
  const linear = await connection(tx, workspaceId)
  const milestoneRows = await tx
    .select({
      id: milestones.id,
      code: milestones.code,
      title: milestones.title,
      status: milestones.status,
      dueDate: milestones.dueDate,
      done: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')`.mapWith(Number),
      total: sql<number>`count(${tasks.id})`.mapWith(Number),
    })
    .from(milestones)
    .leftJoin(tasks, and(eq(tasks.milestoneId, milestones.id), eq(tasks.projectId, projectId)))
    .where(eq(milestones.projectId, projectId))
    .groupBy(milestones.id)

  const riskRows = await tx
    .select({
      id: risks.id,
      code: risks.code,
      title: risks.title,
      severity: risks.severity,
      decideBy: risks.decideBy,
      ownerName: user.name,
    })
    .from(risks)
    .leftJoin(
      memberships,
      and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, risks.ownerId)),
    )
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(eq(risks.projectId, projectId))

  const importedTasks = linear
    ? await tx
        .select({
          id: tasks.id,
          key: sql<string>`${projects.key} || '-' || ${tasks.number}::text`,
          title: tasks.title,
          milestoneId: tasks.milestoneId,
          sourceMilestoneId: externalLinks.sourceMilestoneId,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(
          externalLinks,
          and(eq(externalLinks.taskId, tasks.id), eq(externalLinks.source, 'imported')),
        )
        .innerJoin(
          integrations,
          and(
            eq(integrations.id, externalLinks.integrationId),
            eq(integrations.workspaceId, workspaceId),
            eq(integrations.provider, 'linear'),
            isNotNull(integrations.encryptedCredentials),
          ),
        )
        .where(
          and(
            eq(tasks.projectId, projectId),
            eq(projects.workspaceId, workspaceId),
            isNull(tasks.milestoneId),
          ),
        )
    : []
  return {
    milestones: milestoneRows,
    risks: riskRows,
    importedTasks,
    linearConnected: Boolean(linear),
    linear,
  }
}

async function projectLinearSyncTime(tx: ActivityTx, projectId: string, integrationId: string) {
  const [latest] = await tx
    .select({ at: externalLinks.updatedAt })
    .from(externalLinks)
    .leftJoin(tasks, and(eq(tasks.id, externalLinks.taskId), eq(tasks.projectId, projectId)))
    .leftJoin(
      milestones,
      and(eq(milestones.id, externalLinks.milestoneId), eq(milestones.projectId, projectId)),
    )
    .where(
      and(
        eq(externalLinks.integrationId, integrationId),
        or(isNotNull(tasks.id), isNotNull(milestones.id)),
      ),
    )
    .orderBy(desc(externalLinks.updatedAt))
    .limit(1)
  return latest?.at ?? null
}

export async function lockDriftProject(tx: ActivityTx, scope: Scope) {
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.workspaceId, scope.workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .for('no key update')
  return Boolean(project)
}

export async function checkDrift(tx: ActivityTx, scope: Scope, actorId?: string) {
  const now = new Date()
  const facts = await driftFacts(tx, scope)
  const { findings, changes } = evaluateDrift(facts, now)
  const fingerprint = findingsFingerprint(findings)
  const linearFields = {
    checkedAt: now,
    checkedAgainstLinearAt: facts.linear
      ? await projectLinearSyncTime(tx, scope.projectId, facts.linear.id)
      : null,
    linearDestination: facts.linear?.destination ?? null,
  }
  const previous = await latestReport(tx, scope)
  let suggestions = changes
  const changedDestination =
    previous?.status === 'open' &&
    previous.linearDestination !== linearFields.linearDestination &&
    findings.some(({ kind }) => kind === 'linear_tasks')
  if (previous?.fingerprint === fingerprint && !changedDestination) {
    const rows = previous.status === 'open' ? await draftRows(tx, previous) : []
    const reviewed = new Set(
      rows.filter((row) => row.status !== 'pending').map((row) => row.driftKey),
    )
    suggestions = changes.filter((change) => !reviewed.has(keyFor(change)))
    const pending = rows.filter((row) => row.status === 'pending')
    const byKey = new Map(suggestions.map((change) => [keyFor(change), change]))
    if (
      previous.status !== 'open' ||
      (pending.length === suggestions.length &&
        pending.every((row) => stillApplies(proposed(row), byKey.get(row.driftKey))))
    ) {
      await tx
        .update(driftReports)
        .set({ ...linearFields, ...(previous.status === 'open' ? { findings } : {}) })
        .where(and(eq(driftReports.id, previous.id), eq(driftReports.projectId, scope.projectId)))
      return
    }
  }
  if (previous?.status === 'open')
    await tx
      .update(driftReports)
      .set({ status: 'dismissed' })
      .where(and(eq(driftReports.id, previous.id), eq(driftReports.projectId, scope.projectId)))
  if (!findings.length && !previous) return
  let draftId: string | null = null
  if (suggestions.length) {
    const [draft] = await tx
      .insert(drafts)
      .values({
        projectId: scope.projectId,
        kind: 'drift',
        status: 'ready',
        model: 'rules',
        createdBy: actorId,
      })
      .returning({ id: drafts.id })
    if (!draft) throw new Error('Drift draft could not be stored')
    draftId = draft.id
    await tx.insert(draftChanges).values(
      suggestions.map((change) => ({
        draftId: draft.id,
        kind: change.kind === 'risk_severity' ? ('risks' as const) : ('milestones' as const),
        driftKey: keyFor(change),
        before: change.kind === 'milestone_tasks' ? null : change.before,
        after: change,
      })),
    )
  }
  await tx.insert(driftReports).values({
    ...linearFields,
    projectId: scope.projectId,
    draftId,
    fingerprint,
    findings,
    status: findings.length ? 'open' : 'dismissed',
  })
}

function stillApplies(change: ProposedChange, current: ProposedChange | undefined) {
  if (change.kind === 'milestone_date' && current?.kind === 'milestone_date')
    return change.before === current.before && change.after === current.after
  if (change.kind === 'risk_severity' && current?.kind === 'risk_severity')
    return change.before === current.before && change.decideBy === current.decideBy
  if (change.kind === 'milestone_tasks' && current?.kind === 'milestone_tasks')
    return (
      change.tasks.map(({ id }) => id).join(',') === current.tasks.map(({ id }) => id).join(',')
    )
  return false
}

async function applySuggestion(tx: ActivityTx, scope: Scope, change: ProposedChange, now: Date) {
  if (change.kind === 'milestone_date') {
    await tx
      .update(milestones)
      .set({ dueDate: change.after, updatedAt: now })
      .where(and(eq(milestones.id, change.targetId), eq(milestones.projectId, scope.projectId)))
  } else if (change.kind === 'risk_severity') {
    await tx
      .update(risks)
      .set({ severity: change.after, updatedAt: now })
      .where(and(eq(risks.id, change.targetId), eq(risks.projectId, scope.projectId)))
  } else {
    await tx
      .update(tasks)
      .set({ milestoneId: change.targetId, updatedAt: now })
      .where(
        and(
          eq(tasks.projectId, scope.projectId),
          inArray(
            tasks.id,
            change.tasks.map(({ id }) => id),
          ),
          isNull(tasks.milestoneId),
        ),
      )
  }
}

async function recordDriftDecision(
  tx: ActivityTx,
  scope: Scope,
  actorId: string,
  row: Change,
  accepted: boolean,
  reason: string | null,
  now: Date,
) {
  let before = row.before
  let appliedSnapshot: unknown = null
  if (accepted) {
    before = await currentSnapshot(tx, scope.projectId, row.kind)
    const beforeTasks =
      row.kind === 'milestones' ? await currentTaskMilestones(tx, scope.projectId) : null
    await applySuggestion(tx, scope, proposed(row), now)
    const after = await currentSnapshot(tx, scope.projectId, row.kind)
    const afterTasks = beforeTasks ? await currentTaskMilestones(tx, scope.projectId) : null
    appliedSnapshot =
      beforeTasks && afterTasks
        ? { plan: after, taskMilestones: afterTasks, beforeTaskMilestones: beforeTasks }
        : after
    if (beforeTasks && afterTasks)
      await recordMilestoneTaskChanges(
        tx,
        scope.workspaceId,
        scope.projectId,
        actorId,
        beforeTasks,
        afterTasks,
        [before, after],
      )
  }

  const outcome = accepted ? 'accepted' : 'rejected'
  const [decision] = await tx
    .insert(decisions)
    .values({
      projectId: scope.projectId,
      draftChangeId: row.id,
      actorId,
      kind: row.kind,
      outcome,
      reason,
    })
    .returning({ id: decisions.id })
  await tx
    .update(draftChanges)
    .set({ status: outcome, before, appliedSnapshot, updatedAt: now })
    .where(and(eq(draftChanges.id, row.id), eq(draftChanges.draftId, row.draftId)))
  await recordActivity(tx, {
    ...scope,
    actorId,
    type: accepted ? 'draft.accepted' : 'draft.rejected',
    subject: row.id,
    payload: { section: row.kind, before: 'pending', after: outcome, decisionId: decision?.id },
  })
}

// Advance the baseline only for findings affected by the accepted changes.
function remainingFindings(
  previous: DriftFinding[],
  current: DriftFinding[],
  accepted: ProposedChange[],
): DriftFinding[] {
  const moved = new Set(
    accepted.filter((change) => change.kind === 'milestone_date').map((change) => change.targetId),
  )
  const assignments = accepted.filter((change) => change.kind === 'milestone_tasks')
  const grouped = new Set(assignments.map((change) => change.targetId))
  const assigned = new Set(assignments.flatMap((change) => change.tasks.map((task) => task.id)))
  return previous.flatMap<DriftFinding>((finding) => {
    if (finding.kind === 'milestone_late') {
      if (moved.has(finding.milestoneId)) return []
      if (grouped.has(finding.milestoneId)) {
        const updated = current.find(
          (item) =>
            item.kind === 'milestone_late' &&
            item.milestoneId === finding.milestoneId &&
            item.dueDate === finding.dueDate,
        )
        if (updated) return [updated]
      }
    }
    if (finding.kind === 'linear_tasks') {
      const remaining = finding.tasks.filter(({ id }) => !assigned.has(id))
      return remaining.length ? [{ ...finding, tasks: remaining }] : []
    }
    return [finding]
  })
}

export async function reviewDrift(
  tx: ActivityTx,
  scope: Scope,
  actorId: string,
  action: Exclude<DriftAction, { action: 'check' }>,
  destination: string | null,
) {
  const report = await latestReport(tx, scope)
  if (report?.id !== action.reportId || report.status !== 'open') throw new StaleDriftReport()
  const findings = visibleFindings(report, destination)
  if (!findings.length) throw new StaleDriftReport()
  const reportWhere = and(
    eq(driftReports.id, report.id),
    eq(driftReports.projectId, scope.projectId),
  )
  if (action.action === 'dismiss') {
    await tx
      .update(driftReports)
      .set({ status: 'dismissed', findings, fingerprint: findingsFingerprint(findings) })
      .where(reportWhere)
    return
  }

  const rows = await draftRows(tx, report)
  const pending = rows.filter(
    (row) => row.status === 'pending' && changeIsVisible(row, report, destination),
  )
  const selected =
    action.action === 'accept' ? pending : pending.filter((row) => row.id === action.changeId)
  if (!selected.length) throw new StaleDriftReport()
  const accepted = action.action !== 'reject_change'
  const now = new Date()
  if (accepted) {
    const current = evaluateDrift(await driftFacts(tx, scope), now)
    const proposals = new Map(current.changes.map((change) => [keyFor(change), change]))
    for (const row of selected) {
      if (!stillApplies(proposed(row), proposals.get(row.driftKey))) throw new StaleDriftReport()
    }
  }
  for (const row of selected)
    await recordDriftDecision(tx, scope, actorId, row, accepted, action.reason || null, now)
  if (accepted)
    await tx
      .update(projects)
      .set({ planUpdatedAt: now, planUpdatedBy: actorId })
      .where(and(eq(projects.id, scope.projectId), eq(projects.workspaceId, scope.workspaceId)))

  const complete = selected.length === pending.length
  const remaining = accepted
    ? remainingFindings(
        findings,
        evaluateDrift(await driftFacts(tx, scope), now).findings,
        selected.map(proposed),
      )
    : findings
  await tx
    .update(driftReports)
    .set({
      status: complete
        ? accepted || rows.some((row) => row.status === 'accepted')
          ? 'accepted'
          : 'dismissed'
        : 'open',
      findings: remaining,
      fingerprint: findingsFingerprint(remaining),
    })
    .where(reportWhere)
}

export async function runDriftChecks(db: Db, workspaceId?: string, projectIds?: string[]) {
  if (projectIds?.length === 0) return
  const scopes = await db
    .select({ projectId: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(
      and(
        isNull(projects.deletedAt),
        workspaceId ? eq(projects.workspaceId, workspaceId) : undefined,
        projectIds ? inArray(projects.id, projectIds) : undefined,
      ),
    )
    .orderBy(projects.id)
  for (const scope of scopes) {
    try {
      await db.transaction(async (tx) => {
        if (await lockDriftProject(tx, scope)) await checkDrift(tx, scope)
      })
    } catch {
      // Isolate a failed report so other projects are still checked on this run.
      console.error('A project drift check failed.')
    }
  }
}
