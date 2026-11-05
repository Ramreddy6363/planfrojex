import { drizzle } from 'drizzle-orm/node-postgres'
import { createAuth } from '../auth'
import * as schema from '../db/schema'
import { outbox } from '../email'
import type { Env } from '../env'
import { createApp } from '../index'
import { startTestDatabase } from './database'

export async function testApp() {
  const database = await startTestDatabase()
  const env: Env['Bindings'] = {
    DATABASE_URL: database.connectionString,
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    BETTER_AUTH_URL: 'http://localhost:8787',
    WEB_ORIGIN: 'http://localhost:5173',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    RESEND_API_KEY: '',
    EMAIL_FROM: '',
    ANTHROPIC_API_KEY: '',
  }
  const db = drizzle(database.client, { schema })
  const auth = createAuth(env, db)
  const app = createApp({ database: () => db, auth: () => auth })
  const request = (path: string, init?: RequestInit) => app.request(path, init, env)
  return {
    request,
    async signIn(email: string) {
      const headers = { origin: env.WEB_ORIGIN, 'content-type': 'application/json' }
      const send = await request('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, type: 'sign-in' }),
      })
      if (!send.ok) throw new Error(`Failed to send test code: ${send.status}`)
      const mail = [...outbox].reverse().find((message) => message.to === email)
      const code = mail?.text.match(/\b\d{6}\b/)?.[0]
      if (!code) throw new Error('Test code was not delivered')
      const login = await request('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, otp: code }),
      })
      if (!login.ok) throw new Error(`Failed to sign in test user: ${login.status}`)
      const cookie = login.headers.get('set-cookie')?.split(';')[0]
      if (!cookie) throw new Error('Test session cookie was not set')
      return { origin: env.WEB_ORIGIN, cookie }
    },
    async stop() {
      outbox.length = 0
      await database.stop()
    },
  }
}
