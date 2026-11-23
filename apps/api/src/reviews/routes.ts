import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { getSignedCookie, setSignedCookie } from 'hono/cookie'
import { reviewers, reviewRequests } from '../db/schema'
import { sendReviewCode, sendReviewInvitations } from '../email'
import type { Env } from '../env'
import { consumeRateLimit } from '../rate-limit'
import { publicSchema, readPublicSnapshot } from '../share/public-snapshot'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import {
  activeLink,
  codeHash,
  codeMatches,
  currentApprovals,
  expiration,
  hash,
  newCode,
  newToken,
  projectForMember,
  projectSectionKeys,
  requestForMember,
  requestOutput,
  requestProgress,
  reviewerContext,
  reviewRevision,
  reviewSections,
  writeApproval,
} from './service'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const body = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
  required: true as const,
})
const id = { params: z.object({ id: z.uuid() }) }
const token = { params: z.object({ token: z.string() }) }
const email = z.string().trim().toLowerCase().max(254).pipe(z.email())
const ok = z.object({ ok: z.literal(true) })
const memberErrors = {
  400: json(error, 'Invalid details'),
  401: json(error, 'Sign in required'),
  403: json(error, 'Owner or editor required'),
  404: json(error, 'Not found'),
}
const publicErrors = {
  400: json(error, 'Invalid details'),
  403: json(error, 'Invalid origin'),
  404: json(error, 'Review unavailable'),
  429: json(error, 'Rate limit reached'),
}

const progress = z.object({ approvedCount: z.number(), totalSections: z.number() })
const reviewer = progress.extend({
  id: z.uuid(),
  email: z.string(),
  verifiedAt: z.string().nullable(),
})
const requestSummary = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  dueDate: z.string().nullable(),
  expiresAt: z.string(),
})
const createRequest = createRoute({
  method: 'post',
  path: '/projects/{id}/review-requests',
  request: {
    ...id,
    body: body(
      z
        .object({
          emails: z
            .array(email)
            .min(1)
            .max(20)
            .refine((list) => new Set(list).size === list.length),
          dueDate: z.iso.date().nullable().default(null),
        })
        .strict(),
    ),
  },
  responses: {
    201: json(
      z.object({ request: requestSummary, reviewers: z.array(reviewer) }),
      'Sent review request',
    ),
    ...memberErrors,
    409: json(error, 'No public review sections'),
    429: json(error, 'Review invitation limit reached'),
    503: json(error, 'Review email unavailable'),
  },
})
const listRequests = createRoute({
  method: 'get',
  path: '/projects/{id}/review-requests',
  request: id,
  responses: {
    200: json(
      z.object({
        requests: z.array(
          requestSummary.extend({
            cancelledAt: z.string().nullable(),
            reviewers: z.array(reviewer),
          }),
        ),
      }),
      'Review requests',
    ),
    ...memberErrors,
  },
})
const cancelRequest = createRoute({
  method: 'delete',
  path: '/review-requests/{id}',
  request: id,
  responses: { 200: json(ok, 'Cancelled review request'), ...memberErrors },
})
const verifyEmail = createRoute({
  method: 'post',
  path: '/public/share/{token}/verify-email',
  request: {
    ...token,
    body: body(
      z
        .object({
          email,
          code: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .strict(),
    ),
  },
  responses: {
    200: json(z.union([z.object({ sent: z.literal(true) }), ok]), 'Review code sent or verified'),
    ...publicErrors,
  },
})
const outcome = z.enum(['approved', 'changes_requested'])
const revision = z.string().regex(/^[0-9a-f]{64}$/)
const getReview = createRoute({
  method: 'get',
  path: '/public/share/{token}/review',
  request: token,
  responses: {
    200: json(
      publicSchema.extend({
        review: progress.extend({
          revision,
          requesterName: z.string(),
          reviewerEmail: z.string(),
          dueDate: z.string().nullable(),
          expiresAt: z.string(),
          sections: z.array(
            z.object({
              key: z.string(),
              revision,
              label: z.string(),
              outcome: outcome.nullable(),
              comment: z.string().nullable(),
              updatedAt: z.iso.datetime().nullable(),
            }),
          ),
          planChangeRequest: z.object({ comment: z.string() }).nullable(),
        }),
      }),
      'Public project review',
    ),
    ...publicErrors,
  },
})
const writeApprovals = createRoute({
  method: 'post',
  path: '/public/share/{token}/approvals',
  request: {
    ...token,
    body: body(
      z
        .object({
          section: z.string().regex(/^(brief|milestones|all|diagram:[A-Za-z0-9_-]{43})$/),
          outcome,
          comment: z.string().trim().min(1).max(2_000).optional(),
          revision,
        })
        .strict()
        .refine((input) => input.outcome === 'approved' || input.comment !== undefined),
    ),
  },
  responses: {
    200: json(progress.extend(ok.shape), 'Recorded review'),
    409: json(error, 'Review sections changed; refresh before approving the plan'),
    ...publicErrors,
  },
})

const unavailable = (c: Context<Env>) => c.json({ error: 'This link doesn’t work anymore' }, 404)
const limited = (c: Context<Env>) => c.json({ error: 'Too many requests. Try again later.' }, 429)
const forbidden = (c: Context<Env>) => c.json({ error: 'Owner or editor required' }, 403)
const reviewOrigin: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('Origin') !== c.env.WEB_ORIGIN)
    return c.json({ error: 'Invalid origin' }, 403)
  await next()
}

