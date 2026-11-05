import { createAuth } from './auth'
import { connectLocal } from './dev/local'
import { createApp } from './index'

// Entry for `pnpm dev` (wrangler env.dev): the same app on the local Docker database.
export default createApp({
  database: connectLocal,
  auth: (env) => createAuth(env, connectLocal(env.DATABASE_URL)),
})
