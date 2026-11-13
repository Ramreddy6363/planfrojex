import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { invites, memberships, user as users, workspaces } from '../db/schema'
import { sendInvite } from '../email'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireInvitePermission,
  requireMember,
  requireSession,
  useDb,
} from './permissions'
import { createWorkspaceSchema, inviteSchema } from './validation'

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true as const },
})
const failure = z.object({ error: z.string() })
const role = z.enum(['owner', 'editor', 'viewer'])
const workspaceSummary = z.object({ id: z.string(), name: z.string(), slug: z.string() })
const workspaceCreated = workspaceSummary.extend({ isPersonal: z.boolean() })
const workspaceMember = workspaceCreated.extend({ role })
// Zod failures answer 400 with the same { error } shape as every other failure.
const invalid =
  (error: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: the typed response comes from Context.json
  (result: { success: boolean }, c: { json: (body: { error: string }, status: 400) => any }) => {
    if (!result.success) return c.json({ error }, 400)
  }

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  responses: {
    200: json(
      z.object({
        user: z.object({ id: z.string(), email: z.string(), emailVerified: z.boolean() }),
        workspaces: z.array(workspaceMember),
      }),
      'The signed-in user and their workspaces',
    ),
    401: json(failure, 'Not signed in'),
  },
})
const createWorkspaceRoute = createRoute({
  method: 'post',
  path: '/workspaces',
  request: body(createWorkspaceSchema),
  responses: {
    201: json(z.object({ workspace: workspaceCreated }), 'Workspace created'),
    400: json(failure, 'Invalid workspace details'),
    401: json(failure, 'Not signed in'),
    409: json(failure, 'Workspace URL is already taken'),
  },
})
const getWorkspaceRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}',
  request: { params: z.object({ ws: z.string() }) },
  middleware: [requireMember] as const,
  responses: {
    200: json(z.object({ workspace: workspaceMember }), 'The workspace'),
    401: json(failure, 'Not signed in'),
    404: json(failure, 'Not a member of this workspace'),
  },
})
const memberParams = z.object({ ws: z.string(), userId: z.string().min(1).max(128) })
const membersRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/members',
  request: { params: z.object({ ws: z.string() }) },
  middleware: [requireMember] as const,
  responses: {
    200: json(
      z.object({
        members: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            image: z.string().nullable(),
            role,
          }),
        ),
      }),
      'Workspace members',
    ),
    401: json(failure, 'Not signed in'),
    404: json(failure, 'Workspace not found'),
  },
})
const memberChangeRoute = createRoute({
  method: 'patch',
  path: '/workspaces/{ws}/members/{userId}',
  request: { params: memberParams, ...body(z.object({ role })) },
  middleware: [requireMember, requireInvitePermission] as const,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Role changed'),
    400: json(failure, 'Invalid input'),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Owner required'),
    404: json(failure, 'Not found'),
    409: json(failure, 'Last owner'),
  },
})
const memberRemoveRoute = createRoute({
  method: 'delete',
  path: '/workspaces/{ws}/members/{userId}',
  request: { params: memberParams },
  middleware: [requireMember, requireInvitePermission] as const,
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Member removed'),
    400: json(failure, 'Invalid input'),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Owner required'),
    404: json(failure, 'Not found'),
    409: json(failure, 'Last owner'),
  },
})
const listInvitesRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/invites',
  request: { params: z.object({ ws: z.string() }) },
  middleware: [requireMember, requireInvitePermission] as const,
  responses: {
    200: json(
      z.object({
        invites: z.array(
          z.object({
            id: z.string(),
            email: z.string(),
            role: z.enum(['editor', 'viewer']),
            invitedBy: z.string(),
            createdAt: z.string(),
            expiresAt: z.string(),
          }),
        ),
      }),
      'Pending invitations',
    ),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Owner required'),
    404: json(failure, 'Not found'),
  },
})
const inviteIdParams = z.object({ id: z.string().uuid() })
const resendRoute = createRoute({
  method: 'post',
  path: '/invites/{id}/resend',
  request: { params: inviteIdParams },
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Invitation resent'),
    400: json(failure, 'Invalid invitation'),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Owner required'),
    404: json(failure, 'Not found'),
    429: json(failure, 'Too many invitations'),
    502: json(failure, 'Delivery failed'),
  },
})
const revokeRoute = createRoute({
  method: 'delete',
  path: '/invites/{id}',
  request: { params: inviteIdParams },
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Invitation revoked'),
    400: json(failure, 'Invalid invitation'),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Owner required'),
    404: json(failure, 'Not found'),
  },
})
const inviteRoute = createRoute({
  method: 'post',
  path: '/workspaces/{ws}/invites',
  request: { params: z.object({ ws: z.string() }), ...body(inviteSchema) },
  middleware: [requireMember, requireInvitePermission] as const,
  responses: {
    201: json(z.object({ created: z.number() }), 'Invitations sent'),
    400: json(failure, 'Invalid invitation details'),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Only an owner can invite members'),
    404: json(failure, 'Not a member of this workspace'),
    429: json(failure, 'Too many invitations'),
    502: json(failure.extend({ created: z.number() }), 'An invitation email failed'),
  },
})
const acceptRoute = createRoute({
  method: 'post',
  path: '/invites/accept',
  request: body(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) })),
  responses: {
    200: json(z.object({ workspace: workspaceSummary }), 'Invitation accepted'),
    400: json(failure, 'Invitation is invalid, expired, or for another email'),
    401: json(failure, 'Not signed in'),
    403: json(failure, 'Email not verified'),
  },
})

