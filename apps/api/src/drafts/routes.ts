import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { TriggerClient } from '@trigger.dev/sdk'
import { and, asc, desc, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { recordActivity } from '../activity/service'
import {
  decisions,
  diagrams,
  draftChanges,
  drafts,
  memberships,
  milestones,
  planSections,
  projects,
  risks,
  tasks,
  user,
} from '../db/schema'
import { sceneSchema } from '../diagrams/schema'
import { createDiagramVersion } from '../diagrams/service'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import {
  type DiagramDraftModel,
  fakeDiagramDraftModel,
  processDiagramDraft,
} from './diagram-service'
import { type DraftModel, draftKinds, fakeDraftModel, processPlanDraft } from './service'

const allDraftKinds = [...draftKinds, 'diagram'] as const

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const idParams = { params: z.object({ id: z.uuid() }) }
const draftParams = { params: z.object({ id: z.uuid() }) }
const changeParams = { params: z.object({ id: z.uuid(), changeId: z.uuid() }) }
const reasonBody = z.object({ reason: z.string().trim().max(2_000).optional() }).strict()
const createDraftRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/drafts',
  request: {
    ...idParams,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              kind: z.enum(['plan', 'diagram']).default('plan'),
              diagramId: z.uuid().optional(),
              prompt: z.string().trim().max(4000).optional(),
            })
            .strict()
            .refine(
              (value) => value.kind !== 'diagram' || Boolean(value.diagramId),
              'Choose a diagram',
            )
            .optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    202: json(
      z.object({ draft: z.object({ id: z.uuid(), status: z.literal('queued') }) }),
      'Draft queued',
    ),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
    429: json(error, 'Draft limit reached'),
    503: json(error, 'Drafting is not set up'),
  },
})
const changeResponse = z.object({
  id: z.uuid(),
  kind: z.enum(allDraftKinds),
  before: z.unknown(),
  after: z.unknown(),
  status: z.enum(['pending', 'accepted', 'rejected']),
})
const activeDraftRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/drafts/active',
  request: idParams,
  responses: {
    200: json(
      z.object({
        draft: z
          .object({ id: z.uuid(), status: z.enum(['queued', 'running', 'ready']) })
          .nullable(),
      }),
      'The newest plan draft that still needs review, or null',
    ),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const getDraftRoute = createRoute({
  method: 'get',
  path: '/drafts/{id}',
  request: draftParams,
  responses: {
    200: json(
      z.object({
        draft: z.object({
          id: z.uuid(),
          projectId: z.uuid(),
          kind: z.enum(['plan', 'diagram']),
          diagramId: z.uuid().nullable(),
          status: z.enum(['queued', 'running', 'ready', 'failed', 'discarded']),
          model: z.string(),
          error: z.string().nullable(),
          createdAt: z.string(),
          changes: z.array(changeResponse),
        }),
      }),
      'Draft and proposed changes',
    ),
    401: json(error, 'Sign in required'),
    404: json(error, 'Draft not found'),
  },
})
const acceptChangeRoute = createRoute({
  method: 'post',
  path: '/drafts/{id}/changes/{changeId}/accept',
  request: {
    ...changeParams,
    body: { content: { 'application/json': { schema: reasonBody } }, required: false },
  },
  responses: {
    200: json(
      z.object({ decision: z.object({ id: z.uuid(), outcome: z.literal('accepted') }) }),
      'Accepted change',
    ),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Draft change not found'),
    409: json(error, 'Plan section changed since this draft was made'),
  },
})
const rejectChangeRoute = createRoute({
  method: 'post',
  path: '/drafts/{id}/changes/{changeId}/reject',
  request: {
    ...changeParams,
    body: { content: { 'application/json': { schema: reasonBody } }, required: false },
  },
  responses: {
    200: json(
      z.object({ decision: z.object({ id: z.uuid(), outcome: z.literal('rejected') }) }),
      'Rejected change',
    ),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Draft change not found'),
  },
})
const acceptAllRoute = createRoute({
  method: 'post',
  path: '/drafts/{id}/accept-all',
  request: {
    ...draftParams,
    body: { content: { 'application/json': { schema: reasonBody } }, required: false },
  },
  responses: {
    200: json(
      z.object({ accepted: z.number().int(), decisionIds: z.array(z.uuid()) }),
      'Accepted remaining changes',
    ),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Draft not found'),
    409: json(error, 'Plan section changed since this draft was made'),
  },
})
const deleteDraftRoute = createRoute({
  method: 'delete',
  path: '/drafts/{id}',
  request: draftParams,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Discarded draft'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Draft not found'),
  },
})
const getDecisionsRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/decisions',
  request: idParams,
  responses: {
    200: json(
      z.object({
        decisions: z.array(
          z.object({
            id: z.uuid(),
            kind: z.enum([...allDraftKinds, 'brief', 'plan']),
            outcome: z.enum(['accepted', 'rejected', 'reversed', 'approved', 'changes_requested']),
            reason: z.string().nullable(),
            actorId: z.string().nullable(),
            actorName: z.string(),
            reversesDecisionId: z.uuid().nullable(),
            createdAt: z.string(),
          }),
        ),
      }),
      'Decision log',
    ),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const undoDecisionRoute = createRoute({
  method: 'post',
  path: '/decisions/{id}/undo',
  request: idParams,
  responses: {
    200: json(
      z.object({ decision: z.object({ id: z.uuid(), outcome: z.literal('reversed') }) }),
      'Reversed accepted change',
    ),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Decision not found'),
    409: json(error, 'The plan changed after this decision'),
  },
})

type Db = ReturnType<DatabaseFactory>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type SnapshotSection = { version: number; content: unknown }
const writable = (role: string) => role === 'owner' || role === 'editor'
const stableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJson(child)]),
    )
  return value
}
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right))
class StalePlanSection extends Error {}
class InvalidRiskOwner extends Error {}