const isToken = (raw: string) => /^[A-Za-z0-9_-]{43}$/.test(raw)
const cookieName = (tokenHash: string) => `planfrojex_review_${tokenHash.slice(0, 24)}`
async function reviewerCookie(c: Context<Env>, tokenHash: string) {
  const value = await getSignedCookie(c, c.env.BETTER_AUTH_SECRET, cookieName(tokenHash))
  const [subject, expiry] = typeof value === 'string' ? value.split(':') : []
  return subject === tokenHash && Number(expiry) > Date.now()
}
async function setReviewerCookie(c: Context<Env>, tokenHash: string, expiresAt: Date) {
  await setSignedCookie(
    c,
    cookieName(tokenHash),
    `${tokenHash}:${expiresAt.getTime()}`,
    c.env.BETTER_AUTH_SECRET,
    {
      httpOnly: true,
      secure: new URL(c.env.BETTER_AUTH_URL).protocol === 'https:',
      sameSite: 'Lax',
      path: '/public/share',
      expires: expiresAt,
    },
  )
}
const publicLimit = (c: Context<Env>, scope: string) =>
  consumeRateLimit(
    c.get('db'),
    scope,
    `${c.env.BETTER_AUTH_SECRET}:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`,
    1,
    60,
    60_000,
  )

