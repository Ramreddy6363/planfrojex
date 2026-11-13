import { expect, test } from '@playwright/test'

test('owner creates and stars a project', async ({ page }) => {
  const workspace = {
    id: '1',
    name: 'Northwind',
    slug: 'northwind',
    role: 'owner',
    isPersonal: false,
  }
  let created = false
  let starred = false
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
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
          user: { id: 'owner', email: 'owner@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/templates')
      return route.fulfill({
        headers,
        json: {
          templates: [
            {
              id: 'blank',
              name: 'Blank project',
              description: 'Write the brief yourself',
              brief: '',
            },
            {
              id: 'saas',
              name: 'SaaS MVP',
              description: 'Accounts, billing, admin',
              brief: 'A starting brief',
            },
          ],
        },
      })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({
        headers,
        json: {
          members: [
            { id: 'owner', name: 'Maya', email: 'owner@example.com', image: null, role: 'owner' },
          ],
        },
      })
    if (path === '/workspaces/northwind/projects' && request.method() === 'POST') {
      created = true
      return route.fulfill({ headers, status: 201, json: { project: {} } })
    }
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: created
            ? [
                {
                  id: '123',
                  key: 'PORTAL',
                  name: 'Portal',
                  status: 'draft',
                  leadId: 'owner',
                  leadName: 'Maya',
                  targetDate: null,
                  brief: { problem: 'A starting brief' },
                  starred,
                  updatedAt: '2026-11-13T00:00:00.000Z',
                },
              ]
            : [],
          counts: {
            all: Number(created),
            active: 0,
            mine: Number(created),
            starred: Number(starred),
          },
          nextCursor: null,
        },
      })
    if (path === '/projects/123/star') {
      starred = request.method() === 'PUT'
      return route.fulfill({ headers, json: { ok: true } })
    }
    return route.fulfill({ headers, status: 404, json: { error: 'not found' } })
  })
  await page.goto('/northwind/projects')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await page.getByText('SaaS MVP').click()
  await page.getByLabel('Name', { exact: true }).fill('Portal')
  await expect(page.getByLabel('Brief')).toHaveValue('A starting brief')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('cell', { name: 'Portal', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Star Portal' }).click()
  await expect(page.getByRole('button', { name: 'Unstar Portal' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unstar Portal' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('sidebar loads every page of starred projects', async ({ page }) => {
  const workspace = {
    id: '1',
    name: 'Northwind',
    slug: 'northwind',
    role: 'viewer',
    isPersonal: false,
  }
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
  }
  await page.route('http://localhost:8787/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (url.pathname === '/workspaces/northwind')
      return route.fulfill({ headers, json: { workspace } })
    if (url.pathname === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects:
            url.searchParams.get('view') === 'starred'
              ? [
                  {
                    id: url.searchParams.has('cursor') ? '2' : '1',
                    name: url.searchParams.has('cursor') ? 'Second star' : 'First star',
                  },
                ]
              : [],
          counts: { all: 2, active: 0, mine: 0, starred: 2 },
          nextCursor: url.searchParams.has('cursor') ? null : 'first',
        },
      })
    return route.fulfill({ headers, status: 404, json: {} })
  })
  await page.goto('/northwind')
  await expect(page.getByText('Second star')).toBeVisible()
})

test('viewers can use filters and keyboard views and recover from a loading error', async ({
  page,
}) => {
  const workspace = {
    id: '1',
    name: 'Northwind',
    slug: 'northwind',
    role: 'viewer',
    isPersonal: false,
  }
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
  }
  let failed = false
  let querySeen = ''
  await page.route('http://localhost:8787/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (url.pathname === '/workspaces/northwind')
      return route.fulfill({ headers, json: { workspace } })
    if (url.pathname === '/workspaces/northwind/members')
      return route.fulfill({
        headers,
        json: {
          members: [
            {
              id: 'viewer',
              name: 'Kenji',
              email: 'viewer@example.com',
              image: null,
              role: 'viewer',
            },
          ],
        },
      })
    if (url.pathname === '/workspaces/northwind/projects') {
      if (url.searchParams.get('view') !== 'starred' && !failed) {
        failed = true
        await new Promise((resolve) => setTimeout(resolve, 250))
        return route.fulfill({ headers, status: 500, json: { error: 'unavailable' } })
      }
      if (url.searchParams.get('view') !== 'starred') querySeen = url.search
      return route.fulfill({
        headers,
        json: {
          projects: [],
          counts: { all: 0, active: 0, mine: 0, starred: 0 },
          nextCursor: null,
        },
      })
    }
    return route.fulfill({ headers, status: 404, json: {} })
  })
  await page.goto('/northwind/projects')
  await expect(page.getByText('Loading projects…')).toBeVisible()
  await expect(page.getByText('Couldn’t load projects')).toBeVisible()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('No projects yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'All 0' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Active 0' })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Status', { exact: true }).selectOption('planning')
  await expect.poll(() => querySeen).toContain('status=planning')
  await expect(page.getByText('No matching projects')).toBeVisible()
})

test('switching workspaces resets the projects page cursor', async ({ page }) => {
  const workspace = (slug: string) => ({
    id: slug,
    name: slug,
    slug,
    role: 'viewer',
    isPersonal: false,
  })
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
  }
  await page.route('http://localhost:8787/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
          workspaces: [workspace('northwind'), workspace('acme')],
        },
      })
    if (url.pathname === '/workspaces/northwind' || url.pathname === '/workspaces/acme')
      return route.fulfill({
        headers,
        json: { workspace: workspace(url.pathname.split('/')[2] ?? '') },
      })
    if (url.pathname.endsWith('/members')) return route.fulfill({ headers, json: { members: [] } })
    if (url.pathname.endsWith('/projects')) {
      if (url.pathname.startsWith('/workspaces/acme') && url.searchParams.has('cursor'))
        return route.fulfill({ headers, status: 400, json: { error: 'Invalid cursor' } })
      const sidebar = url.searchParams.get('view') === 'starred'
      return route.fulfill({
        headers,
        json: {
          projects: sidebar
            ? []
            : [
                {
                  id: 'p',
                  name: 'Sample',
                  key: 'SAMPLE',
                  status: 'draft',
                  leadId: 'viewer',
                  leadName: 'Kenji',
                  targetDate: null,
                  brief: { problem: '' },
                  starred: false,
                  updatedAt: '2026-11-13T00:00:00.000Z',
                },
              ],
          counts: { all: 1, active: 0, mine: 1, starred: 0 },
          nextCursor:
            !sidebar && url.pathname.includes('northwind') && !url.searchParams.has('cursor')
              ? 'cursor1'
              : null,
        },
      })
    }
    return route.fulfill({ headers, status: 404, json: {} })
  })
  await page.goto('/northwind/projects')
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('button', { name: 'First page' })).toBeVisible()
  await page.getByRole('button', { name: 'Switch workspace' }).click()
  await page.getByRole('menuitem', { name: 'acme' }).click()
  await expect(page).toHaveURL(/\/acme\/projects$/)
  await expect(page.getByRole('cell', { name: 'Sample', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'First page' })).toHaveCount(0)
})
