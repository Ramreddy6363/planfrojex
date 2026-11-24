import { expect, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const headers = {
  'access-control-allow-origin': 'http://localhost:5199',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const entries = [
  {
    id: 'e1',
    actorId: 'editor',
    actorName: 'Daniel Okafor',
    type: 'comment.added',
    subject: 'comment-1',
    payload: { target: 'task:PORT-36', taskKey: 'PORT-36' },
    comment: { text: '@Maya can we confirm by Friday?', target: 'task', taskId: 'task-1' },
    createdAt: '2026-11-14T11:20:00.000+05:30',
  },
  {
    id: 'e2',
    actorId: 'owner',
    actorName: 'Maya Chen',
    type: 'diagram.version_saved',
    subject: 'diagram-1',
    payload: { name: 'Checkout flow', before: 2, after: 3 },
    createdAt: '2026-11-14T10:42:00.000+05:30',
  },
  {
    id: 'e3',
    actorId: 'editor',
    actorName: 'Daniel Okafor',
    type: 'task.status_changed',
    subject: 'task-1',
    payload: { taskKey: 'PORT-39', before: 'todo', after: 'in_progress' },
    createdAt: '2026-11-14T09:15:00.000+05:30',
  },
  {
    id: 'e7',
    actorId: 'editor',
    actorName: 'Daniel Okafor',
    type: 'draft.accepted',
    subject: 'draft-1',
    payload: { section: 'milestones' },
    createdAt: '2026-11-13T17:03:00+05:30',
  },
  {
    id: 'e4',
    actorId: 'owner',
    actorName: 'Maya Chen',
    type: 'draft.started',
    subject: 'draft-1',
    payload: { kind: 'plan' },
    createdAt: '2026-11-13T16:40:00.000+05:30',
  },
  {
    id: 'e8',
    actorId: 'owner',
    actorName: 'Maya Chen',
    type: 'task.assignee_changed',
    subject: 'task-2',
    payload: { taskKey: 'PORT-36', before: null, after: 'owner' },
    createdAt: '2026-11-13T11:02:00+05:30',
  },
  {
    id: 'e5',
    actorId: 'owner',
    actorName: 'Maya Chen',
    type: 'project.target_date_changed',
    subject: projectId,
    payload: { before: '2026-11-28', after: '2026-12-12' },
    createdAt: '2026-10-09T15:12:00.000+05:30',
  },
  {
    id: 'e6',
    actorId: 'editor',
    actorName: 'Daniel Okafor',
    type: 'comment.added',
    subject: 'deleted-comment',
    payload: { target: `project:${projectId}` },
    comment: null,
    createdAt: '2026-10-08T12:00:00.000Z',
  },
]
async function mockActivity(
  page: import('@playwright/test').Page,
  role = 'owner',
  deletedActor = false,
  reviewer = false,
) {
  const queries: URLSearchParams[] = []
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const project = {
    id: projectId,
    key: 'PORT',
    name: 'Customer portal rebuild',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    starred: false,
    taskProgress: { done: 18, total: 42 },
    tags: [],
    brief: { problem: '', goals: [], constraints: '', outOfScope: '' },
    createdBy: { id: 'owner', name: 'Maya Chen' },
    createdAt: '2026-10-01T00:00:00Z',
  }
  await page.clock.install({ time: new Date('2026-11-14T12:00:00.000Z') })
  await page.route('http://localhost:8787/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: role, name: 'Maya Chen', email: `${role}@example.com`, emailVerified: true },
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
            { id: 'owner', name: 'Maya Chen', role: 'owner' },
            { id: 'editor', name: 'Daniel Okafor', role: 'editor' },
          ],
        },
      })
    if (url.pathname === `/projects/${projectId}`)
      return route.fulfill({ headers, json: { project } })
    if (url.pathname === `/projects/${projectId}/diagrams`)
      return route.fulfill({ headers, json: { diagrams: [{ id: 'diagram-1' }] } })
    if (url.pathname === '/comments') return route.fulfill({ headers, json: { comments: [] } })
    if (url.pathname === `/projects/${projectId}/activity`) {
      queries.push(url.searchParams)
      const actor = url.searchParams.get('actor'),
        category = url.searchParams.get('category')
      const categoryOf = (type: string) =>
        type.startsWith('draft.') || type.startsWith('plan.')
          ? 'plan'
          : type.startsWith('comment.')
            ? 'comments'
            : type.startsWith('task.')
              ? 'tasks'
              : type.startsWith('diagram.')
                ? 'diagrams'
                : 'project'
      const filtered = (
        reviewer
          ? [
              {
                id: 'review-1',
                actorId: null,
                actorName: null,
                type: 'review.changes_requested',
                subject: 'review',
                payload: {
                  section: 'brief',
                  outcome: 'changes_requested',
                  comment: 'Please clarify the launch date.',
                },
                createdAt: '2026-11-14T11:20:00.000+05:30',
              },
            ]
          : entries
      ).filter(
        (row) =>
          (!actor || row.actorId === actor) && (!category || categoryOf(row.type) === category),
      )
      const next = url.searchParams.get('cursor') === 'next'
      return route.fulfill({
        headers,
        json: {
          activity: (next ? filtered.slice(7) : filtered.slice(0, 7)).map((row) => ({
            actorImage: null,
            comment: null,
            category: categoryOf(row.type),
            ...row,
            ...(deletedActor ? { actorId: null, actorName: null } : {}),
          })),
          nextCursor: !next && filtered.length > 7 ? 'next' : null,
        },
      })
    }
    if (url.pathname === '/workspaces/northwind/projects')
      return route.fulfill({ headers, json: { projects: [], nextCursor: null } })
    return route.fulfill({ status: 404, headers, json: { error: 'Not found' } })
  })
  return queries
}

