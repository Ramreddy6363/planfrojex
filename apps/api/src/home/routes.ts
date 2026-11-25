import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { activity, projects, user } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireMember,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const recentRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/activity',
  middleware: [requireMember] as const,
  request: {
    params: z.object({ ws: z.string() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) }),
  },
  responses: {
    200: json(
      z.object({
        activity: z.array(
          z.object({
            id: z.uuid(),
            type: z.string(),
            actorName: z.string(),
            projectId: z.uuid(),
            projectName: z.string(),
            createdAt: z.string(),
          }),
        ),
      }),
      'Recent workspace activity',
    ),
    400: json(error, 'Invalid limit'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Workspace not found'),
  },
})

// Read-only feed for Home: newest events across the workspace's projects.
export function createHomeRoutes(options: { database?: DatabaseFactory; auth?: AuthFactory } = {}) {
  const app = new OpenAPIHono<Env>()
  app.use('/workspaces/*', useDb(options.database), requireSession(options.auth))
  return app.openapi(
    recentRoute,
    async (c) => {
      const rows = await c
        .get('db')
        .select({
          id: activity.id,
          type: activity.type,
          actorName: sql<string>`case when ${activity.type} in ('review.approved', 'review.changes_requested') then 'External reviewer' else coalesce(${user.name}, 'Deleted user') end`,
          projectId: projects.id,
          projectName: projects.name,
          createdAt: activity.createdAt,
        })
        .from(activity)
        .innerJoin(projects, eq(projects.id, activity.projectId))
        .leftJoin(user, eq(user.id, activity.actorId))
        .where(
          and(
            eq(activity.workspaceId, c.get('membership').id),
            eq(projects.workspaceId, c.get('membership').id),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(desc(activity.createdAt), desc(activity.id))
        .limit(c.req.valid('query').limit)
      return c.json(
        { activity: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) },
        200,
      )
    },
    (result, c) => {
      if (!result.success) return c.json({ error: 'Invalid limit' }, 400)
    },
  )
}
