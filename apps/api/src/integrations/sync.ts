import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type ActivityTx, recordTrackerActivity } from '../activity/service'
import type { Db } from '../db'
import {
  draftChanges,
  drafts,
  externalLinks,
  integrations,
  memberships,
  milestones,
  projects,
  type TrackerStatusMapping,
  tasks,
  user,
  workspaces,
} from '../db/schema'
import type { LinearIssue, LinearProvider } from './linear'
import {
  decryptCredentials,
  encryptCredentials,
  type LinearConfig,
  stableLinearId,
} from './security'

export type Integration = typeof integrations.$inferSelect
export const credentialsContext = (row: Pick<Integration, 'id' | 'workspaceId'>) =>
  `linear:${row.workspaceId}:${row.id}`

export async function lockWorkspace(tx: ActivityTx, workspaceId: string) {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('no key update')
}

export async function memberRole(db: Db, workspaceId: string, userId: string) {
  const [member] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  return member?.role
}

type TaskStatus = typeof tasks.$inferSelect.status
const taskStates = { todo: 'planning', in_progress: 'in_progress', done: 'completed' } as const
function localStatus(
  mapping: TrackerStatusMapping,
  stateId: string | null,
): TaskStatus | undefined {
  if (!stateId) return undefined
  // The task board has no archived column. Canceled issues should not complete a task.
  if (stateId === mapping.archived) return undefined
  return (Object.keys(taskStates) as TaskStatus[]).find(
    (status) => mapping[taskStates[status]] === stateId,
  )
}

const snapshot = z.object({ plan: z.array(z.object({ id: z.uuid() })) })
async function acceptedMilestoneIds(tx: ActivityTx, workspaceId: string) {
  const accepted = await tx
    .select({ snapshot: draftChanges.appliedSnapshot })
    .from(draftChanges)
    .innerJoin(drafts, eq(draftChanges.draftId, drafts.id))
    .innerJoin(projects, eq(drafts.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
        eq(draftChanges.kind, 'milestones'),
        eq(draftChanges.status, 'accepted'),
      ),
    )
  return [
    ...new Set(
      accepted.flatMap((row) => {
        const parsed = snapshot.safeParse(row.snapshot)
        return parsed.success ? parsed.data.plan.map(({ id }) => id) : []
      }),
    ),
  ]
}

async function memberEmails(tx: ActivityTx, workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>()
  const rows = await tx
    .select({ id: user.id, email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(user.id, ids)))
  return new Map(rows.map(({ id, email }) => [id, email.toLowerCase()]))
}

