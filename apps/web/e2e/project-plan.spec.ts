import { expect, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'

async function mockPlan(page: import('@playwright/test').Page, role = 'owner') {
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const sections = [
    {
      kind: 'requirements',
      content: ['Customers can sign in using a code.'],
      version: 0,
      updatedAt: '',
      updatedBy: null,
    },
    { kind: 'stories', content: null, version: 0, updatedAt: '', updatedBy: null },
    { kind: 'stack', content: null, version: 0, updatedAt: '', updatedBy: null },
    { kind: 'estimate', content: null, version: 0, updatedAt: '', updatedBy: null },
  ]
  const milestones: Array<Record<string, unknown>> = []
  let lastChanged: { at: string; by: string } | null = null
  const writes: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
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
            {
              id: 'editor',
              name: 'Jordan Lee',
              email: 'jordan@example.com',
              image: null,
              role: 'editor',
            },
          ],
        },
      })
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}/plan` && req.method() === 'GET')
      return route.fulfill({
        headers,
        json: { sections, milestones, risks: [], lastChanged },
      })
    if (path === `/projects/${projectId}/plan/sections/requirements` && req.method() === 'PATCH') {
      const body = req.postDataJSON()
      writes.push({ path, method: req.method(), body })
      const requirements = sections[0]
      lastChanged = { at: new Date().toISOString(), by: 'Maya Chen' }
      if (requirements)
        Object.assign(requirements, {
          content: body.content,
          version: body.version + 1,
          updatedBy: 'owner',
          updatedAt: new Date().toISOString(),
        })
      return route.fulfill({ headers, json: { section: sections[0] } })
    }
    if (path === `/projects/${projectId}/milestones` && req.method() === 'POST') {
      const body = req.postDataJSON()
      writes.push({ path, method: req.method(), body })
      milestones.push({ id: 'milestone-1', projectId, code: 'M1', position: 0, ...body })
      lastChanged = { at: new Date().toISOString(), by: 'Maya Chen' }
      return route.fulfill({ headers, status: 201, json: { milestone: milestones.at(-1) } })
    }
    if (path === '/milestones/milestone-1' && req.method() === 'PATCH') {
      const body = req.postDataJSON()
      writes.push({ path, method: req.method(), body })
      const milestone = milestones[0]
      if (milestone) Object.assign(milestone, body)
      lastChanged = { at: new Date().toISOString(), by: 'Maya Chen' }
      return route.fulfill({ headers, json: { milestone } })
    }
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
  return {
    sections,
    milestones,
    writes,
    get lastChanged() {
      return lastChanged
    },
  }
}

test('owner edits plan sections and adds milestones; viewer reads without write controls', async ({
  page,
}) => {
  const state = await mockPlan(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/northwind/projects/${projectId}/plan`)
  await expect(page.getByRole('heading', { name: 'Customer portal' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'On this page' })).toContainText('Requirements')
  await expect(page.getByText('Customers can sign in using a code.')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Requirements' }).click()
  await page
    .getByLabel('Requirements')
    .fill('Customers can sign in using a code.\nWorkspace owners invite teammates.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(() => {
      const content = state.sections[0]?.content
      return Array.isArray(content) ? content.length : 0
    })
    .toBe(2)
  await expect(page.getByText(/Last changed .* by Maya Chen/)).toBeVisible()
  await page.getByRole('button', { name: 'Add milestone' }).click()
  await page.getByLabel('Milestone title').fill('Private beta')
  await page.getByRole('button', { name: 'Create milestone' }).click()
  await expect(page.locator('#milestones')).toContainText('Private beta')
  await page.getByRole('button', { name: 'Edit Private beta' }).click()
  await page.getByLabel('Edit milestone title Private beta').fill('Private beta launch')
  await page.getByRole('button', { name: 'Save title' }).click()
  await expect.poll(() => state.milestones[0]?.title).toBe('Private beta launch')
  expect(state.lastChanged?.by).toBe('Maya Chen')
  expect(state.writes.some((item) => item.method === 'PATCH')).toBe(true)
  expect(state.writes.some((item) => item.method === 'POST')).toBe(true)

  await page.unrouteAll()
  await mockPlan(page, 'viewer')
  await page.goto(`/northwind/projects/${projectId}/plan`)
  await expect(page.getByText('Customers can sign in using a code.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Requirements' })).toHaveCount(0)
  await expect(page.getByLabel('Milestone title')).toHaveCount(0)
})