async function riskOwnersAreMembers(tx: Tx, workspaceId: string, value: unknown) {
  if (!Array.isArray(value)) return false
  const ownerIds = [
    ...new Set(
      value.flatMap((entry) =>
        entry && typeof entry === 'object' && typeof entry.ownerId === 'string'
          ? [entry.ownerId]
          : [],
      ),
    ),
  ]
  if (!ownerIds.length) return true
  const currentMembers = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.userId, ownerIds)))
    .for('key share')
  return currentMembers.length === ownerIds.length
}

async function visibleProject(db: Db, id: string, actorId: string) {
  const [row] = await db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      role: memberships.role,
      brief: projects.brief,
    })
    .from(projects)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actorId)),
    )
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
  return row
}
async function visibleDraft(db: Db, id: string, actorId: string) {
  const [row] = await db
    .select({
      id: drafts.id,
      projectId: drafts.projectId,
      kind: drafts.kind,
      diagramId: drafts.diagramId,
      status: drafts.status,
      model: drafts.model,
      error: drafts.error,
      createdAt: drafts.createdAt,
      workspaceId: projects.workspaceId,
      role: memberships.role,
    })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actorId)),
    )
    .where(and(eq(drafts.id, id), ne(drafts.kind, 'drift'), isNull(projects.deletedAt)))
  if (row && row.kind !== 'drift') return { ...row, kind: row.kind }
}
async function visibleDecision(db: Db, id: string, actorId: string) {
  const [row] = await db
    .select({
      id: decisions.id,
      projectId: decisions.projectId,
      draftChangeId: decisions.draftChangeId,
      kind: decisions.kind,
      outcome: decisions.outcome,
      actorId: decisions.actorId,
      reversesDecisionId: decisions.reversesDecisionId,
      workspaceId: projects.workspaceId,
      role: memberships.role,
    })
    .from(decisions)
    .innerJoin(projects, eq(projects.id, decisions.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actorId)),
    )
    .where(and(eq(decisions.id, id), isNull(projects.deletedAt)))
  return row
}
function encodeAfter(_kind: string, value: unknown) {
  return value
}
function diagramIdOf(change: { before: unknown }) {
  return change.before && typeof change.before === 'object' && 'diagramId' in change.before
    ? String(change.before.diagramId)
    : undefined
}
export async function currentSnapshot(
  tx: Tx,
  projectId: string,
  kind: string,
  diagramId?: string,
): Promise<unknown> {
  if (kind === 'diagram') {
    if (!diagramId) return null
    const [diagram] = await tx
      .select()
      .from(diagrams)
      .where(
        and(
          eq(diagrams.id, diagramId),
          eq(diagrams.projectId, projectId),
          isNull(diagrams.deletedAt),
        ),
      )
      .for('update')
    return diagram
      ? { diagramId: diagram.id, sceneVersion: diagram.sceneVersion, scene: diagram.scene }
      : null
  }
  if (kind === 'requirements' || kind === 'stories' || kind === 'stack' || kind === 'estimate') {
    const [section] = await tx
      .select({ version: planSections.version, content: planSections.content })
      .from(planSections)
      .where(and(eq(planSections.projectId, projectId), eq(planSections.kind, kind)))
    return {
      version: section?.version ?? 0,
      content: section?.content ?? null,
    } satisfies SnapshotSection
  }
  if (kind === 'milestones') {
    return tx
      .select({
        id: milestones.id,
        code: milestones.code,
        title: milestones.title,
        status: milestones.status,
        dueDate: milestones.dueDate,
        position: milestones.position,
      })
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.position), asc(milestones.id))
  }
  return tx
    .select({
      id: risks.id,
      code: risks.code,
      title: risks.title,
      severity: risks.severity,
      ownerId: risks.ownerId,
      decideBy: risks.decideBy,
    })
    .from(risks)
    .where(eq(risks.projectId, projectId))
    .orderBy(asc(risks.createdAt), asc(risks.id))
}

type TaskMilestoneSnapshot = Array<{ id: string; milestoneId: string | null }>
export async function currentTaskMilestones(
  tx: Tx,
  projectId: string,
): Promise<TaskMilestoneSnapshot> {
  return tx
    .select({ id: tasks.id, milestoneId: tasks.milestoneId })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.id))
}
async function restoreTaskMilestones(tx: Tx, projectId: string, snapshot: TaskMilestoneSnapshot) {
  for (const task of snapshot)
    await tx
      .update(tasks)
      .set({ milestoneId: task.milestoneId, updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.projectId, projectId)))
}

