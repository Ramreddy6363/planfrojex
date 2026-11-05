import { and, eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { connect, type DatabaseFactory } from '../db'
import { memberships, workspaces } from '../db/schema'
import type { Env } from '../env'

export type { DatabaseFactory }
export type AuthFactory = (env: Env['Bindings']) => ReturnType<typeof createAuth>
export type Role = 'owner' | 'editor' | 'viewer'
export const canInvite = (role: Role) => role === 'owner'
export const useDb = (database: DatabaseFactory = connect) =>
  createMiddleware<Env>(async (c, next) => {
    c.set('db', database(c.env.DATABASE_URL))
    await next()
  })
export const requireSession = (auth: AuthFactory = createAuth) =>
  createMiddleware<Env>(async (c, next) => {
    const session = await auth(c.env).api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Sign in required' }, 401)
    c.set('user', session.user)
    await next()
  })
export const requireMember = createMiddleware<Env>(async (c, next) => {
  const [membership] = await c
    .get('db')
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      isPersonal: workspaces.isPersonal,
      role: memberships.role,
    })
    .from(workspaces)
    .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
    .where(
      and(eq(workspaces.slug, c.req.param('ws') ?? ''), eq(memberships.userId, c.get('user').id)),
    )
  if (!membership) return c.json({ error: 'Workspace not found' }, 404)
  c.set('membership', membership)
  await next()
})
export const requireInvitePermission = createMiddleware<Env>(async (c, next) => {
  if (!canInvite(c.get('membership').role))
    return c.json({ error: 'Only an owner can invite members' }, 403)
  await next()
})