export function createReviewRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: 'Invalid review details' }, 400)
    },
  })
  for (const path of ['/projects/:id/review-requests', '/review-requests/:id'])
    app.use(path, useDb(options.database), requireSession(options.auth), reviewOrigin)
  app.use(
    '/public/share/:token/*',
    async (c, next) => {
      c.header('X-Robots-Tag', 'noindex')
      c.header('Referrer-Policy', 'no-referrer')
      c.header('Cache-Control', 'no-store')
      await next()
    },
    useDb(options.database),
    reviewOrigin,
  )

  return app
    .openapi(createRequest, async (c) => {
      const db = c.get('db')
      const { id } = c.req.valid('param')
      const { emails, dueDate } = c.req.valid('json')
      const actorId = c.get('user').id
      const created = await db.transaction(async (tx) => {
        const project = await projectForMember(tx, id, actorId, true)
        if (!project) return { state: 'missing' as const }
        if (project.role === 'viewer') return { state: 'forbidden' as const }
        const link = await activeLink(tx, project, true)
        if (!link) return { state: 'no-share' as const }
        const totalSections = (await projectSectionKeys(tx, project.id, link.include)).length
        if (!totalSections) return { state: 'no-share' as const }
        if (
          !(await consumeRateLimit(
            tx,
            'review-invitations',
            `${project.workspaceId}:${actorId}`,
            emails.length,
            60,
            60 * 60_000,
          ))
        )
          return { state: 'limited' as const }

        const now = new Date()
        const [request] = await tx
          .insert(reviewRequests)
          .values({
            projectId: project.id,
            workspaceId: project.workspaceId,
            createdBy: actorId,
            shareTokenHash: link.tokenHash,
            dueDate,
            expiresAt: expiration(now, dueDate),
            createdAt: now,
          })
          .returning()
        if (!request) throw new Error('Review request was not created')
        const invitations = await Promise.all(
          [...emails].sort().map(async (email) => {
            const token = newToken()
            return { email, token, tokenHash: await hash(token) }
          }),
        )
        const people = await tx
          .insert(reviewers)
          .values(
            invitations.map(({ email, tokenHash }) => ({
              requestId: request.id,
              email,
              tokenHash,
            })),
          )
          .returning({ id: reviewers.id, email: reviewers.email })
        return { state: 'created' as const, request, project, people, invitations, totalSections }
      })
      if (created.state === 'missing') return c.json({ error: 'Project not found' }, 404)
      if (created.state === 'forbidden') return forbidden(c)
      if (created.state === 'no-share')
        return c.json(
          { error: 'Share the Brief, Milestones or a diagram before asking for a review' },
          409,
        )
      if (created.state === 'limited') return limited(c)

      const delivered = await sendReviewInvitations(
        c.env,
        created.invitations.map(({ email, token }) => ({ email, token })),
        created.project.requesterName,
        created.project.name,
        dueDate,
      ).then(
        () => true,
        () => false,
      )
      if (!delivered) {
        await db
          .update(reviewRequests)
          .set({ cancelledAt: new Date() })
          .where(
            and(
              eq(reviewRequests.id, created.request.id),
              eq(reviewRequests.workspaceId, created.project.workspaceId),
              isNull(reviewRequests.cancelledAt),
            ),
          )
        return c.json({ error: 'Could not send the review invitations. Try again.' }, 503)
      }
      return c.json(
        {
          request: requestOutput(created.request),
          reviewers: created.people.map((person) => ({
            ...person,
            verifiedAt: null,
            approvedCount: 0,
            totalSections: created.totalSections,
          })),
        },
        201,
      )
    })
    .openapi(listRequests, async (c) => {
      const db = c.get('db')
      const project = await projectForMember(db, c.req.valid('param').id, c.get('user').id)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      return c.json({ requests: await requestProgress(db, project) }, 200)
    })
    .openapi(cancelRequest, async (c) => {
      const status = await c.get('db').transaction(async (tx) => {
        const request = await requestForMember(tx, c.req.valid('param').id, c.get('user').id)
        if (!request) return 'missing'
        if (request.role === 'viewer') return 'forbidden'
        await tx
          .update(reviewRequests)
          .set({ cancelledAt: new Date() })
          .where(
            and(
              eq(reviewRequests.id, request.id),
              eq(reviewRequests.workspaceId, request.workspaceId),
              isNull(reviewRequests.cancelledAt),
            ),
          )
        return 'cancelled'
      })
      if (status === 'missing') return c.json({ error: 'Review request not found' }, 404)
      if (status === 'forbidden') return forbidden(c)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(verifyEmail, async (c) => {
      if (!(await publicLimit(c, 'review-verify'))) return limited(c)
      const raw = c.req.valid('param').token
      if (!isToken(raw)) return unavailable(c)
      const tokenHash = await hash(raw)
      const { email, code } = c.req.valid('json')
      const secret = c.env.BETTER_AUTH_SECRET
      const result = await c.get('db').transaction(async (tx) => {
        const context = await reviewerContext(tx, tokenHash, true)
        if (!context) return { state: 'missing' as const }
        const { reviewer } = context
        const now = new Date()
        if (code === undefined) {
          if (!(await consumeRateLimit(tx, 'review-code-send', tokenHash, 1, 5, 60 * 60_000)))
            return { state: 'limited' as const }
          if (email !== reviewer.email) return { state: 'sent' as const }
          const generated = newCode()
          await tx
            .update(reviewers)
            .set({
              verificationCodeHash: await codeHash(secret, tokenHash, generated),
              verificationCodeExpiresAt: new Date(now.getTime() + 600_000),
              verificationAttempts: 0,
            })
            .where(eq(reviewers.id, reviewer.id))
          return { state: 'send' as const, code: generated }
        }
        if (
          email !== reviewer.email ||
          !reviewer.verificationCodeHash ||
          !reviewer.verificationCodeExpiresAt ||
          reviewer.verificationCodeExpiresAt <= now ||
          reviewer.verificationAttempts >= 5
        )
          return { state: 'invalid' as const }
        if (!(await codeMatches(secret, tokenHash, code, reviewer.verificationCodeHash))) {
          await tx
            .update(reviewers)
            .set({
              verificationAttempts: reviewer.verificationAttempts + 1,
            })
            .where(eq(reviewers.id, reviewer.id))
          return { state: 'invalid' as const }
        }
        await tx
          .update(reviewers)
          .set({
            verifiedAt: reviewer.verifiedAt ?? now,
            verificationCodeHash: null,
            verificationCodeExpiresAt: null,
            verificationAttempts: 0,
          })
          .where(eq(reviewers.id, reviewer.id))
        return { state: 'verified' as const, expiresAt: context.request.expiresAt }
      })
      if (result.state === 'missing') return unavailable(c)
      if (result.state === 'limited') return limited(c)
      if (result.state === 'invalid')
        return c.json(
          { error: 'That code is incorrect or expired. Try again or send a new code.' },
          400,
        )
      if (result.state === 'verified') {
        await setReviewerCookie(c, tokenHash, result.expiresAt)
        return c.json({ ok: true as const }, 200)
      }
      if (result.state === 'send') {
        // Both a mismatched address and mail delivery failure receive the same reply.
        await sendReviewCode(c.env, email, result.code).catch(() => {})
      }
      return c.json({ sent: true as const }, 200)
    })
    .openapi(getReview, async (c) => {
      const raw = c.req.valid('param').token
      if (!isToken(raw)) return unavailable(c)
      const tokenHash = await hash(raw)
      if (!(await reviewerCookie(c, tokenHash))) return unavailable(c)
      const db = c.get('db')
      const context = await reviewerContext(db, tokenHash)
      if (!context?.reviewer.verifiedAt) return unavailable(c)
      const { data, sharedDiagrams } = await readPublicSnapshot(db, context)
      const sections = await reviewSections(
        context.request.id,
        context.link.include,
        sharedDiagrams,
        data,
      )
      const rows = new Map(
        (await currentApprovals(db, context.reviewer.id)).map((row) => [row.section, row]),
      )
      const revision = await reviewRevision(sections)
      const planFeedback = rows.get('all')
      const feedback = planFeedback?.revision === revision ? planFeedback.comment : null
      const visible = sections.map(({ key, label, storedKey, revision }) => {
        const stored = rows.get(storedKey)
        const row = stored?.revision === revision ? stored : undefined
        return {
          key,
          revision,
          label,
          outcome: row?.outcome ?? null,
          comment: row?.comment ?? null,
          updatedAt: row?.updatedAt.toISOString() ?? null,
        }
      })
      return c.json(
        {
          ...data,
          review: {
            revision,
            requesterName: context.requesterName ?? 'A teammate',
            reviewerEmail: context.reviewer.email,
            dueDate: context.request.dueDate,
            expiresAt: context.request.expiresAt.toISOString(),
            sections: visible,
            approvedCount: visible.filter((row) => row.outcome === 'approved').length,
            totalSections: visible.length,
            planChangeRequest: feedback ? { comment: feedback } : null,
          },
        },
        200,
      )
    })
    .openapi(writeApprovals, async (c) => {
      if (!(await publicLimit(c, 'review-approval'))) return limited(c)
      const raw = c.req.valid('param').token
      if (!isToken(raw)) return unavailable(c)
      const tokenHash = await hash(raw)
      if (!(await reviewerCookie(c, tokenHash))) return unavailable(c)
      const status = await c.get('db').transaction(async (tx) => {
        const context = await reviewerContext(tx, tokenHash, true)
        if (!context?.reviewer.verifiedAt) return { state: 'missing' as const }
        const progress = await writeApproval(tx, context, c.req.valid('json'))
        if (!progress) return { state: 'missing' as const }
        if ('stale' in progress) return { state: 'stale' as const }
        return { state: 'saved' as const, progress }
      })
      if (status.state === 'missing') return unavailable(c)
      if (status.state === 'stale')
        return c.json(
          { error: 'This plan changed. Refresh this page before submitting your review.' },
          409,
        )
      return c.json({ ok: true as const, ...status.progress }, 200)
    })
}
