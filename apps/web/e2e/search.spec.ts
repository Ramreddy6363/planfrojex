import { expect, type Page, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const taskId = '83caa333-1604-43c5-8f15-61be120754e3'
test.use({ viewport: { width: 1440, height: 900 } })
async function mockSearch(page: import('@playwright/test').Page, role = 'owner') {
  const project = {
    id: projectId,
    name: 'Billing migration',
    key: 'BILL',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    brief: { problem: '', goals: [], constraints: '', outOfScope: '' },
    tags: [],
    targetDate: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    createdBy: null,
    starred: false,
    taskProgress: { done: 0, total: 1 },
  }
  const task = {
    id: taskId,
    projectId,
    projectName: project.name,
    key: 'BILL-12',
    number: 12,
    title: 'Approve invoice email copy',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    description: '',
    createdBy: 'owner',
    assigneeId: 'owner',
    assigneeName: 'Maya Chen',
    position: 0,
    milestoneId: null,
    milestoneCode: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const queries: string[] = []
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'owner', name: 'Maya Chen', email: 'maya@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/search') {
      const q = url.searchParams.get('q') ?? ''
      queries.push(q)
      return route.fulfill({
        headers,
        json: { projects: q === 'none' ? [] : [project], tasks: q === 'none' ? [] : [task] },
      })
    }
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [project],
          counts: { all: 1, active: 1, mine: 1, starred: 1 },
          nextCursor: null,
        },
      })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({
        headers,
        json: {
          members: [{ id: 'owner', name: 'Maya Chen', email: 'maya@example.com', role }],
          invites: [],
        },
      })
    if (path === '/workspaces/northwind/invites')
      return route.fulfill({ headers, json: { invites: [] } })
    if (path === '/inbox')
      return route.fulfill({ headers, json: { items: [], unreadCount: 0, nextCursor: null } })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 0, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}/tasks`)
      return route.fulfill({
        headers,
        json: { tasks: [task], counts: { todo: 1, inProgress: 0, done: 0 } },
      })
    if (path === `/projects/${projectId}/diagrams`)
      return route.fulfill({ headers, json: { diagrams: [] } })
    if (path === `/projects/${projectId}/plan`)
      return route.fulfill({
        headers,
        json: { sections: [], milestones: [], risks: [], lastChanged: null },
      })
    if (path === `/tasks/${taskId}`) return route.fulfill({ headers, json: { task } })
    if (path === '/comments') return route.fulfill({ headers, json: { comments: [] } })
    if (path === '/templates')
      return route.fulfill({
        headers,
        json: {
          templates: [
            { id: 'blank', name: 'Blank project', description: 'Start from a brief', brief: '' },
          ],
        },
      })
    return route.fulfill({ headers, json: {} })
  })
  return queries
}

test('opens search from keyboard and sidebar, searches with debounce, and navigates results', async ({
  page,
}) => {
  const queries = await mockSearch(page)
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search projects, tasks and commands' })
  await expect(input).toBeFocused()
  await expect(page.getByRole('option', { name: /Billing migration/ })).toBeVisible()
  await input.fill('bill')
  await expect.poll(() => queries.at(-1)).toBe('bill')
  await page.screenshot({ path: '/tmp/feature12-search-304.png', fullPage: true })
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
  await page.getByRole('button', { name: 'Search ⌘K' }).click()
  await input.fill('bill')
  await expect(page.getByRole('option', { name: /BILL-12/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(input).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/tasks.*task=${taskId}`))
  await expect(page.getByRole('complementary')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-shortcuts-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute(
    'data-shortcuts-route',
    new URL(page.url()).pathname,
  )
  await page.keyboard.press('Meta+k')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(input).toBeHidden()
})

async function goShortcut(page: Page, key: string) {
  await expect(page.locator('html')).toHaveAttribute('data-shortcuts-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute(
    'data-shortcuts-route',
    new URL(page.url()).pathname,
  )
  await page.keyboard.press('g')
  await page.keyboard.press(key)
}

test('commands, global shortcuts, and editable focus guards', async ({ page }) => {
  await mockSearch(page)
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await goShortcut(page, 't')
  await expect(page).toHaveURL(/\/northwind\/my-tasks$/)
  await expect(page.getByRole('heading', { name: 'My tasks', exact: true })).toBeVisible()
  await goShortcut(page, 'i')
  await expect(page).toHaveURL(/\/northwind\/inbox$/)
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await goShortcut(page, 'p')
  await expect(page).toHaveURL(/\/northwind\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await goShortcut(page, 'm')
  await expect(page).toHaveURL(/\/northwind\/members$/)
  await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()
  await goShortcut(page, 'h')
  await expect(page).toHaveURL(/\/northwind$/)
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await page.keyboard.press('c')
  const name = page.getByRole('textbox', { name: 'Name', exact: true })
  await expect(name).toBeVisible()
  await name.focus()
  await name.fill('cghtigpgm')
  await expect(page).toHaveURL(/\/northwind$/)
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Search ⌘K' }).click()
  const input = page.getByRole('combobox', { name: 'Search projects, tasks and commands' })
  await input.fill('Go to My tasks')
  await page.getByRole('option', { name: /Go to My tasks/ }).click()
  await expect(page).toHaveURL(/\/northwind\/my-tasks$/)
  await page.keyboard.press('Control+k')
  await input.fill('none')
  await expect(page.getByText('No results')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('viewers cannot create projects from commands or shortcut', async ({ page }) => {
  await mockSearch(page, 'viewer')
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await page.keyboard.press('c')
  await expect(page.getByRole('dialog', { name: 'New project' })).toHaveCount(0)
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('combobox')).toBeVisible()
  await expect(page.getByRole('option', { name: /Create project/ })).toHaveCount(0)
})

test('pending search cannot select a result from the previous query', async ({ page }) => {
  const queries = await mockSearch(page)
  await page.route('http://localhost:8787/workspaces/northwind/search**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    queries.push(q)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.fulfill({
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: { projects: [], tasks: [] },
    })
  })
  await page.goto('/northwind')
  await page.getByRole('button', { name: 'Search ⌘K' }).click()
  const input = page.getByRole('combobox', { name: 'Search projects, tasks and commands' })
  await expect(page.getByRole('option', { name: /Billing migration/ })).toBeVisible()
  await input.fill('none')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/northwind$/)
  await expect(page.getByRole('combobox')).toBeVisible()
  await expect.poll(() => queries.at(-1)).toBe('none')
})

test('single-key shortcuts ignore input, textarea and contenteditable focus outside dialogs', async ({
  page,
}) => {
  await mockSearch(page)
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  for (const tag of ['input', 'textarea', 'div']) {
    await page.evaluate((tagName) => {
      document.getElementById('editable-probe')?.remove()
      const element = document.createElement(tagName)
      element.id = 'editable-probe'
      if (tagName === 'div') element.contentEditable = 'true'
      document.body.append(element)
      element.focus()
    }, tag)
    await page.keyboard.type('cgti')
    await expect(page).toHaveURL(/\/northwind$/)
    await expect(page.getByRole('dialog', { name: 'New project' })).toHaveCount(0)
  }
})
