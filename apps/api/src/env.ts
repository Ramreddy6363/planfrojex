import type { Db } from './db'

export type Env = {
  Variables: {
    db: Db
    user: { id: string; email: string; emailVerified: boolean; name: string }
    membership: {
      id: string
      name: string
      slug: string
      isPersonal: boolean
      role: 'owner' | 'editor' | 'viewer'
    }
  }
  Bindings: {
    DATABASE_URL: string
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string
    GOOGLE_CLIENT_ID: string
    GOOGLE_CLIENT_SECRET: string
    RESEND_API_KEY: string
    EMAIL_FROM: string
    WEB_ORIGIN: string
    ENVIRONMENT?: string
    ANTHROPIC_API_KEY: string
  }
}
