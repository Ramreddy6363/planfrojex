import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { comments, memberships, projects, stars, tasks, user, workspaces } from '../db/schema'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'

const status = z.enum(['draft', 'planning', 'in-progress', 'completed', 'archived'])
const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const briefSchema = z.object({
  problem: z.string().trim().max(20_000),
  goals: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  constraints: z.string().trim().max(5_000).default(''),
  outOfScope: z.string().trim().max(5_000).default(''),
})
const briefPatchSchema = z
  .object({
    problem: z.string().trim().max(20_000).optional(),
    goals: z.array(z.string().trim().min(1).max(1_000)).max(20).optional(),
    constraints: z.string().trim().max(5_000).optional(),
    outOfScope: z.string().trim().max(5_000).optional(),
  })
  .strict()
  .refine((brief) => Object.keys(brief).length > 0, 'At least one section is required')
const projectResponse = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  status,
  leadId: z.string(),
  leadName: z.string(),
  targetDate: z.string().nullable(),
  brief: briefSchema,
  tags: z.array(z.string()),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  starred: z.boolean(),
  taskProgress: z.object({ done: z.number(), total: z.number() }),
})
const projectDetailResponse = z.object({ project: projectResponse })
const projectParams = { params: z.object({ id: z.uuid() }) }
const getProjectRoute = createRoute({
  method: 'get',
  path: '/projects/{id}',
  request: projectParams,
  responses: {
    200: json(projectDetailResponse, 'Project brief and properties'),
    400: json(error, 'Invalid project'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const patchProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: status.optional(),
    leadId: z.string().min(1).max(128).optional(),
    targetDate: z.iso.date().nullable().optional(),
    brief: briefPatchSchema.optional(),
    tags: z
      .array(z.string().trim().min(1).max(32))
      .max(10)
      .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique')
      .optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')
const patchProjectRoute = createRoute({
  method: 'patch',
  path: '/projects/{id}',
  request: {
    ...projectParams,
    body: {
      content: { 'application/json': { schema: patchProjectSchema } },
      required: true,
    },
  },
  responses: {
    200: json(projectDetailResponse, 'Updated project'),
    400: json(error, 'Invalid project details'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
  },
})
const commentTarget = z.string().regex(/^(project|task):[0-9a-f-]{36}$/i)
const commentsQuery = z.object({ target: commentTarget })
const getCommentsRoute = createRoute({
  method: 'get',
  path: '/comments',
  request: { query: commentsQuery },
  responses: {
    200: json(
      z.object({
        comments: z.array(
          z.object({
            id: z.uuid(),
            authorId: z.string(),
            authorName: z.string(),
            body: z.string(),
            mentions: z.array(z.string()),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
      'Project comments',
    ),
    400: json(error, 'Invalid comment target'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const commentInput = z.object({
  target: commentTarget,
  body: z.string().trim().min(1).max(5_000),
  mentions: z
    .array(z.string().min(1).max(128))
    .max(20)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, 'Mentions must be unique'),
})
const postCommentRoute = createRoute({
  method: 'post',
  path: '/comments',
  request: {
    body: { content: { 'application/json': { schema: commentInput } }, required: true },
  },
  responses: {
    201: json(
      z.object({
        comment: z.object({
          id: z.uuid(),
          authorId: z.string(),
          authorName: z.string(),
          body: z.string(),
          mentions: z.array(z.string()),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
      }),
      'Created comment',
    ),
    400: json(error, 'Invalid comment'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Invalid origin'),
    404: json(error, 'Project not found'),
    429: json(error, 'Comment rate limit exceeded'),
  },
})
const commentParams = { params: z.object({ id: z.uuid() }) }
const patchCommentInput = z
  .object({
    body: z.string().trim().min(1).max(5_000).optional(),
    mentions: z
      .array(z.string().min(1).max(128))
      .max(20)
      .optional()
      .refine(
        (ids) => ids === undefined || new Set(ids).size === ids.length,
        'Mentions must be unique',
      ),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')
const commentResponse = z.object({
  comment: z.object({
    id: z.uuid(),
    authorId: z.string(),
    authorName: z.string(),
    body: z.string(),
    mentions: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
})
const patchCommentRoute = createRoute({
  method: 'patch',
  path: '/comments/{id}',
  request: {
    ...commentParams,
    body: { content: { 'application/json': { schema: patchCommentInput } }, required: true },
  },
  responses: {
    200: json(commentResponse, 'Updated comment'),
    400: json(error, 'Invalid comment'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Only owners or the author can edit this comment'),
    404: json(error, 'Comment not found'),
  },
})
const deleteCommentRoute = createRoute({
  method: 'delete',
  path: '/comments/{id}',
  request: commentParams,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Deleted comment'),
    400: json(error, 'Invalid comment id'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Only owners or the author can delete this comment'),
    404: json(error, 'Comment not found'),
  },
})
const invalid = (
  result: { success: boolean },
  c: { json: (body: { error: string }, status: 400) => any },
) => {
  if (!result.success) return c.json({ error: 'Invalid project or comment details' }, 400)
}

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
function parseCommentTarget(value: string) {
  const separator = value.indexOf(':')
  const kind = value.slice(0, separator)
  const parsed = z.uuid().safeParse(value.slice(separator + 1))
  return parsed.success && (kind === 'project' || kind === 'task')
    ? { kind: kind as 'project' | 'task', id: parsed.data }
    : null
}
async function visibleTaskCommentTarget(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({ taskId: tasks.id, projectId: tasks.projectId, workspaceId: projects.workspaceId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(tasks.id, id), isNull(projects.deletedAt)))
  return row
}
async function projectDetails(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      status: projects.status,
      leadId: projects.leadId,
      leadName: user.name,
      targetDate: projects.targetDate,
      brief: projects.brief,
      tags: projects.tags,
      createdAt: projects.createdAt,
      createdBy: projects.createdBy,
      starredId: stars.projectId,
    })
    .from(projects)
    .innerJoin(user, eq(user.id, projects.leadId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .leftJoin(stars, and(eq(stars.projectId, projects.id), eq(stars.userId, userId)))
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
  if (!row) return null
  const [creator] = row.createdBy
    ? await db.select({ name: user.name }).from(user).where(eq(user.id, row.createdBy))
    : []
  const [taskProgress] = await db
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
    })
    .from(tasks)
    .where(eq(tasks.projectId, id))
  const brief = row.brief
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    leadId: row.leadId,
    leadName: row.leadName,
    targetDate: row.targetDate,
    brief: {
      problem: brief.problem,
      goals: brief.goals ?? [],
      constraints: brief.constraints ?? '',
      outOfScope: brief.outOfScope ?? '',
    },
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    createdBy: creator ? { id: row.createdBy as string, name: creator.name } : null,
    starred: Boolean(row.starredId),
    taskProgress: { done: taskProgress?.done ?? 0, total: taskProgress?.total ?? 0 },
  }
}
async function memberMentions(db: Db, workspaceId: string, ids: string[]) {
  if (!ids.length) return true
  const rows = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.userId, ids)))
  return rows.length === ids.length
}
async function visibleComment(db: Db, id: string, userId: string) {
  const [row] = await db
    .select({
      id: comments.id,
      projectId: comments.projectId,
      workspaceId: projects.workspaceId,
      authorId: comments.authorId,
      role: memberships.role,
    })
    .from(comments)
    .innerJoin(projects, eq(projects.id, comments.projectId))
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(comments.id, id), isNull(projects.deletedAt)))
  return row
}
async function commentDetails(db: Db, id: string) {
  const [row] = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      authorName: user.name,
      body: comments.body,
      mentions: comments.mentions,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
    })
    .from(comments)
    .innerJoin(user, eq(user.id, comments.authorId))
    .where(eq(comments.id, id))
  return row
    ? {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null
}

export function createProjectBriefRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  for (const path of ['/projects/*', '/comments', '/comments/*'])
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
    .openapi(
      getProjectRoute,
      async (c) => {
        const value = await projectDetails(c.get('db'), c.req.valid('param').id, c.get('user').id)
        if (!value) return c.json({ error: 'Project not found' }, 404)
        return c.json({ project: value }, 200)
      },
      invalid,
    )
    .openapi(
      patchProjectRoute,
      async (c) => {
        const id = c.req.valid('param').id
        const input = c.req.valid('json')
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible = await visibleProject(db, id, actorId)
        if (!visible) return c.json({ error: 'Project not found' }, 404)
        if (visible.role === 'viewer')
          return c.json({ error: 'Only owners and editors can edit projects' }, 403)
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
            .select({ id: projects.id, brief: projects.brief })
            .from(projects)
            .where(
              and(
                eq(projects.id, id),
                eq(projects.workspaceId, visible.workspaceId),
                isNull(projects.deletedAt),
              ),
            )
            .for('no key update')
          if (!actor || !project) return { kind: 'missing' as const }
          if (actor.role === 'viewer') return { kind: 'forbidden' as const }
          if (
            input.leadId &&
            !(await tx
              .select({ id: memberships.userId })
              .from(memberships)
              .where(
                and(
                  eq(memberships.workspaceId, visible.workspaceId),
                  eq(memberships.userId, input.leadId),
                ),
              )
              .then((rows) => rows.length))
          )
            return { kind: 'invalid' as const }
          const values: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() }
          if (input.name !== undefined) values.name = input.name
          if (input.status !== undefined) values.status = input.status
          if (input.leadId !== undefined) values.leadId = input.leadId
          if (input.targetDate !== undefined) values.targetDate = input.targetDate
          if (input.brief !== undefined)
            values.brief = {
              problem: input.brief.problem ?? project.brief.problem,
              goals: input.brief.goals ?? project.brief.goals ?? [],
              constraints: input.brief.constraints ?? project.brief.constraints ?? '',
              outOfScope: input.brief.outOfScope ?? project.brief.outOfScope ?? '',
            }
          if (input.tags !== undefined) values.tags = input.tags
          await tx.update(projects).set(values).where(eq(projects.id, id))
          return { kind: 'updated' as const }
        })
        if (result.kind === 'missing') return c.json({ error: 'Project not found' }, 404)
        if (result.kind === 'forbidden')
          return c.json({ error: 'Only owners and editors can edit projects' }, 403)
        if (result.kind === 'invalid')
          return c.json({ error: 'Choose a workspace member as lead' }, 400)
        const value = await projectDetails(db, id, actorId)
        if (!value) return c.json({ error: 'Project not found' }, 404)
        return c.json({ project: value }, 200)
      },
      invalid,
    )
    .openapi(
      getCommentsRoute,
      async (c) => {
        const target = parseCommentTarget(c.req.valid('query').target)
        if (!target) return c.json({ error: 'Invalid comment target' }, 400)
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible =
          target.kind === 'project'
            ? await visibleProject(db, target.id, actorId).then((row) =>
                row ? { projectId: row.id } : null,
              )
            : await visibleTaskCommentTarget(db, target.id, actorId)
        if (!visible) return c.json({ error: 'Comment target not found' }, 404)
        const rows = await c
          .get('db')
          .select({
            id: comments.id,
            authorId: comments.authorId,
            authorName: user.name,
            body: comments.body,
            mentions: comments.mentions,
            createdAt: comments.createdAt,
            updatedAt: comments.updatedAt,
          })
          .from(comments)
          .innerJoin(user, eq(user.id, comments.authorId))
          .where(
            and(
              eq(comments.projectId, visible.projectId),
              eq(comments.target, target.kind as 'project' | 'task'),
              target.kind === 'task' ? eq(comments.taskId, target.id) : isNull(comments.taskId),
            ),
          )
          .orderBy(asc(comments.createdAt), asc(comments.id))
        return c.json(
          {
            comments: rows.map((row) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            })),
          },
          200,
        )
      },
      invalid,
    )
    .openapi(
      postCommentRoute,
      async (c) => {
        const input = c.req.valid('json')
        const target = parseCommentTarget(input.target)
        if (!target) return c.json({ error: 'Invalid comment target' }, 400)
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible =
          target.kind === 'project'
            ? await visibleProject(db, target.id, actorId).then((row) =>
                row ? { projectId: row.id, workspaceId: row.workspaceId } : null,
              )
            : await visibleTaskCommentTarget(db, target.id, actorId)
        if (!visible) return c.json({ error: 'Project not found' }, 404)
        if (!(await memberMentions(db, visible.workspaceId, input.mentions)))
          return c.json({ error: 'Mentions must be workspace members' }, 400)
        if (!(await consumeRateLimit(db, 'project-comments-user', actorId, 1, 20, 3_600_000)))
          return c.json({ error: 'Too many comments. Try again later.' }, 429)
        const created = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, visible.workspaceId))
            .for('no key update')
          const stillVisible =
            target.kind === 'project'
              ? await visibleProject(tx, target.id, actorId).then((row) =>
                  row ? { projectId: row.id, workspaceId: row.workspaceId } : null,
                )
              : await visibleTaskCommentTarget(tx, target.id, actorId)
          if (!stillVisible) return { kind: 'missing' as const }
          if (!(await memberMentions(tx, stillVisible.workspaceId, input.mentions)))
            return { kind: 'invalid' as const }
          const [row] = await tx
            .insert(comments)
            .values({
              projectId: stillVisible.projectId,
              target: target.kind as 'project' | 'task',
              taskId: target.kind === 'task' ? target.id : null,
              authorId: actorId,
              body: input.body,
              mentions: input.mentions,
            })
            .returning({ id: comments.id })
          if (!row) throw new Error('Comment was not created')
          return { kind: 'created' as const, id: row.id }
        })
        if (created.kind === 'missing') return c.json({ error: 'Project not found' }, 404)
        if (created.kind === 'invalid')
          return c.json({ error: 'Mentions must be workspace members' }, 400)
        const value = await commentDetails(db, created.id)
        if (!value) throw new Error('Comment was not created')
        return c.json({ comment: value }, 201)
      },
      invalid,
    )
    .openapi(
      patchCommentRoute,
      async (c) => {
        const id = c.req.valid('param').id
        const input = c.req.valid('json')
        const db = c.get('db')
        const actorId = c.get('user').id
        const visible = await visibleComment(db, id, actorId)
        if (!visible) return c.json({ error: 'Comment not found' }, 404)
        if (visible.role !== 'owner' && visible.authorId !== actorId)
          return c.json({ error: 'Only owners or the author can edit this comment' }, 403)
        const result = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, visible.workspaceId))
            .for('no key update')
          const current = await visibleComment(tx, id, actorId)
          if (!current) return 'missing' as const
          if (current.role !== 'owner' && current.authorId !== actorId) return 'forbidden' as const
          if (input.mentions && !(await memberMentions(tx, current.workspaceId, input.mentions)))
            return 'invalid' as const
          await tx
            .update(comments)
            .set({
              ...(input.body !== undefined && { body: input.body }),
              ...(input.mentions !== undefined && { mentions: input.mentions }),
              updatedAt: new Date(),
            })
            .where(eq(comments.id, id))
          return 'updated' as const
        })
        if (result === 'missing') return c.json({ error: 'Comment not found' }, 404)
        if (result === 'forbidden')
          return c.json({ error: 'Only owners or the author can edit this comment' }, 403)
        if (result === 'invalid')
          return c.json({ error: 'Mentions must be workspace members' }, 400)
        const value = await commentDetails(db, id)
        if (!value) return c.json({ error: 'Comment not found' }, 404)
        return c.json({ comment: value }, 200)
      },
      invalid,
    )
    .openapi(deleteCommentRoute, async (c) => {
      const id = c.req.valid('param').id
      const db = c.get('db')
      const actorId = c.get('user').id
      const visible = await visibleComment(db, id, actorId)
      if (!visible) return c.json({ error: 'Comment not found' }, 404)
      if (visible.role !== 'owner' && visible.authorId !== actorId)
        return c.json({ error: 'Only owners or the author can delete this comment' }, 403)
      const result = await db.transaction(async (tx) => {
        await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.id, visible.workspaceId))
          .for('no key update')
        const current = await visibleComment(tx, id, actorId)
        if (!current) return 'missing' as const
        if (current.role !== 'owner' && current.authorId !== actorId) return 'forbidden' as const
        await tx.delete(comments).where(eq(comments.id, id))
        return 'deleted' as const
      })
      if (result === 'missing') return c.json({ error: 'Comment not found' }, 404)
      if (result === 'forbidden')
        return c.json({ error: 'Only owners or the author can delete this comment' }, 403)
      return c.json({ ok: true as const }, 200)
    })
}