async function pushMilestones(
  tx: ActivityTx,
  integration: Integration,
  teamId: string,
  token: string,
  provider: LinearProvider,
) {
  const ids = await acceptedMilestoneIds(tx, integration.workspaceId)
  if (!ids.length) return
  const rows = await tx
    .select({
      id: milestones.id,
      projectId: projects.id,
      title: milestones.title,
      dueDate: milestones.dueDate,
      leadId: projects.leadId,
      linkId: externalLinks.externalId,
    })
    .from(milestones)
    .innerJoin(projects, eq(milestones.projectId, projects.id))
    .leftJoin(
      externalLinks,
      and(
        eq(externalLinks.milestoneId, milestones.id),
        eq(externalLinks.integrationId, integration.id),
      ),
    )
    .where(
      and(
        eq(projects.workspaceId, integration.workspaceId),
        isNull(projects.deletedAt),
        inArray(milestones.id, ids),
      ),
    )
  const taskRows = await tx
    .select({ task: tasks, linkId: externalLinks.externalId })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(
      externalLinks,
      and(eq(externalLinks.taskId, tasks.id), eq(externalLinks.integrationId, integration.id)),
    )
    .where(
      and(
        eq(projects.workspaceId, integration.workspaceId),
        isNull(projects.deletedAt),
        inArray(tasks.milestoneId, ids),
      ),
    )
  if (!rows.length) return
  const localPeople = await memberEmails(tx, integration.workspaceId, [
    ...new Set(
      [...rows.map((row) => row.leadId), ...taskRows.map(({ task }) => task.assigneeId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ])
  const remotePeople = await provider.users(token, [...localPeople.values()])
  const linearUser = (id: string | null) =>
    id ? (remotePeople.get(localPeople.get(id) ?? '') ?? null) : null

  const milestoneLinks = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      externalId:
        row.linkId ?? (await stableLinearId(integration.workspaceId, teamId, 'milestone', row.id)),
    })),
  )
  const remoteProjects = await provider.projectsInTeam(
    token,
    teamId,
    milestoneLinks.map((row) => row.externalId),
  )
  const remoteProjectById = new Map(remoteProjects.map((row) => [row.id, row]))
  const externalByMilestone = new Map<string, string>()
  for (const row of milestoneLinks) {
    const remote = remoteProjectById.get(row.externalId)
    const target = {
      id: row.externalId,
      name: row.title,
      targetDate: row.dueDate,
      leadId: linearUser(row.leadId),
    }
    if (
      !remote ||
      remote.name !== target.name ||
      remote.targetDate !== target.targetDate ||
      remote.leadId !== target.leadId
    )
      await provider.putProject(token, teamId, target, Boolean(remote))
    if (!row.linkId)
      await tx.insert(externalLinks).values({
        integrationId: integration.id,
        milestoneId: row.id,
        externalId: row.externalId,
        source: 'pushed',
      })
    externalByMilestone.set(row.id, row.externalId)
  }

  const taskLinks = await Promise.all(
    taskRows.map(async (row) => ({
      ...row,
      externalId:
        row.linkId ?? (await stableLinearId(integration.workspaceId, teamId, 'task', row.task.id)),
    })),
  )
  const remoteIssues = await provider.issuesInTeam(
    token,
    teamId,
    [],
    taskLinks.map((row) => row.externalId),
  )
  const remoteIssueById = new Map(remoteIssues.map((row) => [row.id, row]))
  for (const row of taskLinks) {
    const { task } = row
    const projectId = task.milestoneId ? externalByMilestone.get(task.milestoneId) : undefined
    if (!projectId) continue
    const remote = remoteIssueById.get(row.externalId)
    const mappedState = integration.statusMapping[taskStates[task.status]]
    const target = {
      id: row.externalId,
      title: task.title,
      description: task.description || null,
      dueDate: task.dueDate,
      projectId,
      assigneeId: linearUser(task.assigneeId),
      ...(!remote && mappedState ? { stateId: mappedState } : {}),
    }
    if (
      !remote ||
      remote.title !== target.title ||
      remote.description !== target.description ||
      remote.dueDate !== target.dueDate ||
      remote.projectId !== target.projectId ||
      remote.assigneeId !== target.assigneeId
    )
      await provider.putIssue(token, teamId, target, Boolean(remote))
    if (!row.linkId)
      await tx.insert(externalLinks).values({
        integrationId: integration.id,
        taskId: task.id,
        externalId: row.externalId,
        source: 'pushed',
      })
  }
}

async function nextPosition(tx: ActivityTx, projectId: string, status: TaskStatus) {
  const [last] = await tx
    .select({ next: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)))
  return Number(last?.next ?? 0)
}

async function pullStatus(
  tx: ActivityTx,
  integration: Integration,
  issue: LinearIssue,
  task: {
    id: string
    title: string
    status: TaskStatus
    projectId: string
    projectKey: string
    number: number
  },
) {
  const next = localStatus(integration.statusMapping, issue.stateId)
  if (!next || task.status === next) return
  const timestamp = new Date()
  await tx
    .update(tasks)
    .set({
      status: next,
      position: await nextPosition(tx, task.projectId, next),
      updatedAt: timestamp,
    })
    .where(and(eq(tasks.id, task.id), eq(tasks.projectId, task.projectId)))
  await recordTrackerActivity(tx, integration.id, {
    projectId: task.projectId,
    type: 'task.status_changed',
    subject: task.id,
    payload: {
      taskKey: `${task.projectKey}-${task.number}`,
      title: task.title,
      before: task.status,
      after: next,
    },
  })
}

