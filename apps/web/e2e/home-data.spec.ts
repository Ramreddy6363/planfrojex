import { expect, type Page, test } from '@playwright/test'
import { webOrigin } from './test-origin'

test.use({ viewport: { width: 1440, height: 900 } })

const headers = {
  'access-control-allow-origin': webOrigin(),
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const workspace = {
  id: 'w1',
  name: 'Northwind',
  slug: 'northwind',
  role: 'owner',
  isPersonal: false,
}
const base = {
  key: 'P',
  status: 'in-progress',
  leadId: 'owner',
  leadName: 'Maya Chen',
  targetDate: '2026-12-12',
  brief: { problem: 'x', goals: [], constraints: '', outOfScope: '' },
  tags: [],
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
  createdBy: { id: 'owner', name: 'Maya Chen' },
  starred: false,
}
const planned = {
  ...base,
  id: 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715',
  name: 'Customer portal rebuild',
  taskProgress: { done: 1, total: 5 },
}
const empty = {
  ...base,
  id: '2ad5f3f0-8a20-4f12-8abe-62e501220e57',
  name: 'Partner API limits',
  status: 'draft',
  taskProgress: { done: 0, total: 0 },
}

async function mock(page: Page) {
  await page.route('http://localhost:8787/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const json = (body: unknown) => route.fulfill({ headers, json: body })
    if (path === '/me')
      return json({
        user: { id: 'owner', name: 'Maya Chen', email: 'maya@example.com', emailVerified: true },
        workspaces: [workspace],
      })
    if (path === '/workspaces/northwind') return json({ workspace })
    if (path === '/workspaces/northwind/projects')
      return json({
        projects: [planned, empty],
        counts: { all: 2, active: 1, mine: 2, starred: 0 },
        nextCursor: null,
      })
    for (const project of [planned, empty])
      if (path === `/projects/${project.id}`) return json({ project })
    if (path === '/workspaces/northwind/activity')
      return json({
        activity: [
          {
            id: 'a1b3a1d9-9f71-4d75-9b9d-6b7e8f21c715',
            type: 'task.status_changed',
            actorName: 'Luis Ortiz',
            projectId: planned.id,
            projectName: planned.name,
            createdAt: new Date().toISOString(),
          },
        ],
      })
    if (path === '/me/tasks') return json({ tasks: [], counts: { assigned: 0 }, nextCursor: null })
    if (path === '/inbox') return json({ items: [], unreadCount: 0, nextCursor: null })
    return json({
      projects: [],
      tasks: [],
      items: [],
      members: [],
      links: [],
      nextCursor: null,
      unreadCount: 0,
    })
  })
}

for (const [name, path] of [
  ['Home', '/northwind'],
  ['Projects', '/northwind/projects'],
] as const)
  test(`${name} shows real progress, "No plan yet" only when empty`, async ({ page }) => {
    await mock(page)
    await page.goto(path)
    const row = page
      .getByRole('link', { name: planned.name, exact: true })
      .locator(name === 'Home' ? 'xpath=ancestor::li' : 'xpath=ancestor::tr')
    await expect(row.getByText('1/5')).toBeVisible()
    await expect(row.getByText('No plan yet')).toHaveCount(0)
    const none = page
      .getByRole('link', { name: empty.name, exact: true })
      .locator(name === 'Home' ? 'xpath=ancestor::li' : 'xpath=ancestor::tr')
    await expect(none.getByText('No plan yet')).toBeVisible()
  })

test('Home shows real recent activity', async ({ page }) => {
  await mock(page)
  await page.goto('/northwind')
  const feed = page.getByRole('region', { name: 'Recent activity' })
  await expect(feed.getByText('Luis Ortiz')).toBeVisible()
  await expect(feed.getByText(/task status changed/i)).toBeVisible()
  await expect(feed.getByRole('link', { name: planned.name })).toBeVisible()
  await expect(page.getByText('No activity yet')).toHaveCount(0)
})
