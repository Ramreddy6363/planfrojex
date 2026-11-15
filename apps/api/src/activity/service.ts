import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import {
  activity,
  comments,
  decisions,
  draftChanges,
  drafts,
  memberships,
  notificationSettings,
  notifications,
  projects,
} from '../db/schema'
import type { DatabaseFactory } from '../workspaces/permissions'

type Db = ReturnType<DatabaseFactory>
export type ActivityTx = Parameters<Parameters<Db['transaction']>[0]>[0]
export const activityTypes = [
  'project.status_changed',
  'project.lead_changed',
  'project.target_date_changed',
  'project.name_changed',
  'project.brief_edited',
  'task.created',
  'task.status_changed',
  'task.assignee_changed',
  'task.priority_changed',
  'task.due_date_changed',
  'task.milestone_changed',
  'task.deleted',
  'comment.added',
  'comment.mentioned',
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
  'diagram.created',
  'diagram.version_saved',
  'diagram.restored',
  'diagram.draft_accepted',
  'diagram.deleted',
] as const
export type ActivityType = (typeof activityTypes)[number]
export const activityCategories = ['comments', 'tasks', 'plan', 'diagrams', 'project'] as const
export type ActivityCategory = (typeof activityCategories)[number]
export function categoryFor(type: string): ActivityCategory {
  if (type.startsWith('comment.')) return 'comments'
  if (type.startsWith('task.')) return 'tasks'
  if (type.startsWith('diagram.')) return 'diagrams'
  if (type.startsWith('project.')) return 'project'
  return 'plan'
}
// All callers pass the transaction doing the domain write. Derive the inserted
// workspace from this actor's membership, rather than trusting a supplied id.
export async function recordActivity(
  tx: ActivityTx,
  input: {
    workspaceId: string
    projectId: string
    actorId: string
    type: ActivityType
    subject: string | null
    payload: Record<string, unknown>
  },
) {
  const [member] = await tx
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .innerJoin(projects, eq(projects.workspaceId, memberships.workspaceId))
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(memberships.workspaceId, input.workspaceId),
        eq(memberships.userId, input.actorId),
      ),
    )
    .for('key share', { of: memberships })
  if (!member) throw new Error('Activity actor is no longer a workspace member')
  const [row] = await tx
    .insert(activity)
    .values({
      workspaceId: member.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      type: input.type,
      subject: input.subject,
      payload: input.payload,
    })
    .returning()
  if (row) await createNotifications(tx, row, input.actorId)
}

