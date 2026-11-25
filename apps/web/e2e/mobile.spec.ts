import { expect, test } from '@playwright/test'
import { mockDrift } from './drift-fixture'
import { type Mode, mockSignedOut, mockStates, projectScreens, screens } from './states-fixture'
import { mockStatusEmail } from './status-email-fixture'
import { webOrigin } from './test-origin'

const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
const workspace = {
  id: 'workspace-1',
  name: 'Northwind',
  slug: 'northwind',
  role: 'owner',
  isPersonal: false,
}
const contosoWorkspace = {
  id: 'workspace-2',
  name: 'Contoso',
  slug: 'contoso',
  role: 'owner',
  isPersonal: false,
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
    problem:
      'Billing and invoice requests make up 38% of support tickets. These three requests make up 38% of support tickets.',
    goals: [
      'Customers download invoices without contacting support.',
      'Owners invite and remove teammates themselves.',
      'Account tickets drop 40% within two months.',
    ],
    constraints:
      'Keep existing customer IDs and invoice numbers. Launch before the December billing run.',
    outOfScope: '',
  },
  tags: ['web', 'billing'],
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
  createdBy: { id: 'owner', name: 'Maya Chen' },
  starred: false,
  taskProgress: { done: 18, total: 42 },
}
const draftProject = {
  ...project,
  id: '2ad5f3f0-8a20-4f12-8abe-62e501220e57',
  key: 'DRAFT',
  name: 'Partner API rate limits and usage reporting',
  status: 'draft',
  targetDate: null,
  taskProgress: { done: 0, total: 0 },
}
const comments = [
  { authorId: 'owner', authorName: 'Maya Chen' },
  { authorId: 'editor', authorName: 'Luis Ortiz' },
  { authorId: 'viewer', authorName: 'Priya Rao' },
].map(({ authorId, authorName }, n) => ({
  id: `comment-${n}`,
  authorId,
  authorName,
  body: `Comment ${n + 1} on the project.`,
  mentions: [],
  createdAt: '2026-11-13T10:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
}))
const headers = {
  'access-control-allow-origin': webOrigin(),
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const publicShare = {
  workspaceName: 'Northwind',
  sharedBy: 'Maya Chen',
  project: {
    name: project.name,
    status: 'in-progress',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    updatedAt: '2026-11-13T10:00:00.000Z',
  },
  brief: {
    problem:
      'Billing and invoice requests make up 38% of support tickets. We are replacing the legacy portal with a self-serve account area.',
    goals: ['Account-related support tickets drop by 40% within two months of launch.'],
  },
  plan: {
    milestones: [
      {
        code: 'M1',
        title: 'Sign-in, SSO and account settings',
        status: 'in_progress',
        dueDate: '2026-10-31',
      },
      {
        code: 'M2',
        title: 'Billing and invoices',
        status: 'planning',
        dueDate: '2026-11-21',
      },
      {
        code: 'M3',
        title: 'Teammates and launch',
        status: 'planning',
        dueDate: '2026-12-12',
      },
    ],
  },
  diagrams: [
    {
      name: 'Checkout flow',
      type: 'flowchart',
      scene: {
        nodes: [
          { type: 'rectangle', position: { x: 160, y: 0 }, data: { label: 'Open Billing' } },
          { type: 'rectangle', position: { x: 160, y: 100 }, data: { label: 'Download PDF' } },
        ],
        edges: [{ source: 0, target: 1 }],
      },
    },
  ],
}

async function mockApp(page: import('@playwright/test').Page) {
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'owner', name: 'Maya Chen', email: 'owner@example.com', emailVerified: true },
          workspaces: [workspace, contosoWorkspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/contoso')
      return route.fulfill({ headers, json: { workspace: contosoWorkspace } })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [project, draftProject],
          counts: { all: 2, active: 1, mine: 1, starred: 0 },
          nextCursor: null,
        },
      })
    if (path === '/workspaces/contoso/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [project, draftProject],
          counts: { all: 2, active: 1, mine: 1, starred: 0 },
          nextCursor: null,
        },
      })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({
        headers,
        json: {
          members: [
            {
              id: 'owner',
              name: 'Maya Chen',
              email: 'owner@example.com',
              image: null,
              role: 'owner',
            },
          ],
        },
      })
    if (path === '/workspaces/contoso/members')
      return route.fulfill({ headers, json: { members: [] } })
    if (path === `/projects/${projectId}`) return route.fulfill({ headers, json: { project } })
    if (path === `/projects/${draftProject.id}`)
      return route.fulfill({ headers, json: { project: draftProject } })
    if (path === '/comments') return route.fulfill({ headers, json: { comments } })
    if (path === `/projects/${projectId}/diagrams`)
      return route.fulfill({ headers, json: { diagrams: [] } })
    if (path === `/projects/${projectId}/plan`)
      return route.fulfill({ headers, json: { sections: [], milestones: [], risks: [] } })
    if (path === `/projects/${projectId}/status-reports`)
      return route.fulfill({ headers, json: { reports: [] } })
    if (path === `/projects/${projectId}/tasks`)
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { todo: 24, inProgress: 0, done: 18 } },
      })
    if (path === `/projects/${draftProject.id}/tasks`)
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { todo: 0, inProgress: 0, done: 0 } },
      })
    if (path === `/projects/${projectId}/activity`)
      return route.fulfill({ headers, json: { activity: [], nextCursor: null } })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 0, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === '/inbox')
      return route.fulfill({ headers, json: { items: [], unreadCount: 3, nextCursor: null } })
    if (path === '/workspaces/northwind/activity')
      return route.fulfill({ headers, json: { activity: [] } })
    if (path === '/workspaces/northwind/share-links')
      return route.fulfill({ headers, json: { links: [] } })
    if (path.startsWith('/me/notification-settings'))
      return route.fulfill({ headers, json: { settings: [] } })
    if (path.startsWith('/workspaces/northwind/search'))
      return route.fulfill({ headers, json: { projects: [], tasks: [] } })
    if (path === '/public/share/mobile-token') return route.fulfill({ headers, json: publicShare })
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
}

