import { expect, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'

async function mockBrief(page: import('@playwright/test').Page, role = 'owner') {
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  const project = {
    id: projectId,
    key: 'PORTAL',
    name: 'Customer portal rebuild',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    brief: {
      problem: 'Customers call support to update billing details.',
      goals: ['Update payment methods without contacting support.'],
      constraints: 'Keep current customer IDs.',
      outOfScope: 'Plan changes stay with Sales.',
    },
    tags: ['web', 'billing'],
    createdAt: '2026-10-02T00:00:00.000Z',
    createdBy: { id: 'owner', name: 'Maya Chen' },
    starred: false,
  }
  const members = [
    { id: 'owner', name: 'Maya Chen', email: 'owner@example.com', image: null, role: 'owner' },
    {
      id: 'editor',
      name: 'Daniel Okafor',
      email: 'daniel@example.com',
      image: null,
      role: 'editor',
    },
  ]
  const comments: Array<Record<string, unknown>> = []
  const updates: unknown[] = []
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: {
            id: role === 'viewer' ? 'viewer' : 'owner',
            email: `${role}@example.com`,
            emailVerified: true,
          },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({ headers, json: { members } })
    if (path === `/projects/${projectId}` && request.method() === 'GET')
      return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}` && request.method() === 'PATCH') {
      const body = request.postDataJSON()
      updates.push(body)
      const previousBrief = project.brief
      Object.assign(project, body)
      if (body.brief) project.brief = { ...previousBrief, ...body.brief }
      return route.fulfill({ headers, json: { project } })
    }
    if (path === `/projects/${projectId}/star`) {
      project.starred = request.method() === 'PUT'
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === '/comments' && request.method() === 'GET')
      return route.fulfill({ headers, json: { comments } })
    if (path === '/comments' && request.method() === 'POST') {
      const body = request.postDataJSON()
      const comment = {
        id: 'e20ca599-68cc-4132-a4db-6eb23b4e4333',
        authorId: role === 'viewer' ? 'viewer' : 'owner',
        authorName: role === 'viewer' ? 'Kenji Sato' : 'Maya Chen',
        body: body.body,
        mentions: body.mentions,
        createdAt: '2026-11-13T10:00:00.000Z',
        updatedAt: '2026-11-13T10:00:00.000Z',
      }
      comments.push(comment)
      return route.fulfill({ headers, status: 201, json: { comment } })
    }
    if (path.startsWith('/comments/') && request.method() === 'PATCH') {
      const body = request.postDataJSON()
      const comment = comments.find((item) => item.id === path.split('/').pop())
      Object.assign(comment ?? {}, body)
      return route.fulfill({ headers, json: { comment } })
    }
    if (path.startsWith('/comments/') && request.method() === 'DELETE') {
      const index = comments.findIndex((item) => item.id === path.split('/').pop())
      if (index >= 0) comments.splice(index, 1)
      return route.fulfill({ headers, json: { ok: true } })
    }
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
  return { project, comments, updates, members }
}

test('project brief loads, edits, stars and manages comments with member mentions', async ({
  page,
}) => {
  const state = await mockBrief(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/northwind/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: 'Customer portal rebuild' })).toBeVisible()
  await expect(page.getByText('Customers call support to update billing details.')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Problem' }).click()
  await page
    .getByRole('textbox', { name: 'Problem' })
    .fill('Customers cannot manage billing on their own.')
  await page.getByRole('button', { name: 'Save Problem' }).click()
  await expect(page.getByText('Customers cannot manage billing on their own.')).toBeVisible()
  expect(state.updates[0]).toEqual({
    brief: { problem: 'Customers cannot manage billing on their own.' },
  })
  await page.getByRole('button', { name: 'Edit status' }).click()
  await page.getByLabel('Project status').selectOption('planning')
  await expect.poll(() => state.project.status).toBe('planning')
  await page.getByRole('button', { name: 'Star project' }).click()
  await expect(page.getByRole('button', { name: 'Unstar project' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('textbox', { name: 'Comment' }).fill('Could you review @Dan')
  await page
    .getByRole('listbox', { name: 'Workspace members' })
    .getByRole('option', { name: 'Daniel Okafor' })
    .click()
  await page.getByRole('button', { name: 'Post comment' }).click()
  await expect(page.getByText('Could you review @Daniel Okafor')).toBeVisible()
  expect(state.comments[0]).toMatchObject({ mentions: ['editor'] })
  await page.getByRole('button', { name: 'Actions for your comment' }).click()
  await page.getByRole('menuitem', { name: 'Edit comment' }).click()
  await page.getByLabel('Edit comment').fill('Updated comment')
  await page.getByRole('button', { name: 'Save comment' }).click()
  await expect(page.getByText('Updated comment')).toBeVisible()
  expect(state.comments[0]).toMatchObject({ mentions: [] })
  await page.getByRole('button', { name: 'Actions for your comment' }).click()
  await page.getByRole('menuitem', { name: 'Edit comment' }).click()
  await page.getByLabel('Edit comment').fill('Updated @May')
  await expect(
    page
      .getByRole('listbox', { name: 'Workspace members' })
      .getByRole('option', { name: 'Maya Chen' }),
  ).toBeVisible()
  await page
    .getByRole('listbox', { name: 'Workspace members' })
    .getByRole('option', { name: 'Maya Chen' })
    .click()
  await page.getByRole('button', { name: 'Save comment' }).click()
  await expect(page.getByText('Updated @Maya Chen')).toBeVisible()
  expect(state.comments[0]).toMatchObject({ mentions: ['owner'] })
  await page.getByRole('button', { name: 'Actions for your comment' }).click()
  await page.getByRole('menuitem', { name: 'Delete comment' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete comment' }).click()
  await expect(page.getByText('Updated comment')).not.toBeVisible()
  expect(state.updates.length).toBeGreaterThan(0)
})

test('viewer can read the project and comment but cannot edit the brief or properties', async ({
  page,
}) => {
  await mockBrief(page, 'viewer')
  await page.goto(`/northwind/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: 'Customer portal rebuild' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Problem' })).toHaveCount(0)
  await expect(page.getByLabel('Project status')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Comment' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Star project' })).toBeVisible()
})
