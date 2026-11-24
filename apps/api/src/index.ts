import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { createAccountRoutes } from './account/routes'
import { createActivityRoutes } from './activity/routes'
import { createAuth } from './auth'
import { connect } from './db'
import { createDiagramRoutes, createProjectDiagramRoutes } from './diagrams/routes'
import type { DiagramDraftModel } from './drafts/diagram-service'
import { createProjectDraftRoutes } from './drafts/routes'
import type { DraftModel } from './drafts/service'
import type { Env } from './env'
import { createInboxRoutes } from './inbox/routes'
import { createLinearProvider } from './integrations/linear'
import { createIntegrationRoutes, type TrackerRouteOptions } from './integrations/routes'
import { linearConfig } from './integrations/security'
import { runDailyTrackerSync } from './integrations/sync'
import { createProjectBriefRoutes } from './projects/brief-routes'
import { createMyTaskRoutes } from './projects/my-task-routes'
import { createProjectPlanRoutes } from './projects/plan-routes'
import { createProjectRoutes } from './projects/routes'
import { createProjectTaskRoutes, createTaskRoutes } from './projects/task-routes'
import { consumeRateLimit } from './rate-limit'
import { createReviewRoutes } from './reviews/routes'
import { createSearchRoutes } from './search-routes'
import { createShareRoutes } from './share/routes'
import { createWorkspaceRoutes } from './workspaces/routes'
import { createWorkspaceSettingsRoutes } from './workspaces/settings-routes'

export function createApp(
  options: {
    draftModel?: DraftModel
    diagramDraftModel?: DiagramDraftModel
  } & TrackerRouteOptions = {},
) {
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
    .route('/', createAccountRoutes(options))
    .route('/', createWorkspaceRoutes(options))
    .route('/', createWorkspaceSettingsRoutes(options))
    .route('/', createSearchRoutes(options))
    .route('/', createShareRoutes(options))
    .route('/', createReviewRoutes(options))
    .route('/', createProjectRoutes(options))
    .route('/', createProjectBriefRoutes(options))
    .route('/', createActivityRoutes(options))
    .route('/', createMyTaskRoutes(options))
    .route('/', createInboxRoutes(options))
    .route('/', createIntegrationRoutes(options))
    .route('/', createProjectTaskRoutes(options))
    .route('/', createProjectPlanRoutes(options))
    .route('/', createProjectDraftRoutes(options))
    .route('/', createProjectDiagramRoutes(options))
    .route('/', createDiagramRoutes(options))
    .route('/', createTaskRoutes(options))
}

const app = createApp()

export type AppType = typeof app
export type ProjectTaskRoutes = ReturnType<typeof createProjectTaskRoutes>
export type ProjectDiagramRoutes = ReturnType<typeof createProjectDiagramRoutes>
export type DiagramRoutes = ReturnType<typeof createDiagramRoutes>
export type IntegrationRoutes = ReturnType<typeof createIntegrationRoutes>
export type MyTaskRoutes = ReturnType<typeof createMyTaskRoutes>
export type TaskRoutes = ReturnType<typeof createTaskRoutes>
export default Object.assign(app, {
  async scheduled(_controller: unknown, env: Env['Bindings']) {
    const config = await linearConfig(env, false)
    if (config?.mode === 'real')
      await runDailyTrackerSync(connect(env.DATABASE_URL), config, createLinearProvider(env))
  },
})
