import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1360 } })

const shared = {
  workspaceName: 'Northwind',
  sharedBy: 'Maya Chen',
  project: {
    name: 'Customer portal rebuild',
    status: 'in-progress',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    updatedAt: '2026-10-13T12:00:00Z',
  },
  brief: {
    problem:
      'Customers call support to update billing details, download invoices and add teammates. These three requests make up 38% of support tickets. We are replacing the legacy portal with a self-serve account area.',
    goals: ['account-related support tickets drop by 40% within two months of launch.'],
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
        title: 'Billing details and invoice download',
        status: 'planning',
        dueDate: '2026-11-21',
      },
      {
        code: 'M3',
        title: 'Teammate management and public launch',
        status: 'planning',
        dueDate: '2026-12-12',
      },
    ],
    estimate: { value: '9 weeks with 4 engineers and 1 designer', note: '' },
  },
  diagrams: [
    {
      name: 'Checkout flow',
      type: 'flowchart',
      scene: {
        nodes: [
          {
            type: 'rectangle',
            position: { x: 200, y: 0 },
            data: { label: 'Customer opens Billing' },
          },
          {
            type: 'rectangle',
            position: { x: 240, y: 102 },
            data: { label: 'Signed in?' },
          },
          {
            type: 'rectangle',
            position: { x: 65, y: 204 },
            data: { label: 'Show invoices and payment method' },
          },
          {
            type: 'rectangle',
            position: { x: 388, y: 204 },
            data: { label: 'Download PDF' },
          },
          {
            type: 'rectangle',
            position: { x: 235, y: 306 },
            data: { label: 'Update card' },
          },
          {
            type: 'rectangle',
            position: { x: 198, y: 408 },
            data: { label: 'Confirmation email sent' },
          },
        ],
        edges: [
          { source: 0, target: 1 },
          { source: 1, target: 2 },
          { source: 2, target: 3, sourceHandle: 'right', targetHandle: 'left' },
          { source: 2, target: 4 },
          { source: 4, target: 5 },
        ],
      },
    },
  ],
}

async function mockShare(page: import('@playwright/test').Page, body: unknown, status = 200) {
  const requests: string[] = []
  await page.route('http://localhost:8787/**', async (route) => {
    requests.push(new URL(route.request().url()).pathname)
    return route.fulfill({
      status,
      headers: { 'access-control-allow-origin': 'http://localhost:5199' },
      json: body,
    })
  })
  return requests
}

test('opens a signed-out read-only project with only public requests', async ({ page }) => {
  const requests = await mockShare(page, shared)
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: 'private-session',
      domain: 'localhost',
      path: '/',
    },
  ])
  const requestPromise = page.waitForRequest('http://localhost:8787/share/public-token')
  const document = await page.goto('/share/public-token')
  expect(document?.headers()['x-robots-tag']).toBe('noindex')
  expect(document?.headers()['referrer-policy']).toBe('no-referrer')
  await expect(page.getByRole('heading', { name: shared.project.name })).toBeVisible()
  await expect(page.getByText('Read-only link shared by Maya Chen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brief', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Checkout flow' })).toBeVisible()
  await expect(page.getByText('Customer opens Billing', { exact: true })).toBeVisible()
  await expect(page.getByText('Made with planfrojex')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toHaveCount(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('.react-flow__node.draggable')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Zoom out' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Fit diagram' })).toHaveCount(0)
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  expect(requests).toEqual(['/share/public-token'])
  const headers = (await requestPromise).headers()
  expect(headers.cookie).toBeUndefined()
  expect(headers.referer).toBeUndefined()
  await page.screenshot({ path: test.info().outputPath('public-share-601.png'), fullPage: true })
})

test('omits unshared sections and renders included tasks as text', async ({ page }) => {
  await mockShare(page, {
    workspaceName: shared.workspaceName,
    sharedBy: shared.sharedBy,
    project: { ...shared.project, leadName: null, targetDate: null },
    tasks: [{ key: 'PORT-31', title: 'Download invoices', status: 'done' }],
  })
  await page.goto('/share/tasks-token')
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
  await expect(page.getByText('PORT-31')).toBeVisible()
  await expect(page.getByText('Download invoices')).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()
  for (const name of ['Brief', 'Milestones', 'Checkout flow'])
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByText('Led by')).toHaveCount(0)
})

test('unknown, revoked and deleted links have the same plain unavailable page', async ({
  page,
}) => {
  const requests = await mockShare(page, { error: 'This link doesn’t work anymore' }, 404)
  for (const token of ['unknown', 'revoked', 'deleted']) {
    await page.goto(`/share/${token}`)
    await expect(
      page.getByRole('heading', { name: 'This link doesn’t work anymore' }),
    ).toBeVisible()
    await expect(page.getByText(shared.project.name)).toHaveCount(0)
    await expect(page.getByRole('navigation')).toHaveCount(0)
  }
  expect(requests).toEqual(['/share/unknown', '/share/revoked', '/share/deleted'])
})

test('shows a useful service error without exposing project content', async ({ page }) => {
  await mockShare(page, { error: 'Too many requests' }, 429)
  await page.goto('/share/rate-limited')
  await expect(page.getByRole('heading', { name: 'Please try again shortly' })).toBeVisible()
  await expect(page.getByText(shared.project.name)).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
})

test('shows a loading state without a session or project shell', async ({ page }) => {
  let release: (() => void) | undefined
  const response = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('http://localhost:8787/**', async (route) => {
    await response
    await route.fulfill({
      headers: { 'access-control-allow-origin': 'http://localhost:5199' },
      json: shared,
    })
  })
  await page.goto('/share/loading-token')
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  release?.()
  await expect(page.getByRole('heading', { name: shared.project.name })).toBeVisible()
})
