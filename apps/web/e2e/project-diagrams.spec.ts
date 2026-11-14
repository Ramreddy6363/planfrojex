import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const diagramId = 'a4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const draftId = 'd4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const changeId = 'c4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const emptyScene = () => ({ nodes: [], edges: [] })

async function mockDiagrams(
  page: import('@playwright/test').Page,
  role = 'owner',
  conflict = false,
  existing = false,
) {
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  const workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal: false }
  const project = {
    id: projectId,
    key: 'PORT',
    name: 'Customer portal',
    status: 'in-progress',
    leadId: 'owner',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    starred: false,
    taskProgress: { done: 0, total: 1 },
    brief: { problem: 'Billing is confusing' },
    tags: [],
  }
  type Scene = {
    nodes: Array<{
      id: string
      type: string
      position: { x: number; y: number }
      data: { label: string }
    }>
    edges: Array<{ id: string; source: string; target: string }>
  }
  const diagram = {
    id: diagramId,
    projectId,
    name: 'Checkout flow',
    type: 'flowchart',
    currentVersion: 0,
    sceneVersion: 0,
    scene: emptyScene() as Scene,
    createdBy: 'owner',
    createdAt: '2026-11-14T10:42:00Z',
    updatedAt: '2026-11-14T10:42:00Z',
  }
  let created = role === 'viewer' || conflict || existing
  let draftAccepted = false
  const versions: Array<{
    id: string
    version: number
    label: string | null
    createdBy: string
    authorName: string
    createdAt: string
    scene: Scene
  }> = []
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
  if (created)
    diagram.scene.nodes = [
      { id: 'node-1', type: 'rectangle', position: { x: 100, y: 100 }, data: { label: 'Start' } },
    ]
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const json = method === 'GET' || method === 'DELETE' ? {} : request.postDataJSON()
    if (method !== 'GET') writes.push({ path, method, body: json })
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
    if (path === `/projects/${projectId}/plan`)
      return route.fulfill({
        headers,
        json: { sections: [], milestones: [], risks: [], lastChanged: null },
      })
    if (path === `/projects/${projectId}/decisions`)
      return route.fulfill({ headers, json: { decisions: [] } })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({ headers, json: { members: [] } })
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${projectId}/diagrams` && method === 'GET')
      return route.fulfill({ headers, json: { diagrams: created ? [diagram] : [] } })
    if (path === `/projects/${projectId}/diagrams` && method === 'POST') {
      created = true
      diagram.name = json.name
      diagram.type = json.type
      return route.fulfill({ headers, status: 201, json: { diagram } })
    }
    if (path === `/diagrams/${diagramId}` && method === 'GET')
      return route.fulfill({ headers, json: { diagram } })
    if (path === `/diagrams/${diagramId}` && method === 'PUT') {
      if (conflict)
        return route.fulfill({
          headers,
          status: 409,
          json: { error: 'This diagram changed in another window. Reload it before editing.' },
        })
      diagram.scene = json.scene
      diagram.sceneVersion += 1
      return route.fulfill({ headers, json: { diagram } })
    }
    if (path === `/diagrams/${diagramId}/versions` && method === 'GET')
      return route.fulfill({ headers, json: { versions } })
    if (path === `/diagrams/${diagramId}/versions` && method === 'POST') {
      diagram.currentVersion += 1
      const version = {
        id: `version-${diagram.currentVersion}`,
        version: diagram.currentVersion,
        label: json.label ?? null,
        createdBy: 'owner',
        authorName: 'Maya Chen',
        createdAt: '2026-11-14T10:42:00Z',
        scene: structuredClone(diagram.scene),
      }
      versions.unshift(version)
      return route.fulfill({ headers, status: 201, json: { version } })
    }
    if (path.endsWith('/versions/1/restore') && method === 'POST') {
      diagram.currentVersion += 1
      diagram.sceneVersion += 1
      diagram.scene = structuredClone(
        versions.find((version) => version.version === 1)?.scene ?? diagram.scene,
      )
      const version = {
        id: `version-${diagram.currentVersion}`,
        version: diagram.currentVersion,
        label: null,
        createdBy: 'owner',
        authorName: 'Maya Chen',
        createdAt: '2026-11-14T10:42:00Z',
        scene: diagram.scene,
      }
      versions.unshift(version)
      return route.fulfill({ headers, status: 201, json: { diagram, version } })
    }
    if (path === `/projects/${projectId}/drafts` && method === 'POST')
      return route.fulfill({
        headers,
        status: 202,
        json: { draft: { id: draftId, status: 'queued' } },
      })
    if (path === `/drafts/${draftId}` && method === 'GET')
      return route.fulfill({
        headers,
        json: {
          draft: {
            id: draftId,
            kind: 'diagram',
            diagramId,
            projectId,
            status: 'ready',
            changes: [
              {
                id: changeId,
                kind: 'diagram',
                status: draftAccepted ? 'accepted' : 'pending',
                before: { diagramId, sceneVersion: diagram.sceneVersion, scene: diagram.scene },
                after: {
                  nodes: [
                    {
                      id: 'draft-node',
                      type: 'rectangle',
                      position: { x: 100, y: 100 },
                      data: { label: 'Draft checkout' },
                    },
                  ],
                  edges: [],
                },
              },
            ],
          },
        },
      })
    if (path === `/drafts/${draftId}/changes/${changeId}/accept`) {
      draftAccepted = true
      diagram.scene = {
        nodes: [
          {
            id: 'draft-node',
            type: 'rectangle',
            position: { x: 100, y: 100 },
            data: { label: 'Draft checkout' },
          },
        ],
        edges: [],
      }
      diagram.currentVersion += 1
      diagram.sceneVersion += 1
      return route.fulfill({ headers, json: { decision: { id: 'decision-1' } } })
    }
    if (path === '/projects')
      return route.fulfill({
        headers,
        json: { projects: [], counts: { all: 0, starred: 0, archived: 0 }, nextCursor: null },
      })
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
  return { writes, diagram, versions }
}

test('creates a diagram, connects shapes, autosaves, saves/restores versions and accepts a draft', async ({
  page,
}) => {
  const state = await mockDiagrams(page)
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await page.getByRole('button', { name: 'New diagram', exact: true }).first().click()
  await page.getByLabel('Diagram name', { exact: true }).fill('Checkout flow')
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Checkout flow', exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.getByRole('button', { name: 'Diamond', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await page.getByRole('button', { name: 'Arrow', exact: true }).click()
  await page.locator('.react-flow__node').nth(0).click()
  await page.locator('.react-flow__node').nth(1).click()
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect.poll(() => state.diagram.scene.edges.length).toBe(1)
  await expect(page.getByText(/^Saved /)).toBeVisible()
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await page.getByLabel('Version name').fill('Checkout baseline')
  await page.getByRole('button', { name: 'Save version', exact: true }).last().click()
  await expect(page.getByText('Checkout baseline')).toBeVisible()
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect.poll(() => state.diagram.scene.nodes.length).toBe(3)
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await page.getByLabel('Version name').fill('With note')
  await page.getByRole('button', { name: 'Save version', exact: true }).last().click()
  await page.getByRole('button', { name: 'Restore v1' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect.poll(() => state.diagram.currentVersion).toBe(3)
  await page.getByLabel('Diagram instructions').fill('Show a checkout with email sign-in')
  await page.getByRole('button', { name: 'Draft diagram', exact: true }).click()
  await expect(page.getByText('Draft preview')).toBeVisible()
  await expect(page.getByText('Draft checkout', { exact: true })).toBeVisible()
  await expect.poll(() => state.diagram.scene.nodes.length).toBe(2)
  await page.getByRole('button', { name: 'Accept draft', exact: true }).click()
  await expect(page.getByText('Draft preview')).toHaveCount(0)
  await expect.poll(() => state.diagram.scene.nodes[0]?.data.label).toBe('Draft checkout')
})

test('a stale autosave keeps local edits and asks to reload', async ({ page }) => {
  const state = await mockDiagrams(page, 'owner', true)
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed in another window')
  const writes = state.writes.length
  await page.waitForTimeout(900)
  expect(state.writes).toHaveLength(writes)
  await expect(page.getByRole('button', { name: 'Reload diagram' })).toBeVisible()
})

test('viewers can pan and zoom but see no canvas, version or draft write controls', async ({
  page,
}) => {
  const state = await mockDiagrams(page, 'viewer')
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  for (const name of ['New diagram', 'Rectangle', 'Save version', 'Draft diagram', 'Restore v1'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Diagram instructions')).toHaveCount(0)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(state.writes).toHaveLength(0)
})

test('renders the diagram workspace and saved version history from screen 407', async ({
  page,
}) => {
  const state = await mockDiagrams(page, 'owner', false, true)
  state.diagram.currentVersion = 3
  state.diagram.scene.nodes = [
    {
      id: 'billing',
      type: 'rectangle',
      position: { x: 205, y: 60 },
      data: { label: 'Customer opens Billing' },
    },
    {
      id: 'signed-in',
      type: 'rectangle',
      position: { x: 245, y: 160 },
      data: { label: 'Signed in?' },
    },
    {
      id: 'invoices',
      type: 'rectangle',
      position: { x: 100, y: 260 },
      data: { label: 'Show invoices and payment method' },
    },
    {
      id: 'download',
      type: 'rectangle',
      position: { x: 425, y: 260 },
      data: { label: 'Download PDF' },
    },
    { id: 'card', type: 'rectangle', position: { x: 240, y: 360 }, data: { label: 'Update card' } },
    {
      id: 'email',
      type: 'rectangle',
      position: { x: 205, y: 460 },
      data: { label: 'Confirmation email sent' },
    },
  ]
  state.diagram.scene.edges = [
    { id: 'e1', source: 'billing', target: 'signed-in' },
    { id: 'e2', source: 'signed-in', target: 'invoices' },
    { id: 'e3', source: 'invoices', target: 'download' },
    { id: 'e4', source: 'invoices', target: 'card' },
    { id: 'e5', source: 'card', target: 'email' },
  ]
  for (const version of [3, 2, 1])
    state.versions.push({
      id: `version-${version}`,
      version,
      label: null,
      createdBy: 'owner',
      authorName: version === 1 ? 'Maya Chen' : 'Priya Raman',
      createdAt: `2026-11-${11 + version}T10:42:00Z`,
      scene: structuredClone(state.diagram.scene),
    })
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await expect(page.locator('.react-flow__node')).toHaveCount(6)
  await expect(page.getByText('Current', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore v1' })).toBeVisible()
  await page.screenshot({ path: '/tmp/feature8-diagrams-407.png', fullPage: true })
})

test('deleting a connected shape autosaves a scene without dangling arrows', async ({ page }) => {
  const state = await mockDiagrams(page, 'owner', false, true)
  state.diagram.scene.nodes = [
    { id: 'first', type: 'rectangle', position: { x: 100, y: 100 }, data: { label: 'First' } },
    { id: 'second', type: 'rectangle', position: { x: 100, y: 250 }, data: { label: 'Second' } },
  ]
  state.diagram.scene.edges = [{ id: 'arrow', source: 'first', target: 'second' }]
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await page.locator('.react-flow__node').first().click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect.poll(() => state.diagram.scene.nodes.length).toBe(1)
  expect(state.diagram.scene.edges).toHaveLength(0)
  for (const write of state.writes.filter((item) => item.method === 'PUT')) {
    const scene = write.body.scene as typeof state.diagram.scene
    const ids = new Set(scene.nodes.map((node) => node.id))
    expect(scene.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true)
  }
})

test('flushes pending autosave before tabs, browser back and sidebar navigation', async ({
  page,
}) => {
  const state = await mockDiagrams(page, 'owner', false, true)
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  expect(state.diagram.scene.nodes).toHaveLength(1)
  await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  await expect(page).toHaveURL(`/northwind/projects/${projectId}/plan`)
  expect(state.diagram.scene.nodes).toHaveLength(2)
  await page.getByRole('tab', { name: 'Diagrams 1', exact: true }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  expect(state.diagram.scene.nodes).toHaveLength(2)
  await page.goBack()
  await expect(page).toHaveURL(`/northwind/projects/${projectId}/plan`)
  expect(state.diagram.scene.nodes).toHaveLength(3)
  await page.getByRole('tab', { name: 'Diagrams 1', exact: true }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  expect(state.diagram.scene.nodes).toHaveLength(3)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page).toHaveURL('/northwind/projects')
  expect(state.diagram.scene.nodes).toHaveLength(4)
})

test('keeps the route and local scene when navigation autosave conflicts', async ({ page }) => {
  const state = await mockDiagrams(page, 'owner', true)
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed in another window')
  await expect(page).toHaveURL(`/northwind/projects/${projectId}/diagrams`)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  expect(state.diagram.scene.nodes).toHaveLength(1)
})

test('autosaves a keyboard move of a shape', async ({ page }) => {
  const state = await mockDiagrams(page, 'owner', false, true)
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  const node = page.locator('.react-flow__node').first()
  await node.click()
  await node.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => state.diagram.scene.nodes[0]?.position.x).toBeGreaterThan(100)
})

test('keeps diagram names, version names and drafting instructions within API limits', async ({
  page,
}) => {
  await mockDiagrams(page, 'owner', false, true)
  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  const instructions = page.getByLabel('Diagram instructions')
  await instructions.fill('x'.repeat(5000))
  await expect.poll(async () => (await instructions.inputValue()).length).toBe(4000)
  await page.getByRole('button', { name: 'New diagram', exact: true }).click()
  const name = page.getByLabel('Diagram name', { exact: true })
  await name.fill('x'.repeat(200))
  await expect.poll(async () => (await name.inputValue()).length).toBe(160)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  const version = page.getByLabel('Version name')
  await version.fill('x'.repeat(200))
  await expect.poll(async () => (await version.inputValue()).length).toBe(160)
})

test('shows a loading state while the diagram canvas downloads', async ({ page }) => {
  await mockDiagrams(page, 'viewer')
  let releaseCanvas = () => {}
  const canvasReady = new Promise<void>((resolve) => {
    releaseCanvas = resolve
  })
  await page.route('**/src/ui/diagram-canvas.tsx', async (route) => {
    await canvasReady
    await route.continue()
  })
  try {
    await page.goto(`/northwind/projects/${projectId}/diagrams`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading diagram canvas…' }),
    ).toBeVisible()
  } finally {
    releaseCanvas()
  }
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
})
