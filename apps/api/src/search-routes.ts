import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { memberships, projects, tasks, workspaces } from './db/schema'
import type { Env } from './env'
import { consumeRateLimit } from './rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from './workspaces/permissions'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const route = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/search',
  request: {
    params: z.object({ ws: z.string().min(1).max(63) }),
    query: z.object({ q: z.string().max(100).trim().min(1) }),
  },
  responses: {
    200: json(
      z.object({
        projects: z.array(
          z.object({
            id: z.uuid(),
            key: z.string(),
            name: z.string(),
            status: z.enum(['draft', 'planning', 'in-progress', 'completed', 'archived']),
          }),
        ),
        tasks: z.array(
          z.object({
            id: z.uuid(),
            key: z.string(),
            title: z.string(),
            status: z.enum(['todo', 'in_progress', 'done']),
            projectId: z.uuid(),
            projectName: z.string(),
          }),
        ),
      }),
      'Search results',
    ),
    400: json(error, 'Invalid search query'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Workspace not found'),
    429: json(error, 'Search limit reached'),
  },
})
export function createSearchRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  app.use('/workspaces/:ws/search', useDb(options.database), requireSession(options.auth))
  return app.openapi(
    route,
    async (c) => {
      const db = c.get('db'),
        actorId = c.get('user').id,
        ws = c.req.valid('param').ws,
        q = c.req.valid('query').q
      const [member] = await db
        .select({ workspaceId: memberships.workspaceId })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(and(eq(memberships.userId, actorId), eq(workspaces.slug, ws)))
      if (!member) return c.json({ error: 'Workspace not found' }, 404)
      if (!(await consumeRateLimit(db, 'workspace-search', actorId, 1, 60, 60_000)))
        return c.json({ error: 'Too many searches. Try again in a minute.' }, 429)
      // Only lexemes enter the parameterized tsquery; punctuation never becomes query syntax.
      const words = q.match(/[\p{L}\p{N}]+/gu) ?? []
      if (!words.length) return c.json({ projects: [], tasks: [] }, 200)
      const query = sql`to_tsquery('simple', ${words.map((word) => `${word}:*`).join(' & ')})`
      const scope = and(eq(projects.workspaceId, member.workspaceId), isNull(projects.deletedAt))
      const text = q.toLowerCase()
      const projectScore = sql<number>`case when lower(${projects.key})=${text} or lower(${projects.name})=${text} then 3 when starts_with(lower(${projects.name}),${text}) or starts_with(lower(${projects.key}),${text}) then 2 else 1 end`
      const foundProjects = await db
        .select({
          id: projects.id,
          key: projects.key,
          name: projects.name,
          status: projects.status,
        })
        .from(projects)
        .where(and(scope, sql`${projects.search} @@ ${query}`))
        .orderBy(
          desc(projectScore),
          sql`ts_rank_cd(${projects.search},${query}) desc`,
          asc(projects.name),
          asc(projects.id),
        )
        .limit(5)
      const taskKey = sql<string>`${projects.key} || '-' || ${tasks.number}::text`
      const exactKey = sql`lower(${taskKey})=${text}`
      const keyPrefix = sql`starts_with(lower(${taskKey}),${text})`
      const taskScore = sql<number>`case when ${exactKey} then 4 when ${keyPrefix} then 3 when starts_with(lower(${tasks.title}),${text}) then 2 else 1 end`
      const foundTasks = await db
        .select({
          id: tasks.id,
          key: taskKey,
          title: tasks.title,
          status: tasks.status,
          projectId: projects.id,
          projectName: projects.name,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(scope, or(exactKey, keyPrefix, sql`${tasks.search} @@ ${query}`)))
        .orderBy(
          desc(taskScore),
          sql`ts_rank_cd(${tasks.search},${query}) desc`,
          asc(tasks.title),
          asc(tasks.id),
        )
        .limit(8)
      return c.json({ projects: foundProjects, tasks: foundTasks }, 200)
    },
    (result, c) => {
      if (!result.success)
        return c.json({ error: 'Search must be between 1 and 100 characters' }, 400)
    },
  )
}
