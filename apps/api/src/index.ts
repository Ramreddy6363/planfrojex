import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { createAuth } from './auth'
import { connect } from './db'
import type { Env } from './env'
import { createProjectBriefRoutes } from './projects/brief-routes'
import { createProjectPlanRoutes } from './projects/plan-routes'
import { createProjectRoutes } from './projects/routes'
import { createProjectTaskRoutes, createTaskRoutes } from './projects/task-routes'
import { consumeRateLimit } from './rate-limit'
import type { AuthFactory, DatabaseFactory } from './workspaces/permissions'
import { createWorkspaceRoutes } from './workspaces/routes'

export function createApp(options: { database?: DatabaseFactory; auth?: AuthFactory } = {}) {
  const database = options.database ?? connect
  const auth = options.auth ?? createAuth
  return new OpenAPIHono<Env>()
    .use('*', (c, next) => cors({ origin: c.env?.WEB_ORIGIN ?? '', credentials: true })(c, next))
    .use('/api/auth/*', async (c, next) => {
      if (
        [
          '/api/auth/email-otp/request-password-reset',
          '/api/auth/forget-password/email-otp',
          '/api/auth/email-otp/reset-password',
          '/api/auth/email-otp/check-verification-otp',
        ].includes(c.req.path)
      )
        return c.notFound()
      return next()
    })
    .use('/api/auth/email-otp/send-verification-otp', async (c, next) => {
      if (c.req.method !== 'POST') return next()
      const body = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).safeParse(
        await c.req.raw
          .clone()
          .json()
          .catch(() => null),
      )
      if (!body.success) return next()
      if (
        !(await consumeRateLimit(
          database(c.env.DATABASE_URL),
          'code-email',
          body.data.email,
          1,
          5,
          600_000,
        ))
      )
        return c.json({ error: 'Too many codes requested. Try again later.' }, 429)
      return next()
    })
    .on(['GET', 'POST'], '/api/auth/*', (c) => auth(c.env).handler(c.req.raw))
    .get('/health', (c) => c.json({ ok: true }))
    .route('/', createWorkspaceRoutes(options))
    .route('/', createProjectRoutes(options))
    .route('/', createProjectBriefRoutes(options))
    .route('/', createProjectTaskRoutes(options))
    .route('/', createProjectPlanRoutes(options))
    .route('/', createTaskRoutes(options))
}

const app = createApp()

export type AppType = typeof app
export type ProjectTaskRoutes = ReturnType<typeof createProjectTaskRoutes>
export type TaskRoutes = ReturnType<typeof createTaskRoutes>
export default app
