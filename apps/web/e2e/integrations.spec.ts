import { expect, type Page, test } from '@playwright/test'
import { webOrigin } from './test-origin'

async function mockIntegrations(page: Page, role = 'owner', configured = true, connected = false) {
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const initial = {
    id: 'integration-1',
    provider: 'linear',
    name: 'Northwind',
    lastSyncedAt: null as string | null,
    options: { pushMilestones: false, pullStatus: true, importIssues: false },
    statusMapping: {
      planning: 'todo',
      in_progress: 'started',
      completed: 'done',
      archived: 'canceled',
    },
    states: [
      { id: 'todo', name: 'Todo' },
      { id: 'backlog', name: 'Backlog' },
      { id: 'started', name: 'In Progress' },
      { id: 'done', name: 'Done' },
      { id: 'canceled', name: 'Canceled' },
    ],
  }
  let integration: typeof initial | null = connected ? initial : null
  const headers = {
    'access-control-allow-origin': webOrigin(),
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'maya', name: 'Maya Chen', email: 'maya@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/share-links')
      return route.fulfill({ headers, json: { links: [] } })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [],
          counts: { all: 0, active: 0, mine: 0, starred: 0 },
          nextCursor: null,
        },
      })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 0, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === '/inbox')
      return route.fulfill({ headers, json: { items: [], unreadCount: 0, nextCursor: null } })
    if (path === '/workspaces/northwind/integrations')
      return route.fulfill({ headers, json: { configured, integration } })
    if (path === '/workspaces/northwind/integrations/linear/connect') {
      integration = initial
      return route.fulfill({
        headers,
        json: { authorizationUrl: '/northwind/settings?tab=integrations' },
      })
    }
    if (path === '/integrations/integration-1' && request.method() === 'PATCH') {
      if (!integration) return route.fulfill({ status: 404, headers })
      const body = request.postDataJSON()
      integration = {
        ...integration,
        ...body,
        options: { ...integration.options, ...body.options },
        statusMapping: { ...integration.statusMapping, ...body.statusMapping },
      }
      return route.fulfill({ headers, json: { integration } })
    }
    if (path === '/integrations/integration-1/sync') {
      if (!integration) return route.fulfill({ status: 404, headers })
      integration = { ...integration, lastSyncedAt: new Date().toISOString() }
      return route.fulfill({ headers, json: { integration } })
    }
    if (path === '/integrations/integration-1' && request.method() === 'DELETE') {
      integration = null
      return route.fulfill({ headers, json: { ok: true } })
    }
    return route.fulfill({ status: 404, headers, json: { error: 'Not found' } })
  })
  return { current: () => integration }
}

test('owner connects Linear, changes options and mapping, syncs and disconnects', async ({
  page,
}) => {
  const state = await mockIntegrations(page)
  await page.goto('/northwind/settings')
  await page.getByRole('tab', { name: 'Integrations' }).click()
  await expect(page.getByText('Coming soon')).toHaveCount(3)
  await page.getByRole('button', { name: 'Connect Linear' }).click()
  await expect(page.getByText('Connected to Northwind')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Create tasks for new Linear issues' }).check()
  await expect.poll(() => state.current()?.options.importIssues).toBe(true)
  const planning = page.getByLabel('Planning Linear state')
  await expect(planning.getByRole('option', { name: 'In Progress' })).toBeDisabled()
  await expect(planning.getByRole('option', { name: 'Todo' })).toBeEnabled()
  await planning.selectOption('backlog')
  await expect.poll(() => state.current()?.statusMapping.planning).toBe('backlog')
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText(/Synced .* ago/)).toBeVisible()
  await page.screenshot({ path: '/tmp/feature19-settings-504.png', fullPage: true })
  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect Linear' })).toBeVisible()
})

test('non-owners have no integrations management access', async ({ page }) => {
  await mockIntegrations(page, 'viewer')
  await page.goto('/northwind/settings')
  await expect(page.getByRole('tab', { name: 'Integrations' })).toHaveCount(0)
})

test('unconfigured Linear cannot be connected and failed authorization is explained', async ({
  page,
}) => {
  await mockIntegrations(page, 'owner', false)
  await page.goto('/northwind/settings?tab=integrations&integrationError=failed')
  await expect(page.getByText('Linear is not set up')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Linear' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('Couldn’t connect Linear')
})

test('an existing integration with missing configuration is unavailable but can be disconnected', async ({
  page,
}) => {
  await mockIntegrations(page, 'owner', false, true)
  await page.goto('/northwind/settings?tab=integrations')
  await expect(page.getByText('Linear is not set up')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled()
  await expect(
    page.getByRole('checkbox', { name: 'Pull issue status back into the plan' }),
  ).toBeDisabled()
  await expect(page.getByLabel('Planning Linear state')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect Linear' })).toBeDisabled()
})