test.beforeEach(async ({ page }) => {
  await mockApp(page)
})

test('weekly status list and email preview fit the Plan at 390px', async ({ page }, testInfo) => {
  await mockStatusEmail(page, projectId)
  await page.goto(`/northwind/projects/${projectId}/plan`)
  const status = page.getByRole('region', { name: 'Weekly status' })
  await expect(status.getByRole('button', { name: 'View report for Oct 6, 2025' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await status.getByRole('button', { name: 'Preview this week' }).click()
  const preview = page.getByRole('dialog', { name: 'Weekly status preview' })
  await expect(preview.getByRole('heading', { name: 'Next week' })).toBeVisible()
  expect(await preview.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await preview.screenshot({ path: testInfo.outputPath('weekly-status-preview-603-mobile.png') })
  await preview.getByRole('button', { name: 'Done' }).click()
  await expect(preview).toHaveCount(0)
})

test('bottom tabs navigate between Home, My tasks, Inbox and Projects', async ({ page }) => {
  await page.goto('/northwind/projects')
  const tabs = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(tabs).toBeVisible()
  await expect(tabs.getByRole('link', { name: /Inbox/ })).toContainText('3')
  for (const [label, path] of [
    ['Home', '/northwind'],
    ['My tasks', '/northwind/my-tasks'],
    ['Inbox', '/northwind/inbox'],
    ['Projects', '/northwind/projects'],
  ] as const) {
    await tabs.getByRole('link', { name: new RegExp(label) }).click()
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`))
  }
})

test('Projects uses compact rows and opens mobile search and project creation', async ({
  page,
}) => {
  await page.goto('/northwind/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Customer portal rebuild' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Projects' }).getByText('18/42')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Projects' }).getByText('No plan yet')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mobile-701.png') })
  await page.getByRole('button', { name: 'Search projects' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Search' })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(358)
  expect(box?.width).toBeLessThanOrEqual(390)
})

test('mobile workspace menu reaches settings, account, sign out and workspace switching', async ({
  page,
}) => {
  await page.goto('/northwind/projects')
  await page.getByRole('button', { name: 'Workspace menu' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Members', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Account settings', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Northwind', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await menu.getByRole('menuitem', { name: 'Contoso', exact: true }).click()
  await expect(page).toHaveURL('/contoso/projects')
})

test('Project brief opens its comments in a full-height sheet', async ({ page }) => {
  await page.goto(`/northwind/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mobile-702.png') })
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Add out of scope' }).click()
  const outOfScopeEditor = page.getByRole('textbox', { name: 'Out of scope' })
  await expect(outOfScopeEditor).toBeVisible()
  const editorBox = await outOfScopeEditor.boundingBox()
  const commentBarBox = await page.getByRole('button', { name: '3 comments' }).boundingBox()
  if (!editorBox || !commentBarBox)
    throw new Error('Mobile brief editor is missing its layout bounds')
  expect(editorBox.y + editorBox.height).toBeLessThan(commentBarBox.y)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: '3 comments' }).click()
  const sheet = page.getByRole('dialog', { name: 'Comments' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Comment 1 on the project.')).toBeVisible()
  const box = await sheet.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(800)
  const commentIds = await page
    .locator('[id]')
    .evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(commentIds).size).toBe(commentIds.length)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Project properties' }).click()
  const properties = page.getByRole('dialog', { name: 'Project properties' })
  await expect(properties).toBeVisible()
  const propertyIds = await page
    .locator('[id]')
    .evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(propertyIds).size).toBe(propertyIds.length)
})

test('public share page fits the viewport and its diagram can be panned', async ({ page }) => {
  await page.goto('/share/mobile-token')
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Checkout flow' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  const diagram = page.locator('.react-flow')
  await expect(diagram).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mobile-703.png') })
  await diagram.scrollIntoViewIfNeeded()
  await expect(diagram.locator('.react-flow__node')).toHaveCount(2)
  const viewport = diagram.locator('.react-flow__viewport')
  const beforePan = await viewport.getAttribute('style')
  const bounds = await diagram.boundingBox()
  if (!bounds) throw new Error('Diagram canvas has no visible bounds')
  await page.mouse.move(bounds.x + 24, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 54, bounds.y + bounds.height / 2 + 12)
  await page.mouse.up()
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforePan)
  await expect(page.locator('.react-flow__node.draggable')).toHaveCount(0)
})

test('mobile diagrams stay read-only and the selector opens another diagram', async ({ page }) => {
  const diagramIds = ['mobile-diagram-1', 'mobile-diagram-2'] as const
  const diagrams = diagramIds.map((id, index) => ({
    id,
    projectId,
    name: index ? 'Billing flow' : 'Checkout flow',
    type: 'flowchart',
    currentVersion: 1,
  }))
  await page.route(`http://localhost:8787/projects/${projectId}/diagrams`, (route) =>
    route.fulfill({ headers, json: { diagrams } }),
  )
  await page.route('http://localhost:8787/diagrams/mobile-diagram-*/versions', (route) =>
    route.fulfill({ headers, json: { versions: [] } }),
  )
  await page.route('http://localhost:8787/diagrams/mobile-diagram-*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    const index = id === diagramIds[0] ? 0 : 1
    const diagram = {
      ...diagrams[index],
      sceneVersion: 0,
      scene: {
        nodes: [
          {
            id: `node-${index}`,
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: { label: index ? 'Billing details' : 'Start checkout' },
          },
        ],
        edges: [],
      },
      createdBy: 'owner',
      createdAt: '2026-11-13T10:00:00.000Z',
      updatedAt: '2026-11-13T10:00:00.000Z',
    }
    return route.fulfill({ headers, json: { diagram } })
  })

  await page.goto(`/northwind/projects/${projectId}/diagrams`)
  const selector = page.getByRole('combobox', { name: 'Select diagram' })
  await expect(selector).toHaveValue(diagramIds[0])
  await expect(page.getByText('Start checkout')).toBeVisible()
  await selector.selectOption(diagramIds[1])
  await expect(page.getByText('Billing details')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save version' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rectangle' })).toHaveCount(0)
})

