import { expect, test } from '@playwright/test'

const apiTemplates = [
  { id: 'blank', name: 'Blank project', description: 'Write the brief yourself', brief: '' },
  {
    id: 'saas',
    name: 'SaaS MVP',
    description: 'Accounts, billing, admin',
    brief: 'Describe the customer problem and the first useful release.',
  },
  {
    id: 'ml',
    name: 'ML product',
    description: 'Data pipeline, model, review',
    brief: 'Describe the problem, the available data, and how results will be reviewed.',
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    description: 'iOS and Android release',
    brief: 'Describe the people using the app and the problem it solves.',
  },
  {
    id: 'commerce',
    name: 'E-commerce',
    description: 'Catalog, cart, checkout',
    brief: 'Describe the shopping experience and customer problem.',
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Case studies, contact',
    brief: 'Describe the audience and the work to present.',
  },
]

async function mockSignedOut(page: import('@playwright/test').Page) {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({ status: 401, headers, json: { error: 'Sign in required' } })
    if (path === '/templates')
      return route.fulfill({ status: 401, headers, json: { error: 'Sign in required' } })
    return route.fulfill({ status: 404, headers, json: { error: 'not found' } })
  })
}

test('signed-out visitors see the landing page sections and correct links', async ({ page }) => {
  await mockSignedOut(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')

  await expect(page.getByRole('navigation').getByRole('img', { name: 'planfrojex' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Product', exact: true })).toHaveAttribute(
    'href',
    '#product',
  )
  await expect(page.getByRole('link', { name: 'Templates', exact: true })).toHaveAttribute(
    'href',
    '#templates',
  )
  await expect(page.getByRole('link', { name: 'Teams', exact: true })).toHaveAttribute(
    'href',
    '#teams',
  )
  await expect(
    page.getByRole('heading', { name: 'Plans your team actually follows.' }),
  ).toBeVisible()
  await expect(page.getByText(/It.s about the whole team agreeing on one\./)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Draft the plan. Keep the decisions.' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Draft a plan from the brief' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Draft a diagram' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Don.t plan twice\./ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What else can PlanFrojex do?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Start with the brief.' })).toBeVisible()
  await expect(
    page.getByText('Free for one person. Bring the team in when the plan is ready.').first(),
  ).toBeVisible()

  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute(
    'href',
    '/sign-in',
  )
  await expect(page.getByRole('link', { name: 'Get started' }).first()).toHaveAttribute(
    'href',
    '/sign-up',
  )
  await expect(page.getByRole('link', { name: 'Start planning free' }).first()).toHaveAttribute(
    'href',
    '/sign-up',
  )
  await expect(page.getByRole('link', { name: 'See a real plan' }).first()).toHaveAttribute(
    'href',
    '#product',
  )
  await expect(
    page.getByRole('link', {
      name: /Pricing|Example plan|Changelog|Help center|Careers|Press kit|newsletter/i,
    }),
  ).toHaveCount(0)
  await expect(page.getByText(/tracker sync|redraft one section|export/i)).toHaveCount(0)
  await expect(page.locator('html')).not.toContainText(/\bAI\b/i)

  const productPreview = page.getByRole('region', { name: 'PlanFrojex product preview' })
  await productPreview.getByRole('tab', { name: 'Tasks 42' }).dispatchEvent('click')
  await expect(productPreview.getByRole('heading', { name: 'Requirements' })).toBeVisible()
  await expect(
    productPreview.getByText('The project brief, work and history stay connected in one place.'),
  ).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('landing-801-desktop.png'), fullPage: true })

  await page.getByRole('link', { name: 'Sign in' }).first().click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await page.goto('/')
  await mockSignedOut(page)
  await page.getByRole('link', { name: 'Start planning free' }).first().click()
  await expect(page).toHaveURL(/\/sign-up$/)
})

test('template category tabs filter the real built-in template list', async ({ page }) => {
  await mockSignedOut(page)
  await page.goto('/#templates')
  const grid = page.getByRole('region', { name: 'Templates' })
  await expect(grid.getByRole('heading', { name: 'Blank project' })).toBeVisible()
  await expect(grid.locator('article')).toHaveCount(6)

  await grid.getByRole('tab', { name: 'Product' }).click()
  await expect(grid.locator('article')).toHaveCount(3)
  await expect(grid.getByRole('heading', { name: 'SaaS MVP' })).toBeVisible()
  await expect(grid.getByRole('heading', { name: 'ML product' })).toBeVisible()
  await expect(grid.getByRole('heading', { name: 'Mobile app' })).toHaveCount(0)

  await grid.getByRole('tab', { name: 'Mobile' }).click()
  await expect(grid.locator('article')).toHaveCount(1)
  await expect(grid.getByRole('heading', { name: 'Mobile app' })).toBeVisible()

  await grid.getByRole('tab', { name: 'All' }).click()
  await expect(grid.locator('article')).toHaveCount(6)
})

test('public template cards and the New project picker use the same catalog', async ({ page }) => {
  await mockSignedOut(page)
  await page.goto('/#templates')
  const landingCards = page.getByRole('region', { name: 'Templates' }).locator('article h3')
  await expect(landingCards).toHaveCount(apiTemplates.length)
  const landingNames = await landingCards.allTextContents()

  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'owner', email: 'owner@example.com', emailVerified: true },
          workspaces: [{ id: '1', name: 'Northwind', slug: 'northwind', role: 'owner' }],
        },
      })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        headers,
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
      })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [],
          counts: { all: 0, active: 0, mine: 0, starred: 0 },
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
    if (path === '/templates') return route.fulfill({ headers, json: { templates: apiTemplates } })
    return route.fulfill({ status: 404, headers, json: {} })
  })
  await page.goto('/northwind/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  const picker = page
    .getByRole('dialog', { name: 'New project' })
    .getByRole('region', { name: 'Start from' })
  await expect(picker.locator('button span.flex > span:first-child')).toHaveText(landingNames)
})

test('landing stays public when the identity endpoint is unavailable', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({ status: 503, headers, json: { error: 'Unavailable' } })
    if (path === '/templates')
      return route.fulfill({ status: 401, headers, json: { error: 'Sign in required' } })
    return route.fulfill({ status: 404, headers, json: {} })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Plans your team actually follows.' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute(
    'href',
    '/sign-in',
  )
  await expect(page.getByRole('link', { name: 'Get started' }).first()).toHaveAttribute(
    'href',
    '/sign-up',
  )
})

test('signed-in visitors still enter their workspace from /', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'owner', email: 'owner@example.com', emailVerified: true },
          workspaces: [{ id: '1', name: 'Northwind', slug: 'northwind', role: 'owner' }],
        },
      })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        headers,
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
      })
    return route.fulfill({ status: 404, headers, json: {} })
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/northwind$/)
})

test('landing has no horizontal overflow at 1440px', async ({ page }) => {
  await mockSignedOut(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

test('tablet product preview tabs fit at 768px', async ({ page }) => {
  await mockSignedOut(page)
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/')
  const preview = page.getByRole('region', { name: 'PlanFrojex product preview' })
  const tabStrip = await preview.getByRole('tablist').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(tabStrip.scrollWidth).toBeLessThanOrEqual(tabStrip.clientWidth)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768)
})
