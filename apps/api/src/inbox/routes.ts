import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  activity,
  comments,
  memberships,
  notifications,
  projects,
  tasks,
  user,
  workspaces,
} from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const ok = z.object({ ok: z.literal(true) })
const cursorSchema = z.object({ time: z.iso.datetime({ offset: true }), id: z.uuid() }).strict()
const itemSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid(),
  type: z.enum(['mention', 'assigned', 'reply', 'draft_decision']),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  actor: z.object({ id: z.string().nullable(), name: z.string(), image: z.string().nullable() }),
  project: z.object({ id: z.uuid(), name: z.string() }),
  task: z
    .object({
      id: z.uuid(),
      key: z.string(),
      title: z.string(),
      status: z.enum(['todo', 'in_progress', 'done']),
      dueDate: z.string().nullable(),
    })
    .nullable(),
  comment: z
    .object({
      id: z.uuid(),
      body: z.string(),
      target: z.enum(['project', 'task']),
      taskId: z.uuid().nullable(),
    })
    .nullable(),
  target: z.string().nullable(),
  section: z.string().nullable(),
  outcome: z.string().nullable(),
})
const list = createRoute({
  method: 'get',
  path: '/inbox',
  request: {
    query: z.object({
      ws: z.string().min(1).max(63),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  },
  responses: {
    200: json(
      z.object({
        items: z.array(itemSchema),
        unreadCount: z.number(),
        nextCursor: z.string().nullable(),
      }),
      'Inbox',
    ),
    400: json(error, 'Invalid inbox query'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Workspace not found'),
  },
})
const read = createRoute({
  method: 'post',
  path: '/inbox/{id}/read',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: json(ok, 'Marked read'),
    400: json(error, 'Invalid notification'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Notification not found'),
  },
})
const readAll = createRoute({
  method: 'post',
  path: '/inbox/read-all',
  request: { query: z.object({ ws: z.string().min(1).max(63) }) },
  responses: {
    200: json(ok, 'All marked read'),
    400: json(error, 'Invalid workspace'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Workspace not found'),
  },
})
export function createInboxRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  app.use('/inbox', useDb(options.database), requireSession(options.auth))
  app.use('/inbox/*', useDb(options.database), requireSession(options.auth))
  return app
    .openapi(
      list,
      async (c) => {
        const db = c.get('db'),
          userId = c.get('user').id,
          query = c.req.valid('query')
        const [member] = await db
          .select({ workspaceId: memberships.workspaceId })
          .from(memberships)
          .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
          .where(and(eq(memberships.userId, userId), eq(workspaces.slug, query.ws)))
        if (!member) return c.json({ error: 'Workspace not found' }, 404)
        let cursor: z.infer<typeof cursorSchema> | undefined
        if (query.cursor)
          try {
            cursor = cursorSchema.parse(JSON.parse(atob(query.cursor)))
          } catch {
            return c.json({ error: 'Invalid inbox cursor' }, 400)
          }
        const scope = and(
          eq(notifications.userId, userId),
          eq(notifications.workspaceId, member.workspaceId),
          eq(activity.workspaceId, member.workspaceId),
          eq(projects.workspaceId, member.workspaceId),
          isNull(projects.deletedAt),
        )
        const [count] = await db
          .select({ unreadCount: sql<number>`count(*)::int` })
          .from(notifications)
          .innerJoin(activity, eq(activity.id, notifications.activityId))
          .innerJoin(projects, eq(projects.id, activity.projectId))
          .where(and(scope, isNull(notifications.readAt)))
        const rows = await db
          .select({
            id: notifications.id,
            activityId: notifications.activityId,
            type: notifications.type,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
            cursorTime: sql<string>`to_char(${notifications.createdAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            actorId: user.id,
            actorName: sql<string>`coalesce(${user.name}, 'Deleted user')`,
            actorImage: user.image,
            projectId: projects.id,
            projectName: projects.name,
            projectKey: projects.key,
            taskId: tasks.id,
            taskNumber: tasks.number,
            taskTitle: tasks.title,
            taskStatus: tasks.status,
            taskDueDate: tasks.dueDate,
            commentId: comments.id,
            commentBody: comments.body,
            commentTarget: comments.target,
            commentTaskId: comments.taskId,
            payload: activity.payload,
            eventType: activity.type,
            subject: activity.subject,
          })
          .from(notifications)
          .innerJoin(activity, eq(activity.id, notifications.activityId))
          .innerJoin(projects, eq(projects.id, activity.projectId))
          .leftJoin(user, eq(user.id, activity.actorId))
          .leftJoin(
            comments,
            and(
              eq(sql<string>`${comments.id}::text`, activity.subject),
              eq(comments.projectId, activity.projectId),
              inArray(activity.type, ['comment.added', 'comment.mentioned']),
            ),
          )
          .leftJoin(
            tasks,
            and(
              eq(tasks.projectId, projects.id),
              eq(
                sql<string>`${tasks.id}::text`,
                sql<string>`coalesce(${comments.taskId}::text, ${activity.payload}->>'taskId', case when ${activity.type} like 'task.%' then ${activity.subject} end)`,
              ),
            ),
          )
          .where(
            and(
              scope,
              cursor
                ? sql`(${notifications.createdAt}<${cursor.time}::timestamptz or (${notifications.createdAt}=${cursor.time}::timestamptz and ${notifications.id}>${cursor.id}::uuid))`
                : undefined,
            ),
          )
          .orderBy(sql`${notifications.createdAt} desc nulls last`, asc(notifications.id))
          .limit(query.limit + 1)
        const page = rows.slice(0, query.limit),
          last = page.at(-1)
        return c.json(
          {
            items: page.map((row) => ({
              id: row.id,
              activityId: row.activityId,
              type: row.type,
              readAt: row.readAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              actor: { id: row.actorId, name: row.actorName, image: row.actorImage },
              project: { id: row.projectId, name: row.projectName },
              task:
                row.taskId && row.taskStatus
                  ? {
                      id: row.taskId,
                      key: `${row.projectKey}-${row.taskNumber}`,
                      title: row.taskTitle ?? '',
                      status: row.taskStatus,
                      dueDate: row.taskDueDate,
                    }
                  : null,
              comment:
                row.commentId && row.commentTarget
                  ? {
                      id: row.commentId,
                      body: row.commentBody ?? '',
                      target: row.commentTarget,
                      taskId: row.commentTaskId,
                    }
                  : null,
              target: (() => {
                const payloadTaskId = row.payload.taskId
                const taskTargetId =
                  typeof payloadTaskId === 'string'
                    ? payloadTaskId
                    : row.eventType.startsWith('task.')
                      ? row.subject
                      : row.commentTaskId
                if (taskTargetId) return `task:${taskTargetId}`
                return ['comment.added', 'comment.mentioned'].includes(row.eventType)
                  ? `project:${row.projectId}`
                  : null
              })(),
              section: typeof row.payload.section === 'string' ? row.payload.section : null,
              outcome: typeof row.payload.after === 'string' ? row.payload.after : null,
            })),
            unreadCount: count?.unreadCount ?? 0,
            nextCursor:
              rows.length > query.limit && last
                ? btoa(JSON.stringify({ time: last.cursorTime, id: last.id }))
                : null,
          },
          200,
        )
      },
      (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid inbox details' }, 400)
      },
    )
    .openapi(
      readAll,
      async (c) => {
        const db = c.get('db'),
          userId = c.get('user').id,
          ws = c.req.valid('query').ws
        const result = await db.transaction(async (tx) => {
          const [member] = await tx
            .select({ workspaceId: memberships.workspaceId })
            .from(memberships)
            .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
            .where(and(eq(memberships.userId, userId), eq(workspaces.slug, ws)))
            .for('key share', { of: memberships })
          if (!member) return false
          await tx
            .update(notifications)
            .set({ readAt: new Date() })
            .where(
              and(
                eq(notifications.userId, userId),
                eq(notifications.workspaceId, member.workspaceId),
                isNull(notifications.readAt),
              ),
            )
          return true
        })
        return result
          ? c.json({ ok: true as const }, 200)
          : c.json({ error: 'Workspace not found' }, 404)
      },
      (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid inbox details' }, 400)
      },
    )
    .openapi(
      read,
      async (c) => {
        const db = c.get('db'),
          userId = c.get('user').id,
          id = c.req.valid('param').id
        const result = await db.transaction(async (tx) => {
          const [visible] = await tx
            .select({ workspaceId: memberships.workspaceId })
            .from(notifications)
            .innerJoin(
              memberships,
              and(
                eq(memberships.workspaceId, notifications.workspaceId),
                eq(memberships.userId, userId),
              ),
            )
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .for('key share', { of: memberships })
          if (!visible) return false
          await tx
            .update(notifications)
            .set({ readAt: sql`coalesce(${notifications.readAt},now())` })
            .where(
              and(
                eq(notifications.id, id),
                eq(notifications.userId, userId),
                eq(notifications.workspaceId, visible.workspaceId),
              ),
            )
          return true
        })
        return result
          ? c.json({ ok: true as const }, 200)
          : c.json({ error: 'Notification not found' }, 404)
      },
      (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid inbox details' }, 400)
      },
    )
}
