import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { projects, statusReports } from '../db/schema'
import type { Env } from '../env'
import { projectForMember } from '../reviews/service'
import {
  type AuthFactory,
  type DatabaseFactory,
  requireSession,
  useDb,
} from '../workspaces/permissions'
import { reportSchema } from './report'
import { confirmUnsubscribe, previewStatusReport, unsubscribePath } from './service'

const error = z.object({ error: z.string() })
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})
const id = z.object({ id: z.uuid() })
const sentReport = reportSchema.extend({
  id: z.uuid(),
  sentAt: z.iso.datetime(),
  recipientsCount: z.number().int().positive(),
})
const listRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/status-reports',
  request: { params: id },
  responses: {
    200: json(z.object({ reports: z.array(sentReport) }), 'Sent weekly status reports'),
    400: json(error, 'Invalid project ID'),
    401: json(error, 'Sign in required'),
    404: json(error, 'Project not found'),
  },
})
const previewRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/status-reports/preview',
  request: { params: id },
  responses: {
    200: json(z.object({ report: reportSchema }), 'This week’s weekly status report preview'),
    400: json(error, 'Invalid project ID'),
    401: json(error, 'Sign in required'),
    403: json(error, 'Owner or editor required'),
    404: json(error, 'Project not found'),
  },
})

const unsubscribeToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const unsubscribeTokenParams = z.object({ token: z.string().max(128) })
const unsubscribeRequest = {
  path: `${unsubscribePath}/{token}` as const,
  request: { params: unsubscribeTokenParams },
  responses: {
    200: {
      description: 'Unsubscribe result',
      content: { 'text/html': { schema: z.string() } },
    },
    404: json(error, 'Unsubscribe link not found'),
  },
}
const unsubscribeGetRoute = createRoute({ ...unsubscribeRequest, method: 'get' })
const unsubscribePostRoute = createRoute({ ...unsubscribeRequest, method: 'post' })

function unsubscribePage(complete: boolean) {
  const title = complete ? 'You’re unsubscribed' : 'Unsubscribe from weekly status emails'
  const detail = complete
    ? 'You won’t receive weekly status emails for this project anymore.'
    : 'This stops weekly status emails for this project.'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    body{margin:0;background:rgb(247,247,245);font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif;color:rgb(26,26,24)}
    main{box-sizing:border-box;max-width:520px;margin:64px auto;padding:24px}
    h1{font-size:24px;line-height:1.3}
    button{min-height:44px;border:0;border-radius:6px;padding:0 16px;background:rgb(37,80,201);color:white;font:inherit}
    button:focus-visible{outline:2px solid rgb(37,80,201);outline-offset:3px}
    </style></head><body><main><h1>${title}</h1><p>${detail}</p>
    ${complete ? '' : '<form method="post"><button type="submit">Unsubscribe</button></form>'}
    </main></body></html>`
}

export function createProjectStatusReportRoutes(
  options: { database?: DatabaseFactory; auth?: AuthFactory } = {},
) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (result.success) return
      if (c.req.path.startsWith(unsubscribePath))
        return c.json({ error: 'Unsubscribe link not found' }, 404)
      return c.json({ error: 'Invalid project ID' }, 400)
    },
  })
  for (const path of ['/projects/:id/status-reports', '/projects/:id/status-reports/preview'])
    app.use(path, useDb(options.database), requireSession(options.auth))
  app.use(`${unsubscribePath}/:token`, useDb(options.database), async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Robots-Tag', 'noindex')
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    await next()
  })
  return app
    .openapi(listRoute, async (c) => {
      const db = c.get('db')
      const project = await projectForMember(db, c.req.valid('param').id, c.get('user').id)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const reports = await db
        .select({
          id: statusReports.id,
          week: statusReports.week,
          status: statusReports.status,
          subject: statusReports.subject,
          body: statusReports.body,
          sentAt: statusReports.sentAt,
          recipientsCount: statusReports.recipientsCount,
        })
        .from(statusReports)
        .innerJoin(projects, eq(statusReports.projectId, projects.id))
        .where(
          and(
            eq(statusReports.projectId, project.id),
            eq(projects.workspaceId, project.workspaceId),
            isNull(projects.deletedAt),
            isNotNull(statusReports.sentAt),
          ),
        )
        .orderBy(desc(statusReports.week))
      return c.json(
        {
          reports: reports.flatMap((row) =>
            row.sentAt ? [{ ...row, sentAt: row.sentAt.toISOString() }] : [],
          ),
        },
        200,
      )
    })
    .openapi(previewRoute, async (c) => {
      const db = c.get('db')
      const project = await projectForMember(db, c.req.valid('param').id, c.get('user').id)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      if (project.role === 'viewer') return c.json({ error: 'Owner or editor required' }, 403)
      const report = await previewStatusReport(db, project, new Date(), c.env.WEB_ORIGIN)
      if (!report) return c.json({ error: 'Project not found' }, 404)
      return c.json({ report }, 200)
    })
    .openapi(unsubscribeGetRoute, async (c) => {
      const token = unsubscribeToken.safeParse(c.req.valid('param').token)
      if (!token.success) return c.json({ error: 'Unsubscribe link not found' }, 404)
      if (!(await confirmUnsubscribe(c.get('db'), token.data, false)))
        return c.json({ error: 'Unsubscribe link not found' }, 404)
      return c.html(unsubscribePage(false), 200)
    })
    .openapi(unsubscribePostRoute, async (c) => {
      const token = unsubscribeToken.safeParse(c.req.valid('param').token)
      if (!token.success) return c.json({ error: 'Unsubscribe link not found' }, 404)
      if (!(await confirmUnsubscribe(c.get('db'), token.data, true)))
        return c.json({ error: 'Unsubscribe link not found' }, 404)
      return c.html(unsubscribePage(true), 200)
    })
}
