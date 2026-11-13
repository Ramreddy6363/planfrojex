import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { memberships, projects, stars, user, workspaces } from '../db/schema'
import type { Env } from '../env'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireMember,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const templates = [
  { id: 'blank', name: 'Blank project', description: 'Write the brief yourself', brief: '' },
  {
    id: 'saas',
    name: 'SaaS MVP',
    description: 'Accounts, billing, admin',
    brief: 'Describe the customer problem and the first useful release.',
  },
  {
    id: 'ml',
    name: 'ML product',
    description: 'Data pipeline, model, review',
    brief: 'Describe the problem, the available data, and how results will be reviewed.',
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    description: 'iOS and Android release',
    brief: 'Describe the people using the app and the problem it solves.',
  },
  {
    id: 'commerce',
    name: 'E-commerce',
    description: 'Catalog, cart, checkout',
    brief: 'Describe the shopping experience and customer problem.',
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Case studies, contact',
    brief: 'Describe the audience and the work to present.',
  },
] as const
const template = z.enum(['blank', 'saas', 'ml', 'mobile', 'commerce', 'portfolio'])
const status = z.enum(['draft', 'planning', 'in-progress', 'completed', 'archived'])
const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const project = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  status,
  leadId: z.string(),
  leadName: z.string(),
  targetDate: z.string().nullable(),
  brief: z.object({ problem: z.string() }),
  starred: z.boolean(),
  updatedAt: z.string(),
})
const query = z.object({
  view: z.enum(['all', 'active', 'mine', 'starred']).default('all'),
  status: status.optional(),
  lead: z.string().optional(),
  dueBefore: z.iso.date().optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
const listRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/projects',
  middleware: [requireMember] as const,
  request: { params: z.object({ ws: z.string() }), query },
  responses: {
    200: json(
      z.object({
        projects: z.array(project),
        counts: z.object({
          all: z.number(),
          active: z.number(),
          mine: z.number(),
          starred: z.number(),
        }),
        nextCursor: z.string().nullable(),
      }),
      'Projects',
    ),
    400: json(error, 'Invalid filter'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Workspace not found'),
  },
})
const createRouteDef = createRoute({
  method: 'post',
  path: '/workspaces/{ws}/projects',
  middleware: [requireMember] as const,
  request: {
    params: z.object({ ws: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().trim().min(1).max(200),
            brief: z.string().max(20000),
            leadId: z.string().min(1).max(128),
            targetDate: z.iso.date().nullable(),
            template,
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    201: json(z.object({ project }), 'Created'),
    400: json(error, 'Invalid project'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Editor required'),
    404: json(error, 'Workspace not found'),
  },
})
const templatesRoute = createRoute({
  method: 'get',
  path: '/templates',
  responses: {
    200: json(
      z.object({
        templates: z.array(
          z.object({ id: template, name: z.string(), description: z.string(), brief: z.string() }),
        ),
      }),
      'Templates',
    ),
    401: json(error, 'Sign in required'),
  },
})
const starSchema = { params: z.object({ id: z.uuid() }) }
const starResponses = {
  200: json(z.object({ ok: z.literal(true) }), 'Updated'),
  400: json(error, 'Invalid project'),
  401: json(error, 'Sign in required'),
  404: json(error, 'Project not found'),
}
const starRoute = createRoute({
  method: 'put',
  path: '/projects/{id}/star',
  request: starSchema,
  responses: starResponses,
})
const unstarRoute = createRoute({
  method: 'delete',
  path: '/projects/{id}/star',
  request: starSchema,
  responses: starResponses,
})
const invalid = (
  result: { success: boolean },
  c: { json: (body: { error: string }, status: 400) => any },
) => {
  if (!result.success) return c.json({ error: 'Invalid project details' }, 400)
}

export function createProjectRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  for (const path of ['/workspaces/*', '/projects/*', '/templates'])
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
  return app
    .openapi(templatesRoute, (c) => c.json({ templates: [...templates] }, 200))
    .openapi(
      listRoute,
      async (c) => {
        const ws = c.get('membership').id
        const userId = c.get('user').id
        const filters = c.req.valid('query')
        const db = c.get('db')
        const base = and(eq(projects.workspaceId, ws), isNull(projects.deletedAt))
        const [totals] = await db
          .select({
            all: sql<number>`count(*)::int`,
            active: sql<number>`count(*) filter (where ${projects.status} in ('planning', 'in-progress'))::int`,
            mine: sql<number>`count(*) filter (where ${projects.leadId} = ${userId})::int`,
            starred: sql<number>`count(*) filter (where ${stars.projectId} is not null)::int`,
          })
          .from(projects)
          .leftJoin(stars, and(eq(stars.projectId, projects.id), eq(stars.userId, userId)))
          .where(base)
        const [cursorRow] = filters.cursor
          ? await db
              .select({ id: projects.id, updatedAt: projects.updatedAt })
              .from(projects)
              .where(and(base, eq(projects.id, filters.cursor)))
          : []
        if (filters.cursor && !cursorRow) return c.json({ error: 'Invalid project cursor' }, 400)
        const rows = await db
          .select({
            id: projects.id,
            key: projects.key,
            name: projects.name,
            status: projects.status,
            leadId: projects.leadId,
            leadName: user.name,
            targetDate: projects.targetDate,
            brief: projects.brief,
            updatedAt: projects.updatedAt,
            starredId: stars.projectId,
          })
          .from(projects)
          .innerJoin(user, eq(user.id, projects.leadId))
          .leftJoin(stars, and(eq(stars.projectId, projects.id), eq(stars.userId, userId)))
          .where(
            and(
              base,
              filters.view === 'active'
                ? inArray(projects.status, ['planning', 'in-progress'])
                : undefined,
              filters.view === 'mine' ? eq(projects.leadId, userId) : undefined,
              filters.view === 'starred' ? isNotNull(stars.projectId) : undefined,
              filters.status ? eq(projects.status, filters.status) : undefined,
              filters.lead ? eq(projects.leadId, filters.lead) : undefined,
              filters.dueBefore ? lte(projects.targetDate, filters.dueBefore) : undefined,
              cursorRow
                ? sql`(${projects.updatedAt}, ${projects.id}) < (select updated_at, id from ${projects} where id = ${cursorRow.id} and workspace_id = ${ws})`
                : undefined,
            ),
          )
          .orderBy(desc(projects.updatedAt), desc(projects.id))
          .limit(filters.limit + 1)
        const page = rows.slice(0, filters.limit).map(({ starredId, updatedAt, ...row }) => ({
          ...row,
          starred: Boolean(starredId),
          updatedAt: updatedAt.toISOString(),
        }))
        return c.json(
          {
            projects: page,
            counts: totals ?? { all: 0, active: 0, mine: 0, starred: 0 },
            nextCursor: rows.length > filters.limit ? (page[page.length - 1]?.id ?? null) : null,
          },
          200,
        )
      },
      invalid,
    )
    .openapi(
      createRouteDef,
      async (c) => {
        const membership = c.get('membership')
        if (membership.role === 'viewer')
          return c.json({ error: 'Only owners and editors can create projects' }, 403)
        const input = c.req.valid('json')
        const db = c.get('db')
        const result = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, membership.id))
            .for('no key update')
          const [actor] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, membership.id),
                eq(memberships.userId, c.get('user').id),
              ),
            )
          if (!actor || actor.role === 'viewer') return { kind: 'forbidden' as const }
          const [lead] = await tx
            .select({ name: user.name })
            .from(memberships)
            .innerJoin(user, eq(user.id, memberships.userId))
            .where(
              and(eq(memberships.workspaceId, membership.id), eq(memberships.userId, input.leadId)),
            )
          if (!lead) return { kind: 'invalid' as const }
          const prefix =
            input.name
              .normalize('NFKD')
              .replace(/[^a-zA-Z0-9]+/g, '')
              .slice(0, 8)
              .toUpperCase() || 'PROJECT'
          const existing = await tx
            .select({ key: projects.key })
            .from(projects)
            .where(eq(projects.workspaceId, membership.id))
          const keys = new Set(existing.map((p) => p.key))
          let key = prefix
          for (let n = 2; keys.has(key); n++) key = `${prefix}${n}`
          const [created] = await tx
            .insert(projects)
            .values({
              workspaceId: membership.id,
              key,
              name: input.name,
              brief: { problem: input.brief },
              leadId: input.leadId,
              createdBy: c.get('user').id,
              targetDate: input.targetDate,
            })
            .returning()
          if (!created) throw new Error('Project was not created')
          return {
            kind: 'created' as const,
            value: {
              id: created.id,
              key: created.key,
              name: created.name,
              status: created.status,
              brief: created.brief,
              leadId: created.leadId,
              leadName: lead.name,
              targetDate: created.targetDate,
              starred: false,
              updatedAt: created.updatedAt.toISOString(),
            },
          }
        })
        if (result.kind === 'forbidden')
          return c.json({ error: 'Only owners and editors can create projects' }, 403)
        if (result.kind === 'invalid')
          return c.json({ error: 'Choose a workspace member as lead' }, 400)
        return c.json({ project: result.value }, 201)
      },
      invalid,
    )
    .openapi(
      starRoute,
      async (c) => {
        const id = c.req.valid('param').id
        const db = c.get('db')
        const [visible] = await db
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(
            memberships,
            and(
              eq(memberships.workspaceId, projects.workspaceId),
              eq(memberships.userId, c.get('user').id),
            ),
          )
          .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
        if (!visible) return c.json({ error: 'Project not found' }, 404)
        await db
          .insert(stars)
          .values({ userId: c.get('user').id, projectId: id })
          .onConflictDoNothing()
        return c.json({ ok: true as const }, 200)
      },
      invalid,
    )
    .openapi(
      unstarRoute,
      async (c) => {
        const id = c.req.valid('param').id
        const db = c.get('db')
        const [visible] = await db
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(
            memberships,
            and(
              eq(memberships.workspaceId, projects.workspaceId),
              eq(memberships.userId, c.get('user').id),
            ),
          )
          .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
        if (!visible) return c.json({ error: 'Project not found' }, 404)
        await db
          .delete(stars)
          .where(and(eq(stars.projectId, id), eq(stars.userId, c.get('user').id)))
        return c.json({ ok: true as const }, 200)
      },
      invalid,
    )
}