async function importIssue(
  tx: ActivityTx,
  integration: Integration,
  teamId: string,
  issue: LinearIssue,
  projectId: string,
  projectKey: string,
) {
  if (issue.stateId && issue.stateId === integration.statusMapping.archived) return
  const id = await stableLinearId(integration.workspaceId, teamId, 'imported', issue.id)
  const [existing] = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      number: tasks.number,
      projectId: projects.id,
      projectKey: projects.key,
      deletedAt: projects.deletedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, id), eq(projects.workspaceId, integration.workspaceId)))
  if (existing?.deletedAt) return
  if (existing && integration.options.pullStatus) await pullStatus(tx, integration, issue, existing)
  if (!existing) {
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${tasks.number}), 0)` })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
    const status = localStatus(integration.statusMapping, issue.stateId) ?? 'todo'
    const number = Number(last?.max ?? 0) + 1
    const title = issue.title.trim().slice(0, 200) || 'Untitled Linear issue'
    await tx.insert(tasks).values({
      id,
      projectId,
      number,
      title,
      description: issue.description?.trim().slice(0, 10_000) ?? '',
      status,
      dueDate: issue.dueDate,
      position: await nextPosition(tx, projectId, status),
    })
    await recordTrackerActivity(tx, integration.id, {
      projectId,
      type: 'task.created',
      subject: id,
      payload: {
        taskKey: `${projectKey}-${number}`,
        title,
        before: null,
        after: {
          status,
          priority: 'medium',
          assigneeId: null,
          dueDate: issue.dueDate,
          milestoneId: null,
        },
      },
    })
  }
  await tx
    .insert(externalLinks)
    .values({ integrationId: integration.id, taskId: id, externalId: issue.id, source: 'imported' })
}

async function pullIssues(
  tx: ActivityTx,
  integration: Integration,
  teamId: string,
  token: string,
  provider: LinearProvider,
  issueId?: string,
) {
  if (!integration.options.pullStatus && !integration.options.importIssues) return
  const signedIssue = issueId
    ? (await provider.issuesInTeam(token, teamId, [], [issueId])).find(
        (issue) => issue.id === issueId,
      )
    : undefined
  if (issueId && !signedIssue) return
  const localTaskLinks = await tx
    .select({
      externalId: externalLinks.externalId,
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      number: tasks.number,
      projectId: projects.id,
      projectKey: projects.key,
    })
    .from(externalLinks)
    .innerJoin(tasks, eq(externalLinks.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(externalLinks.integrationId, integration.id),
        issueId ? eq(externalLinks.externalId, issueId) : undefined,
        eq(projects.workspaceId, integration.workspaceId),
        isNull(projects.deletedAt),
      ),
    )
  const localMilestoneLinks =
    integration.options.importIssues && (!issueId || signedIssue?.projectId)
      ? await tx
          .select({
            externalId: externalLinks.externalId,
            projectId: projects.id,
            projectKey: projects.key,
          })
          .from(externalLinks)
          .innerJoin(milestones, eq(externalLinks.milestoneId, milestones.id))
          .innerJoin(projects, eq(milestones.projectId, projects.id))
          .where(
            and(
              eq(externalLinks.integrationId, integration.id),
              signedIssue?.projectId
                ? eq(externalLinks.externalId, signedIssue.projectId)
                : undefined,
              eq(projects.workspaceId, integration.workspaceId),
              isNull(projects.deletedAt),
            ),
          )
      : []
  const linkedTasks = new Map(localTaskLinks.map((link) => [link.externalId, link]))
  const linkedMilestones = new Map(localMilestoneLinks.map((link) => [link.externalId, link]))
  const issues = signedIssue
    ? [signedIssue]
    : await provider.issuesInTeam(
        token,
        teamId,
        [...linkedMilestones.keys()],
        integration.options.pullStatus ? [...linkedTasks.keys()] : [],
      )
  for (const issue of issues) {
    const task = linkedTasks.get(issue.id)
    if (task) {
      if (integration.options.pullStatus) await pullStatus(tx, integration, issue, task)
      continue
    }
    const project = issue.projectId ? linkedMilestones.get(issue.projectId) : undefined
    if (project)
      await importIssue(tx, integration, teamId, issue, project.projectId, project.projectKey)
  }
}

export const webhookFreshness = 60_000
export type WebhookReceipt = { key: string; timestamp: number; issueId: string; teamId?: string }
type SyncInput = {
  id: string
  workspaceId: string
  config: LinearConfig
  provider: LinearProvider
  actorId?: string
  receipt?: WebhookReceipt
  organizationId?: string
}
export async function runIntegrationSync(
  db: Db,
  { id, workspaceId, config, provider, actorId, receipt, organizationId }: SyncInput,
) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId)
    if (actorId) {
      const role = await memberRole(tx, workspaceId, actorId)
      if (role !== 'owner')
        return role ? { kind: 'forbidden' as const } : { kind: 'missing' as const }
    }
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.id, id),
          eq(integrations.workspaceId, workspaceId),
          organizationId ? eq(integrations.organizationId, organizationId) : undefined,
        ),
      )
      .for('no key update')
    if (!integration?.encryptedCredentials || !integration.teamId)
      return { kind: 'missing' as const }
    const { teamId } = integration
    const now = Date.now()
    if (
      receipt &&
      (receipt.timestamp + webhookFreshness < now || (receipt.teamId && receipt.teamId !== teamId))
    )
      return { kind: 'ignored' as const }
    const receipts = Object.fromEntries(
      Object.entries(integration.webhookReceipts).filter(([, expires]) => expires >= now),
    )
    if (receipt && receipts[receipt.key] !== undefined) return { kind: 'replayed' as const }
    if (receipt && Object.keys(receipts).length >= 512) return { kind: 'limited' as const }
    const context = credentialsContext(integration)
    try {
      let credentials = await decryptCredentials(
        config.encryptionKey,
        context,
        integration.encryptedCredentials,
      )
      if (credentials.expiresAt < now + 300_000 && credentials.refreshToken) {
        credentials = await provider.refresh(credentials.refreshToken)
        await tx
          .update(integrations)
          .set({
            encryptedCredentials: await encryptCredentials(
              config.encryptionKey,
              context,
              credentials,
            ),
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, id))
      }
      // Roll back local domain writes and the receipt together, while keeping any
      // rotated OAuth credentials even if a later Linear API call fails.
      return await tx.transaction(async (sync) => {
        if (!receipt && integration.options.pushMilestones)
          await pushMilestones(sync, integration, teamId, credentials.accessToken, provider)
        await pullIssues(
          sync,
          integration,
          teamId,
          credentials.accessToken,
          provider,
          receipt?.issueId,
        )
        if (receipt) receipts[receipt.key] = receipt.timestamp + webhookFreshness
        const [saved] = await sync
          .update(integrations)
          .set({
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
            webhookReceipts: receipts,
          })
          .where(eq(integrations.id, id))
          .returning()
        return saved
          ? { kind: 'synced' as const, integration: saved }
          : { kind: 'missing' as const }
      })
    } catch {
      return { kind: 'failed' as const }
    }
  })
}

export async function runDailyTrackerSync(db: Db, config: LinearConfig, provider: LinearProvider) {
  const rows = await db
    .select({ id: integrations.id, workspaceId: integrations.workspaceId })
    .from(integrations)
    .where(and(eq(integrations.provider, 'linear'), isNotNull(integrations.encryptedCredentials)))
  for (const row of rows) {
    // A failing connection can retry on the next sync without blocking other workspaces.
    await runIntegrationSync(db, { ...row, config, provider }).catch(() => undefined)
  }
}
