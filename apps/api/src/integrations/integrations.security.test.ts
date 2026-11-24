import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { integrationSuite } from '../testing/pg'
import { createLinearProvider } from './linear'
import { decryptCredentials, linearConfig } from './security'
import { credentialsContext, runDailyTrackerSync } from './sync'
import { connectPath, listPath, testEnv, trackerFixture, webhook } from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
function gate() {
  let open = () => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

integrationSuite(url)('Linear integration permissions and credentials', () => {
  let fixture: Awaited<ReturnType<typeof trackerFixture>>
  beforeAll(async () => {
    fixture = await trackerFixture(url as string)
  })
  afterAll(async () => fixture?.database.close())

  it.each(['editor', 'viewer', 'other'])(
    'checks workspace scope and permissions for %s',
    async (actor) => {
      const status = actor === 'other' ? 404 : 403
      expect((await fixture.request(listPath, 'GET', actor)).status).toBe(status)
      expect((await fixture.request(connectPath, 'POST', actor)).status).toBe(status)
      const { id } = await fixture.connect()
      const root = `/integrations/${id}`
      for (const [path, method, body] of [
        [
          root,
          'PATCH',
          { options: { pushMilestones: true, pullStatus: true, importIssues: false } },
        ],
        [`${root}/sync`, 'POST', undefined],
        [root, 'DELETE', undefined],
      ] as const)
        expect((await fixture.request(path, method, actor, body)).status).toBe(status)
      expect((await fixture.request(await fixture.authorizationUrl(), 'GET', actor)).status).toBe(
        status,
      )
      await fixture.request(root, 'DELETE')
    },
  )

  it('binds OAuth state to the creating owner and consumes it once', async () => {
    const callback = await fixture.authorizationUrl()
    expect((await fixture.request(callback, 'GET', 'second-owner')).status).toBe(404)
    expect((await fixture.request(callback, 'GET', null)).status).toBe(401)
    const tampered = new URL(callback)
    const state = tampered.searchParams.get('state') as string
    tampered.searchParams.set('state', `${state.startsWith('a') ? 'b' : 'a'}${state.slice(1)}`)
    expect((await fixture.request(tampered.href)).status).toBe(404)
    expect((await fixture.request(callback)).status).toBe(302)
    expect((await fixture.request(callback)).status).toBe(404)
    const list = await fixture.request(listPath)
    expect(await list.text()).not.toMatch(/accessToken|refreshToken|encrypted|fake-linear-token/)
  })

  it('expires an unused OAuth authorization after ten minutes', async () => {
    const callback = await fixture.authorizationUrl()
    await fixture.database.client.query(
      "UPDATE integrations SET oauth_expires_at = now() - interval '1 second'",
    )
    expect((await fixture.request(callback)).status).toBe(404)
  })

  it('returns no OAuth callback details to a member of another workspace', async () => {
    const callback = await fixture.authorizationUrl()
    const outsider = await fixture.request(callback, 'GET', 'other')
    expect(outsider.status).toBe(404)
    expect(outsider.headers.has('location')).toBe(false)
    expect(await outsider.json()).toEqual({ error: 'Integration not found' })
    expect((await fixture.request(callback)).status).toBe(302)
  })

  it('does not fall back to fake Linear when production keys are missing', async () => {
    const response = await fixture.app.request(
      listPath,
      {
        headers: { 'x-test-actor': 'other' },
      },
      { ...testEnv, ENVIRONMENT: 'production' },
    )
    expect(response.status).toBe(404)
    const productionList = await fixture.app.request(
      '/workspaces/other/integrations',
      {
        headers: { 'x-test-actor': 'other' },
      },
      { ...testEnv, ENVIRONMENT: 'production' },
    )
    expect(await productionList.json()).toEqual({ configured: false, integration: null })
    const productionConnect = await fixture.app.request(
      '/workspaces/other/integrations/linear/connect',
      {
        method: 'POST',
        headers: { 'x-test-actor': 'other', origin: testEnv.WEB_ORIGIN },
      },
      { ...testEnv, ENVIRONMENT: 'production' },
    )
    expect(productionConnect.status).toBe(503)
    expect(await productionConnect.json()).toEqual({ error: 'Linear is not set up' })
  })

  it('requires the web origin for integration writes', async () => {
    const { id } = await fixture.connect()
    const root = `/integrations/${id}`
    for (const [path, method, body] of [
      [root, 'PATCH', JSON.stringify({ options: { pushMilestones: false } })],
      [`${root}/sync`, 'POST'],
      [root, 'DELETE'],
    ] as const) {
      const response = await fixture.app.request(
        path,
        {
          method,
          body,
          headers: {
            'x-test-actor': 'owner',
            origin: 'http://untrusted.example.com',
            'content-type': 'application/json',
          },
        },
        testEnv,
      )
      expect(response.status).toBe(403)
    }
  })

  it('requires a new publishing opt-in when the connected Linear team changes', async () => {
    await fixture.database.client.query('TRUNCATE rate_limits')
    const connected = await fixture.connect()
    const path = `/integrations/${connected.id}`
    expect(
      (await fixture.request(path, 'PATCH', 'owner', { options: { pushMilestones: true } })).status,
    ).toBe(200)
    await fixture.connect()
    expect(await (await fixture.request(listPath)).json()).toMatchObject({
      integration: { options: { pushMilestones: true } },
    })
    const account = fixture.fake.provider.account
    vi.spyOn(fixture.fake.provider, 'account').mockImplementationOnce(async (token, id) => ({
      ...(await account(token, id)),
      teamId: 'different-linear-team',
    }))
    await fixture.connect()
    expect(await (await fixture.request(listPath)).json()).toMatchObject({
      integration: { options: { pushMilestones: false } },
    })
  })

  it('rejects bad signatures and expired webhooks, and ignores replayed signed payloads', async () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      organizationId: `fake-org-${fixture.workspace.id}`,
      webhookId: 'example-webhook',
      webhookTimestamp: Date.now(),
      data: { id: 'issue-1' },
    }
    expect((await webhook(fixture, payload, 'wrong-secret')).status).toBe(401)
    expect(
      (await webhook(fixture, { ...payload, webhookTimestamp: Date.now() - 120_000 })).status,
    ).toBe(401)
    const first = await webhook(fixture, payload)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, replayed: false })
    const duplicate = await webhook(fixture, payload)
    expect(await duplicate.json()).toEqual({ ok: true, replayed: true })
    expect((await webhook(fixture, { ...payload, organizationId: 'other-org' })).status).toBe(404)
  })

  it('acknowledges a Workers webhook before the provider finishes syncing', async () => {
    const { promise: providerStarted, open: started } = gate()
    const { promise: providerBlocked, open: release } = gate()
    const override = vi
      .spyOn(fixture.fake.provider, 'issuesInTeam')
      .mockImplementationOnce(async () => {
        started()
        await providerBlocked
        return []
      })
    const scheduled: Promise<unknown>[] = []
    const response = webhook(
      fixture,
      {
        action: 'update',
        type: 'Issue',
        organizationId: `fake-org-${fixture.workspace.id}`,
        webhookTimestamp: Date.now(),
        data: { id: 'blocked-provider' },
      },
      undefined,
      {
        waitUntil(promise) {
          scheduled.push(promise)
        },
        passThroughOnException() {},
        props: {},
      },
    )
    try {
      await providerStarted
      expect(scheduled).toHaveLength(1)
      expect((await response).status).toBe(200)
    } finally {
      release()
      await response
      await Promise.all(scheduled)
      override.mockRestore()
    }
  })

  it('discards a duplicate that expires while waiting on the workspace lock', async () => {
    const { promise: providerStarted, open: started } = gate()
    const { promise: providerBlocked, open: release } = gate()
    const override = vi
      .spyOn(fixture.fake.provider, 'issuesInTeam')
      .mockImplementationOnce(async () => {
        started()
        await providerBlocked
        return []
      })
    const scheduled: Promise<unknown>[] = []
    const context = {
      waitUntil(promise: Promise<unknown>) {
        scheduled.push(promise)
      },
      passThroughOnException() {},
      props: {},
    }
    const payload = {
      action: 'update',
      type: 'Issue',
      organizationId: `fake-org-${fixture.workspace.id}`,
      webhookTimestamp: Date.now(),
      data: { id: 'expired-duplicate' },
    }
    try {
      expect((await webhook(fixture, payload, undefined, context)).status).toBe(200)
      await providerStarted
      expect((await webhook(fixture, payload, undefined, context)).status).toBe(200)
      expect(scheduled).toHaveLength(2)
      vi.spyOn(Date, 'now').mockReturnValue(payload.webhookTimestamp + 120_000)
      release()
      await Promise.all(scheduled)
      expect(override).toHaveBeenCalledTimes(1)
    } finally {
      release()
      await Promise.all(scheduled)
      vi.restoreAllMocks()
    }
  })

  it('uses live OAuth only when configured and rotates both encrypted credentials in the daily job', async () => {
    const env = {
      ...testEnv,
      ENVIRONMENT: 'production',
      LINEAR_CLIENT_ID: 'test-client-id',
      LINEAR_CLIENT_SECRET: 'test-client-secret',
      LINEAR_TOKEN_ENCRYPTION_KEY: btoa('0'.repeat(32)),
      LINEAR_WEBHOOK_SECRET: 'test-hook-secret',
    }
    const settings = '/workspaces/other/integrations'
    const request = (path: string, method = 'GET', body?: unknown) =>
      fixture.app.request(
        path,
        {
          method,
          headers: {
            'x-test-actor': 'other',
            origin: env.WEB_ORIGIN,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      )
    const expectSecretFree = async (response: Response) => {
      expect(JSON.stringify([...response.headers])).not.toMatch(
        /old-access|new-access|old-refresh|new-refresh/,
      )
      expect(await response.clone().text()).not.toMatch(
        /accessToken|refreshToken|encryptedCredentials|old-access|new-access|old-refresh|new-refresh/,
      )
    }
    const connection = (nodes: unknown[]) => ({
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    })
    const grants: URLSearchParams[] = []
    const mockFetch = async (path: string, init: RequestInit) => {
      if (path === 'https://api.linear.app/oauth/token') {
        if (!(init.body instanceof URLSearchParams)) throw new TypeError('Expected an OAuth form')
        const values = init.body
        grants.push(values)
        const isRefresh = values.get('grant_type') === 'refresh_token'
        return Response.json({
          access_token: isRefresh ? 'new-access' : 'old-access',
          refresh_token: isRefresh ? 'new-refresh' : 'old-refresh',
          expires_in: isRefresh ? 86_400 : 1,
        })
      }
      if (path !== 'https://api.linear.app/graphql' || typeof init.body !== 'string')
        throw new Error('Unexpected Linear call')
      const { query } = JSON.parse(init.body) as { query: string }
      if (query.includes('organization'))
        return Response.json({ data: { organization: { id: 'org', name: 'Other' } } })
      if (query.includes('teams('))
        return Response.json({ data: { teams: connection([{ id: 'team', key: 'TEST' }]) } })
      if (query.includes('states('))
        return Response.json({
          data: { team: { states: connection([{ id: 'todo', name: 'Todo', type: 'unstarted' }]) } },
        })
      throw new Error('Unexpected Linear query')
    }
    vi.stubGlobal('fetch', mockFetch)
    try {
      const response = await request(`${settings}/linear/connect`, 'POST')
      expect(response.status).toBe(200)
      await expectSecretFree(response)
      const body = (await response.json()) as { authorizationUrl: string }
      const authorize = new URL(body.authorizationUrl)
      expect(authorize.origin).toBe('https://linear.app')
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
      const callback = new URL(authorize.searchParams.get('redirect_uri') as string)
      callback.searchParams.set('code', 'provider-authorization-code')
      callback.searchParams.set('state', authorize.searchParams.get('state') as string)
      const callbackResponse = await request(callback.href)
      expect(callbackResponse.status).toBe(302)
      await expectSecretFree(callbackResponse)
      expect(callbackResponse.headers.get('location')).toBe(
        'http://localhost:5173/other/settings?tab=integrations',
      )
      const { integrations } = await import('../db/schema')
      const { eq } = await import('drizzle-orm')
      const read = async () =>
        (
          await fixture.db
            .select()
            .from(integrations)
            .where(eq(integrations.workspaceId, fixture.other.id))
        )[0]
      const before = await read()
      expect(before?.encryptedCredentials).toBeTruthy()
      expect(before?.lastSyncedAt).toBeNull()
      expect(before?.oauthStateHash).toBeNull()
      const config = await linearConfig(env, false)
      if (!config) throw new Error('Expected Linear config')
      await runDailyTrackerSync(fixture.db, config, createLinearProvider(env))
      const updated = await read()
      if (!updated?.encryptedCredentials) throw new Error('Expected encrypted credentials')
      expect(
        await decryptCredentials(
          config.encryptionKey,
          credentialsContext(updated),
          updated.encryptedCredentials,
        ),
      ).toMatchObject({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      })
      expect(updated.lastSyncedAt).toBeInstanceOf(Date)
      expect(grants.map((grant) => grant.get('grant_type'))).toEqual([
        'authorization_code',
        'refresh_token',
      ])
      expect(grants[0]?.get('code_verifier')).toBeTruthy()
      expect(grants[1]?.get('refresh_token')).toBe('old-refresh')
      const list = await request(settings)
      expect(list.status).toBe(200)
      await expectSecretFree(list)
      const root = `/integrations/${updated.id}`
      const patch = await request(root, 'PATCH', { options: { importIssues: true } })
      expect(patch.status).toBe(200)
      await expectSecretFree(patch)
      const sync = await request(`${root}/sync`, 'POST')
      expect(sync.status).toBe(200)
      await expectSecretFree(sync)
      const remove = await request(root, 'DELETE')
      expect(remove.status).toBe(200)
      await expectSecretFree(remove)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