test('main workspace routes do not create horizontal page overflow at 390px', async ({ page }) => {
  const paths = [
    '/northwind',
    '/northwind/my-tasks',
    '/northwind/inbox',
    '/northwind/projects',
    `/northwind/projects/${projectId}`,
    `/northwind/projects/${projectId}/plan`,
    `/northwind/projects/${projectId}/tasks`,
    `/northwind/projects/${projectId}/diagrams`,
    `/northwind/projects/${projectId}/activity`,
    '/northwind/members',
    '/northwind/settings',
    '/northwind/account',
  ]
  for (const path of paths) {
    await page.goto(path)
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      root: {
        clientWidth: document.documentElement.clientWidth,
        rectWidth: document.documentElement.getBoundingClientRect().width,
        bodyWidth: document.body.getBoundingClientRect().width,
      },
      outside: [...document.querySelectorAll<HTMLElement>('*')]
        .filter((element) => element.getBoundingClientRect().right > innerWidth + 0.25)
        .map((element) => ({
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className : '',
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .slice(0, 8),
      overflow: [...document.querySelectorAll<HTMLElement>('*')]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className : '',
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          right: Math.round(element.getBoundingClientRect().right),
          overflowX: getComputedStyle(element).overflowX,
        }))
        .slice(0, 8),
    }))
    expect(dimensions.width, `${path}: ${JSON.stringify(dimensions)}`).toBe(390)
  }
})

