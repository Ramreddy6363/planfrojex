import { expect, test } from '@playwright/test'

test('shows Home and the signed-in workspace', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
        headers,
      })
    if (path === '/me')
      return route.fulfill({
        json: {
          user: { id: '1', email: 'maya@example.com', emailVerified: true },
          workspaces: [
            { id: '1', name: 'Northwind', slug: 'northwind', role: 'owner', isPersonal: false },
          ],
        },
        headers,
      })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('navigation')).toContainText('Northwind')
  await expect(page.getByText('maya@example.com')).toBeVisible()
})

test('switches between memberships and remembers the chosen workspace', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({
        json: {
          user: { id: '1', email: 'maya@example.com', emailVerified: true },
          workspaces: [
            { id: '1', name: 'Northwind', slug: 'northwind', role: 'owner', isPersonal: false },
            { id: '2', name: 'Acme', slug: 'acme', role: 'viewer', isPersonal: false },
          ],
        },
        headers,
      })
    if (path === '/workspaces/northwind' || path === '/workspaces/acme') {
      const slug = path.split('/').pop()
      return route.fulfill({
        json: { workspace: { name: slug === 'acme' ? 'Acme' : 'Northwind', slug, role: 'owner' } },
        headers,
      })
    }
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/northwind')
  await page.getByLabel('Switch workspace').selectOption('acme')
  await expect(page).toHaveURL(/\/acme$/)
  await expect(page.getByLabel('Switch workspace')).toHaveValue('acme')
  expect(await page.evaluate(() => localStorage.getItem('lastWorkspace'))).toBe('acme')
})

test('Home shows empty sections without sample records', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({
        json: { user: { id: '1', email: 'maya@example.com', emailVerified: true }, workspaces: [] },
        headers,
      })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
        headers,
      })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  await expect(page.getByText('Starred', { exact: true })).toBeVisible()
  await expect(
    page.getByLabel('Switch workspace').getByRole('option', { name: 'Northwind' }),
  ).toHaveCount(0)
  await expect(page.getByText('Customer portal rebuild')).toHaveCount(0)
  await page.getByRole('button', { name: 'New project' }).click()
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
})

test('a failed identity request shows a retry instead of no access', async ({ page }) => {
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
  }
  await page.route('http://localhost:8787/workspaces/northwind', (route) =>
    route.fulfill({
      json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
      headers,
    }),
  )
  await page.route('http://localhost:8787/me', (route) =>
    route.fulfill({ status: 404, json: { error: 'unavailable' }, headers }),
  )
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
})

test('sign out returns to sign in', async ({ page }) => {
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  await page.addInitScript(() => sessionStorage.setItem('displayName', 'Maya'))
  await page.route('http://localhost:8787/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/auth/sign-out') return route.fulfill({ json: { success: true }, headers })
    if (path === '/me')
      return route.fulfill({
        json: { user: { id: '1', email: 'maya@example.com', emailVerified: true }, workspaces: [] },
        headers,
      })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
        headers,
      })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/northwind')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to PlanFrojex' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('displayName'))).toBeNull()
})

test('shows a loading state while the workspace is being checked', async ({ page }) => {
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
  }
  await page.route('http://localhost:8787/workspaces/northwind', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800))
    await route.fulfill({
      json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
      headers,
    })
  })
  await page.route('http://localhost:8787/me', (route) =>
    route.fulfill({
      json: { user: { id: '1', email: 'maya@example.com', emailVerified: true }, workspaces: [] },
      headers,
    }),
  )
  await page.goto('/northwind')
  await expect(page.getByText('Loading…')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})
