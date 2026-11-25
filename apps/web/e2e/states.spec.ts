import { expect, test } from '@playwright/test'
import { mockSignedOut, mockStates, screens } from './states-fixture'

test.use({ viewport: { width: 1440, height: 900 } })

const notFound = { name: "This page isn't on the plan" }
const unknown = '/a/b/c/d'

for (const screen of screens) {
  test.describe(screen.name, () => {
    test('empty state', async ({ page }) => {
      await mockStates(page, screen.target, 'empty')
      await page.goto(screen.path)
      await expect(page.getByText(screen.empty, { exact: true })).toBeVisible()
    })

    test('loading skeleton, then content', async ({ page }) => {
      const { release } = await mockStates(page, screen.target, 'slow')
      await page.goto(screen.path)
      await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeVisible()
      release()
      await expect(page.getByText(screen.empty, { exact: true })).toBeVisible()
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
    })

    test('failed response shows Try again, which recovers', async ({ page }) => {
      const { state } = await mockStates(page, screen.target, 'fail')
      await page.goto(screen.path)
      await expect(page.getByText(screen.error, { exact: true })).toBeVisible()
      state.mode = 'empty'
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByText(screen.error, { exact: true })).toHaveCount(0)
      await expect(page.getByText(screen.empty, { exact: true })).toBeVisible()
    })
  })
}

test('Projects empty and error use the drawn copy', async ({ page }) => {
  const { state } = await mockStates(page, '/workspaces/northwind/projects', 'fail')
  await page.goto('/northwind/projects')
  await expect(
    page.getByText('Check your connection and try again. Nothing you changed was lost.'),
  ).toBeVisible()
  state.mode = 'empty'
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(
    page.getByText(
      'A project holds a brief, a plan, tasks and diagrams. Start from a template or a blank page.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' }).last()).toBeVisible()
})

test('Home empty tasks links to Projects', async ({ page }) => {
  await mockStates(page, '/workspaces/northwind/projects', 'empty')
  await page.goto('/northwind')
  await page.getByRole('button', { name: 'Browse projects' }).click()
  await expect(page).toHaveURL(/\/northwind\/projects$/)
})

test('404 signed out offers sign-in', async ({ page }) => {
  await mockSignedOut(page)
  await page.goto(unknown)
  await expect(page.getByRole('heading', notFound)).toBeVisible()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('404 signed in goes back to the workspace', async ({ page }) => {
  await mockStates(page, '/workspaces/northwind/projects', 'empty')
  await page.goto('/northwind/nope/deeper')
  await expect(page.getByRole('heading', notFound)).toBeVisible()
  await page.getByRole('button', { name: 'Go to Home' }).click()
  await expect(page).toHaveURL(/\/northwind$/)
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('a render crash shows the error state, not a blank page', async ({ page }) => {
  await mockStates(page, '/workspaces/northwind/projects', 'empty')
  // A malformed list makes the Home screen throw while rendering.
  await page.route('http://localhost:8787/workspaces/northwind/projects*', (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: { projects: [null] },
    }),
  )
  await page.goto('/northwind')
  await expect(page.getByRole('alert')).toContainText('Something went wrong')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('a failed /me is an error with Try again, not the landing page', async ({ page }) => {
  await mockSignedOut(page, 500)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Something went wrong')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})

test('an unreachable API on / is an error, not the landing page', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('a 401 on / still shows the landing page', async ({ page }) => {
  await mockSignedOut(page, 401)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
})