export function createWorkspaceRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  const guard = async (c: Context<Env>, next: Next) => {
    if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
      return c.json({ error: 'Invalid origin' }, 403)
    return next()
  }
  // Only these paths; anything else falls through to a plain 404.
  for (const path of ['/me', '/workspaces/*', '/invites/*'])
    app.use(path, guard, useDb(options.database), requireSession(options.auth))
  return app
    .openapi(meRoute, async (c) => {
      const user = c.get('user')
      const rows = await c
        .get('db')
        .select({
          id: workspaces.id,
          slug: workspaces.slug,
          name: workspaces.name,
          isPersonal: workspaces.isPersonal,
          role: memberships.role,
        })
        .from(workspaces)
        .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
        .where(eq(memberships.userId, user.id))
        .orderBy(asc(workspaces.createdAt))
      return c.json(
        {
          user: { id: user.id, email: user.email, emailVerified: user.emailVerified },
          workspaces: rows,
        },
        200,
      )
    })
    .openapi(
      createWorkspaceRoute,
      async (c) => {
        const user = c.get('user')
        const { name, slug, isPersonal } = c.req.valid('json')
        const workspace = await c.get('db').transaction(async (tx) => {
          const [created] = await tx
            .insert(workspaces)
            .values({ name, slug, isPersonal })
            .onConflictDoNothing({ target: workspaces.slug })
            .returning({
              id: workspaces.id,
              name: workspaces.name,
              slug: workspaces.slug,
              isPersonal: workspaces.isPersonal,
            })
          if (created)
            await tx
              .insert(memberships)
              .values({ workspaceId: created.id, userId: user.id, role: 'owner' })
          return created
        })
        if (!workspace) return c.json({ error: 'Workspace URL is already taken' }, 409)
        return c.json({ workspace }, 201)
      },
      invalid('Invalid workspace details'),
    )
    .openapi(getWorkspaceRoute, (c) => c.json({ workspace: c.get('membership') }, 200))
    .openapi(membersRoute, async (c) => {
      const rows = await c
        .get('db')
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, c.get('membership').id))
        .orderBy(asc(users.name))
      return c.json({ members: rows }, 200)
    })
    .openapi(
      memberChangeRoute,
      async (c) => {
        const workspaceId = c.get('membership').id
        const targetId = c.req.valid('param').userId
        const newRole = c.req.valid('json').role
        const outcome = await c.get('db').transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .for('no key update')
          const rows = await tx
            .select({ userId: memberships.userId, role: memberships.role })
            .from(memberships)
            .where(eq(memberships.workspaceId, workspaceId))
          if (!rows.some((row) => row.userId === c.get('user').id && row.role === 'owner'))
            return 403 as const
          const target = rows.find((row) => row.userId === targetId)
          if (!target) return 404 as const
          if (
            target.role === 'owner' &&
            newRole !== 'owner' &&
            rows.filter((row) => row.role === 'owner').length === 1
          )
            return 409 as const
          await tx
            .update(memberships)
            .set({ role: newRole, updatedAt: new Date() })
            .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetId)))
          return 200 as const
        })
        if (outcome === 403) return c.json({ error: 'Only an owner can manage members' }, 403)
        if (outcome === 404) return c.json({ error: 'Member not found' }, 404)
        if (outcome === 409)
          return c.json({ error: 'A workspace must have at least one owner' }, 409)
        return c.json({ ok: true as const }, 200)
      },
      invalid('Invalid member details'),
    )
    .openapi(
      memberRemoveRoute,
      async (c) => {
        const workspaceId = c.get('membership').id
        const targetId = c.req.valid('param').userId
        const outcome = await c.get('db').transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .for('no key update')
          const rows = await tx
            .select({ userId: memberships.userId, role: memberships.role })
            .from(memberships)
            .where(eq(memberships.workspaceId, workspaceId))
          if (!rows.some((row) => row.userId === c.get('user').id && row.role === 'owner'))
            return 403 as const
          const target = rows.find((row) => row.userId === targetId)
          if (!target) return 404 as const
          if (target.role === 'owner' && rows.filter((row) => row.role === 'owner').length === 1)
            return 409 as const
          await tx
            .delete(memberships)
            .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetId)))
          return 200 as const
        })
        if (outcome === 403) return c.json({ error: 'Only an owner can manage members' }, 403)
        if (outcome === 404) return c.json({ error: 'Member not found' }, 404)
        if (outcome === 409)
          return c.json({ error: 'A workspace must have at least one owner' }, 409)
        return c.json({ ok: true as const }, 200)
      },
      invalid('Invalid member details'),
    )
    .openapi(listInvitesRoute, async (c) => {
      const rows = await c
        .get('db')
        .select({
          id: invites.id,
          email: invites.email,
          role: invites.role,
          invitedBy: users.name,
          createdAt: invites.createdAt,
          expiresAt: invites.expiresAt,
        })
        .from(invites)
        .innerJoin(users, eq(users.id, invites.invitedBy))
        .where(and(eq(invites.workspaceId, c.get('membership').id), eq(invites.status, 'pending')))
        .orderBy(asc(invites.createdAt))
      return c.json(
        {
          invites: rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
          })),
        },
        200,
      )
    })
    .openapi(
      resendRoute,
      async (c) => {
        const db = c.get('db')
        const id = c.req.valid('param').id
        const userId = c.get('user').id
        const [access] = await db
          .select({
            role: memberships.role,
            workspaceId: workspaces.id,
            tokenHash: invites.tokenHash,
          })
          .from(invites)
          .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
          .innerJoin(
            memberships,
            and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, userId)),
          )
          .where(eq(invites.id, id))
        if (!access) return c.json({ error: 'Invitation not found' }, 404)
        if (access.role !== 'owner')
          return c.json({ error: 'Only an owner can manage invitations' }, 403)
        const ip = c.req.header('cf-connecting-ip')
        if (
          !(await consumeRateLimit(db, 'invites-user', userId, 1, 40, 3_600_000)) ||
          !(await consumeRateLimit(
            db,
            'invites-workspace',
            access.workspaceId,
            1,
            100,
            3_600_000,
          )) ||
          (ip && !(await consumeRateLimit(db, 'invites-ip', ip, 1, 100, 3_600_000)))
        )
          return c.json({ error: 'Too many invitations. Try again later.' }, 429)
        const token = randomToken()
        const tokenHash = await hashToken(token)
        try {
          const outcome = await db.transaction(async (tx) => {
            await tx
              .select({ id: workspaces.id })
              .from(workspaces)
              .where(eq(workspaces.id, access.workspaceId))
              .for('no key update')
            const [row] = await tx
              .select({
                id: invites.id,
                email: invites.email,
                status: invites.status,
                workspaceId: invites.workspaceId,
                tokenHash: invites.tokenHash,
              })
              .from(invites)
              .where(eq(invites.id, id))
              .for('update')
            if (!row) return 404 as const
            const [current] = await tx
              .select({ role: memberships.role, name: workspaces.name })
              .from(memberships)
              .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
              .where(
                and(eq(memberships.workspaceId, row.workspaceId), eq(memberships.userId, userId)),
              )
            if (!current) return 404 as const
            if (current.role !== 'owner') return 403 as const
            if (row.status !== 'pending' || row.tokenHash !== access.tokenHash) return 400 as const
            await tx
              .update(invites)
              .set({
                tokenHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
                updatedAt: new Date(),
              })
              .where(and(eq(invites.id, id), eq(invites.workspaceId, row.workspaceId)))
            await sendInvite(c.env, row.email, current.name, token)
            return 200 as const
          })
          if (outcome === 404) return c.json({ error: 'Invitation not found' }, 404)
          if (outcome === 403) return c.json({ error: 'Only an owner can manage invitations' }, 403)
          if (outcome === 400) return c.json({ error: 'Invitation is no longer pending' }, 400)
          return c.json({ ok: true as const }, 200)
        } catch {
          return c.json({ error: 'Could not resend invitation' }, 502)
        }
      },
      invalid('Invalid invitation'),
    )
    .openapi(
      revokeRoute,
      async (c) => {
        const db = c.get('db')
        const id = c.req.valid('param').id
        const userId = c.get('user').id
        const [access] = await db
          .select({ role: memberships.role, workspaceId: invites.workspaceId })
          .from(invites)
          .innerJoin(
            memberships,
            and(eq(memberships.workspaceId, invites.workspaceId), eq(memberships.userId, userId)),
          )
          .where(eq(invites.id, id))
        if (!access) return c.json({ error: 'Invitation not found' }, 404)
        if (access.role !== 'owner')
          return c.json({ error: 'Only an owner can manage invitations' }, 403)
        const outcome = await db.transaction(async (tx) => {
          await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, access.workspaceId))
            .for('no key update')
          const [row] = await tx
            .select({ id: invites.id, status: invites.status, workspaceId: invites.workspaceId })
            .from(invites)
            .where(eq(invites.id, id))
            .for('update')
          if (!row) return 404 as const
          const [current] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(eq(memberships.workspaceId, row.workspaceId), eq(memberships.userId, userId)),
            )
          if (!current) return 404 as const
          if (current.role !== 'owner') return 403 as const
          if (row.status !== 'pending') return 400 as const
          await tx
            .update(invites)
            .set({ status: 'revoked', updatedAt: new Date() })
            .where(and(eq(invites.id, id), eq(invites.workspaceId, row.workspaceId)))
          return 200 as const
        })
        if (outcome === 404) return c.json({ error: 'Invitation not found' }, 404)
        if (outcome === 403) return c.json({ error: 'Only an owner can manage invitations' }, 403)
        if (outcome === 400) return c.json({ error: 'Invitation is no longer pending' }, 400)
        return c.json({ ok: true as const }, 200)
      },
      invalid('Invalid invitation'),
    )
    .openapi(
      inviteRoute,
      async (c) => {
        const user = c.get('user')
        const db = c.get('db')
        const input = c.req.valid('json')
        const workspace = c.get('membership')
        const emails = [...new Set(input.emails.map((email) => email.toLowerCase()))]
        const ip = c.req.header('cf-connecting-ip')
        if (
          !(await consumeRateLimit(db, 'invites-user', user.id, emails.length, 40, 3_600_000)) ||
          !(await consumeRateLimit(
            db,
            'invites-workspace',
            workspace.id,
            emails.length,
            100,
            3_600_000,
          )) ||
          (ip && !(await consumeRateLimit(db, 'invites-ip', ip, emails.length, 100, 3_600_000)))
        )
          return c.json({ error: 'Too many invitations. Try again later.' }, 429)
        let created = 0
        for (const email of emails) {
          const token = randomToken()
          const tokenHash = await hashToken(token)
          const [row] = await db
            .insert(invites)
            .values({
              workspaceId: workspace.id,
              email,
              role: input.role,
              tokenHash,
              invitedBy: user.id,
              expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
            })
            .onConflictDoNothing({
              target: [invites.workspaceId, invites.email],
              where: sql`${invites.status} = 'pending'`,
            })
            .returning({ id: invites.id })
          if (!row) continue
          try {
            await sendInvite(c.env, email, workspace.name, token)
            created++
          } catch {
            await db
              .delete(invites)
              .where(and(eq(invites.id, row.id), eq(invites.workspaceId, workspace.id)))
            return c.json({ error: 'Could not send all invitations', created }, 502)
          }
        }
        return c.json({ created }, 201)
      },
      invalid('Invalid invitation details'),
    )
    .openapi(
      acceptRoute,
      async (c) => {
        const user = c.get('user')
        if (!user.emailVerified)
          return c.json({ error: 'Verify your email before accepting an invitation' }, 403)
        const tokenHash = await hashToken(c.req.valid('json').token)
        const workspace = await c.get('db').transaction(async (tx) => {
          const [invite] = await tx
            .update(invites)
            .set({ status: 'accepted', updatedAt: new Date() })
            .where(
              and(
                eq(invites.tokenHash, tokenHash),
                eq(sql`lower(${invites.email})`, user.email.toLowerCase()),
                eq(invites.status, 'pending'),
                gt(invites.expiresAt, sql`now()`),
              ),
            )
            .returning({ workspaceId: invites.workspaceId, role: invites.role })
          if (!invite) return undefined
          // An existing membership keeps its current role.
          await tx
            .insert(memberships)
            .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role })
            .onConflictDoNothing({ target: [memberships.workspaceId, memberships.userId] })
          const [joined] = await tx
            .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
            .from(workspaces)
            .where(eq(workspaces.id, invite.workspaceId))
          return joined
        })
        if (!workspace)
          return c.json(
            { error: 'Invitation is invalid, expired, or belongs to another email' },
            400,
          )
        return c.json({ workspace }, 200)
      },
      invalid('Invalid invitation'),
    )
}

export default createWorkspaceRoutes()
