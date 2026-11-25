import { expect, test } from '@playwright/test'
import { webOrigin } from './test-origin'

test.use({ viewport: { width: 1440, height: 900 } })

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const otherProjectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c716'
const taskId = '83caa333-1604-43c5-8f15-61be120754e3'

async function mockMyTasks(page: import('@playwright/test').Page, role = 'owner') {
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const project = {
    id: projectId,
    key: 'PORT',
    name: 'Customer portal',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    targetDate: null,
    brief: { problem: '' },
    tags: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    createdBy: 'owner',
    starred: false,
    taskProgress: { done: 0, total: 1 },
  }
  const base = {
    projectId,
    projectKey: 'PORT',
    projectName: 'Customer portal',
    number: 1,
    key: 'PORT-1',
    title: 'Write acceptance criteria',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-11-14',
    createdBy: 'owner',
    assigneeId: 'owner',
    updatedAt: '2026-11-15T00:00:00.000Z',
    description: '',
    assigneeName: 'Maya Chen',
    position: 0,
    milestoneId: null,
    milestoneCode: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  }
  const tasks = [
    { ...base, id: taskId },
    {
      ...base,
      id: 'task-2',
      key: 'BILL-2',
      title: 'Review invoice copy',
      projectId: otherProjectId,
      projectName: 'Billing migration',
      projectKey: 'BILL',
      priority: 'medium',
      dueDate: '2026-11-17',
    },
    {
      ...base,
      id: 'task-3',
      key: 'PORT-3',
      title: 'Share beta plan',
      priority: 'low',
      dueDate: '2026-11-18',
    },
    { ...base, id: 'task-4', key: 'PORT-4', title: 'Prepare launch', dueDate: '2026-11-25' },
    { ...base, id: 'task-5', key: 'PORT-5', title: 'Triage feedback', dueDate: null },
    { ...base, id: 'task-6', key: 'PORT-6', title: 'Created task', assigneeId: 'someone-else' },
    { ...base, id: 'task-done', key: 'PORT-7', title: 'Completed task', status: 'done' },
  ]
  const headers = {
    'access-control-allow-origin': webOrigin(),
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  await page.route('http://localhost:8787/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'owner', name: 'Maya Chen', email: 'maya@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({ headers, json: { members: [] } })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects:
            url.searchParams.get('view') === 'starred'
              ? []
              : [
                  project,
                  { ...project, id: otherProjectId, key: 'BILL', name: 'Billing migration' },
                ],
          nextCursor: null,
          counts: { all: 2, mine: 2, starred: 0 },
        },
      })
    if (path === '/me/tasks') {
      const filtered = tasks.filter(
        (t) => !url.searchParams.get('project') || t.projectId === url.searchParams.get('project'),
      )
      const assigned = filtered.filter((t) => t.status !== 'done' && t.assigneeId === 'owner')
      const created = filtered.filter((t) => t.status !== 'done' && t.createdBy === 'owner')
      const completed = filtered.filter((t) => t.status === 'done' && t.assigneeId === 'owner')
      const view = url.searchParams.get('view') || 'assigned'
      const list = view === 'created' ? created : view === 'completed' ? completed : assigned
      const cursor = url.searchParams.get('cursor')
      return route.fulfill({
        headers,
        json: {
          tasks: cursor ? list.slice(3) : list.slice(0, 3),
          counts: {
            assigned: assigned.length,
            created: created.length,
            completed: completed.length,
          },
          nextCursor: !cursor && list.length > 3 ? 'next' : null,
        },
      })
    }
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}/plan`)
      return route.fulfill({
        headers,
        json: { sections: [], milestones: [], risks: [], lastChanged: null },
      })
    if (path === `/projects/${projectId}/tasks`)
      return route.fulfill({
        headers,
        json: { tasks, counts: { todo: 5, inProgress: 0, done: 1 } },
      })
    if (path === `/projects/${projectId}/diagrams`)
      return route.fulfill({ headers, json: { diagrams: [] } })
    if (path.startsWith('/tasks/')) {
      const task = tasks.find((t) => t.id === path.split('/').pop())
      if (req.method() === 'PATCH') Object.assign(task ?? {}, req.postDataJSON())
      return route.fulfill({ headers, json: { task } })
    }
    if (path === '/comments') return route.fulfill({ headers, json: { comments: [] } })
    return route.fulfill({ headers, json: {} })
  })
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-17T12:00:00') })
})

test('tabs, due groups, project and priority groupings, project filter and load more', async ({
  page,
}) => {
  await mockMyTasks(page)
  await page.goto('/northwind/my-tasks')
  await expect(page.getByRole('heading', { name: 'My tasks', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Assigned 5' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Overdue 1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Today 1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'This week 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByRole('heading', { name: 'No due date 1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Later 1' })).toBeVisible()
  await page.screenshot({ path: '/tmp/feature10-my-tasks-305.png', fullPage: true })
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('project')
  await expect(page.getByRole('heading', { name: 'Customer portal 4' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('priority')
  await expect(page.getByRole('heading', { name: 'High 3' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Project' }).selectOption(projectId)
  await expect(page.getByRole('tab', { name: 'Assigned 4' })).toBeVisible()
  await page.getByRole('tab', { name: 'Created by me 5' }).click()
  await expect(page.getByRole('tab', { name: 'Created by me 5' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('tab', { name: 'Completed 1' }).click()
  await expect(page.getByText('Completed task', { exact: true })).toBeVisible()
})

test('mark done and undo refresh counts, and a row opens its task panel', async ({ page }) => {
  await mockMyTasks(page)
  await page.goto('/northwind/my-tasks')
  await expect(page.getByRole('button', { name: 'My tasks 5' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Complete Write acceptance criteria' }).click()
  await expect(page.getByRole('button', { name: 'My tasks 4' })).toBeVisible()
  await page.getByRole('tab', { name: 'Completed 2' }).click()
  await page.getByRole('checkbox', { name: 'Reopen Write acceptance criteria' }).click()
  await expect(page.getByRole('button', { name: 'My tasks 5' })).toBeVisible()
  await page.getByRole('tab', { name: 'Assigned 5' }).click()
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Write acceptance criteria' })
    .getByRole('img', { name: 'High priority' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/tasks.*task=${taskId}`))
  await expect(page.getByRole('complementary')).toBeVisible()
  await page.getByRole('combobox', { name: 'Task status' }).selectOption('done')
  await expect(page.getByRole('button', { name: 'My tasks 4' })).toBeVisible()
})

test('viewer can read tasks and checkboxes are disabled', async ({ page }) => {
  await mockMyTasks(page, 'viewer')
  await page.goto('/northwind/my-tasks')
  await expect(page.getByText('Write acceptance criteria', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('checkbox', { name: 'Complete Write acceptance criteria' }),
  ).toBeDisabled()
})
