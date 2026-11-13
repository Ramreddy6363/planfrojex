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
  const switcher = page.getByRole('button', { name: 'Switch workspace' })
  await switcher.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu', { name: 'Switch workspace' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(switcher).toBeFocused()
  await switcher.click()
  await page.getByRole('menuitem', { name: 'Acme' }).click()
  await expect(page).toHaveURL(/\/acme$/)
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toContainText('Acme')
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
  await page.getByRole('button', { name: 'Switch workspace' }).click()
  await expect(page.getByRole('menuitem', { name: 'Northwind' })).toHaveCount(0)
  await page.keyboard.press('Escape')
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
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
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

test('home lists the projects you lead', async ({ page }) => {
  const workspace = {
    id: '1',
    name: 'Northwind',
    slug: 'northwind',
    role: 'owner',
    isPersonal: false,
  }
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
  }
  let view = ''
  await page.route('http://localhost:8787/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'maya', email: 'maya@example.com', emailVerified: true, name: 'Maya Chen' },
          workspaces: [workspace],
        },
      })
    if (url.pathname === '/workspaces/northwind')
      return route.fulfill({ headers, json: { workspace } })
    if (url.pathname === '/workspaces/northwind/projects') {
      if (url.searchParams.get('limit') === '5') view = url.searchParams.get('view') ?? ''
      return route.fulfill({
        headers,
        json: {
          projects: [
            {
              id: 'p1',
              key: 'PORTAL',
              name: 'Customer portal rebuild',
              status: 'in-progress',
              leadId: 'maya',
              leadName: 'Maya Chen',
              targetDate: '2026-12-12',
              brief: { problem: '' },
              starred: false,
              updatedAt: '2026-11-13T00:00:00.000Z',
            },
          ],
          counts: { all: 1, active: 1, mine: 1, starred: 0 },
          nextCursor: null,
        },
      })
    }
    return route.fulfill({ headers, status: 404, json: { error: 'not found' } })
  })
  await page.goto('/northwind')
  const projects = page.getByRole('region', { name: 'Your projects' })
  await expect(projects.getByText('Customer portal rebuild')).toBeVisible()
  await expect(projects.getByText('In progress')).toBeVisible()
  await expect(page.getByText('Maya Chen').first()).toBeVisible()
  expect(view).toBe('mine')
})
