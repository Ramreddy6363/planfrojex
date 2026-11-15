import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, DrizzleQueryError, eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { workspaces } from '../db/schema'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireMember,
  requireSession,
  useDb,
} from './permissions'
import { validWorkspaceName } from './rules'
import { createWorkspaceSchema } from './validation'

const failure = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const params = z.object({ ws: z.string().min(1).max(40) })
const patchSchema = z
  .object({
    name: createWorkspaceSchema.shape.name
      .refine((name) => validWorkspaceName(name, 60))
      .optional(),
    slug: createWorkspaceSchema.shape.slug.optional(),
  })
  .refine((body) => body.name !== undefined || body.slug !== undefined)
const ownerOnly = createMiddleware<Env>(async (c, next) => {
  if (c.get('membership').role !== 'owner')
    return c.json({ error: 'Only an owner can change workspace settings' }, 403)
  return next()
})
const rateLimitWrites = (scope: string) =>
  createMiddleware<Env>(async (c, next) => {
    if (!(await consumeRateLimit(c.get('db'), scope, c.get('user').id, 1, 10, 60_000)))
      return c.json({ error: 'Too many changes. Try again in a minute.' }, 429)
    return next()
  })
const patchRoute = createRoute({
  method: 'patch',
  path: '/workspaces/{ws}',
  middleware: [requireMember, ownerOnly, rateLimitWrites('workspace-settings-update')] as const,
  request: {
    params,
    body: { content: { 'application/json': { schema: patchSchema } }, required: true },
  },
  responses: {
    200: json(
      z.object({
        workspace: z.object({
          id: z.uuid(),
          name: z.string(),
          slug: z.string(),
          isPersonal: z.boolean(),
          role: z.literal('owner'),
        }),
      }),
      'Workspace updated',
    ),
    400: json(failure, 'Invalid workspace details'),
    401: json(failure, 'Sign in required'),
    403: json(failure, 'Only owners can change settings'),
    404: json(failure, 'Workspace not found'),
    409: json(failure, 'Workspace URL is taken'),
    429: json(failure, 'Too many changes'),
  },
})
const deleteRoute = createRoute({
  method: 'delete',
  path: '/workspaces/{ws}',
  middleware: [requireMember, ownerOnly, rateLimitWrites('workspace-settings-delete')] as const,
  request: {
    params,
    body: {
      content: { 'application/json': { schema: z.object({ confirm: z.string().max(100) }) } },
      required: true,
    },
  },
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Workspace deleted'),
    400: json(failure, 'Confirmation does not match'),
    401: json(failure, 'Sign in required'),
    403: json(failure, 'Only owners can delete'),
    404: json(failure, 'Workspace not found'),
    409: json(failure, 'Personal workspace cannot be deleted'),
    429: json(failure, 'Too many changes'),
  },
})

export function createWorkspaceSettingsRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  app.use(
    '/workspaces/:ws',
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
      patchRoute,
      async (c) => {
        const db = c.get('db')
        const member = c.get('membership')
        const patch = c.req.valid('json')
        try {
          const [workspace] = await db
            .update(workspaces)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(workspaces.id, member.id))
            .returning({
              id: workspaces.id,
              name: workspaces.name,
              slug: workspaces.slug,
              isPersonal: workspaces.isPersonal,
            })
          if (!workspace) return c.json({ error: 'Workspace not found' }, 404)
          return c.json({ workspace: { ...workspace, role: 'owner' as const } }, 200)
        } catch (error) {
          if (
            error instanceof DrizzleQueryError &&
            (error.cause as { code?: string } | undefined)?.code === '23505'
          )
            return c.json({ error: 'That URL is taken' }, 409)
          throw error
        }
      },
      (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid workspace name or URL' }, 400)
      },
    )
    .openapi(
      deleteRoute,
      async (c) => {
        const db = c.get('db')
        const member = c.get('membership')
        if (member.isPersonal)
          return c.json({ error: 'Your personal workspace cannot be deleted' }, 409)
        const { confirm } = c.req.valid('json')
        if (confirm !== member.name)
          return c.json({ error: 'Type the workspace name exactly to confirm' }, 400)
        // The name and personal flag are checked again in the delete so a concurrent
        // rename cannot make an old confirmation delete the renamed workspace.
        const [deleted] = await db
          .delete(workspaces)
          .where(
            and(
              eq(workspaces.id, member.id),
              eq(workspaces.name, confirm),
              eq(workspaces.isPersonal, false),
            ),
          )
          .returning({ id: workspaces.id })
        if (!deleted) return c.json({ error: 'Workspace changed. Reload and try again.' }, 400)
        return c.json({ ok: true as const }, 200)
      },
      (result, c) => {
        if (!result.success) return c.json({ error: 'Type the workspace name to confirm' }, 400)
      },
    )
}
