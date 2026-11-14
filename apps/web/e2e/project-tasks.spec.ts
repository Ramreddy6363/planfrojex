import { expect, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const taskId = '83caa333-1604-43c5-8f15-61be120754e3'
const secondTaskId = 'cd1ef2e2-b99e-45bb-9c1b-f2f56ce9f59e'

async function mockTasks(page: import('@playwright/test').Page, role = 'owner') {
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const project = {
    id: projectId,
    key: 'PORT',
    name: 'Customer portal',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    brief: {
      problem: 'Support calls are too frequent.',
      goals: [],
      constraints: '',
      outOfScope: '',
    },
    tags: [],
    createdAt: '2026-10-02T00:00:00.000Z',
    createdBy: null,
    starred: false,
    taskProgress: { done: 0, total: 1 },
  }
  const task = {
    id: taskId,
    projectId,
    number: 1,
    key: 'PORT-1',
    title: 'Build billing form',
    description: 'Allow self-service billing updates.',
    status: 'todo',
    priority: 'high',
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    milestoneId: 'milestone-1',
    milestoneCode: 'M1',
    position: 0,
    createdBy: 'owner',
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
  }
  const tasks = [
    task,
    {
      ...task,
      id: secondTaskId,
      number: 2,
      key: 'PORT-2',
      title: 'Write help copy',
      position: 1,
    },
  ]
  const comments: Array<Record<string, unknown>> = []
  const writes: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  const milestones = [
    {
      id: 'milestone-1',
      projectId,
      code: 'M1',
      title: 'Private beta',
      status: 'planning',
      dueDate: '2026-12-01',
      position: 0,
    },
  ]
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  await page.route('http://localhost:8787/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: {
            id: role === 'viewer' ? 'viewer' : 'owner',
            email: 'test@example.com',
            emailVerified: true,
          },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({
        headers,
        json: {
          members: [
            {
              id: 'owner',
              name: 'Maya Chen',
              email: 'maya@example.com',
              image: null,
              role: 'owner',
            },
          ],
        },
      })
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}/plan`)
      return route.fulfill({
        headers,
        json: { sections: [], milestones, risks: [], lastChanged: null },
      })
    if (path === `/projects/${projectId}/tasks` && req.method() === 'GET')
      return route.fulfill({
        headers,
        json: {
          tasks,
          counts: {
            todo: tasks.filter((item) => item.status === 'todo').length,
            inProgress: tasks.filter((item) => item.status === 'in_progress').length,
            done: tasks.filter((item) => item.status === 'done').length,
          },
        },
      })
    if (path === `/projects/${projectId}/tasks` && req.method() === 'POST') {
      const body = req.postDataJSON()
      writes.push({ method: req.method(), path, body })
      const created = {
        ...task,
        ...body,
        id: `created-${tasks.length}`,
        key: `PORT-${tasks.length + 1}`,
        number: tasks.length + 1,
      }
      tasks.push(created)
      return route.fulfill({ headers, status: 201, json: { task: created } })
    }
    if (path === `/tasks/${taskId}` && req.method() === 'GET')
      return route.fulfill({ headers, json: { task } })
    if (path.startsWith('/tasks/') && req.method() === 'PATCH') {
      const body = req.postDataJSON()
      writes.push({ method: req.method(), path, body })
      const found = tasks.find((item) => item.id === path.split('/').pop())
      if (found) Object.assign(found, body)
      return route.fulfill({ headers, json: { task: found ?? task } })
    }
    if (path === '/comments' && req.method() === 'GET')
      return route.fulfill({ headers, json: { comments } })
    if (path === '/comments' && req.method() === 'POST') {
      const body = req.postDataJSON()
      writes.push({ method: req.method(), path, body })
      comments.push({
        id: 'comment-1',
        authorId: role === 'viewer' ? 'viewer' : 'owner',
        authorName: 'Maya Chen',
        body: body.body,
        mentions: body.mentions,
        createdAt: '2026-11-13T00:00:00.000Z',
        updatedAt: '2026-11-13T00:00:00.000Z',
      })
      return route.fulfill({ headers, status: 201, json: { comment: comments[0] } })
    }
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
  return { tasks, writes }
}

test('task list, dialog, side panel, board drag, and viewer read-only state', async ({ page }) => {
  const state = await mockTasks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/northwind/projects/${projectId}/tasks`)
  await expect(page.getByRole('heading', { name: 'Customer portal' })).toBeVisible()
  await expect(page.getByText('PORT-1')).toBeVisible()
  await expect(page.getByLabel('Filter by milestone')).toBeVisible()
  await page.getByRole('button', { name: 'Build billing form', exact: true }).click()
  await page.getByRole('button', { name: 'Close task' }).click()
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  await page.getByLabel('Task title').fill('Add invoice export')
  await page.getByLabel('New task priority').selectOption('medium')
  await page.getByLabel('New task milestone').selectOption('milestone-1')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText('Add invoice export')).toBeVisible()
  expect(
    state.writes.some(
      (write) => write.method === 'POST' && write.path === `/projects/${projectId}/tasks`,
    ),
  ).toBe(true)
  expect(state.writes.find((write) => write.method === 'POST')?.body?.milestoneId).toBe(
    'milestone-1',
  )
  await page.getByRole('button', { name: 'Build billing form', exact: true }).click()
  await page.getByLabel('Task status', { exact: true }).selectOption('in_progress')
  await expect.poll(() => state.tasks[0]?.status).toBe('in_progress')
  await expect(page.getByLabel('Task milestone', { exact: true })).toHaveValue('milestone-1')
  await page.getByLabel('Task comment').fill('Reviewed')
  await page.getByRole('button', { name: 'Post comment' }).click()
  expect(state.writes.some((write) => write.body?.target === `task:${taskId}`)).toBe(true)
  await page.getByRole('button', { name: 'Close task' }).click()
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  const card = page.getByRole('button', { name: /PORT-1 Build billing form/ })
  await card.dragTo(page.getByRole('region', { name: 'Completed tasks' }))
  await expect.poll(() => state.tasks[0]?.status).toBe('done')
  await card.click()
  await expect(page.getByLabel('Task status', { exact: true })).toHaveValue('done')
  await page.getByLabel('Task comment').fill('Draft for the first task')
  await page.getByRole('button', { name: 'Close task' }).click()
  await page.getByRole('button', { name: /PORT-2 Write help copy/ }).click()
  await expect(page.getByLabel('Task comment')).toHaveValue('')
})

test('viewer can read and comment but sees no task write controls', async ({ page }) => {
  await mockTasks(page, 'viewer')
  await page.goto(`/northwind/projects/${projectId}/tasks`)
  await expect(page.getByText('Build billing form')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Build billing form', exact: true }).click()
  await expect(page.getByLabel('Task status', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Task milestone', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Task comment')).toBeVisible()
})
