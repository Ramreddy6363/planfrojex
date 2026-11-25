import { expect, test } from '@playwright/test'
import { webOrigin } from './test-origin'

test.use({ viewport: { width: 1440, height: 900 } })
const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const taskId = '83caa333-1604-43c5-8f15-61be120754e3'
const commentId = '83caa333-1604-43c5-8f15-61be120754e4'

async function mockInbox(page: import('@playwright/test').Page) {
  const workspace = {
    id: '1',
    name: 'Northwind',
    slug: 'northwind',
    role: 'owner',
    isPersonal: false,
  }
  const actor = { id: 'daniel', name: 'Daniel Okafor' }
  const project = {
    id: projectId,
    key: 'PORT',
    name: 'Customer portal rebuild',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    targetDate: null,
    brief: { problem: '', goals: [], constraints: '', outOfScope: '' },
    tags: [],
    createdAt: '2026-11-01T00:00:00Z',
    createdBy: 'owner',
    starred: false,
    taskProgress: { done: 0, total: 1 },
  }
  const task = {
    id: taskId,
    key: 'PORT-36',
    number: 36,
    title: 'Review SSO vendor contract with legal',
    status: 'in_progress',
    dueDate: '2026-11-15',
    projectId,
    priority: 'medium',
    description: '',
    assigneeId: 'owner',
    assigneeName: 'Maya Chen',
    createdBy: 'owner',
    position: 0,
    milestoneId: null,
    milestoneCode: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-15T00:00:00Z',
  }
  const comments = [
    {
      id: 'previous',
      authorId: 'owner',
      authorName: 'Maya Chen',
      body: 'Contract draft is in the shared drive under Vendors / Auth, Legal has it.',
      mentions: [],
      createdAt: '2026-11-11T10:00:00Z',
      updatedAt: '2026-11-11T10:00:00Z',
    },
    {
      id: commentId,
      authorId: actor.id,
      authorName: actor.name,
      body: '@Maya the SSO work depends on the auth vendor contract. Can we confirm by Friday?',
      mentions: ['owner'],
      createdAt: '2026-11-15T09:20:00Z',
      updatedAt: '2026-11-15T09:20:00Z',
    },
  ]
  const items = [
    {
      id: 'n1',
      type: 'mention',
      activityId: 'a1',
      readAt: null as string | null,
      createdAt: '2026-11-15T11:20:00Z',
      actor,
      project: { id: projectId, name: project.name },
      task,
      comment: { id: commentId, body: comments[1]?.body, target: `task:${taskId}` },
      target: `task:${taskId}`,
      section: null,
      outcome: null,
    },
    {
      id: 'n2',
      type: 'assigned',
      activityId: 'a2',
      readAt: null as string | null,
      createdAt: '2026-11-15T09:02:00Z',
      actor: { id: 'tom', name: 'Tom Brown' },
      project: { id: projectId, name: project.name },
      task: { ...task, title: 'Decide on proration rules' },
      comment: null,
      target: `task:${taskId}`,
      section: null,
      outcome: null,
    },
    {
      id: 'n3',
      type: 'reply',
      activityId: 'a3',
      readAt: null as string | null,
      createdAt: '2026-11-14T12:00:00Z',
      actor: { id: 'priya', name: 'Priya Rao' },
      project: { id: projectId, name: project.name },
      task: null,
      comment: {
        id: 'brief-comment',
        body: 'SSO accounts ask for invoices most, agreed. Moving it into M1.',
        target: `project:${projectId}`,
      },
      target: `project:${projectId}`,
      section: null,
      outcome: null,
    },
    {
      id: 'n4',
      type: 'draft_decision',
      activityId: 'a4',
      readAt: '2026-11-14T12:00:00Z' as string | null,
      createdAt: '2026-11-14T10:00:00Z',
      actor: { id: 'sofia', name: 'Sofia Ali' },
      project: { id: projectId, name: project.name },
      task: null,
      comment: null,
      target: null,
      section: 'Milestones',
      outcome: 'accepted',
    },
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
      return route.fulfill({
        headers,
        json: {
          members: [
            { id: actor.id, name: actor.name, email: 'daniel@example.com', role: 'editor' },
          ],
        },
      })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: { projects: [], nextCursor: null, counts: { all: 1, mine: 1, starred: 0 } },
      })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 7, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === '/inbox')
      return route.fulfill({
        headers,
        json: {
          items: url.searchParams.get('cursor') ? items.slice(3) : items.slice(0, 3),
          unreadCount: items.filter((i) => !i.readAt).length,
          nextCursor:
            url.searchParams.get('limit') === '1'
              ? null
              : url.searchParams.get('cursor')
                ? null
                : 'more',
        },
      })
    if (path === '/inbox/read-all') {
      for (const i of items) i.readAt = new Date().toISOString()
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path.startsWith('/inbox/')) {
      const item = items.find((i) => i.id === path.split('/')[2])
      if (item) item.readAt = new Date().toISOString()
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === '/comments') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON()
        comments.push({
          id: 'reply',
          authorId: 'owner',
          authorName: 'Maya Chen',
          body: body.body,
          mentions: body.mentions,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        return route.fulfill({ status: 201, headers, json: { comment: comments.at(-1) } })
      }
      return route.fulfill({ headers, json: { comments } })
    }
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}/tasks`)
      return route.fulfill({
        headers,
        json: { tasks: [task], counts: { todo: 0, inProgress: 1, done: 0 } },
      })
    if (path === `/tasks/${taskId}`) return route.fulfill({ headers, json: { task } })
    if (path === `/projects/${projectId}/diagrams`)
      return route.fulfill({ headers, json: { diagrams: [] } })
    if (path === `/projects/${projectId}/plan`)
      return route.fulfill({
        headers,
        json: { sections: [], milestones: [], risks: [], lastChanged: null },
      })
    return route.fulfill({ headers, json: {} })
  })
  return {
    addReview: (outcome = 'changes_requested') => {
      Object.assign(items[0] ?? {}, {
        type: 'review_decision',
        actor: { id: null, name: null },
        task: null,
        comment: null,
        target: null,
        section: 'Brief',
        outcome,
        reviewComment: outcome === 'changes_requested' ? 'Please clarify the launch date.' : null,
      })
    },
    markFirstRead: () => {
      if (items[0]) items[0].readAt = new Date().toISOString()
    },
    deleteFirstTask: () => {
      const first = items[0]
      if (first) first.task = null
    },
    deleteFirstActor: () => {
      Object.assign(actor, { id: null, name: null })
      Object.assign(comments[1] ?? {}, { authorId: null, authorName: null })
    },
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-15T12:00:00Z') })
})

test('a deleted actor stays visible in inbox and its comment thread', async ({ page }) => {
  const state = await mockInbox(page)
  state.deleteFirstActor()
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: /Deleted user mentioned you/ }).click()
  await expect(page.getByText('Deleted user', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Reply to Deleted user' })).toBeVisible()
})

test('list, opening marks read, reply mentions, mark all read and load more', async ({ page }) => {
  await mockInbox(page)
  await page.goto('/northwind/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Inbox 3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Daniel Okafor mentioned you/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Review SSO vendor contract with legal' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Inbox 2', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/feature11-inbox-306.png', fullPage: true })
  await page.getByRole('textbox', { name: 'Reply to Daniel Okafor' }).fill('Thanks @Dan')
  await page.getByRole('option', { name: 'Daniel Okafor' }).click()
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('Thanks @Daniel Okafor', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(
    page.getByRole('button', { name: /Sofia Ali accepted your plan draft/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Mark all as read' }).click()
  await expect(page.getByRole('button', { name: 'Inbox 0', exact: true })).toBeVisible()
})

test('opens task, brief and plan from their notifications', async ({ page }) => {
  await mockInbox(page)
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: /Daniel Okafor mentioned you/ }).click()
  await page.getByRole('link', { name: 'Open task' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/tasks.*task=${taskId}`))
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: /Priya Rao replied to your comment/ }).click()
  await page.getByRole('link', { name: 'Open brief' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: 'Load more' }).click()
  await page.getByRole('button', { name: /Sofia Ali accepted your plan draft/ }).click()
  await page.getByRole('link', { name: 'Open plan' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/plan$`))
})

test('deleted task notifications do not offer a brief fallback or reply box', async ({ page }) => {
  const notifications = await mockInbox(page)
  notifications.deleteFirstTask()
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: /Daniel Okafor mentioned you/ }).click()
  await expect(page.getByRole('heading', { name: 'Task no longer available' })).toBeVisible()
  await expect(
    page.getByText('Customer portal rebuild  Task no longer available').last(),
  ).toBeVisible()
  await expect(page.getByText('This task is no longer available.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Open/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /Reply to/ })).toHaveCount(0)
})

test('sidebar unread count refreshes every minute and on navigation', async ({ page }) => {
  const notifications = await mockInbox(page)
  await page.goto('/northwind/inbox')
  await expect(page.getByRole('button', { name: 'Inbox 3', exact: true })).toBeVisible()
  notifications.markFirstRead()
  await page.clock.runFor(60_000)
  await expect(page.getByRole('button', { name: 'Inbox 2', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'My tasks 7', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Inbox 2', exact: true })).toBeVisible()
})

test('review change request identifies the reviewer, shows the comment and opens the brief', async ({
  page,
}) => {
  const state = await mockInbox(page)
  state.addReview()
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: /External reviewer requested changes/ }).click()
  await expect(page.getByText('Please clarify the launch date.').last()).toBeVisible()
  await page.getByRole('link', { name: 'Open brief' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
})

test('review approval appears in inbox and opens the project', async ({ page }) => {
  const state = await mockInbox(page)
  state.addReview('approved')
  await page.goto('/northwind/inbox')
  await page.getByRole('button', { name: /External reviewer approved Brief/ }).click()
  await expect(page.getByText('External reviewer approved Brief.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Open brief' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
})
