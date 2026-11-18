import { expect, type Page, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
async function mockShare(page: Page, role = 'owner', initial = false) {
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  let enabled = initial
  let include = ['brief', 'plan', 'diagrams']
  let creations = 0
  let fail = false
  const updates: unknown[] = []
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  const share = () => ({
    enabled,
    include,
    viewCount: 41,
    lastViewedAt: '2026-11-15T10:00:00Z',
    createdAt: initial || enabled ? '2026-10-09T00:00:00Z' : null,
  })
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
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
    if (path === `/projects/${projectId}`)
      return route.fulfill({
        headers,
        json: {
          project: {
            id: projectId,
            key: 'PORTAL',
            name: 'Customer portal rebuild',
            status: 'in-progress',
            leadId: 'maya',
            leadName: 'Maya Chen',
            targetDate: null,
            brief: { problem: 'Customer billing', goals: [], constraints: '', outOfScope: '' },
            tags: [],
            createdAt: '2026-10-02T00:00:00Z',
            createdBy: { id: 'maya', name: 'Maya Chen' },
            starred: false,
            taskProgress: { done: 0, total: 0 },
          },
        },
      })
    if (path === '/workspaces/northwind/projects/PORTAL/share') {
      if (fail) return route.fulfill({ headers, status: 500, json: { error: 'Unavailable' } })
      if (request.method() === 'DELETE') {
        enabled = false
        return route.fulfill({ headers, json: { ok: true } })
      }
      if (request.method() === 'PUT') {
        const body = request.postDataJSON()
        updates.push(body)
        const created = body.enabled && (!enabled || body.rotate)
        enabled = body.enabled
        include = body.include
        if (created) creations++
        return route.fulfill({
          headers,
          json: { share: share(), ...(created ? { token: `new-token-${creations}` } : {}) },
        })
      }
      return route.fulfill({ headers, json: { share: share() } })
    }
    if (path === '/workspaces/northwind/share-links')
      return route.fulfill({
        headers,
        json: {
          links: enabled
            ? [
                {
                  projectKey: 'PORTAL',
                  projectName: 'Customer portal rebuild',
                  createdBy: 'Maya Chen',
                  createdAt: '2026-10-09T00:00:00Z',
                  viewCount: 41,
                },
              ]
            : [],
        },
      })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [],
          counts: { all: 1, active: 0, mine: 0, starred: 0 },
          nextCursor: null,
        },
      })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({ headers, json: { members: [] } })
    if (path === '/comments') return route.fulfill({ headers, json: { comments: [] } })
    if (path.endsWith('/diagrams')) return route.fulfill({ headers, json: { diagrams: [] } })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 0, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === '/inbox')
      return route.fulfill({ headers, json: { items: [], unreadCount: 0, nextCursor: null } })
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
  return {
    updates,
    setFail: (value: boolean) => {
      fail = value
    },
  }
}
test.use({ viewport: { width: 1440, height: 900 } })
test('creates a link once, updates included sections, forgets the token on close and rotates or revokes', async ({
  page,
  context,
}) => {
  const state = await mockShare(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/northwind/projects/${projectId}`)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share Customer portal rebuild' })
  await expect(dialog).toHaveCSS('width', '540px')
  await expect(dialog.getByLabel('Share link', { exact: true })).toHaveCount(0)
  await dialog.getByRole('switch', { name: 'Public read-only link' }).click()
  for (const section of ['Brief', 'Plan', 'Diagrams'])
    await expect(dialog.getByLabel(section, { exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Tasks', { exact: true })).not.toBeChecked()
  await expect(dialog.getByLabel('Share link', { exact: true })).toHaveValue(
    /\/share\/new-token-1$/,
  )
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/\/share\/new-token-1$/)
  await dialog.getByLabel('Tasks', { exact: true }).click()
  await expect(dialog.getByLabel('Tasks', { exact: true })).toBeChecked()
  await expect
    .poll(() => state.updates.at(-1))
    .toEqual({ enabled: true, include: ['brief', 'plan', 'diagrams', 'tasks'] })
  await expect(dialog.getByText('Ask for approval')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Send for review' })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/feature15-share-409.png' })
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(dialog.getByLabel('Share link', { exact: true })).toHaveValue('Link is on')
  await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Make a new link' }).click()
  await expect(dialog.getByLabel('Share link', { exact: true })).toHaveValue(/new-token-2$/)
  await dialog.getByRole('button', { name: 'Turn off link' }).click()
  await expect(dialog.getByRole('switch')).not.toBeChecked()
})
test('share errors keep controls recoverable', async ({ page }) => {
  const state = await mockShare(page)
  state.setFail(true)
  await page.goto(`/northwind/projects/${projectId}`)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Couldn’t load share link' })).toBeVisible()
  state.setFail(false)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  const toggle = page.getByRole('switch', { name: 'Public read-only link' })
  await expect(toggle).toBeVisible()
  state.setFail(true)
  await toggle.click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(toggle).not.toBeChecked()
})
for (const role of ['owner', 'editor', 'viewer']) {
  test(`${role} sees permitted share controls and settings table`, async ({ page }) => {
    await mockShare(page, role, true)
    await page.goto(`/northwind/projects/${projectId}`)
    await expect(
      page.getByRole('heading', { name: 'Customer portal rebuild', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(
      role === 'viewer' ? 0 : 1,
    )
    await page.goto('/northwind/settings')
    const row = page.getByRole('row').filter({ hasText: 'Customer portal rebuild' })
    await expect(row.getByRole('cell', { name: '41', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(role === 'owner' ? 1 : 0)
    if (role === 'owner') {
      await page.screenshot({ path: '/tmp/feature15-settings-503.png' })
      await row.getByRole('button', { name: 'Revoke' }).click()
      await expect(page.getByRole('heading', { name: 'No share links yet' })).toBeVisible()
    }
  })
}

test('editor can enable and disable a public link', async ({ page }) => {
  const state = await mockShare(page, 'editor')
  await page.goto(`/northwind/projects/${projectId}`)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByRole('switch', { name: 'Public read-only link' }).click()
  await expect(page.getByLabel('Share link', { exact: true })).toHaveValue(/new-token-1$/)
  await page.getByRole('button', { name: 'Turn off link' }).click()
  await expect(page.getByRole('switch')).not.toBeChecked()
  expect(state.updates.at(-1)).toEqual({ enabled: false, include: ['brief', 'plan', 'diagrams'] })
})
test('a failed revoke leaves the settings link listed and can be retried', async ({ page }) => {
  const state = await mockShare(page, 'owner', true)
  await page.goto('/northwind/settings')
  await expect(page.getByRole('button', { name: 'Revoke' })).toBeVisible()
  state.setFail(true)
  await page.getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Revoke' })).toBeEnabled()
  state.setFail(false)
  await page.getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByRole('heading', { name: 'No share links yet' })).toBeVisible()
})
