import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { connect, type Db } from '../db'
import {
  emailUnsubscribes,
  projects,
  reviewRequests,
  shareLinks,
  statusReportDeliveries,
  user,
  workspaces,
} from '../db/schema'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireMember,
  requireSession,
  useDb,
} from '../workspaces/permissions'

import { publicSchema, readPublicSnapshot } from './public-snapshot'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const section = z.enum(['brief', 'plan', 'diagrams', 'tasks'])
const includeSchema = z
  .array(section)
  .max(4)
  .refine((x) => new Set(x).size === x.length)
const share = z.object({
  enabled: z.boolean(),
  include: includeSchema,
  viewCount: z.number(),
  lastViewedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
})
const shareResponse = z.object({ share, token: z.string().optional() })
const params = z.object({ ws: z.string(), key: z.string() })
const errors = {
  401: json(error, 'Sign in required'),
  403: json(error, 'Owner or editor required'),
  404: json(error, 'Not found'),
}
const getRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/projects/{key}/share',
  request: { params },
  responses: { 200: json(shareResponse, 'Share settings'), ...errors },
})
const putRoute = createRoute({
  method: 'put',
  path: '/workspaces/{ws}/projects/{key}/share',
  request: {
    params,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              enabled: z.boolean(),
              include: includeSchema,
              rotate: z.boolean().optional(),
            })
            .strict(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: json(shareResponse, 'Share settings'),
    400: json(error, 'Invalid input'),
    ...errors,
  },
})
const deleteRoute = createRoute({
  method: 'delete',
  path: '/workspaces/{ws}/projects/{key}/share',
  request: { params },
  responses: { 200: json(z.object({ ok: z.literal(true) }), 'Link disabled'), ...errors },
})
const listRoute = createRoute({
  method: 'get',
  path: '/workspaces/{ws}/share-links',
  request: { params: z.object({ ws: z.string() }) },
  responses: {
    200: json(
      z.object({
        links: z.array(
          z.object({
            projectKey: z.string(),
            projectName: z.string(),
            createdBy: z.string().nullable(),
            createdAt: z.string(),
            viewCount: z.number(),
          }),
        ),
      }),
      'Share links',
    ),
    401: errors[401],
    404: errors[404],
  },
})
const publicRoute = createRoute({
  method: 'get',
  path: '/public/share/{token}',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: json(publicSchema, 'Public project'),
    404: json(error, 'Link unavailable'),
    429: json(error, 'Rate limit reached'),
  },
})
const defaults = ['brief', 'plan', 'diagrams'] as const
const output = (row: typeof shareLinks.$inferSelect | undefined) => ({
  enabled: !!row && !row.revokedAt,
  include: (row?.include ?? [...defaults]) as z.infer<typeof includeSchema>,
  viewCount: row?.viewCount ?? 0,
  lastViewedAt: row?.lastViewedAt?.toISOString() ?? null,
  createdAt: row?.createdAt.toISOString() ?? null,
})
const hash = async (token: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('')
const privateRateSubject = async (secret: string, ip: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`public-share:${ip}`),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const token = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

export function createShareRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>()
  app.use(
    '/workspaces/:ws/projects/:key/share',
    async (c, next) => {
      if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.WEB_ORIGIN)
        return c.json({ error: 'Invalid origin' }, 403)
      return next()
    },
    useDb(options.database),
    requireSession(options.auth),
    requireMember,
  )
  app.use(
    '/workspaces/:ws/share-links',
    useDb(options.database),
    requireSession(options.auth),
    requireMember,
  )
  app.use('/public/share/:token', async (c, next) => {
    c.header('X-Robots-Tag', 'noindex')
    c.header('Referrer-Policy', 'no-referrer')
    await next()
  })
  const findProject = async (db: Db, workspaceId: string, key: string) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.key, key),
          isNull(projects.deletedAt),
        ),
      )
    return project as typeof projects.$inferSelect | undefined
  }
  return app
    .openapi(getRoute, async (c) => {
      const p = await findProject(c.get('db'), c.get('membership').id, c.req.valid('param').key)
      if (!p) return c.json({ error: 'Project not found' }, 404)
      if (c.get('membership').role === 'viewer')
        return c.json({ error: 'Owner or editor required' }, 403)
      const [row] = await c
        .get('db')
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.workspaceId, p.workspaceId), eq(shareLinks.projectId, p.id)))
      return c.json({ share: output(row) }, 200)
    })
    .openapi(putRoute, async (c) => {
      const p = await findProject(c.get('db'), c.get('membership').id, c.req.valid('param').key)
      if (!p) return c.json({ error: 'Project not found' }, 404)
      if (c.get('membership').role === 'viewer')
        return c.json({ error: 'Owner or editor required' }, 403)
      const db = c.get('db'),
        body = c.req.valid('json')
      const [old] = await db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.workspaceId, p.workspaceId), eq(shareLinks.projectId, p.id)))
      if (!body.enabled && !old)
        return c.json({ share: { ...output(undefined), include: body.include } }, 200)
      if (body.enabled && (!old || old.revokedAt || body.rotate)) {
        const raw = token(),
          tokenHash = await hash(raw),
          now = new Date()
        const [row] = await db
          .insert(shareLinks)
          .values({
            workspaceId: p.workspaceId,
            projectId: p.id,
            tokenHash,
            include: body.include,
            createdBy: c.get('user').id,
          })
          .onConflictDoUpdate({
            target: shareLinks.projectId,
            set: {
              tokenHash,
              include: body.include,
              createdBy: c.get('user').id,
              createdAt: now,
              revokedAt: null,
              viewCount: 0,
              lastViewedAt: null,
            },
          })
          .returning()
        return c.json({ share: output(row), token: raw }, 200)
      }
      const [row] = await db
        .update(shareLinks)
        .set({ include: body.include, ...(!body.enabled ? { revokedAt: new Date() } : {}) })
        .where(and(eq(shareLinks.workspaceId, p.workspaceId), eq(shareLinks.projectId, p.id)))
        .returning()
      return c.json({ share: output(row) }, 200)
    })
    .openapi(deleteRoute, async (c) => {
      const p = await findProject(c.get('db'), c.get('membership').id, c.req.valid('param').key)
      if (!p) return c.json({ error: 'Project not found' }, 404)
      if (c.get('membership').role !== 'owner')
        return c.json({ error: 'Owner or editor required' }, 403)
      await c
        .get('db')
        .update(shareLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(shareLinks.workspaceId, p.workspaceId),
            eq(shareLinks.projectId, p.id),
            isNull(shareLinks.revokedAt),
          ),
        )
      return c.json({ ok: true as const }, 200)
    })
    .openapi(listRoute, async (c) => {
      const rows = await c
        .get('db')
        .select({
          projectKey: projects.key,
          projectName: projects.name,
          createdBy: user.name,
          createdAt: shareLinks.createdAt,
          viewCount: shareLinks.viewCount,
        })
        .from(shareLinks)
        .innerJoin(
          projects,
          and(
            eq(projects.id, shareLinks.projectId),
            eq(projects.workspaceId, shareLinks.workspaceId),
          ),
        )
        .leftJoin(user, eq(user.id, shareLinks.createdBy))
        .where(
          and(
            eq(shareLinks.workspaceId, c.get('membership').id),
            isNull(shareLinks.revokedAt),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(desc(shareLinks.createdAt))
      return c.json(
        { links: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) },
        200,
      )
    })
    .openapi(publicRoute, async (c) => {
      const invalid = () => c.json({ error: 'This link doesn’t work anymore' }, 404)
      const raw = c.req.valid('param').token
      const db = (options.database ?? connect)(c.env.DATABASE_URL)
      if (
        !(await consumeRateLimit(
          db,
          'public-share',
          await privateRateSubject(
            c.env.BETTER_AUTH_SECRET,
            c.req.header('CF-Connecting-IP') ?? 'unknown',
          ),
          1,
          60,
          60_000,
        ))
      )
        return c.json({ error: 'Too many requests. Try again in a minute.' }, 429)
      if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return invalid()
      const tokenHash = await hash(raw)
      const lead = alias(user, 'lead'),
        creator = alias(user, 'creator')
      const [found] = await db
        .select({
          link: shareLinks,
          project: projects,
          workspaceName: workspaces.name,
          leadName: lead.name,
          sharedBy: creator.name,
        })
        .from(shareLinks)
        .innerJoin(
          projects,
          and(
            eq(projects.id, shareLinks.projectId),
            eq(projects.workspaceId, shareLinks.workspaceId),
          ),
        )
        .innerJoin(workspaces, eq(workspaces.id, shareLinks.workspaceId))
        .leftJoin(lead, eq(lead.id, projects.leadId))
        .leftJoin(creator, eq(creator.id, shareLinks.createdBy))
        .where(
          and(
            eq(shareLinks.tokenHash, tokenHash),
            isNull(shareLinks.revokedAt),
            isNull(projects.deletedAt),
          ),
        )
      if (found) {
        const counted = await db
          .update(shareLinks)
          .set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() })
          .where(
            and(
              eq(shareLinks.id, found.link.id),
              eq(shareLinks.tokenHash, tokenHash),
              eq(shareLinks.workspaceId, found.link.workspaceId),
              isNull(shareLinks.revokedAt),
            ),
          )
          .returning({ id: shareLinks.id })
        if (!counted.length) return invalid()
        const { data } = await readPublicSnapshot(db, found)
        return c.json(data, 200)
      }
      const [reviewerLink] = await db
        .select({
          project: projects,
          link: { include: shareLinks.include },
          linkId: shareLinks.id,
          shareTokenHash: shareLinks.tokenHash,
          workspaceName: workspaces.name,
          leadName: lead.name,
          sharedBy: creator.name,
        })
        .from(emailUnsubscribes)
        .innerJoin(
          statusReportDeliveries,
          and(eq(statusReportDeliveries.id, emailUnsubscribes.deliveryId)),
        )
        .innerJoin(
          shareLinks,
          and(
            eq(shareLinks.projectId, emailUnsubscribes.projectId),
            eq(shareLinks.tokenHash, statusReportDeliveries.shareTokenHash),
          ),
        )
        .innerJoin(
          reviewRequests,
          and(
            eq(reviewRequests.id, emailUnsubscribes.shareReviewRequestId),
            eq(reviewRequests.id, statusReportDeliveries.reviewRequestId),
            eq(reviewRequests.projectId, shareLinks.projectId),
            eq(reviewRequests.workspaceId, shareLinks.workspaceId),
            eq(reviewRequests.shareTokenHash, shareLinks.tokenHash),
          ),
        )
        .innerJoin(
          projects,
          and(
            eq(projects.id, shareLinks.projectId),
            eq(projects.workspaceId, shareLinks.workspaceId),
          ),
        )
        .innerJoin(workspaces, eq(workspaces.id, shareLinks.workspaceId))
        .leftJoin(lead, eq(lead.id, projects.leadId))
        .leftJoin(creator, eq(creator.id, shareLinks.createdBy))
        .where(
          and(
            eq(emailUnsubscribes.shareTokenHash, tokenHash),
            isNull(shareLinks.revokedAt),
            isNull(projects.deletedAt),
            isNull(reviewRequests.cancelledAt),
            gt(reviewRequests.expiresAt, new Date()),
            isNotNull(statusReportDeliveries.shareInclude),
          ),
        )
      if (!reviewerLink) return invalid()
      const counted = await db
        .update(shareLinks)
        .set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() })
        .where(
          and(
            eq(shareLinks.id, reviewerLink.linkId),
            eq(shareLinks.tokenHash, reviewerLink.shareTokenHash),
            isNull(shareLinks.revokedAt),
          ),
        )
        .returning({ id: shareLinks.id })
      if (!counted.length) return invalid()
      const { data } = await readPublicSnapshot(db, reviewerLink)
      return c.json(data, 200)
    })
}
