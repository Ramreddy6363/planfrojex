import { expect, type Page, test } from '@playwright/test'

async function mockSettings(page: Page, role = 'owner', hasNext = true, isPersonal = false) {
  let workspace = { id: '1', name: 'Northwind', slug: 'northwind', role, isPersonal }
  const next = { id: '2', name: 'Personal space', slug: 'maya', role: 'owner', isPersonal: true }
  let deleted = false
  const changes: Record<string, string>[] = []
  let confirmed = ''
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'maya', name: 'Maya Chen', email: 'maya@example.com', emailVerified: true },
          workspaces: [...(deleted ? [] : [workspace]), ...(hasNext ? [next] : [])],
        },
      })
    if (path === `/workspaces/${workspace.slug}` && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, string>
      changes.push(body)
      if (body.slug === 'taken')
        return route.fulfill({ headers, status: 409, json: { error: 'That URL is taken' } })
      workspace = { ...workspace, ...body }
      return route.fulfill({ headers, json: { workspace } })
    }
    if (path === `/workspaces/${workspace.slug}` && request.method() === 'DELETE') {
      confirmed = request.postDataJSON().confirm
      deleted = true
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === `/workspaces/${workspace.slug}`)
      return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/maya') return route.fulfill({ headers, json: { workspace: next } })
    if (/\/workspaces\/[^/]+\/projects$/.test(path))
      return route.fulfill({
        headers,
        json: {
          projects: [],
          counts: { all: 8, active: 0, mine: 0, starred: 0 },
          nextCursor: null,
        },
      })
    if (path.endsWith('/share-links')) return route.fulfill({ headers, json: { links: [] } })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 0, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === '/inbox')
      return route.fulfill({ headers, json: { items: [], unreadCount: 0, nextCursor: null } })
    return route.fulfill({ headers, status: 404, json: { error: 'Not found' } })
  })
  return { changes, confirm: () => confirmed }
}

test.use({ viewport: { width: 1440, height: 900 } })
test('owner edits the workspace name and URL, sees taken URL inline, and lands at the new URL', async ({
  page,
}) => {
  const state = await mockSettings(page)
  await page.goto('/northwind')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/northwind\/settings$/)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No share links yet' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Save changes' })
  await expect(save).toBeDisabled()
  await page.screenshot({ path: '/tmp/feature13-settings-503.png', fullPage: true })
  await page.getByLabel('Workspace name', { exact: true }).fill('Northwind Studio')
  await page.getByRole('textbox', { name: 'Workspace URL', exact: true }).fill('taken')
  await save.click()
  await expect(page.getByText('That URL is taken', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Workspace URL', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await page.getByRole('textbox', { name: 'Workspace URL', exact: true }).fill('northwind-studio')
  await save.click()
  await expect(page).toHaveURL(/\/northwind-studio\/settings$/)
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue('Northwind Studio')
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: 'Switch workspace' }).click()
  await expect(page.getByRole('menuitem', { name: 'Northwind Studio' })).toBeVisible()
  expect(state.changes.at(-1)).toEqual({ name: 'Northwind Studio', slug: 'northwind-studio' })
})

test('owner confirms the actual name and project count before delete, then moves to the next workspace', async ({
  page,
}) => {
  const state = await mockSettings(page)
  await page.goto('/northwind/settings')
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' })
  await expect(dialog.getByText(/8 projects/)).toBeVisible()
  const remove = dialog.getByRole('button', { name: 'Delete workspace', exact: true })
  await expect(remove).toBeDisabled()
  await dialog.getByRole('textbox').fill('wrong')
  await expect(remove).toBeDisabled()
  await dialog.getByRole('textbox').fill('Northwind')
  await remove.click()
  await expect(page).toHaveURL(/\/maya$/)
  expect(state.confirm()).toBe('Northwind')
})

test('deleting the last workspace opens onboarding', async ({ page }) => {
  await mockSettings(page, 'owner', false)
  await page.goto('/northwind/settings')
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' })
  await dialog.getByRole('textbox').fill('Northwind')
  await dialog.getByRole('button', { name: 'Delete workspace', exact: true }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
})

for (const role of ['editor', 'viewer']) {
  test(`${role} reads General without editing or deletion controls`, async ({ page }) => {
    await mockSettings(page, role)
    await page.goto('/northwind/settings')
    await expect(page.getByLabel('Workspace name', { exact: true })).toHaveAttribute('readonly', '')
    await expect(page.getByRole('textbox', { name: 'Workspace URL', exact: true })).toHaveAttribute(
      'readonly',
      '',
    )
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete workspace' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'No share links yet' })).toBeVisible()
  })
}

test('personal workspace owner cannot see deletion controls', async ({ page }) => {
  await mockSettings(page, 'owner', true, true)
  await page.goto('/northwind/settings')
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete workspace' })).toHaveCount(0)
})
