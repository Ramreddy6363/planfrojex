import { expect, type Page, test } from '@playwright/test'
import { headers, mockSignedOut, mockStates, projectScreens, screens } from './states-fixture'

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

for (const screen of projectScreens) {
  test.describe(`${screen.name} (${screen.path.split('?')[0]})`, () => {
    const ok = (page: Page) => page.getByText(screen.ok, { exact: true }).first()

    test('loading skeleton, then content', async ({ page }) => {
      const { release } = await mockStates(page, screen.target, 'slow')
      await page.goto(screen.path)
      await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeVisible()
      release()
      await expect(ok(page)).toBeVisible()
    })

    test('failed response shows an alert with Try again, which recovers', async ({ page }) => {
      const { state } = await mockStates(page, screen.target, 'fail')
      await page.goto(screen.path)
      await expect(page.getByRole('alert').filter({ hasText: screen.error })).toBeVisible()
      state.mode = 'empty'
      await page.getByRole('button', { name: 'Try again' }).first().click()
      await expect(page.getByRole('alert').filter({ hasText: screen.error })).toHaveCount(0)
      await expect(ok(page)).toBeVisible()
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

test('404 with a failing /me shows the error state, not Sign in, and recovers', async ({
  page,
}) => {
  const { state } = await mockStates(page, '/workspaces/northwind/projects', 'empty')
  state.meFails = true
  await page.goto('/a/b/c/d')
  await expect(page.getByRole('heading', notFound)).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Couldn’t check your sign-in')
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  state.meFails = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: 'Go to Home' })).toBeVisible()
})

test('a render crash shows the error state, and Try again loads the app', async ({ page }) => {
  await mockStates(page, '/workspaces/northwind/projects', 'empty')
  let broken = true
  // A malformed list makes the Home screen throw while rendering.
  await page.route('http://localhost:8787/workspaces/northwind/projects*', (route) =>
    route.fulfill({ headers, json: { projects: broken ? [null] : [] } }),
  )
  await page.goto('/northwind')
  await expect(page.getByRole('alert')).toContainText('Something went wrong')
  broken = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('a failed /me is an error with Try again, and recovery enters the app', async ({ page }) => {
  const { state } = await mockStates(page, '/workspaces/northwind/projects', 'empty')
  state.meFails = true
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Something went wrong')
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  state.meFails = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('a failed /me that comes back signed out then shows the landing page', async ({ page }) => {
  const { state } = await mockSignedOut(page, 500)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  state.status = 401
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
})

test('an unreachable API on / is an error, and Try again loads the app once it is back', async ({
  page,
}) => {
  await page.route('http://localhost:8787/**', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Something went wrong')
  await page.unrouteAll()
  await mockStates(page, '/workspaces/northwind/projects', 'empty')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('a 401 on / still shows the landing page', async ({ page }) => {
  await mockSignedOut(page, 401)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
})

test('Home lists real assigned tasks instead of the empty copy', async ({ page }) => {
  await mockStates(page, '/workspaces/northwind/projects', 'empty')
  await page.route('http://localhost:8787/me/tasks*', (route) =>
    route.fulfill({
      headers,
      json: {
        tasks: [
          {
            id: 't1',
            key: 'PORT-1',
            title: 'Write acceptance criteria',
            projectName: 'Customer portal',
          },
        ],
        counts: { assigned: 1, created: 0, completed: 0 },
        nextCursor: null,
      },
    }),
  )
  await page.goto('/northwind')
  await expect(page.getByText('Write acceptance criteria')).toBeVisible()
  await expect(page.getByText('Nothing assigned to you')).toHaveCount(0)
  await page.getByRole('link', { name: 'View all my tasks' }).click()
  await expect(page).toHaveURL(/\/northwind\/my-tasks$/)
})

test('public share: loading skeleton, then a failed load offers Try again', async ({ page }) => {
  let status = 500
  await page.route('http://localhost:8787/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    await new Promise((r) => setTimeout(r, 400))
    return route.fulfill({ status, headers, json: { error: 'x' } })
  })
  await page.goto(`/share/${'ab'.repeat(32)}`)
  await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  status = 404
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'This link doesn’t work anymore' })).toBeVisible()
})