export async function recordMilestoneTaskChanges(
  tx: Tx,
  workspaceId: string,
  projectId: string,
  actorId: string,
  before: TaskMilestoneSnapshot,
  after: TaskMilestoneSnapshot,
  planSnapshots: unknown[],
) {
  const previous = new Map(before.map((task) => [task.id, task.milestoneId]))
  const next = new Map(after.map((task) => [task.id, task.milestoneId]))
  const changed = after.filter(
    (task) => previous.has(task.id) && previous.get(task.id) !== task.milestoneId,
  )
  if (!changed.length) return
  const names = new Map<string, string>()
  for (const snapshot of planSnapshots)
    if (Array.isArray(snapshot))
      for (const row of snapshot) {
        if (
          row &&
          typeof row === 'object' &&
          typeof row.id === 'string' &&
          typeof row.title === 'string'
        )
          names.set(row.id, row.title)
      }
  const metadata = await tx
    .select({ id: tasks.id, title: tasks.title, number: tasks.number, projectKey: projects.key })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
        inArray(
          tasks.id,
          changed.map((task) => task.id),
        ),
      ),
    )
  for (const task of metadata) {
    const beforeId = previous.get(task.id) ?? null,
      afterId = next.get(task.id) ?? null
    await recordActivity(tx, {
      workspaceId,
      projectId,
      actorId,
      type: 'task.milestone_changed',
      subject: task.id,
      payload: {
        taskKey: `${task.projectKey}-${task.number}`,
        title: task.title,
        before: beforeId,
        after: afterId,
        beforeName: beforeId ? (names.get(beforeId) ?? null) : null,
        afterName: afterId ? (names.get(afterId) ?? null) : null,
      },
    })
  }
}

async function applyValue(
  tx: Tx,
  projectId: string,
  kind: string,
  value: unknown,
  actorId: string,
  diagramId?: string,
) {
  if (kind === 'diagram') {
    if (!diagramId) throw new StalePlanSection()
    const [diagram] = await tx
      .select()
      .from(diagrams)
      .where(
        and(
          eq(diagrams.id, diagramId),
          eq(diagrams.projectId, projectId),
          isNull(diagrams.deletedAt),
        ),
      )
      .for('update')
    if (!diagram) throw new StalePlanSection()
    const scene = sceneSchema.parse(
      value && typeof value === 'object' && 'scene' in value ? value.scene : value,
    )
    await createDiagramVersion(tx, diagram, scene, null, actorId, true)
    return
  }
  if (kind === 'requirements' || kind === 'stories' || kind === 'stack' || kind === 'estimate') {
    const content =
      value && typeof value === 'object' && !Array.isArray(value) && 'version' in value
        ? (value as SnapshotSection).content
        : value
    const jsonContent = content === null ? sql`'null'::jsonb` : content
    const [current] = await tx
      .select({ version: planSections.version })
      .from(planSections)
      .where(and(eq(planSections.projectId, projectId), eq(planSections.kind, kind)))
    if (!current) {
      await tx
        .insert(planSections)
        .values({ projectId, kind, content: jsonContent, version: 1, updatedBy: actorId })
    } else {
      await tx
        .update(planSections)
        .set({
          content: jsonContent,
          version: current.version + 1,
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(planSections.projectId, projectId),
            eq(planSections.kind, kind),
            eq(planSections.version, current.version),
          ),
        )
    }
    return
  }
  if (kind === 'milestones') {
    const desired = value as Array<{
      id?: string
      code?: string
      title: string
      status: 'planning' | 'in_progress' | 'completed'
      dueDate: string | null
      position?: number
    }>
    const current = await tx
      .select({
        id: milestones.id,
        code: milestones.code,
        title: milestones.title,
        status: milestones.status,
        dueDate: milestones.dueDate,
        position: milestones.position,
      })
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.position), asc(milestones.id))
    const retained = new Set<string>()
    let nextCode = Math.max(0, ...current.map((item) => Number(item.code.slice(1)) || 0))
    for (const [index, item] of desired.entries()) {
      const existing = item.id ? current.find((row) => row.id === item.id) : current[index]
      if (existing) {
        retained.add(existing.id)
        await tx
          .update(milestones)
          .set({
            title: item.title,
            status: item.status,
            dueDate: item.dueDate,
            position: item.position ?? index,
            updatedAt: new Date(),
          })
          .where(and(eq(milestones.id, existing.id), eq(milestones.projectId, projectId)))
      } else {
        nextCode += 1
        await tx.insert(milestones).values({
          ...(item.id ? { id: item.id } : {}),
          projectId,
          code: item.code ?? `M${nextCode}`,
          title: item.title,
          status: item.status,
          dueDate: item.dueDate,
          position: item.position ?? index,
        })
      }
    }
    const removedIds = current.filter((row) => !retained.has(row.id)).map((row) => row.id)
    if (removedIds.length) {
      await tx
        .update(tasks)
        .set({ milestoneId: null, updatedAt: new Date() })
        .where(inArray(tasks.milestoneId, removedIds))
      await tx
        .delete(milestones)
        .where(and(eq(milestones.projectId, projectId), inArray(milestones.id, removedIds)))
    }
    return
  }
  const desired = value as Array<{
    id?: string
    code?: string
    title: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    ownerId: string | null
    decideBy: string | null
  }>
  const current = await tx
    .select({
      id: risks.id,
      code: risks.code,
      title: risks.title,
      severity: risks.severity,
      ownerId: risks.ownerId,
      decideBy: risks.decideBy,
    })
    .from(risks)
    .where(eq(risks.projectId, projectId))
    .orderBy(asc(risks.createdAt), asc(risks.id))
  const retained = new Set<string>()
  let nextCode = Math.max(0, ...current.map((item) => Number(item.code.slice(1)) || 0))
  for (const [index, item] of desired.entries()) {
    const existing = item.id ? current.find((row) => row.id === item.id) : current[index]
    if (existing) {
      retained.add(existing.id)
      await tx
        .update(risks)
        .set({
          title: item.title,
          severity: item.severity,
          ownerId: item.ownerId,
          decideBy: item.decideBy,
          updatedAt: new Date(),
        })
        .where(and(eq(risks.id, existing.id), eq(risks.projectId, projectId)))
    } else {
      nextCode += 1
      await tx.insert(risks).values({
        ...(item.id ? { id: item.id } : {}),
        projectId,
        code: item.code ?? `R${nextCode}`,
        title: item.title,
        severity: item.severity,
        ownerId: item.ownerId,
        decideBy: item.decideBy,
      })
    }
  }
  const removedIds = current.filter((row) => !retained.has(row.id)).map((row) => row.id)
  if (removedIds.length)
    await tx.delete(risks).where(and(eq(risks.projectId, projectId), inArray(risks.id, removedIds)))
}

