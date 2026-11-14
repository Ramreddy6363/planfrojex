import { and, eq } from 'drizzle-orm'
import { activity, memberships, projects } from '../db/schema'
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
  await tx.insert(activity).values({
    workspaceId: member.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    type: input.type,
    subject: input.subject,
    payload: input.payload,
  })
}
