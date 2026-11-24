import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Context, ExecutionContext } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import type { Db } from '../db'
import { externalLinks, integrations, memberships, workspaces } from '../db/schema'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireMember,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import {
  authorizeUrl,
  createFakeLinearProvider,
  createLinearProvider,
  type LinearProvider,
} from './linear'
import {
  digest,
  encryptCredentials,
  type LinearConfig,
  linearConfig,
  makeOAuthState,
  pkceVerifier,
  validOAuthState,
  verifyWebhook,
} from './security'
import {
  credentialsContext,
  type Integration,
  lockWorkspace,
  memberRole,
  runIntegrationSync,
  type WebhookReceipt,
  webhookFreshness,
} from './sync'

const failure = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const workspace = z.string().min(1).max(40)
const providerParam = z.literal('linear')
const integrationId = z.object({ id: z.uuid() })
const workspaceParam = z.object({ ws: workspace })
const stateId = z.string().trim().min(1).max(128)
const statusMapping = z
  .object({
    planning: stateId.nullable(),
    in_progress: stateId.nullable(),
    completed: stateId.nullable(),
    archived: stateId.nullable(),
  })
  .strict()
const optionsSchema = z
  .object({
    pushMilestones: z.boolean(),
    pullStatus: z.boolean(),
    importIssues: z.boolean(),
  })
  .strict()
const patchSchema = z
  .object({
    options: optionsSchema.partial().optional(),
    statusMapping: statusMapping.partial().optional(),
  })
  .strict()
  .refine(
    (input) =>
      Boolean(
        Object.keys(input.options ?? {}).length || Object.keys(input.statusMapping ?? {}).length,
      ),
    'Choose at least one integration setting',
  )
const integrationSchema = z.object({
  id: z.uuid(),
  provider: providerParam,
  name: z.string(),
  options: optionsSchema,
  statusMapping,
  states: z.array(z.object({ id: stateId, name: z.string() })),
  lastSyncedAt: z.iso.datetime().nullable(),
})
const ok = z.object({ ok: z.literal(true) })
const integrationResponse = z.object({ integration: integrationSchema })
const ownerErrors = {
  400: json(failure, 'Invalid integration input'),
  401: json(failure, 'Sign in required'),
  403: json(failure, 'Only an owner can manage integrations'),
  404: json(failure, 'Integration or workspace not found'),
}
const list = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/integrations',
  request: { params: workspaceParam },
  responses: {
    200: json(
      z.object({ configured: z.boolean(), integration: integrationSchema.nullable() }),
      'Tracker settings',
    ),
    ...ownerErrors,
  },
})
const begin = createRoute({
  method: 'post',
  path: '/workspaces/{ws}/integrations/{provider}/connect',
  request: { params: workspaceParam.extend({ provider: providerParam }) },
  responses: {
    200: json(z.object({ authorizationUrl: z.url() }), 'Linear authorization URL'),
    ...ownerErrors,
    429: json(failure, 'Try again later'),
    503: json(failure, 'Linear is not set up'),
  },
})
const callback = createRoute({
  method: 'get',
  path: '/integrations/{provider}/callback',
  request: {
    params: z.object({ provider: providerParam }),
    query: z
      .object({
        state: z.string().regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
        code: z.string().min(1).max(2048).optional(),
        error: z.string().min(1).max(200).optional(),
      })
      .refine((query) => Boolean(query.code) !== Boolean(query.error)),
  },
  responses: {
    302: { description: 'Return to workspace integration settings' },
    ...ownerErrors,
    503: json(failure, 'Linear is not set up'),
  },
})
const patch = createRoute({
  method: 'patch',
  path: '/integrations/{id}',
  request: {
    params: integrationId,
    body: { content: { 'application/json': { schema: patchSchema } }, required: true },
  },
  responses: { 200: json(integrationResponse, 'Updated integration'), ...ownerErrors },
})
const sync = createRoute({
  method: 'post',
  path: '/integrations/{id}/sync',
  request: { params: integrationId },
  responses: {
    200: json(integrationResponse, 'Synchronized integration'),
    ...ownerErrors,
    429: json(failure, 'Try again later'),
    502: json(failure, 'Linear sync failed'),
    503: json(failure, 'Linear is not set up'),
  },
})
const disconnect = createRoute({
  method: 'delete',
  path: '/integrations/{id}',
  request: { params: integrationId },
  responses: { 200: json(ok, 'Disconnected integration'), ...ownerErrors },
})
const webhook = createRoute({
  method: 'post',
  path: '/webhooks/linear',
  request: {
    headers: z.object({
      'linear-signature': z.string().optional(),
      'linear-delivery': z.string().optional(),
      'linear-timestamp': z.string().optional(),
    }),
  },
  responses: {
    200: json(
      z.union([ok.extend({ queued: z.literal(true) }), ok.extend({ replayed: z.boolean() })]),
      'Acknowledged delivery',
    ),
    400: json(failure, 'Invalid Linear webhook'),
    401: json(failure, 'Invalid signature or timestamp'),
    404: json(failure, 'Linear installation not found'),
    413: json(failure, 'Webhook too large'),
    429: json(failure, 'Too many deliveries'),
    502: json(failure, 'Linear sync failed'),
    503: json(failure, 'Linear is not set up'),
  },
})
const webhookBody = z.object({
  organizationId: stateId,
  webhookTimestamp: z.number().int().positive(),
  webhookId: stateId.optional(),
  type: z.string().min(1).max(80),
  action: z.string().min(1).max(80),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  data: z.object({ id: stateId, teamId: stateId.optional() }).optional(),
})
const webhookLimit = 262_144
const invalid = (result: { success: boolean }, c: Context<Env>) => {
  if (!result.success) return c.json({ error: 'Invalid integration input' }, 400)
}
const denied = { error: 'Only an owner can manage integrations' }
const missing = { error: 'Integration not found' }
const unconfigured = { error: 'Linear is not set up' }
const retrySync = { error: 'Couldn’t sync with Linear. Try again.' }
const requireWebOrigin = createMiddleware<Env>(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
    return c.json({ error: 'Invalid origin' }, 403)
  await next()
})

