import { drizzle } from 'drizzle-orm/node-postgres'
import type { ExecutionContext } from 'hono'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { memberships, user, workspaces } from '../db/schema'
import type { Env } from '../env'
import { createApp } from '../index'
import { openTestDb } from '../testing/pg'
import { createFakeLinearProvider } from './linear'

export const testEnv: Env['Bindings'] = {
  DATABASE_URL: 'test',
  BETTER_AUTH_SECRET: 'tracker-test-secret-that-is-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  ANTHROPIC_API_KEY: '',
  ENVIRONMENT: 'test',
}

export const listPath = '/workspaces/northwind/integrations'
export const connectPath = `${listPath}/linear/connect`

export async function trackerFixture(url: string) {
  const database = await openTestDb(url)
  const pool = new Pool({ connectionString: url, options: `-c search_path=${database.schemaName}` })
  const db = drizzle(pool, { schema })
  const fake = createFakeLinearProvider()
  const app = createApp({
    fakeLinearProvider: fake.provider,
    database: () => db,
    auth: () =>
      ({
        api: {
          getSession: async ({ headers }: { headers: Headers }) => {
            const id = headers.get('x-test-actor')
            return id ? { user: { id, email: `${id}@example.com` } } : null
          },
        },
      }) as never,
  })
  await db.insert(user).values(
    ['owner', 'editor', 'viewer', 'other', 'second-owner'].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  )
  const [workspace, other] = await db
    .insert(workspaces)
    .values([
      { name: 'Northwind', slug: 'northwind' },
      { name: 'Other', slug: 'other' },
    ])
    .returning()
  if (!workspace || !other) throw new Error('Missing test workspaces')
  await db.insert(memberships).values([
    { workspaceId: workspace.id, userId: 'owner', role: 'owner' },
    { workspaceId: workspace.id, userId: 'editor', role: 'editor' },
    { workspaceId: workspace.id, userId: 'viewer', role: 'viewer' },
    { workspaceId: workspace.id, userId: 'second-owner', role: 'owner' },
    { workspaceId: other.id, userId: 'other', role: 'owner' },
  ])
  const request = (path: string, method = 'GET', as: string | null = 'owner', json?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: {
          origin: testEnv.WEB_ORIGIN,
          ...(as ? { 'x-test-actor': as } : {}),
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
      },
      testEnv,
    )
  const authorizationUrl = async () => {
    const response = await request(connectPath, 'POST')
    if (response.status !== 200) throw new Error(`Expected connect 200, got ${response.status}`)
    return ((await response.json()) as { authorizationUrl: string }).authorizationUrl
  }
  const connect = async () => {
    const response = await request(await authorizationUrl())
    if (response.status !== 302) throw new Error(`Expected callback 302, got ${response.status}`)
    const listed = await request(listPath)
    const body = (await listed.json()) as {
      integration: { id: string; states: { id: string; name: string }[] }
    }
    return body.integration
  }
  return {
    database: {
      ...database,
      async close() {
        await pool.end()
        await database.close()
      },
    },
    db,
    app,
    workspace,
    other,
    request,
    authorizationUrl,
    connect,
    fake,
  }
}

export async function webhook(
  fixture: Awaited<ReturnType<typeof trackerFixture>>,
  payload: unknown,
  secret = 'planfrojex-fake-linear-webhook',
  executionCtx?: ExecutionContext,
) {
  const body = JSON.stringify(payload)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const signature = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return fixture.app.request(
    '/webhooks/linear',
    {
      method: 'POST',
      headers: {
        'linear-signature': signature,
        'linear-timestamp': String(Date.now()),
        'linear-delivery': crypto.randomUUID(),
        'content-type': 'application/json',
      },
      body,
    },
    testEnv,
    executionCtx,
  )
}
