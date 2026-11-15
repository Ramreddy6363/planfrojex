import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, DrizzleQueryError, eq, inArray, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import {
  memberships,
  notificationSettings,
  tasks,
  user,
  verification,
  workspaces,
} from '../db/schema'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import { notificationDefaults, notificationTypes } from './preferences'

const error = z.object({ error: z.string() })
const ok = z.object({ ok: z.literal(true) })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true as const },
})
const profile = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  timezone: z.string().nullable(),
})
const preference = z
  .object({ type: z.enum(notificationTypes), email: z.boolean(), inApp: z.boolean() })
  .strict()
const settings = z
  .object({
    settings: z
      .array(preference)
      .length(5)
      .refine((rows) => new Set(rows.map((row) => row.type)).size === 5),
  })
  .strict()
const limit = (scope: string, max = 20, window = 60_000) =>
  createMiddleware<Env>(async (c, next) => {
    if (!(await consumeRateLimit(c.get('db'), scope, c.get('user').id, 1, max, window)))
      return c.json({ error: 'Too many requests. Try again later.' }, 429)
    return next()
  })
const common = {
  400: json(error, 'Invalid account details'),
  401: json(error, 'Sign in required'),
  429: json(error, 'Too many requests'),
}
const patch = createRoute({
  method: 'patch',
  path: '/me',
  middleware: [limit('account-profile')] as const,
  request: body(
    z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        timezone: z
          .string()
          .max(100)
          .refine((zone) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: zone })
              return true
            } catch {
              return false
            }
          })
          .optional(),
        image: z.null().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  ),
  responses: { 200: json(z.object({ user: profile }), 'Profile saved'), ...common },
})
const getSettings = createRoute({
  method: 'get',
  path: '/me/notification-settings',
  middleware: [limit('account-settings-read')] as const,
  responses: { 200: json(settings, 'Notification settings'), ...common },
})
const putSettings = createRoute({
  method: 'put',
  path: '/me/notification-settings',
  middleware: [limit('account-settings-write')] as const,
  request: body(settings),
  responses: { 200: json(settings, 'Notification settings saved'), ...common },
})
const start = createRoute({
  method: 'post',
  path: '/me/email/start',
  middleware: [limit('account-email-start', 3, 3_600_000)] as const,
  request: body(z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).strict()),
  responses: {
    200: json(ok, 'Verification code sent'),
    409: json(error, 'Email already in use'),
    ...common,
  },
})
const verify = createRoute({
  method: 'post',
  path: '/me/email/verify',
  middleware: [limit('account-email-verify')] as const,
  request: body(z.object({ code: z.string().regex(/^\d{6}$/) }).strict()),
  responses: {
    200: json(ok, 'Email changed'),
    409: json(error, 'Email already in use'),
    ...common,
  },
})
const remove = createRoute({
  method: 'delete',
  path: '/me',
  middleware: [limit('account-delete')] as const,
  request: body(z.object({ confirm: z.literal('delete') }).strict()),
  responses: {
    200: json(ok, 'Account deleted'),
    409: json(
      error.extend({
        workspaces: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })),
      }),
      'Make someone else owner first',
    ),
    ...common,
  },
})
const invalid = (result: { success: boolean }, c: Pick<Context<Env>, 'json'>) => {
  if (!result.success) return c.json({ error: 'Check the account details and try again.' }, 400)
}
export function createAccountRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const auth = options.auth ?? createAuth
  const app = new OpenAPIHono<Env>()
  for (const path of ['/me', '/me/*'])
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
      patch,
      async (c) => {
        const [updated] = await c
          .get('db')
          .update(user)
          .set({ ...c.req.valid('json'), updatedAt: new Date() })
          .where(eq(user.id, c.get('user').id))
          .returning({
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            timezone: user.timezone,
          })
        if (!updated) return c.json({ error: 'Sign in required' }, 401)
        return c.json({ user: updated }, 200)
      },
      invalid,
    )
    .openapi(getSettings, async (c) => {
      const rows = await c
        .get('db')
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, c.get('user').id))
      return c.json(
        {
          settings: notificationDefaults.map((fallback) => {
            const row = rows.find((row) => row.type === fallback.type)
            return {
              type: fallback.type,
              email: row?.email ?? fallback.email,
              inApp: row?.inApp ?? fallback.inApp,
            }
          }),
        },
        200,
      )
    })
    .openapi(
      putSettings,
      async (c) => {
        const input = c.req.valid('json')
        await c.get('db').transaction(async (tx) => {
          for (const setting of input.settings)
            await tx
              .insert(notificationSettings)
              .values({ userId: c.get('user').id, ...setting })
              .onConflictDoUpdate({
                target: [notificationSettings.userId, notificationSettings.type],
                set: { email: setting.email, inApp: setting.inApp },
              })
        })
        return c.json(input, 200)
      },
      invalid,
    )
    .openapi(
      start,
      async (c) => {
        const db = c.get('db'),
          id = c.get('user').id,
          email = c.req.valid('json').email
        const [current] = await db.select().from(user).where(eq(user.id, id))
        if (!current) return c.json({ error: 'Sign in required' }, 401)
        if (email === current.email.toLowerCase())
          return c.json({ error: 'Choose a different email address' }, 400)
        if (
          (await db.select({ id: user.id }).from(user).where(sql`lower(${user.email})=${email}`))
            .length
        )
          return c.json({ error: 'That email is already in use' }, 409)
        try {
          await auth(c.env).api.requestEmailChangeEmailOTP({
            headers: c.req.raw.headers,
            body: { newEmail: email },
          })
          await db.transaction(async (tx) => {
            await tx.select({ id: user.id }).from(user).where(eq(user.id, id)).for('update')
            await tx.delete(verification).where(eq(verification.identifier, `account-email:${id}`))
            await tx.insert(verification).values({
              id: crypto.randomUUID(),
              identifier: `account-email:${id}`,
              value: email,
              expiresAt: new Date(Date.now() + 600_000),
            })
          })
          return c.json({ ok: true as const }, 200)
        } catch {
          return c.json({ error: 'Could not send the code. Try signing in again.' }, 400)
        }
      },
      invalid,
    )
    .openapi(
      verify,
      async (c) => {
        const db = c.get('db'),
          id = c.get('user').id
        const [pending] = await db
          .select()
          .from(verification)
          .where(
            and(
              eq(verification.identifier, `account-email:${id}`),
              sql`${verification.expiresAt}>now()`,
            ),
          )
          .orderBy(asc(verification.createdAt))
        if (!pending) return c.json({ error: 'The code expired. Send a new code.' }, 400)
        if (
          (
            await db
              .select({ id: user.id })
              .from(user)
              .where(and(sql`lower(${user.email})=${pending.value}`, sql`${user.id}<>${id}`))
          ).length
        )
          return c.json({ error: 'That email is already in use' }, 409)
        try {
          const result = await auth(c.env).api.changeEmailEmailOTP({
            headers: c.req.raw.headers,
            body: { newEmail: pending.value, otp: c.req.valid('json').code },
            returnHeaders: true,
          })
          await auth(c.env).api.revokeOtherSessions({ headers: c.req.raw.headers })
          for (const cookie of result.headers.getSetCookie())
            c.header('set-cookie', cookie, { append: true })
          await db.delete(verification).where(eq(verification.identifier, `account-email:${id}`))
          return c.json({ ok: true as const }, 200)
        } catch (err) {
          if (
            (err instanceof DrizzleQueryError &&
              (err.cause as { code?: string })?.code === '23505') ||
            (
              await db
                .select({ id: user.id })
                .from(user)
                .where(and(sql`lower(${user.email})=${pending.value}`, sql`${user.id}<>${id}`))
            ).length > 0
          )
            return c.json({ error: 'That email is already in use' }, 409)
          return c.json(
            { error: 'That code is incorrect or expired. Try again or send a new code.' },
            400,
          )
        }
      },
      invalid,
    )
    .openapi(
      remove,
      async (c) => {
        const db = c.get('db'),
          id = c.get('user').id
        const blocked = await db.transaction(async (tx) => {
          await tx.select({ id: user.id }).from(user).where(eq(user.id, id)).for('update')
          const owned = await tx
            .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
            .from(workspaces)
            .innerJoin(
              memberships,
              and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, id)),
            )
            .orderBy(asc(workspaces.id))
            .for('update', { of: workspaces })
          const blocked: typeof owned = [],
            solo: string[] = []
          for (const ws of owned) {
            const people = await tx
              .select({ id: memberships.userId, role: memberships.role })
              .from(memberships)
              .where(eq(memberships.workspaceId, ws.id))
            if (people.length === 1) solo.push(ws.id)
            else if (
              people.some((person) => person.id === id && person.role === 'owner') &&
              !people.some((person) => person.id !== id && person.role === 'owner')
            )
              blocked.push(ws)
          }
          if (blocked.length) return blocked
          if (solo.length) await tx.delete(workspaces).where(inArray(workspaces.id, solo))
          await tx.update(tasks).set({ assigneeDeleted: true }).where(eq(tasks.assigneeId, id))
          await tx.delete(verification).where(eq(verification.identifier, `account-email:${id}`))
          await tx.delete(user).where(eq(user.id, id))
          return []
        })
        if (blocked.length)
          return c.json({ error: 'Make someone else owner first', workspaces: blocked }, 409)
        return c.json({ ok: true as const }, 200)
      },
      invalid,
    )
}
