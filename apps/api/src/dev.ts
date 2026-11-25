import { createAuth } from './auth'
import { connectLocal } from './dev/local'
import { mountDevOutbox } from './dev-outbox'
import type { Env } from './env'
import { createApp, dispatchScheduledChecks } from './index'

// Entry for `pnpm dev` (wrangler env.dev): the same app on the local Docker database.
const app = createApp({
  database: connectLocal,
  localTracker: true,
  auth: (env) => createAuth(env, connectLocal(env.DATABASE_URL)),
})

export default Object.assign(mountDevOutbox(app), {
  async scheduled(controller: { cron: string; scheduledTime: number }, env: Env['Bindings']) {
    await dispatchScheduledChecks(connectLocal(env.DATABASE_URL), env, controller)
  },
})