function visibleIntegration(row: Integration) {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name ?? 'Linear',
    options: row.options,
    statusMapping: row.statusMapping,
    states: row.states,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  }
}

async function integrationMembership(db: Db, id: string, userId: string) {
  const [result] = await db
    .select({ workspaceId: integrations.workspaceId, role: memberships.role })
    .from(integrations)
    .innerJoin(
      memberships,
      and(eq(memberships.workspaceId, integrations.workspaceId), eq(memberships.userId, userId)),
    )
    .where(and(eq(integrations.id, id), isNotNull(integrations.encryptedCredentials)))
  return result
}

export type TrackerRouteOptions = {
  database?: DatabaseFactory
  auth?: AuthFactory
  localTracker?: boolean
  fakeLinearProvider?: LinearProvider
}

function executionContext(c: Context<Env>): ExecutionContext | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}

async function syncWebhook(
  db: Db,
  rows: { id: string; workspaceId: string }[],
  config: LinearConfig,
  provider: LinearProvider,
  organizationId: string,
  receipt: WebhookReceipt,
) {
  let failed = false
  let limited = false
  let replayed = true
  for (const row of rows) {
    const result = await runIntegrationSync(db, {
      ...row,
      config,
      provider,
      organizationId,
      receipt,
    })
    if (result.kind === 'failed') failed = true
    if (result.kind === 'limited') limited = true
    if (result.kind === 'synced') replayed = false
  }
  return { failed, limited, replayed }
}

