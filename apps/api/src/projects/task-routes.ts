import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { memberships, milestones, projects, tasks, user, workspaces } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const status = z.enum(['todo', 'in_progress', 'done'])
const priority = z.enum(['low', 'medium', 'high'])
const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const taskResponse = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status,
  priority,
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  milestoneId: z.uuid().nullable(),
  milestoneCode: z.string().nullable(),
  dueDate: z.string().nullable(),
  position: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const params = { params: z.object({ id: z.uuid() }) }
const taskQuery = z.object({
  status: status.optional(),
  assignee: z.string().max(128).optional(),
  priority: priority.optional(),
  milestone: z.string().max(64).optional(),
})
const listRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/tasks',
  request: { ...params, query: taskQuery },
  responses: {
    200: json(
      z.object({
        tasks: z.array(taskResponse),
        counts: z.object({ todo: z.number(), inProgress: z.number(), done: z.number() }),
      }),
      'Project tasks',
    ),
    400: json(error, 'Invalid task filters'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000).default(''),
    status: status.default('todo'),
    assigneeId: z.string().min(1).max(128).nullable().optional(),
    priority: priority.default('medium'),
    dueDate: z.iso.date().nullable().optional(),
    milestoneId: z.uuid().nullable().optional(),
  })
  .strict()
const createTaskRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/tasks',
  request: {
    ...params,
    body: { content: { 'application/json': { schema: createTaskSchema } }, required: true },
  },
  responses: {
    201: json(z.object({ task: taskResponse }), 'Created task'),
    400: json(error, 'Invalid task or assignee'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
  },
})
const getRoute = createRoute({
  method: 'get',
  path: '/tasks/{id}',
  request: params,
  responses: {
    200: json(z.object({ task: taskResponse }), 'Task details'),
    400: json(error, 'Invalid task'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Task not found'),
  },
})
const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(10_000).optional(),
    status: status.optional(),
    assigneeId: z.string().min(1).max(128).nullable().optional(),
    priority: priority.optional(),
    dueDate: z.iso.date().nullable().optional(),
    position: z.number().int().min(0).max(2_147_483_647).optional(),
    milestoneId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')
const patchRoute = createRoute({
  method: 'patch',
  path: '/tasks/{id}',
  request: {
    ...params,
    body: { content: { 'application/json': { schema: patchSchema } }, required: true },
  },
  responses: {
    200: json(z.object({ task: taskResponse }), 'Updated task'),
    400: json(error, 'Invalid task or assignee'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Task not found'),
  },
})
const deleteRoute = createRoute({
  method: 'delete',
  path: '/tasks/{id}',
  request: params,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Deleted task'),
    400: json(error, 'Invalid task'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Task not found'),
  },
})

type Db = ReturnType<DatabaseFactory>
async function visibleProject(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId, role: memberships.role })
    .from(projects)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
  return row
}
async function visibleTask(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      status: tasks.status,
      workspaceId: projects.workspaceId,
      role: memberships.role,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(tasks.id, id), isNull(projects.deletedAt)))
  return row
}
async function taskDetails(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      number: tasks.number,
      projectKey: projects.key,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      milestoneId: tasks.milestoneId,
      milestoneCode: milestones.code,
      dueDate: tasks.dueDate,
      position: tasks.position,
      createdBy: tasks.createdBy,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .leftJoin(user, eq(user.id, tasks.assigneeId))
    .leftJoin(
      milestones,
      and(eq(milestones.id, tasks.milestoneId), eq(milestones.projectId, tasks.projectId)),
    )
    .where(and(eq(tasks.id, id), isNull(projects.deletedAt)))
  return row
    ? {
        id: row.id,
        projectId: row.projectId,
        number: row.number,
        key: `${row.projectKey}-${row.number}`,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assigneeId: row.assigneeId,
        assigneeName: row.assigneeName,
        milestoneId: row.milestoneId,
        milestoneCode: row.milestoneCode,
        dueDate: row.dueDate,
        position: row.position,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null
}
async function isWorkspaceMember(db: Db, workspaceId: string, userId: string) {
  const [member] = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  return Boolean(member)
}
async function statusPosition(
  db: Db,
  projectId: string,
  taskStatus: 'todo' | 'in_progress' | 'done',
) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${tasks.position}), -1)` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, taskStatus)))
  return Number(row?.max ?? -1) + 1
}
const isWritable = (role: string) => role === 'owner' || role === 'editor'
const invalid = (result: { success: boolean }, c: import('hono').Context<Env>) => {
  if (!result.success) return c.json({ error: 'Invalid task details' }, 400)
}

const addTaskMiddleware = (
  app: OpenAPIHono<Env>,
  path: string,
  options: { database?: DatabaseFactory; auth?: AuthFactory },
) => {
  app.use(
    path,
    async (c, next) => {
      if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
        return c.json({ error: 'Invalid origin' }, 403)
      return next()
    },
    useDb(options.database),
    requireSession(options.auth),
  )
}

export function createProjectTaskRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  addTaskMiddleware(app, '/projects/*', options)
  return app
    .openapi(
      listRoute,
      async (c) => {
        const projectId = c.req.valid('param').id
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible = await visibleProject(db, projectId, actorId)
        if (!visible) return c.json({ error: 'Project not found' }, 404)
        const filters = c.req.valid('query')
        const counts = await db
          .select({
            status: tasks.status,
            count: sql<number>`count(*)::int`,
          })
          .from(tasks)
          .where(eq(tasks.projectId, projectId))
          .groupBy(tasks.status)
        const countByStatus = {
          todo: counts.find((row) => row.status === 'todo')?.count ?? 0,
          inProgress: counts.find((row) => row.status === 'in_progress')?.count ?? 0,
          done: counts.find((row) => row.status === 'done')?.count ?? 0,
        }
        const rows = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, projectId),
              filters.status
                ? eq(tasks.status, filters.status as 'todo' | 'in_progress' | 'done')
                : undefined,
              filters.assignee === 'unassigned'
                ? sql`${tasks.assigneeId} is null`
                : filters.assignee
                  ? eq(tasks.assigneeId, filters.assignee)
                  : undefined,
              filters.priority ? eq(tasks.priority, filters.priority) : undefined,
              filters.milestone === 'unassigned'
                ? isNull(tasks.milestoneId)
                : filters.milestone
                  ? eq(tasks.milestoneId, filters.milestone)
                  : undefined,
            ),
          )
          .orderBy(
            sql`case ${tasks.status} when 'in_progress' then 0 when 'todo' then 1 else 2 end`,
            asc(tasks.position),
            asc(tasks.number),
          )
        const values = await Promise.all(rows.map((row) => taskDetails(db, row.id, actorId)))
        return c.json(
          { tasks: values.filter((value) => value !== null), counts: countByStatus },
          200,
        )
      },
      invalid,
    )
    .openapi(
      createTaskRoute,
      async (c) => {
        const projectId = c.req.valid('param').id
        const input = c.req.valid('json')
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible = await visibleProject(db, projectId, actorId)
        if (!visible) return c.json({ error: 'Project not found' }, 404)
        if (!isWritable(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
        const result = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, visible.workspaceId))
            .for('no key update')
          const [actor] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, visible.workspaceId),
                eq(memberships.userId, actorId),
              ),
            )
          const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.workspaceId, visible.workspaceId),
                isNull(projects.deletedAt),
              ),
            )
            .for('no key update')
          if (!actor || !project) return { kind: 'missing' as const }
          if (!isWritable(actor.role)) return { kind: 'forbidden' as const }
          if (
            input.assigneeId &&
            !(await isWorkspaceMember(tx, visible.workspaceId, input.assigneeId))
          )
            return { kind: 'invalid' as const }
          if (
            input.milestoneId &&
            !(
              await tx
                .select({ id: milestones.id })
                .from(milestones)
                .where(
                  and(eq(milestones.id, input.milestoneId), eq(milestones.projectId, projectId)),
                )
            ).length
          )
            return { kind: 'invalidMilestone' as const }
          const [last] = await tx
            .select({ max: sql<number>`coalesce(max(${tasks.number}), 0)` })
            .from(tasks)
            .where(eq(tasks.projectId, projectId))
          const number = Number(last?.max ?? 0) + 1
          const position = await statusPosition(tx, projectId, input.status)
          const [created] = await tx
            .insert(tasks)
            .values({
              projectId,
              number,
              title: input.title,
              description: input.description,
              status: input.status,
              priority: input.priority,
              assigneeId: input.assigneeId ?? null,
              dueDate: input.dueDate ?? null,
              milestoneId: input.milestoneId ?? null,
              position,
              createdBy: actorId,
            })
            .returning({ id: tasks.id })
          if (!created) throw new Error('Task was not created')
          return { kind: 'created' as const, id: created.id }
        })
        if (result.kind === 'missing') return c.json({ error: 'Project not found' }, 404)
        if (result.kind === 'forbidden') return c.json({ error: 'Owner or editor required' }, 403)
        if (result.kind === 'invalid')
          return c.json({ error: 'Assignee must be a member of this workspace' }, 400)
        if (result.kind === 'invalidMilestone')
          return c.json({ error: 'Milestone must belong to this project' }, 400)
        const task = await taskDetails(db, result.id, actorId)
        if (!task) return c.json({ error: 'Task not found' }, 404)
        return c.json({ task }, 201)
      },
      invalid,
    )
}

export function createTaskRoutes(options: { database?: DatabaseFactory; auth?: AuthFactory } = {}) {
  const app = new OpenAPIHono<Env>()
  addTaskMiddleware(app, '/tasks/*', options)
  return app
    .openapi(
      getRoute,
      async (c) => {
        const task = await taskDetails(c.get('db'), c.req.valid('param').id, c.get('user').id)
        if (!task) return c.json({ error: 'Task not found' }, 404)
        return c.json({ task }, 200)
      },
      invalid,
    )
    .openapi(
      patchRoute,
      async (c) => {
        const id = c.req.valid('param').id
        const input = c.req.valid('json')
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible = await visibleTask(db, id, actorId)
        if (!visible) return c.json({ error: 'Task not found' }, 404)
        if (!isWritable(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
        const result = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, visible.workspaceId))
            .for('no key update')
          const [actor] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, visible.workspaceId),
                eq(memberships.userId, actorId),
              ),
            )
          if (!actor) return 'missing' as const
          if (!isWritable(actor.role)) return 'forbidden' as const
          const [task] = await tx
            .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status })
            .from(tasks)
            .innerJoin(projects, eq(projects.id, tasks.projectId))
            .where(
              and(
                eq(tasks.id, id),
                eq(projects.workspaceId, visible.workspaceId),
                isNull(projects.deletedAt),
              ),
            )
            .for('no key update')
          if (!task) return 'missing' as const
          if (
            input.assigneeId &&
            !(await isWorkspaceMember(tx, visible.workspaceId, input.assigneeId))
          )
            return 'invalid' as const
          if (
            input.milestoneId &&
            !(
              await tx
                .select({ id: milestones.id })
                .from(milestones)
                .where(
                  and(
                    eq(milestones.id, input.milestoneId),
                    eq(milestones.projectId, task.projectId),
                  ),
                )
            ).length
          )
            return 'invalidMilestone' as const
          const values: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() }
          if (input.title !== undefined) values.title = input.title
          if (input.description !== undefined) values.description = input.description
          if (input.priority !== undefined) values.priority = input.priority
          if (input.assigneeId !== undefined) values.assigneeId = input.assigneeId
          if (input.dueDate !== undefined) values.dueDate = input.dueDate
          if (input.milestoneId !== undefined) values.milestoneId = input.milestoneId
          const nextStatus = input.status ?? task.status
          const reorder = input.position !== undefined || nextStatus !== task.status
          if (!reorder) {
            await tx.update(tasks).set(values).where(eq(tasks.id, id))
          } else {
            const targetRows = await tx
              .select({ id: tasks.id })
              .from(tasks)
              .where(
                and(
                  eq(tasks.projectId, task.projectId),
                  eq(tasks.status, nextStatus),
                  sql`${tasks.id} <> ${id}`,
                ),
              )
              .orderBy(asc(tasks.position), asc(tasks.number))
              .for('no key update')
            const targetPosition = Math.max(
              0,
              Math.min(input.position ?? targetRows.length, targetRows.length),
            )
            targetRows.splice(targetPosition, 0, { id })
            if (nextStatus !== task.status) {
              const sourceRows = await tx
                .select({ id: tasks.id })
                .from(tasks)
                .where(
                  and(
                    eq(tasks.projectId, task.projectId),
                    eq(tasks.status, task.status),
                    sql`${tasks.id} <> ${id}`,
                  ),
                )
                .orderBy(asc(tasks.position), asc(tasks.number))
                .for('no key update')
              for (const [position, row] of sourceRows.entries())
                await tx
                  .update(tasks)
                  .set({ position, updatedAt: new Date() })
                  .where(eq(tasks.id, row.id))
            }
            for (const [position, row] of targetRows.entries())
              await tx
                .update(tasks)
                .set(
                  row.id === id
                    ? { ...values, status: nextStatus, position }
                    : { position, updatedAt: new Date() },
                )
                .where(eq(tasks.id, row.id))
          }
          return 'updated' as const
        })
        if (result === 'missing') return c.json({ error: 'Task not found' }, 404)
        if (result === 'forbidden') return c.json({ error: 'Owner or editor required' }, 403)
        if (result === 'invalid')
          return c.json({ error: 'Assignee must be a member of this workspace' }, 400)
        if (result === 'invalidMilestone')
          return c.json({ error: 'Milestone must belong to this project' }, 400)
        const task = await taskDetails(db, id, actorId)
        if (!task) return c.json({ error: 'Task not found' }, 404)
        return c.json({ task }, 200)
      },
      invalid,
    )
    .openapi(
      deleteRoute,
      async (c) => {
        const id = c.req.valid('param').id
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible = await visibleTask(db, id, actorId)
        if (!visible) return c.json({ error: 'Task not found' }, 404)
        if (!isWritable(visible.role)) return c.json({ error: 'Owner or editor required' }, 403)
        const result = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, visible.workspaceId))
            .for('no key update')
          const [actor] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, visible.workspaceId),
                eq(memberships.userId, actorId),
              ),
            )
          if (!actor) return 'missing' as const
          if (!isWritable(actor.role)) return 'forbidden' as const
          const [task] = await tx
            .select({ id: tasks.id })
            .from(tasks)
            .innerJoin(projects, eq(projects.id, tasks.projectId))
            .where(
              and(
                eq(tasks.id, id),
                eq(projects.workspaceId, visible.workspaceId),
                isNull(projects.deletedAt),
              ),
            )
            .for('no key update')
          if (!task) return 'missing' as const
          await tx.delete(tasks).where(eq(tasks.id, id))
          return 'deleted' as const
        })
        if (result === 'missing') return c.json({ error: 'Task not found' }, 404)
        if (result === 'forbidden') return c.json({ error: 'Owner or editor required' }, 403)
        return c.json({ ok: true as const }, 200)
      },
      invalid,
    )
}