async function acceptChange(
  db: Db,
  projectId: string,
  workspaceId: string,
  actorId: string,
  draftId: string,
  changeId: string,
  reason: string | null,
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .for('no key update')
    const [draft] = await tx
      .select({ status: drafts.status })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .for('update')
    if (draft?.status !== 'ready') return { kind: 'missing' as const }
    const [change] = await tx
      .select()
      .from(draftChanges)
      .where(and(eq(draftChanges.id, changeId), eq(draftChanges.draftId, draftId)))
      .for('update')
    if (!change || change.status !== 'pending') return { kind: 'missing' as const }
    const current = await currentSnapshot(tx, projectId, change.kind, diagramIdOf(change))
    if (!sameJson(current, change.before)) return { kind: 'stale' as const }
    if (change.kind === 'risks' && !(await riskOwnersAreMembers(tx, workspaceId, change.after)))
      return { kind: 'invalid-owner' as const }
    const beforeTaskMilestones =
      change.kind === 'milestones' ? await currentTaskMilestones(tx, projectId) : null
    const [diagramBefore] =
      change.kind === 'diagram' && diagramIdOf(change)
        ? await tx
            .select({ name: diagrams.name, version: diagrams.currentVersion })
            .from(diagrams)
            .where(
              and(
                eq(diagrams.id, diagramIdOf(change) as string),
                eq(diagrams.projectId, projectId),
              ),
            )
        : []
    await applyValue(
      tx,
      projectId,
      change.kind,
      encodeAfter(change.kind, change.after),
      actorId,
      diagramIdOf(change),
    )
    const appliedPlanSnapshot = await currentSnapshot(
      tx,
      projectId,
      change.kind,
      diagramIdOf(change),
    )
    const afterTaskMilestones = beforeTaskMilestones
      ? await currentTaskMilestones(tx, projectId)
      : null
    const appliedSnapshot =
      change.kind === 'milestones'
        ? { plan: appliedPlanSnapshot, taskMilestones: afterTaskMilestones, beforeTaskMilestones }
        : appliedPlanSnapshot
    const [decision] = await tx
      .insert(decisions)
      .values({
        projectId,
        draftChangeId: change.id,
        kind: change.kind,
        actorId,
        outcome: 'accepted',
        reason,
      })
      .returning({ id: decisions.id })
    await tx
      .update(draftChanges)
      .set({ status: 'accepted', appliedSnapshot, updatedAt: new Date() })
      .where(eq(draftChanges.id, change.id))
    if (change.kind !== 'diagram')
      await tx
        .update(projects)
        .set({ planUpdatedAt: new Date(), planUpdatedBy: actorId })
        .where(eq(projects.id, projectId))
    if (beforeTaskMilestones && afterTaskMilestones)
      await recordMilestoneTaskChanges(
        tx,
        workspaceId,
        projectId,
        actorId,
        beforeTaskMilestones,
        afterTaskMilestones,
        [current, appliedPlanSnapshot],
      )
    await recordActivity(tx, {
      workspaceId,
      projectId,
      actorId,
      type: change.kind === 'diagram' ? 'diagram.draft_accepted' : 'draft.accepted',
      subject: diagramIdOf(change) ?? change.id,
      payload: diagramBefore
        ? {
            name: diagramBefore.name,
            before: diagramBefore.version,
            after: diagramBefore.version + 1,
            decisionId: decision?.id,
          }
        : { section: change.kind, before: 'pending', after: 'accepted', decisionId: decision?.id },
    })
    return { kind: 'accepted' as const, decisionId: decision?.id }
  })
}