test('keeps activity visible when the actor account was deleted', async ({ page }) => {
  await mockActivity(page, 'viewer', true)
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(page.getByText('Deleted user', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('“@Maya can we confirm by Friday?”')).toBeVisible()
})

test('activity groups timeline entries, renders details, filters and loads more', async ({
  page,
}) => {
  const queries = await mockActivity(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Yesterday', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'October 9', exact: true })).toBeVisible()
  await expect(page.getByText('@Maya can we confirm by Friday?', { exact: false })).toBeVisible()
  await expect(page.getByText('v2')).toBeVisible()
  await expect(page.getByText('v3')).toBeVisible()
  await expect(page.getByText('To do', { exact: true })).toBeVisible()
  await expect(page.getByText('Nov 28', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/feature9-activity-408.png' })
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('deleted a comment')).toBeVisible()
  await expect(page.getByText('secret deleted text')).toHaveCount(0)
  await page.getByLabel('Filter by person').selectOption('editor')
  await expect.poll(() => queries.at(-1)?.get('actor')).toBe('editor')
  await page.getByLabel('Filter by change').selectOption('tasks')
  await expect.poll(() => queries.at(-1)?.get('category')).toBe('tasks')
  await expect(page.getByText('changed the status of PORT-39')).toBeVisible()
  await expect(page.getByText('Checkout flow', { exact: false })).toHaveCount(0)
})

test('viewer can read activity and reach it from project tabs', async ({ page }) => {
  await mockActivity(page, 'viewer')
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('Filter by person')).toBeVisible()
  await expect(page.getByText('commented on PORT-36')).toBeVisible()
  await expect(page.getByRole('button', { name: /edit activity|delete activity/i })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Brief', exact: true }).click()
  await expect(page).toHaveURL(`/northwind/projects/${projectId}`)
  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
})

test('activity and people failures can be retried', async ({ page }) => {
  await mockActivity(page)
  let fail = true
  await page.route('http://localhost:8787/workspaces/northwind/members', async (route) =>
    fail
      ? route.fulfill({ headers, status: 500, json: { error: 'Unavailable' } })
      : route.fallback(),
  )
  await page.route(`http://localhost:8787/projects/${projectId}/activity*`, async (route) =>
    fail
      ? route.fulfill({ headers, status: 500, json: { error: 'Unavailable' } })
      : route.fallback(),
  )
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(page.getByText('Activity could not be loaded.', { exact: true })).toBeVisible()
  await expect(page.getByText('People could not be loaded.', { exact: true })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry people' }).click()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('commented on PORT-36')).toBeVisible()
  await expect(
    page.getByLabel('Filter by person').getByRole('option', { name: 'Daniel Okafor' }),
  ).toHaveCount(1)
})

test('mention edits use truthful activity copy without repeating comment text', async ({
  page,
}) => {
  await mockActivity(page)
  await page.route(`http://localhost:8787/projects/${projectId}/activity*`, (route) =>
    route.fulfill({
      headers,
      json: {
        activity: [
          {
            ...entries[0],
            id: 'mention-edit',
            type: 'comment.mentioned',
            comment: { text: 'Private edited comment body', target: 'task', taskId: 'task-1' },
          },
          { ...entries[0], id: 'deleted-mention-edit', type: 'comment.mentioned', comment: null },
        ],
        nextCursor: null,
      },
    }),
  )
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(
    page.getByText('added mentions to a comment on PORT-36', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('deleted a comment', { exact: true })).toBeVisible()
  await expect(page.getByText('Private edited comment body', { exact: false })).toHaveCount(0)
})

test('activity identifies an external review change request and its comment', async ({ page }) => {
  await mockActivity(page, 'owner', false, true)
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(page.getByText('External reviewer', { exact: true })).toBeVisible()
  await expect(page.getByText(/requested changes/)).toBeVisible()
  await expect(page.getByText('Please clarify the launch date.', { exact: false })).toBeVisible()
})

test('attributes tracker updates to Linear and deleted accounts to Deleted user', async ({
  page,
}) => {
  await mockActivity(page)
  const taskActivity = entries[2]
  if (!taskActivity) throw new Error('Missing task activity fixture')
  await page.route(`http://localhost:8787/projects/${projectId}/activity*`, (route) =>
    route.fulfill({
      headers,
      json: {
        activity: [
          {
            ...taskActivity,
            id: 'tracker',
            actorId: null,
            actorName: null,
            payload: { ...taskActivity.payload, source: 'linear' },
          },
          { ...taskActivity, id: 'deleted', actorId: null, actorName: null },
        ],
        nextCursor: null,
      },
    }),
  )
  await page.goto(`/northwind/projects/${projectId}/activity`)
  await expect(page.getByText('Linear', { exact: true })).toBeVisible()
  await expect(page.getByText('Deleted user', { exact: true })).toBeVisible()
})
