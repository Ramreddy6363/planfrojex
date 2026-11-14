import { expect, test } from '@playwright/test'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'

async function mockPlan(
  page: import('@playwright/test').Page,
  role = 'owner',
  initialDraftStatus = 'ready',
) {
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
  const draftId = 'd4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
  const kinds = ['requirements', 'stories', 'milestones', 'risks', 'stack', 'estimate']
  const changes = kinds.map((kind, index) => ({
    id: `c4a3a1d9-9f71-4d75-9b9d-6b7e8f21c71${index}`,
    kind,
    before:
      kind === 'milestones' || kind === 'risks'
        ? []
        : {
            version: 0,
            content: kind === 'requirements' ? ['Customers can sign in using a code.'] : null,
          },
    after: {
      requirements: ['Customers can sign in using a code.', 'Invites are accepted by email.'],
      stories: ['As a teammate, I can accept an invite.'],
      milestones: [{ title: 'First release', status: 'planning', dueDate: '2027-01-15' }],
      risks: [
        {
          title: 'Email delivery may be delayed',
          severity: 'medium',
          ownerId: 'editor',
          decideBy: null,
        },
      ],
      stack: ['React', 'PostgreSQL'],
      estimate: { value: '4 weeks', note: 'One engineer and a designer.' },
    }[kind],
    status: 'pending',
  }))
  const decisions: Array<Record<string, unknown>> = []
  let draftStatus = initialDraftStatus
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
    if (path === `/projects/${projectId}/drafts` && req.method() === 'POST') {
      if (draftStatus === 'discarded') draftStatus = 'ready'
      return route.fulfill({
        headers,
        status: 202,
        json: { draft: { id: draftId, status: 'queued' } },
      })
    }
    if (path === `/drafts/${draftId}` && req.method() === 'GET')
      return route.fulfill({
        headers,
        json: {
          draft: {
            id: draftId,
            projectId,
            status: draftStatus,
            model: 'fake',
            error: null,
            createdAt: new Date().toISOString(),
            changes,
          },
        },
      })
    if (path === `/drafts/${draftId}` && req.method() === 'DELETE') {
      draftStatus = 'discarded'
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === `/projects/${projectId}/decisions` && req.method() === 'GET')
      return route.fulfill({ headers, json: { decisions } })
    const changeMatch = path.match(
      new RegExp(`^/drafts/${draftId}/changes/([^/]+)/(accept|reject)$`),
    )
    if (changeMatch && req.method() === 'POST') {
      const change = changes.find((item) => item.id === changeMatch[1])
      if (!change) return route.fulfill({ headers, status: 404 })
      change.status = changeMatch[2] === 'accept' ? 'accepted' : 'rejected'
      const decisionId = `e4a3a1d9-9f71-4d75-9b9d-6b7e8f21c7${decisions.length}`
      decisions.push({
        id: decisionId,
        kind: change.kind,
        outcome: change.status,
        actorId: 'owner',
        actorName: 'Maya Chen',
        reversesDecisionId: null,
        createdAt: new Date().toISOString(),
      })
      if (change.status === 'accepted' && change.kind === 'requirements') {
        const requirement = sections[0]
        if (requirement) {
          requirement.content = change.after as string[]
          requirement.version += 1
        }
      }
      return route.fulfill({
        headers,
        json: { decision: { id: decisionId, outcome: change.status } },
      })
    }
    if (path === `/drafts/${draftId}/accept-all` && req.method() === 'POST') {
      const pending = changes.filter((item) => item.status === 'pending')
      for (const change of pending) {
        change.status = 'accepted'
        decisions.push({
          id: `e4a3a1d9-9f71-4d75-9b9d-6b7e8f21c7${decisions.length}`,
          kind: change.kind,
          outcome: 'accepted',
          actorId: 'owner',
          actorName: 'Maya Chen',
          reversesDecisionId: null,
          createdAt: new Date().toISOString(),
        })
      }
      return route.fulfill({ headers, json: { accepted: pending.length, decisionIds: [] } })
    }
    const undoMatch = path.match(/^\/decisions\/([^/]+)\/undo$/)
    if (undoMatch && req.method() === 'POST') {
      const item = decisions.find((decision) => decision.id === undoMatch[1])
      if (item) {
        const change = changes.find((candidate) => candidate.kind === item.kind)
        if (change) change.status = 'pending'
        item.outcome = 'reversed'
      }
      return route.fulfill({
        headers,
        json: { decision: { id: 'f4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715', outcome: 'reversed' } },
      })
    }
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
    changes,
    decisions,
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
  await expect(page.getByRole('button', { name: 'Draft plan from brief' })).toHaveCount(0)
  await expect(page.getByLabel('Milestone title')).toHaveCount(0)
})

test('owner reviews a plan draft, accepts and rejects changes, then undoes an acceptance', async ({
  page,
}) => {
  const state = await mockPlan(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/northwind/projects/${projectId}/plan`)
  await page.getByRole('button', { name: 'Draft plan from brief' }).click()
  await expect(page.getByRole('region', { name: 'Plan draft' })).toContainText('ready for review')
  await expect(page.getByRole('region', { name: 'Plan draft' })).not.toContainText(
    '[object Object]',
  )
  await expect(page.locator('#requirements')).not.toContainText('version: 0')
  await expect(page.locator('#milestones')).toContainText('First release')
  await expect(page.locator('#risks')).toContainText('Jordan Lee')
  await page.getByRole('button', { name: 'Accept', exact: true }).first().click()
  await expect.poll(() => state.changes[0]?.status).toBe('accepted')
  await page.getByRole('button', { name: 'Reject', exact: true }).first().click()
  await expect.poll(() => state.changes[1]?.status).toBe('rejected')
  await page.getByRole('button', { name: 'Accept remaining' }).click()
  await expect
    .poll(() => state.changes.filter((change) => change.status === 'accepted').length)
    .toBe(5)
  await page
    .getByRole('heading', { name: 'Decision log' })
    .locator('..')
    .getByRole('button', { name: 'Undo' })
    .first()
    .click()
  await expect
    .poll(() => state.decisions.some((decision) => decision.outcome === 'reversed'))
    .toBe(true)
})

test('failed drafts can be discarded and started again', async ({ page }) => {
  await mockPlan(page, 'owner', 'failed')
  await page.goto(`/northwind/projects/${projectId}/plan`)
  await page.getByRole('button', { name: 'Draft plan from brief' }).click()
  await expect(page.getByRole('heading', { name: 'Draft could not be created' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await page.getByRole('button', { name: 'Draft plan from brief' }).click()
  await expect(
    page.getByRole('heading', { name: 'Draft from the brief is ready for review' }),
  ).toBeVisible()
})
