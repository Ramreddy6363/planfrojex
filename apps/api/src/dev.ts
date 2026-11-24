import { createAuth } from './auth'
import { connectLocal } from './dev/local'
import { mountDevOutbox } from './dev-outbox'
import { createApp } from './index'

// Entry for `pnpm dev` (wrangler env.dev): the same app on the local Docker database.
const app = createApp({
  database: connectLocal,
  localTracker: true,
  auth: (env) => createAuth(env, connectLocal(env.DATABASE_URL)),
})

export default mountDevOutbox(app)
