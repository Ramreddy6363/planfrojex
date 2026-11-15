import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { activity, comments, memberships, projects, user } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import { activityCategories, activityTypes, categoryFor } from './service'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const cursorSchema = z
  .object({
    time: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict()
const listRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/activity',
  request: {
    params: z.object({ id: z.uuid() }),
    query: z.object({
      actor: z.string().min(1).max(128).optional(),
      category: z.enum(activityCategories).optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  },
  responses: {
    200: json(
      z.object({
        activity: z.array(
          z.object({
            id: z.uuid(),
            actorId: z.string().nullable(),
            actorName: z.string(),
            actorImage: z.string().nullable(),
            type: z.string(),
            category: z.enum(activityCategories),
            subject: z.string().nullable(),
            payload: z.record(z.string(), z.unknown()),
            createdAt: z.string(),
            comment: z
              .object({
                text: z.string(),
                target: z.enum(['project', 'task']),
                taskId: z.uuid().nullable(),
              })
              .nullable(),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      'Project activity',
    ),
    400: json(error, 'Invalid activity filter'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
export function createActivityRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  app.use('/projects/*', useDb(options.database), requireSession(options.auth))
  return app.openapi(
    listRoute,
    async (c) => {
      const db = c.get('db'),
        actorId = c.get('user').id,
        id = c.req.valid('param').id,
        query = c.req.valid('query')
      const [project] = await db
        .select({ id: projects.id, workspaceId: memberships.workspaceId })
        .from(projects)
        .innerJoin(
          memberships,
          and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actorId)),
        )
        .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (query.actor) {
        const [member] = await db
          .select({ id: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, project.workspaceId),
              eq(memberships.userId, query.actor),
            ),
          )
        if (!member) return c.json({ error: 'Choose a member of this workspace' }, 400)
      }
      let cursor: z.infer<typeof cursorSchema> | undefined
      if (query.cursor) {
        try {
          const parsed = cursorSchema.safeParse(JSON.parse(atob(query.cursor)))
          if (!parsed.success) throw new Error()
          cursor = parsed.data
        } catch {
          return c.json({ error: 'Invalid activity cursor' }, 400)
        }
      }
      const types = query.category
        ? activityTypes.filter((type) => categoryFor(type) === query.category)
        : undefined
      const rows = await db
        .select({
          id: activity.id,
          actorId: activity.actorId,
          actorName: sql<string>`coalesce(${user.name}, 'Deleted user')`,
          actorImage: user.image,
          type: activity.type,
          subject: activity.subject,
          payload: activity.payload,
          createdAt: activity.createdAt,
          cursorTime: sql<string>`to_char(${activity.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          commentText: comments.body,
          commentTarget: comments.target,
          commentTaskId: comments.taskId,
        })
        .from(activity)
        .leftJoin(user, eq(user.id, activity.actorId))
        .leftJoin(
          comments,
          and(
            eq(sql<string>`${comments.id}::text`, activity.subject),
            eq(comments.projectId, activity.projectId),
            inArray(activity.type, ['comment.added', 'comment.mentioned']),
          ),
        )
        .where(
          and(
            eq(activity.projectId, project.id),
            eq(activity.workspaceId, project.workspaceId),
            query.actor ? eq(activity.actorId, query.actor) : undefined,
            types ? inArray(activity.type, types) : undefined,
            cursor
              ? sql`(${activity.createdAt} < ${cursor.time}::timestamptz or (${activity.createdAt} = ${cursor.time}::timestamptz and ${activity.id} > ${cursor.id}::uuid))`
              : undefined,
          ),
        )
        .orderBy(sql`${activity.createdAt} desc nulls last`, asc(activity.id))
        .limit(query.limit + 1)
      const page = rows.slice(0, query.limit),
        last = page.at(-1)
      return c.json(
        {
          activity: page.map(
            ({ cursorTime: _cursor, commentText, commentTarget, commentTaskId, ...row }) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
              category: categoryFor(row.type),
              comment:
                commentText !== null && commentTarget
                  ? { text: commentText, target: commentTarget, taskId: commentTaskId }
                  : null,
            }),
          ),
          nextCursor:
            rows.length > query.limit && last
              ? btoa(JSON.stringify({ time: last.cursorTime, id: last.id }))
              : null,
        },
        200,
      )
    },
    (result, c) => {
      if (!result.success) return c.json({ error: 'Invalid activity filters' }, 400)
    },
  )
}
