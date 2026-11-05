import { describe, expect, it, vi } from 'vitest'
import type { Db } from '../db'
import { createWorkspaceRoutes } from './routes'

const env = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://test',
  BETTER_AUTH_SECRET: '',
  BETTER_AUTH_URL: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  ANTHROPIC_API_KEY: '',
}
const headers = { origin: env.WEB_ORIGIN, 'content-type': 'application/json' }
const touched = vi.fn()
const db = new Proxy({}, { get: () => touched() }) as Db
const signedOut = { api: { getSession: async () => null } }
const routes = createWorkspaceRoutes({ database: () => db, auth: () => signedOut as never })

// Membership, role and isolation tests need a real database: routes.integration.test.ts.
describe('workspace routes before the database', () => {
  it('requires a session to create a workspace', async () => {
    const res = await routes.request(
      '/workspaces',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Test', slug: 'test', isPersonal: true }),
      },
      env,
    )
    expect(res.status).toBe(401)
    expect(touched).not.toHaveBeenCalled()
  })
  it('rejects cross-origin writes before accessing the database', async () => {
    const res = await routes.request(
      '/invites/accept',
      { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' },
      env,
    )
    expect(res.status).toBe(403)
    expect(touched).not.toHaveBeenCalled()
  })
  it('answers 404 for unknown paths even when signed out', async () => {
    expect((await routes.request('/nope', { headers }, env)).status).toBe(404)
    expect(touched).not.toHaveBeenCalled()
  })
})
