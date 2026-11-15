import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { activity, memberships, projects, tasks, workspaces } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const view = z.enum(['assigned', 'created', 'completed'])
const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const cursorSchema = z
  .object({
    view,
    id: z.uuid(),
    dueDate: z.iso.date().nullable(),
    time: z.iso.datetime({ offset: true }),
  })
  .strict()
const listRoute = createRoute({
  method: 'get',
  path: '/me/tasks',
  request: {
    query: z.object({
      ws: z.string().min(1).max(63),
      view: view.default('assigned'),
      project: z.uuid().optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: json(
      z.object({
        tasks: z.array(
          z.object({
            id: z.uuid(),
            projectId: z.uuid(),
            projectKey: z.string(),
            projectName: z.string(),
            number: z.number().int(),
            key: z.string(),
            title: z.string(),
            status: z.enum(['todo', 'in_progress', 'done']),
            priority: z.enum(['low', 'medium', 'high']),
            dueDate: z.string().nullable(),
            createdBy: z.string().nullable(),
            assigneeId: z.string().nullable(),
            updatedAt: z.string(),
          }),
        ),
        counts: z.object({ assigned: z.number(), created: z.number(), completed: z.number() }),
        nextCursor: z.string().nullable(),
      }),
      'My tasks',
    ),
    400: json(error, 'Invalid task filters'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Workspace or project not found'),
  },
})

export function createMyTaskRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  app.use('/me/tasks', useDb(options.database), requireSession(options.auth))
  return app.openapi(
    listRoute,
    async (c) => {
      const db = c.get('db'),
        userId = c.get('user').id,
        query = c.req.valid('query')
      const [membership] = await db
        .select({ workspaceId: memberships.workspaceId })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(and(eq(memberships.userId, userId), eq(workspaces.slug, query.ws)))
      if (!membership) return c.json({ error: 'Workspace not found' }, 404)
      if (query.project) {
        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, query.project),
              eq(projects.workspaceId, membership.workspaceId),
              isNull(projects.deletedAt),
            ),
          )
        if (!project) return c.json({ error: 'Project not found' }, 404)
      }
      let cursor: z.infer<typeof cursorSchema> | undefined
      if (query.cursor) {
        try {
          cursor = cursorSchema.parse(JSON.parse(atob(query.cursor)))
          if (cursor.view !== query.view) throw new Error()
        } catch {
          return c.json({ error: 'Invalid task cursor' }, 400)
        }
      }
      const scope = and(
        eq(projects.workspaceId, membership.workspaceId),
        isNull(projects.deletedAt),
        query.project ? eq(projects.id, query.project) : undefined,
      )
      const assigned = and(eq(tasks.assigneeId, userId), sql`${tasks.status} <> 'done'`)
      const created = and(eq(tasks.createdBy, userId), sql`${tasks.status} <> 'done'`)
      const completedAt = sql<Date>`coalesce(
        (select max(${activity.createdAt}) from ${activity}
          where ${activity.subject} = ${tasks.id}::text
            and ${activity.workspaceId} = ${membership.workspaceId}
            and ${activity.projectId} = ${tasks.projectId}
            and (
              (${activity.type} = 'task.status_changed' and ${activity.payload}->>'after' = 'done')
              or (${activity.type} = 'task.created' and ${activity.payload}->'after'->>'status' = 'done')
            )),
        ${tasks.updatedAt}
      )`
      const completed = and(
        eq(tasks.assigneeId, userId),
        eq(tasks.status, 'done'),
        sql`${completedAt} >= now() - interval '90 days'`,
      )
      const [counts] = await db
        .select({
          assigned: sql<number>`count(*) filter (where ${assigned})::int`,
          created: sql<number>`count(*) filter (where ${created})::int`,
          completed: sql<number>`count(*) filter (where ${completed})::int`,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(scope)
      const afterCursor = !cursor
        ? undefined
        : query.view === 'completed'
          ? sql`(${completedAt} < ${cursor.time}::timestamptz or (${completedAt} = ${cursor.time}::timestamptz and ${tasks.id} > ${cursor.id}::uuid))`
          : cursor.dueDate === null
            ? and(isNull(tasks.dueDate), sql`${tasks.id} > ${cursor.id}::uuid`)
            : sql`(${tasks.dueDate} > ${cursor.dueDate}::date or ${tasks.dueDate} is null or (${tasks.dueDate} = ${cursor.dueDate}::date and ${tasks.id} > ${cursor.id}::uuid))`
      const rows = await db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          projectKey: projects.key,
          projectName: projects.name,
          number: tasks.number,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          createdBy: tasks.createdBy,
          assigneeId: tasks.assigneeId,
          updatedAt: tasks.updatedAt,
          cursorTime: sql<string>`to_char(${query.view === 'completed' ? completedAt : tasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(
          and(
            scope,
            query.view === 'assigned' ? assigned : query.view === 'created' ? created : completed,
            afterCursor,
          ),
        )
        .orderBy(
          query.view === 'completed'
            ? sql`${completedAt} desc`
            : sql`${tasks.dueDate} asc nulls last`,
          asc(tasks.id),
        )
        .limit(query.limit + 1)
      const values = rows.slice(0, query.limit)
      const last = values.at(-1)
      return c.json(
        {
          tasks: values.map(({ cursorTime: _cursorTime, ...row }) => ({
            ...row,
            key: `${row.projectKey}-${row.number}`,
            updatedAt: row.updatedAt.toISOString(),
          })),
          counts: counts ?? { assigned: 0, created: 0, completed: 0 },
          nextCursor:
            rows.length > query.limit && last
              ? btoa(
                  JSON.stringify({
                    view: query.view,
                    id: last.id,
                    dueDate: last.dueDate,
                    time: last.cursorTime,
                  }),
                )
              : null,
        },
        200,
      )
    },
    (result, c) => {
      if (!result.success) return c.json({ error: 'Invalid task filters' }, 400)
    },
  )
}