export function createIntegrationRoutes(options: TrackerRouteOptions) {
  const fake = options.fakeLinearProvider ?? createFakeLinearProvider().provider
  const configFor = (c: Context<Env>) => linearConfig(c.env, options.localTracker ?? false)
  const providerFor = (mode: 'real' | 'fake', env: Env['Bindings']) =>
    mode === 'fake' ? fake : createLinearProvider(env)
  const session = requireSession(options.auth)
  const db = useDb(options.database)

  const app = new OpenAPIHono<Env>()
  app
    .use('/workspaces/:ws/integrations', db, session, requireMember)
    .use('/workspaces/:ws/integrations/:provider/connect', db, session, requireMember)
    .use('/integrations/*', requireWebOrigin, db, session)
    .use(
      '/webhooks/linear',
      bodyLimit({
        maxSize: webhookLimit,
        onError: (c) => c.json({ error: 'Linear webhook too large' }, 413),
      }),
      db,
    )
  return app
    .openapi(
      list,
      async (c) => {
        const member = c.get('membership')
        if (member.role !== 'owner') return c.json(denied, 403)
        const config = await configFor(c)
        const [row] = await c
          .get('db')
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.workspaceId, member.id),
              eq(integrations.provider, 'linear'),
              isNotNull(integrations.encryptedCredentials),
            ),
          )
        return c.json(
          { configured: config !== null, integration: row ? visibleIntegration(row) : null },
          200,
        )
      },
      invalid,
    )
    .openapi(
      begin,
      async (c) => {
        const member = c.get('membership')
        if (member.role !== 'owner') return c.json(denied, 403)
        const config = await configFor(c)
        if (!config) return c.json(unconfigured, 503)
        const userId = c.get('user').id
        const db = c.get('db')
        if (!(await consumeRateLimit(db, 'tracker-connect', userId, 1, 12, 60_000)))
          return c.json({ error: 'Try connecting to Linear again in a minute' }, 429)
        const state = await makeOAuthState(c.env.BETTER_AUTH_SECRET)
        const oauthStateHash = await digest(state)
        const saved = await db.transaction(async (tx) => {
          await lockWorkspace(tx, member.id)
          const role = await memberRole(tx, member.id, userId)
          if (role !== 'owner') return role ? 'forbidden' : 'missing'
          const values = {
            oauthStateHash,
            oauthExpiresAt: new Date(Date.now() + 600_000),
            oauthUserId: userId,
          }
          await tx
            .insert(integrations)
            .values({ workspaceId: member.id, ...values })
            .onConflictDoUpdate({
              target: [integrations.workspaceId, integrations.provider],
              set: { ...values, updatedAt: new Date() },
            })
          return 'saved'
        })
        if (saved === 'missing') return c.json(missing, 404)
        if (saved === 'forbidden') return c.json(denied, 403)
        const verifier = await pkceVerifier(c.env.BETTER_AUTH_SECRET, state)
        c.header('Cache-Control', 'no-store')
        return c.json(
          { authorizationUrl: await authorizeUrl(c.env, state, verifier, config.mode === 'fake') },
          200,
        )
      },
      invalid,
    )
    .openapi(
      callback,
      async (c) => {
        const { state, code } = c.req.valid('query')
        c.header('Cache-Control', 'no-store')
        c.header('Referrer-Policy', 'no-referrer')
        if (!(await validOAuthState(c.env.BETTER_AUTH_SECRET, state))) return c.json(missing, 404)
        const stateHash = await digest(state)
        const db = c.get('db')
        const actor = c.get('user').id
        const [match] = await db
          .select({ workspaceId: integrations.workspaceId, role: memberships.role })
          .from(integrations)
          .innerJoin(
            memberships,
            and(
              eq(memberships.workspaceId, integrations.workspaceId),
              eq(memberships.userId, actor),
            ),
          )
          .where(eq(integrations.oauthStateHash, stateHash))
        if (!match) return c.json(missing, 404)
        if (match.role !== 'owner') return c.json(denied, 403)
        const config = await configFor(c)
        if (!config) return c.json(unconfigured, 503)
        const spent = await db.transaction(async (tx) => {
          await lockWorkspace(tx, match.workspaceId)
          const [scope] = await tx
            .select({ workspaceId: workspaces.id, slug: workspaces.slug, role: memberships.role })
            .from(workspaces)
            .innerJoin(
              memberships,
              and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, actor)),
            )
            .where(eq(workspaces.id, match.workspaceId))
          if (!scope) return { kind: 'missing' as const }
          if (scope.role !== 'owner') return { kind: 'forbidden' as const }
          const [row] = await tx
            .select()
            .from(integrations)
            .where(
              and(
                eq(integrations.workspaceId, scope.workspaceId),
                eq(integrations.oauthStateHash, stateHash),
                eq(integrations.oauthUserId, actor),
              ),
            )
            .for('no key update')
          if (!row?.oauthExpiresAt || row.oauthExpiresAt.getTime() <= Date.now())
            return { kind: 'missing' as const }
          await tx
            .update(integrations)
            .set({
              oauthStateHash: null,
              oauthExpiresAt: null,
              oauthUserId: null,
              updatedAt: new Date(),
            })
            .where(eq(integrations.id, row.id))
          if (!code) return { kind: 'redirect' as const, slug: scope.slug, error: 'cancelled' }
          try {
            const provider = providerFor(config.mode, c.env)
            const verifier = await pkceVerifier(c.env.BETTER_AUTH_SECRET, state)
            const credentials = await provider.exchange(code, verifier, scope.workspaceId)
            const account = await provider.account(credentials.accessToken, scope.workspaceId)
            const sameAccount =
              row.teamId === account.teamId && row.organizationId === account.organizationId
            await tx.transaction(async (save) => {
              if (!sameAccount)
                await save.delete(externalLinks).where(eq(externalLinks.integrationId, row.id))
              await save
                .update(integrations)
                .set({
                  ...account,
                  options: sameAccount ? row.options : { ...row.options, pushMilestones: false },
                  statusMapping: sameAccount ? row.statusMapping : account.statusMapping,
                  lastSyncedAt: sameAccount ? row.lastSyncedAt : null,
                  webhookReceipts: sameAccount ? row.webhookReceipts : {},
                  encryptedCredentials: await encryptCredentials(
                    config.encryptionKey,
                    credentialsContext(row),
                    credentials,
                  ),
                  updatedAt: new Date(),
                })
                .where(eq(integrations.id, row.id))
            })
            return { kind: 'redirect' as const, slug: scope.slug }
          } catch {
            return { kind: 'redirect' as const, slug: scope.slug, error: 'connection-failed' }
          }
        })
        if (spent.kind === 'missing') return c.json(missing, 404)
        if (spent.kind === 'forbidden') return c.json(denied, 403)
        const target = new URL(`/${spent.slug}/settings`, c.env.WEB_ORIGIN)
        target.searchParams.set('tab', 'integrations')
        if (spent.error) target.searchParams.set('integrationError', spent.error)
        return c.redirect(target.href, 302)
      },
      invalid,
    )
    .openapi(
      patch,
      async (c) => {
        const { id } = c.req.valid('param')
        const input = c.req.valid('json')
        const db = c.get('db')
        const userId = c.get('user').id
        const scope = await integrationMembership(db, id, userId)
        if (!scope) return c.json(missing, 404)
        if (scope.role !== 'owner') return c.json(denied, 403)
        const result = await db.transaction(async (tx) => {
          await lockWorkspace(tx, scope.workspaceId)
          const role = await memberRole(tx, scope.workspaceId, userId)
          if (role !== 'owner')
            return { kind: role ? ('forbidden' as const) : ('missing' as const) }
          const [row] = await tx
            .select()
            .from(integrations)
            .where(
              and(
                eq(integrations.id, id),
                eq(integrations.workspaceId, scope.workspaceId),
                isNotNull(integrations.encryptedCredentials),
              ),
            )
            .for('no key update')
          if (!row) return { kind: 'missing' as const }
          const mapped = { ...row.statusMapping, ...input.statusMapping }
          const allowed = new Set(row.states.map(({ id }) => id))
          const mappedIds = Object.values(mapped).filter((id): id is string => id !== null)
          if (
            mappedIds.some((id) => !allowed.has(id)) ||
            mappedIds.length !== new Set(mappedIds).size
          )
            return { kind: 'invalid' as const }
          const [saved] = await tx
            .update(integrations)
            .set({
              options: { ...row.options, ...input.options },
              statusMapping: mapped,
              updatedAt: new Date(),
            })
            .where(eq(integrations.id, id))
            .returning()
          return saved ? { kind: 'saved' as const, row: saved } : { kind: 'missing' as const }
        })
        if (result.kind === 'missing') return c.json(missing, 404)
        if (result.kind === 'forbidden') return c.json(denied, 403)
        if (result.kind !== 'saved')
          return c.json(
            { error: 'Choose a different state from the connected Linear team for each status' },
            400,
          )
        return c.json({ integration: visibleIntegration(result.row) }, 200)
      },
      invalid,
    )
    .openapi(
      sync,
      async (c) => {
        const { id } = c.req.valid('param')
        const db = c.get('db')
        const actorId = c.get('user').id
        const scope = await integrationMembership(db, id, actorId)
        if (!scope) return c.json(missing, 404)
        if (scope.role !== 'owner') return c.json(denied, 403)
        const config = await configFor(c)
        if (!config) return c.json(unconfigured, 503)
        if (!(await consumeRateLimit(db, 'tracker-sync', actorId, 1, 12, 60_000)))
          return c.json({ error: 'Try syncing again in a minute' }, 429)
        const result = await runIntegrationSync(db, {
          id,
          workspaceId: scope.workspaceId,
          actorId,
          config,
          provider: providerFor(config.mode, c.env),
        })
        if (result.kind === 'missing') return c.json(missing, 404)
        if (result.kind === 'forbidden') return c.json(denied, 403)
        if (result.kind !== 'synced') return c.json(retrySync, 502)
        return c.json({ integration: visibleIntegration(result.integration) }, 200)
      },
      invalid,
    )
    .openapi(
      disconnect,
      async (c) => {
        const { id } = c.req.valid('param')
        const db = c.get('db')
        const userId = c.get('user').id
        const scope = await integrationMembership(db, id, userId)
        if (!scope) return c.json(missing, 404)
        if (scope.role !== 'owner') return c.json(denied, 403)
        const result = await db.transaction(async (tx) => {
          await lockWorkspace(tx, scope.workspaceId)
          const role = await memberRole(tx, scope.workspaceId, userId)
          if (role !== 'owner') return role ? 'forbidden' : 'missing'
          const [removed] = await tx
            .delete(integrations)
            .where(and(eq(integrations.id, id), eq(integrations.workspaceId, scope.workspaceId)))
            .returning({ id: integrations.id })
          return removed ? 'deleted' : 'missing'
        })
        if (result === 'missing') return c.json(missing, 404)
        if (result === 'forbidden') return c.json(denied, 403)
        return c.json({ ok: true as const }, 200)
      },
      invalid,
    )
    .openapi(
      webhook,
      async (c) => {
        const config = await configFor(c)
        if (!config) return c.json(unconfigured, 503)
        const headers = c.req.valid('header')
        const signature = headers['linear-signature'] ?? ''
        if (!/^[a-f0-9]{64}$/i.test(signature))
          return c.json({ error: 'Invalid Linear webhook signature' }, 401)
        const raw = await c.req.arrayBuffer()
        if (raw.byteLength > webhookLimit) return c.json({ error: 'Linear webhook too large' }, 413)
        if (!(await verifyWebhook(config.webhookSecret, signature, raw)))
          return c.json({ error: 'Invalid Linear webhook signature' }, 401)
        let body: unknown
        try {
          body = JSON.parse(new TextDecoder().decode(raw))
        } catch {
          return c.json({ error: 'Invalid Linear webhook' }, 400)
        }
        const event = webhookBody.safeParse(body)
        if (!event.success) return c.json({ error: 'Invalid Linear webhook' }, 400)
        const { organizationId, webhookTimestamp } = event.data
        const timestamp = headers['linear-timestamp']
        if (
          Math.abs(Date.now() - webhookTimestamp) > webhookFreshness ||
          (timestamp !== undefined &&
            (!/^\d+$/.test(timestamp) ||
              Math.abs(Date.now() - Number(timestamp)) > webhookFreshness))
        )
          return c.json({ error: 'Expired Linear webhook' }, 401)
        const db = c.get('db')
        const rows = await db
          .select({ id: integrations.id, workspaceId: integrations.workspaceId })
          .from(integrations)
          .where(
            and(
              eq(integrations.provider, 'linear'),
              eq(integrations.organizationId, organizationId),
              isNotNull(integrations.encryptedCredentials),
            ),
          )
        if (!rows.length) return c.json(missing, 404)
        if (event.data.type !== 'Issue') return c.json({ ok: true as const, replayed: false }, 200)
        const issue = event.data.data
        if (!issue) return c.json({ error: 'Invalid Linear webhook' }, 400)
        // The delivery header is unsigned. Key the receipt to signed fields so a caller
        // cannot bypass deduplication by swapping the header on an otherwise valid body.
        const key = event.data.createdAt
          ? await digest(
              JSON.stringify([
                event.data.webhookId,
                event.data.type,
                event.data.action,
                event.data.createdAt,
                issue.id,
              ]),
            )
          : signature.toLowerCase()
        const work = syncWebhook(
          db,
          rows,
          config,
          providerFor(config.mode, c.env),
          organizationId,
          { key, timestamp: webhookTimestamp, issueId: issue.id, teamId: issue.teamId },
        )
        const context = executionContext(c)
        if (context) {
          // Linear expects acknowledgement within five seconds. Workers keeps the
          // invocation alive for the sync; daily catch-up covers interrupted work.
          context.waitUntil(work.catch(() => undefined))
          return c.json({ ok: true as const, queued: true as const }, 200)
        }
        const result = await work
        if (result.failed) return c.json(retrySync, 502)
        if (result.limited) return c.json({ error: 'Too many Linear deliveries' }, 429)
        return c.json({ ok: true as const, replayed: result.replayed }, 200)
      },
      invalid,
    )
}