export function createProjectDraftRoutes(
  options: {
    database?: DatabaseFactory
    auth?: AuthFactory
    draftModel?: DraftModel
    diagramDraftModel?: DiagramDraftModel
  } = {},
) {
  const app = new OpenAPIHono<Env>()
  for (const path of ['/projects/*', '/drafts/*', '/decisions/*'])
    app.use(
      path,
      async (c, next) => {
        // Plan drafting predates the optional JSON input and accepts an empty POST body.
        if (
          c.req.method === 'POST' &&
          /^\/projects\/[^/]+\/drafts$/.test(c.req.path) &&
          !(await c.req.raw.clone().text())
        )
          c.req.raw = new Request(c.req.raw, { body: '{}' })
        if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
          return c.json({ error: 'Invalid origin' }, 403)
        return next()
      },
      useDb(options.database),
      requireSession(options.auth),
    )
  return app
    .openapi(createDraftRoute, async (c) => {
      const { id: projectId } = c.req.valid('param')
      const db = c.get('db')
      const actorId = c.get('user').id
      const project = await visibleProject(db, projectId, actorId)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (!writable(project.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const input = c.req.valid('json')
      if (input?.kind === 'diagram') {
        const [diagram] = await db
          .select({ id: diagrams.id })
          .from(diagrams)
          .where(
            and(
              eq(diagrams.id, input.diagramId as string),
              eq(diagrams.projectId, projectId),
              isNull(diagrams.deletedAt),
            ),
          )
        if (!diagram) return c.json({ error: 'Diagram not found' }, 404)
      }
      // Production (ENVIRONMENT is set by wrangler.jsonc) never falls back to the fixed sample plan.
      if (
        c.env.ENVIRONMENT === 'production' &&
        !options.draftModel &&
        !options.diagramDraftModel &&
        !(c.env.ANTHROPIC_API_KEY && c.env.TRIGGER_SECRET_KEY)
      )
        return c.json({ error: 'Drafting is not set up' }, 503)
      if (
        !(await consumeRateLimit(
          db,
          'plan-drafts-workspace',
          project.workspaceId,
          1,
          20,
          3_600_000,
        ))
      )
        return c.json({ error: 'Draft limit reached. Try again later.' }, 429)
      const hasKeys = Boolean(
        c.env.ANTHROPIC_API_KEY &&
          c.env.TRIGGER_SECRET_KEY &&
          !options.draftModel &&
          !options.diagramDraftModel,
      )
      const draft = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(drafts)
          .values({
            projectId,
            kind: input?.kind ?? 'plan',
            diagramId: input?.kind === 'diagram' ? input.diagramId : null,
            prompt: input?.kind === 'diagram' ? input.prompt : null,
            model: hasKeys ? 'claude-opus-5-5' : 'fake',
            createdBy: actorId,
          })
          .returning({ id: drafts.id })
        if (!created) throw new Error('Draft insert failed')
        await recordActivity(tx, {
          workspaceId: project.workspaceId,
          projectId,
          actorId,
          type: 'draft.started',
          subject: created.id,
          payload: { kind: input?.kind ?? 'plan', before: null, after: 'queued' },
        })
        return created
      })
      const run = async () => {
        try {
          if (hasKeys) {
            await new TriggerClient({ accessToken: c.env.TRIGGER_SECRET_KEY }).tasks.trigger(
              'draft-plan',
              { draftId: draft.id },
            )
          } else {
            if (input?.kind === 'diagram')
              await processDiagramDraft(
                db,
                draft.id,
                options.diagramDraftModel ?? fakeDiagramDraftModel,
              )
            else await processPlanDraft(db, draft.id, options.draftModel ?? fakeDraftModel)
          }
        } catch {
          await db
            .update(drafts)
            .set({
              status: 'failed',
              error: 'The plan could not be drafted. Try again.',
              updatedAt: new Date(),
            })
            .where(and(eq(drafts.id, draft.id), inArray(drafts.status, ['queued', 'running'])))
        }
      }
      try {
        c.executionCtx.waitUntil(run())
      } catch {
        void run()
      }
      return c.json({ draft: { id: draft.id, status: 'queued' as const } }, 202)
    })
    .openapi(activeDraftRoute, async (c) => {
      const { id: projectId } = c.req.valid('param')
      const db = c.get('db')
      const project = await visibleProject(db, projectId, c.get('user').id)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      // Unresolved: still being drafted, or ready with at least one section not yet reviewed.
      const [draft] = await db
        .select({ id: drafts.id, status: drafts.status })
        .from(drafts)
        .where(
          and(
            eq(drafts.projectId, projectId),
            eq(drafts.kind, 'plan'),
            or(
              inArray(drafts.status, ['queued', 'running']),
              and(
                eq(drafts.status, 'ready'),
                exists(
                  db
                    .select({ id: draftChanges.id })
                    .from(draftChanges)
                    .where(
                      and(eq(draftChanges.draftId, drafts.id), eq(draftChanges.status, 'pending')),
                    ),
                ),
              ),
            ),
          ),
        )
        .orderBy(desc(drafts.createdAt), desc(drafts.id))
        .limit(1)
      return c.json(
        {
          // The query above only selects queued, running or ready drafts.
          draft: draft
            ? { id: draft.id, status: draft.status as 'queued' | 'running' | 'ready' }
            : null,
        },
        200,
      )
    })
    .openapi(getDraftRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const draft = await visibleDraft(db, id, c.get('user').id)
      if (!draft) return c.json({ error: 'Draft not found' }, 404)
      const changes = await db
        .select({
          id: draftChanges.id,
          kind: draftChanges.kind,
          before: draftChanges.before,
          after: draftChanges.after,
          status: draftChanges.status,
        })
        .from(draftChanges)
        .where(eq(draftChanges.draftId, id))
        .orderBy(asc(draftChanges.createdAt), asc(draftChanges.id))
      changes.sort((a, b) => allDraftKinds.indexOf(a.kind) - allDraftKinds.indexOf(b.kind))
      return c.json(
        {
          draft: {
            id: draft.id,
            projectId: draft.projectId,
            kind: draft.kind,
            diagramId: draft.diagramId,
            status: draft.status,
            model: draft.model,
            error: draft.error,
            createdAt: draft.createdAt.toISOString(),
            changes,
          },
        },
        200,
      )
    })
    .openapi(acceptChangeRoute, async (c) => {
      const { id, changeId } = c.req.valid('param')
      const reason = c.req.valid('json')?.reason ?? null
      const db = c.get('db')
      const actorId = c.get('user').id
      const draft = await visibleDraft(db, id, actorId)
      if (!draft) return c.json({ error: 'Draft change not found' }, 404)
      if (!writable(draft.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const result = await acceptChange(
        db,
        draft.projectId,
        draft.workspaceId,
        actorId,
        id,
        changeId,
        reason,
      )
      if (result.kind === 'missing') return c.json({ error: 'Draft change not found' }, 404)
      if (result.kind === 'invalid-owner')
        return c.json({ error: 'Risk owner is no longer a workspace member' }, 409)
      if (result.kind === 'stale')
        return c.json({ error: 'Plan section changed since this draft was made' }, 409)
      return c.json(
        { decision: { id: result.decisionId as string, outcome: 'accepted' as const } },
        200,
      )
    })
    .openapi(rejectChangeRoute, async (c) => {
      const { id, changeId } = c.req.valid('param')
      const reason = c.req.valid('json')?.reason ?? null
      const db = c.get('db')
      const actorId = c.get('user').id
      const draft = await visibleDraft(db, id, actorId)
      if (!draft) return c.json({ error: 'Draft change not found' }, 404)
      if (!writable(draft.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const [result] = await db.transaction(async (tx) => {
        await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, id)).for('update')
        const [change] = await tx
          .select()
          .from(draftChanges)
          .where(and(eq(draftChanges.id, changeId), eq(draftChanges.draftId, id)))
          .for('update')
        if (!change || change.status !== 'pending' || draft.status !== 'ready') return []
        const [decision] = await tx
          .insert(decisions)
          .values({
            projectId: draft.projectId,
            draftChangeId: change.id,
            kind: change.kind,
            actorId,
            outcome: 'rejected',
            reason,
          })
          .returning({ id: decisions.id })
        await tx
          .update(draftChanges)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(eq(draftChanges.id, change.id))
        await recordActivity(tx, {
          workspaceId: draft.workspaceId,
          projectId: draft.projectId,
          actorId,
          type: 'draft.rejected',
          subject: change.id,
          payload: {
            section: change.kind,
            before: 'pending',
            after: 'rejected',
            decisionId: decision?.id,
          },
        })
        return [decision]
      })
      if (!result) return c.json({ error: 'Draft change not found' }, 404)
      return c.json({ decision: { id: result.id, outcome: 'rejected' as const } }, 200)
    })
    .openapi(acceptAllRoute, async (c) => {
      const id = c.req.valid('param').id
      const reason = c.req.valid('json')?.reason ?? null
      const db = c.get('db')
      const actorId = c.get('user').id
      const visible = await visibleDraft(db, id, actorId)
      if (!visible) return c.json({ error: 'Draft not found' }, 404)
      if (!writable(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
      let result:
        | { kind: 'accepted'; accepted: number; decisionIds: string[] }
        | { kind: 'stale'; accepted: 0; decisionIds: [] }
        | { kind: 'invalid-owner'; accepted: 0; decisionIds: [] }
        | { kind: 'missing'; accepted: 0; decisionIds: [] }
      try {
        result = await db.transaction(async (tx) => {
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, visible.projectId),
                eq(projects.workspaceId, visible.workspaceId),
              ),
            )
            .for('no key update')
          const [draft] = await tx
            .select({ status: drafts.status })
            .from(drafts)
            .where(eq(drafts.id, id))
            .for('update')
          if (draft?.status !== 'ready')
            return { kind: 'missing' as const, accepted: 0, decisionIds: [] as [] }
          const pending = await tx
            .select()
            .from(draftChanges)
            .where(and(eq(draftChanges.draftId, id), eq(draftChanges.status, 'pending')))
            .for('update')
          pending.sort((a, b) => allDraftKinds.indexOf(a.kind) - allDraftKinds.indexOf(b.kind))
          const decisionIds: string[] = []
          let acceptedDiagram:
            | { name: string; before: number; after: number; id: string }
            | undefined
          for (const change of pending) {
            const current = await currentSnapshot(
              tx,
              visible.projectId,
              change.kind,
              diagramIdOf(change),
            )
            if (!sameJson(current, change.before)) throw new StalePlanSection()
            if (
              change.kind === 'risks' &&
              !(await riskOwnersAreMembers(tx, visible.workspaceId, change.after))
            )
              throw new InvalidRiskOwner()
            const beforeTaskMilestones =
              change.kind === 'milestones'
                ? await currentTaskMilestones(tx, visible.projectId)
                : null
            if (change.kind === 'diagram' && diagramIdOf(change)) {
              const [diagram] = await tx
                .select({ id: diagrams.id, name: diagrams.name, version: diagrams.currentVersion })
                .from(diagrams)
                .where(
                  and(
                    eq(diagrams.id, diagramIdOf(change) as string),
                    eq(diagrams.projectId, visible.projectId),
                  ),
                )
              if (diagram)
                acceptedDiagram = {
                  id: diagram.id,
                  name: diagram.name,
                  before: diagram.version,
                  after: diagram.version + 1,
                }
            }
            await applyValue(
              tx,
              visible.projectId,
              change.kind,
              encodeAfter(change.kind, change.after),
              actorId,
              diagramIdOf(change),
            )
            const appliedPlanSnapshot = await currentSnapshot(
              tx,
              visible.projectId,
              change.kind,
              diagramIdOf(change),
            )
            const afterTaskMilestones = beforeTaskMilestones
              ? await currentTaskMilestones(tx, visible.projectId)
              : null
            const appliedSnapshot =
              change.kind === 'milestones'
                ? {
                    plan: appliedPlanSnapshot,
                    taskMilestones: afterTaskMilestones,
                    beforeTaskMilestones,
                  }
                : appliedPlanSnapshot
            if (beforeTaskMilestones && afterTaskMilestones)
              await recordMilestoneTaskChanges(
                tx,
                visible.workspaceId,
                visible.projectId,
                actorId,
                beforeTaskMilestones,
                afterTaskMilestones,
                [current, appliedPlanSnapshot],
              )
            const [decision] = await tx
              .insert(decisions)
              .values({
                projectId: visible.projectId,
                draftChangeId: change.id,
                kind: change.kind,
                actorId,
                outcome: 'accepted',
                reason,
              })
              .returning({ id: decisions.id })
            if (decision) decisionIds.push(decision.id)
            await tx
              .update(draftChanges)
              .set({ status: 'accepted', appliedSnapshot, updatedAt: new Date() })
              .where(eq(draftChanges.id, change.id))
          }
          if (pending.length)
            await tx
              .update(projects)
              .set({ planUpdatedAt: new Date(), planUpdatedBy: actorId })
              .where(eq(projects.id, visible.projectId))
          if (pending.length)
            await recordActivity(tx, {
              workspaceId: visible.workspaceId,
              projectId: visible.projectId,
              actorId,
              type: acceptedDiagram ? 'diagram.draft_accepted' : 'draft.accepted_all',
              subject: acceptedDiagram?.id ?? id,
              payload: acceptedDiagram
                ? {
                    name: acceptedDiagram.name,
                    before: acceptedDiagram.before,
                    after: acceptedDiagram.after,
                    decisionIds,
                  }
                : {
                    sections: pending.map((change) => change.kind),
                    before: 'pending',
                    after: 'accepted',
                    decisionIds,
                  },
            })
          return { kind: 'accepted' as const, accepted: pending.length, decisionIds }
        })
      } catch (cause) {
        if (cause instanceof StalePlanSection)
          result = { kind: 'stale', accepted: 0, decisionIds: [] }
        else if (cause instanceof InvalidRiskOwner)
          result = { kind: 'invalid-owner', accepted: 0, decisionIds: [] }
        else throw cause
      }
      if (result.kind === 'invalid-owner')
        return c.json({ error: 'Risk owner is no longer a workspace member' }, 409)
      if (result.kind === 'missing') return c.json({ error: 'Draft not found' }, 404)
      if (result.kind === 'stale')
        return c.json({ error: 'Plan section changed since this draft was made' }, 409)
      return c.json({ accepted: result.accepted, decisionIds: result.decisionIds }, 200)
    })
    .openapi(deleteDraftRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const actorId = c.get('user').id
      const draft = await visibleDraft(db, id, actorId)
      if (!draft) return c.json({ error: 'Draft not found' }, 404)
      if (!writable(draft.role)) return c.json({ error: 'Owner or editor required' }, 403)
      const [updated] = await db
        .update(drafts)
        .set({ status: 'discarded', updatedAt: new Date() })
        .where(
          and(eq(drafts.id, id), inArray(drafts.status, ['queued', 'running', 'ready', 'failed'])),
        )
        .returning({ id: drafts.id })
      if (!updated && draft.status !== 'discarded') return c.json({ error: 'Draft not found' }, 404)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(getDecisionsRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const project = await visibleProject(db, id, c.get('user').id)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const rows = await db
        .select({
          id: decisions.id,
          kind: decisions.kind,
          outcome: decisions.outcome,
          reason: decisions.reason,
          actorId: decisions.actorId,
          actorName: user.name,
          reversesDecisionId: decisions.reversesDecisionId,
          createdAt: decisions.createdAt,
        })
        .from(decisions)
        .leftJoin(user, eq(user.id, decisions.actorId))
        .where(eq(decisions.projectId, id))
        .orderBy(asc(decisions.createdAt), asc(decisions.id))
      return c.json(
        {
          decisions: rows.map((row) => ({
            ...row,
            actorName:
              row.outcome === 'approved' || row.outcome === 'changes_requested'
                ? 'External reviewer'
                : (row.actorName ?? 'Deleted user'),
            createdAt: row.createdAt.toISOString(),
          })),
        },
        200,
      )
    })
    .openapi(undoDecisionRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const actorId = c.get('user').id
      const visible = await visibleDecision(db, id, actorId)
      if (!visible) return c.json({ error: 'Decision not found' }, 404)
      if (!writable(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
      if (visible.outcome !== 'accepted' || visible.reversesDecisionId)
        return c.json({ error: 'Decision cannot be undone' }, 409)
      const result = await db.transaction(async (tx) => {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(eq(projects.id, visible.projectId), eq(projects.workspaceId, visible.workspaceId)),
          )
          .for('no key update')
        const [original] = await tx
          .select()
          .from(decisions)
          .where(eq(decisions.id, id))
          .for('update')
        if (!original || original.outcome !== 'accepted') return { kind: 'missing' as const }
        const [alreadyReversed] = await tx
          .select({ id: decisions.id })
          .from(decisions)
          .where(eq(decisions.reversesDecisionId, id))
        if (alreadyReversed) return { kind: 'stale' as const }
        if (!original.draftChangeId) return { kind: 'stale' as const }
        const [change] = await tx
          .select()
          .from(draftChanges)
          .where(eq(draftChanges.id, original.draftChangeId))
          .for('update')
        if (!change || change.status !== 'accepted') return { kind: 'stale' as const }
        const current = await currentSnapshot(
          tx,
          visible.projectId,
          change.kind,
          diagramIdOf(change),
        )
        const milestoneSnapshot =
          change.kind === 'milestones' &&
          change.appliedSnapshot &&
          typeof change.appliedSnapshot === 'object'
            ? (change.appliedSnapshot as {
                plan: unknown
                taskMilestones: TaskMilestoneSnapshot
                beforeTaskMilestones: TaskMilestoneSnapshot
              })
            : null
        if (
          change.kind === 'milestones'
            ? !milestoneSnapshot ||
              !sameJson(current, milestoneSnapshot.plan) ||
              !sameJson(
                await currentTaskMilestones(tx, visible.projectId),
                milestoneSnapshot.taskMilestones,
              )
            : !sameJson(current, change.appliedSnapshot)
        )
          return { kind: 'stale' as const }
        if (
          change.kind === 'risks' &&
          !(await riskOwnersAreMembers(tx, visible.workspaceId, change.before))
        )
          return { kind: 'stale' as const }
        const beforeUndoTasks = milestoneSnapshot
          ? await currentTaskMilestones(tx, visible.projectId)
          : null
        await applyValue(
          tx,
          visible.projectId,
          change.kind,
          change.before,
          actorId,
          diagramIdOf(change),
        )
        if (milestoneSnapshot)
          await restoreTaskMilestones(tx, visible.projectId, milestoneSnapshot.beforeTaskMilestones)
        const restored = await currentSnapshot(
          tx,
          visible.projectId,
          change.kind,
          diagramIdOf(change),
        )
        const [reversal] = await tx
          .insert(decisions)
          .values({
            projectId: visible.projectId,
            draftChangeId: change.id,
            kind: change.kind,
            actorId,
            outcome: 'reversed',
            reason: 'Undo accepted change',
            reversesDecisionId: id,
          })
          .returning({ id: decisions.id })
        await tx
          .update(draftChanges)
          .set({
            status: 'pending',
            before: restored,
            baseVersion:
              restored && typeof restored === 'object' && 'version' in restored
                ? Number((restored as SnapshotSection).version)
                : change.baseVersion,
            updatedAt: new Date(),
          })
          .where(eq(draftChanges.id, change.id))
        await tx
          .update(projects)
          .set({ planUpdatedAt: new Date(), planUpdatedBy: actorId })
          .where(eq(projects.id, visible.projectId))
        if (beforeUndoTasks)
          await recordMilestoneTaskChanges(
            tx,
            visible.workspaceId,
            visible.projectId,
            actorId,
            beforeUndoTasks,
            await currentTaskMilestones(tx, visible.projectId),
            [current, restored],
          )
        await recordActivity(tx, {
          workspaceId: visible.workspaceId,
          projectId: visible.projectId,
          actorId,
          type: 'draft.undone',
          subject: change.id,
          payload: {
            section: change.kind,
            before: 'accepted',
            after: 'pending',
            decisionId: reversal?.id,
            reversesDecisionId: id,
          },
        })
        return { kind: 'reversed' as const, decisionId: reversal?.id }
      })
      if (result.kind === 'missing') return c.json({ error: 'Decision not found' }, 404)
      if (result.kind === 'stale')
        return c.json({ error: 'The plan changed after this decision' }, 409)
      return c.json(
        { decision: { id: result.decisionId as string, outcome: 'reversed' as const } },
        200,
      )
    })
}