test('long project names wrap without horizontal overflow on mobile project and share pages', async ({
  page,
}) => {
  const longName = 'AccessibilityDocumentationForInternationalCustomerBillingPlatform'
  await page.route(`http://localhost:8787/projects/${projectId}`, (route) =>
    route.fulfill({ headers, json: { project: { ...project, name: longName } } }),
  )
  await page.route('http://localhost:8787/public/share/mobile-token', (route) =>
    route.fulfill({
      headers,
      json: { ...publicShare, project: { ...publicShare.project, name: longName } },
    }),
  )
  for (const path of [
    `/northwind/projects/${projectId}`,
    `/northwind/projects/${projectId}/plan`,
    `/northwind/projects/${projectId}/activity`,
    '/share/mobile-token',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: longName })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBe(390)
  }
})

test('landing stacks at 390px with reachable navigation and no horizontal overflow', async ({
  page,
}) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const routeHeaders = {
      'access-control-allow-origin': webOrigin(),
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({
        status: 401,
        headers: routeHeaders,
        json: { error: 'Sign in required' },
      })
    if (path === '/templates')
      return route.fulfill({
        status: 401,
        headers: routeHeaders,
        json: { error: 'Sign in required' },
      })
    return route.fulfill({ status: 404, headers: routeHeaders, json: {} })
  })
  await page.goto('/')
  await expect(page.getByRole('navigation').getByRole('img', { name: 'planfrojex' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Get started' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Product', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Templates', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Teams', exact: true })).toHaveCount(0)
  for (const name of ['Sign in', 'Get started', 'Start planning free', 'See a real plan']) {
    const target = page.getByRole('link', { name, exact: name !== 'See a real plan' }).first()
    const box = await target.boundingBox()
    expect(box?.height ?? 0, `${name} target height`).toBeGreaterThanOrEqual(44)
  }
  const templateTab = page.getByRole('tab', { name: 'Product' })
  expect((await templateTab.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  const previewTabs = page
    .getByRole('region', { name: 'PlanFrojex product preview' })
    .getByRole('tablist')
  const tabStrip = await previewTabs.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(tabStrip.scrollWidth).toBeLessThanOrEqual(tabStrip.clientWidth)
  await expect(
    page.getByRole('heading', { name: 'Plans your team actually follows.' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: /Don.t plan twice\./ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath('landing-801-mobile.png'), fullPage: true })
})

test('reviewer page fits at 390px with approval controls reachable', async ({ page }) => {
  const requesterName = 'W'.repeat(80)
  await page.route('http://localhost:8787/public/share/review-token/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (route.request().url().endsWith('/verify-email'))
      return route.fulfill({ headers, json: { ok: true } })
    return route.fulfill({
      headers,
      json: {
        ...publicShare,
        brief: {
          ...publicShare.brief,
          problem: `See https://example.com/${'A'.repeat(160)}`,
        },
        plan: {
          ...publicShare.plan,
          estimate: { value: '9 weeks', note: 'L'.repeat(160) },
          milestones: publicShare.plan.milestones.map((milestone, index) =>
            index === 0 ? { ...milestone, title: 'W'.repeat(160) } : milestone,
          ),
        },
        review: {
          requesterName,
          reviewerEmail: 'lena@example.com',
          dueDate: '2026-12-20',
          expiresAt: '2026-12-21T00:00:00Z',
          approvedCount: 0,
          totalSections: 2,
          revision: 'a'.repeat(64),
          sections: [
            { key: 'brief', label: 'Brief', revision: 'b'.repeat(64) },
            { key: 'milestones', label: 'Milestones', revision: 'c'.repeat(64) },
          ],
        },
      },
    })
  })
  await page.goto('/share/review-token?review=1')
  await expect(
    page.getByText(`${requesterName} asked you to review this plan`, { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve plan' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390)
})

test('integration settings fit at 390px with all controls reachable', async ({ page }) => {
  await page.route('http://localhost:8787/workspaces/northwind/integrations', (route) =>
    route.fulfill({
      headers,
      json: {
        configured: true,
        integration: {
          id: 'i1',
          provider: 'linear',
          name: 'Northwind',
          options: { pushMilestones: true, pullStatus: true, importIssues: false },
          statusMapping: {
            planning: 'todo',
            in_progress: 'started',
            completed: 'done',
            archived: 'canceled',
          },
          states: [
            { id: 'todo', name: 'Todo' },
            { id: 'started', name: 'In Progress' },
            { id: 'done', name: 'Done' },
            { id: 'canceled', name: 'Canceled' },
          ],
          lastSyncedAt: null,
        },
      },
    }),
  )
  await page.goto('/northwind/settings')
  await page.getByRole('tab', { name: 'Integrations' }).click()
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
  await expect(page.getByLabel('Archived Linear state')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('drift card and its review controls fit the plan at 390px', async ({ page }, testInfo) => {
  await mockDrift(page, projectId)
  await page.goto(`/northwind/projects/${projectId}/plan`)
  const card = page.getByRole('region', { name: 'The plan has drifted from the work' })
  await expect(card.getByRole('button', { name: 'Accept update' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('project-plan-drift-403-mobile.png') })
  await card.getByRole('button', { name: 'Review each' }).click()
  await expect(card.getByRole('button', { name: /^Reject M2/ }).first()).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390)
})

// Every state of every workspace screen, and the 404 page, fits 390px.
test('states and 404 do not overflow at 390px', async ({ page }) => {
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  for (const screen of screens) {
    for (const mode of ['empty', 'fail'] satisfies Mode[]) {
      await page.unrouteAll()
      await mockStates(page, screen.target, mode)
      await page.goto(screen.path)
      await expect(
        page.getByText(mode === 'empty' ? screen.empty : screen.error, { exact: true }),
      ).toBeVisible()
      expect(await overflow(), `${screen.name} ${mode}`).toBeLessThanOrEqual(0)
    }
  }
  // The brief's comment column is not shown at 390px, so its states are not checked here.
  for (const screen of projectScreens.filter((item) => item.name !== 'Brief comments')) {
    for (const mode of ['empty', 'fail'] satisfies Mode[]) {
      await page.unrouteAll()
      await mockStates(page, screen.target, mode)
      await page.goto(screen.path)
      await expect(
        mode === 'empty'
          ? page.getByText(screen.ok, { exact: true }).locator('visible=true').first()
          : page.getByRole('alert').filter({ hasText: screen.error }),
      ).toBeVisible()
      expect(await overflow(), `${screen.name} ${mode}`).toBeLessThanOrEqual(0)
    }
  }
  await page.unrouteAll()
  await mockSignedOut(page)
  await page.goto('/a/b/c/d')
  await expect(page.getByRole('heading', { name: "This page isn't on the plan" })).toBeVisible()
  expect(await overflow(), '404').toBeLessThanOrEqual(0)
})

test('Home project names stay readable at 390px', async ({ page }) => {
  await page.goto('/northwind')
  for (const name of [project.name, draftProject.name]) {
    const link = page.getByRole('link', { name, exact: true })
    await expect(link).toBeVisible()
    const box = await link.boundingBox()
    expect(box?.width).toBeGreaterThan(200)
    expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

for (const [name, path, heading] of [
  ['Home', '/northwind', 'Home'],
  ['My tasks', '/northwind/my-tasks', 'My tasks'],
  ['Inbox', '/northwind/inbox', 'Inbox'],
] as const)
  test(`workspace menu opens from ${name} and reaches Settings and Sign out`, async ({ page }) => {
    await page.route('http://localhost:8787/api/auth/sign-out', (route) =>
      route.fulfill({ headers, json: { success: true } }),
    )
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Workspace menu' })
    const box = await trigger.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL('/northwind/settings')
    await page.goto(path)
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/sign-in')
  })

test('Settings share links fit at 390px and Revoke is reachable', async ({ page }) => {
  await page.route('http://localhost:8787/workspaces/northwind/share-links', (route) =>
    route.fulfill({
      headers,
      json: {
        links: [
          {
            projectKey: 'PORTAL',
            projectName: 'Customer portal rebuild',
            createdBy: 'Maya Chen',
            createdAt: '2026-11-13T10:00:00.000Z',
            viewCount: 12,
          },
        ],
      },
    }),
  )
  await page.goto('/northwind/settings')
  const revoke = page.getByRole('button', { name: 'Revoke' })
  await expect(revoke).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const table = page.getByRole('table')
  expect(
    await table.evaluate(
      (el) => (el.parentElement?.scrollWidth ?? 0) <= (el.parentElement?.clientWidth ?? 0),
    ),
  ).toBe(true)
  const box = await revoke.boundingBox()
  expect(box && box.x + box.width <= 390).toBe(true)
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await expect(revoke).toBeEnabled()
})

for (const [name, path] of [
  ['Home', '/northwind'],
  ['Projects', '/northwind/projects'],
  ['My tasks', '/northwind/my-tasks'],
  ['Inbox', '/northwind/inbox'],
] as const)
  test(`a failed sign-out from the ${name} menu shows an error`, async ({ page }) => {
    await page.route('http://localhost:8787/api/auth/sign-out', (route) =>
      route.fulfill({ status: 500, headers, json: { message: 'x' } }),
    )
    await page.goto(path)
    await page.getByRole('button', { name: 'Workspace menu' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByText('Could not sign out. Try again.')).toBeVisible()
    await expect(page).toHaveURL(path)
  })