// Notification fan-out always runs in the domain transaction through activity.
async function createNotifications(
  tx: ActivityTx,
  event: typeof activity.$inferSelect,
  actorId: string,
) {
  const recipients = new Map<string, 'mention' | 'assigned' | 'reply' | 'draft_decision'>()
  if (['comment.added', 'comment.mentioned'].includes(event.type) && event.subject) {
    const [comment] = await tx
      .select()
      .from(comments)
      .innerJoin(projects, eq(projects.id, comments.projectId))
      .where(and(eq(comments.id, event.subject), eq(projects.workspaceId, event.workspaceId)))
    if (!comment) return
    const value = comment.comments
    if (event.type === 'comment.added') {
      const participants = await tx
        .selectDistinct({ id: comments.authorId })
        .from(comments)
        .innerJoin(projects, eq(projects.id, comments.projectId))
        .where(
          and(
            eq(projects.workspaceId, event.workspaceId),
            eq(comments.projectId, event.projectId),
            eq(comments.target, value.target),
            value.taskId ? eq(comments.taskId, value.taskId) : isNull(comments.taskId),
            ne(comments.id, value.id),
          ),
        )
      for (const person of participants) if (person.id) recipients.set(person.id, 'reply')
    }
    const mentioned =
      event.type === 'comment.mentioned' && Array.isArray(event.payload.mentionedUserIds)
        ? event.payload.mentionedUserIds.filter((id): id is string => typeof id === 'string')
        : value.mentions
    for (const id of mentioned) recipients.set(id, 'mention')
  } else if (event.type === 'task.assignee_changed') {
    if (typeof event.payload.after === 'string') recipients.set(event.payload.after, 'assigned')
  } else if (event.type === 'task.created') {
    const after = event.payload.after as { assigneeId?: unknown } | undefined
    if (typeof after?.assigneeId === 'string') recipients.set(after.assigneeId, 'assigned')
  } else if (
    ['draft.accepted', 'draft.rejected', 'draft.accepted_all', 'diagram.draft_accepted'].includes(
      event.type,
    )
  ) {
    const ids = Array.isArray(event.payload.decisionIds)
      ? event.payload.decisionIds
      : [event.payload.decisionId]
    const validIds = ids.filter((id): id is string => typeof id === 'string')
    if (validIds.length) {
      const starters = await tx
        .selectDistinct({ id: drafts.createdBy })
        .from(decisions)
        .innerJoin(draftChanges, eq(draftChanges.id, decisions.draftChangeId))
        .innerJoin(drafts, eq(drafts.id, draftChanges.draftId))
        .innerJoin(projects, eq(projects.id, drafts.projectId))
        .where(
          and(
            inArray(decisions.id, validIds),
            eq(projects.workspaceId, event.workspaceId),
            eq(projects.id, event.projectId),
          ),
        )
      for (const starter of starters) if (starter.id) recipients.set(starter.id, 'draft_decision')
    }
  }
  recipients.delete(actorId)
  if (!recipients.size) return
  const members = await tx
    .select({ id: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, event.workspaceId),
        inArray(memberships.userId, [...recipients.keys()]),
      ),
    )
    .for('key share')
  for (const person of members) {
    const type = recipients.get(person.id)
    if (!type) continue
    const settingType =
      type === 'reply' ? 'mention' : type === 'draft_decision' ? 'draft_ready' : type
    const [setting] = await tx
      .select({ inApp: notificationSettings.inApp })
      .from(notificationSettings)
      .where(
        and(eq(notificationSettings.userId, person.id), eq(notificationSettings.type, settingType)),
      )
    if (setting?.inApp === false) continue
    if (type === 'mention') {
      const existing = await tx
        .select({ id: notifications.id, type: notifications.type })
        .from(notifications)
        .innerJoin(activity, eq(activity.id, notifications.activityId))
        .where(
          and(
            eq(notifications.userId, person.id),
            eq(notifications.workspaceId, event.workspaceId),
            eq(activity.workspaceId, event.workspaceId),
            eq(activity.subject, event.subject ?? ''),
            inArray(notifications.type, ['mention', 'reply']),
          ),
        )
      if (existing.some((row) => row.type === 'mention')) continue
      const replies = existing.filter((row) => row.type === 'reply').map((row) => row.id)
      if (replies.length)
        await tx
          .delete(notifications)
          .where(
            and(
              eq(notifications.workspaceId, event.workspaceId),
              inArray(notifications.id, replies),
            ),
          )
    }
    await tx
      .insert(notifications)
      .values({ userId: person.id, workspaceId: event.workspaceId, activityId: event.id, type })
      .onConflictDoNothing()
  }
}

export async function refreshCommentMentions(
  tx: ActivityTx,
  workspaceId: string,
  commentId: string,
  actorId: string,
  addedMentions: string[],
) {
  if (!addedMentions.length) return
  const [comment] = await tx
    .select({
      projectId: comments.projectId,
      target: comments.target,
      taskId: comments.taskId,
      mentions: comments.mentions,
    })
    .from(comments)
    .innerJoin(projects, eq(projects.id, comments.projectId))
    .where(and(eq(comments.id, commentId), eq(projects.workspaceId, workspaceId)))
  if (!comment) return
  const existing = await tx
    .select({ userId: notifications.userId })
    .from(notifications)
    .innerJoin(activity, eq(activity.id, notifications.activityId))
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(activity.workspaceId, workspaceId),
        eq(activity.subject, commentId),
        eq(notifications.type, 'mention'),
      ),
    )
  const notified = new Set(existing.map((row) => row.userId))
  if (!addedMentions.some((id) => id !== actorId && !notified.has(id))) return
  await recordActivity(tx, {
    workspaceId,
    projectId: comment.projectId,
    actorId,
    type: 'comment.mentioned',
    subject: commentId,
    payload: {
      target: comment.target,
      mentionedUserIds: addedMentions,
      ...(comment.taskId ? { taskId: comment.taskId } : {}),
    },
  })
}
