import { expect, type Page, test } from '@playwright/test'

const defaults = [
  { type: 'mention', email: true, inApp: true },
  { type: 'assigned', email: true, inApp: true },
  { type: 'draft_ready', email: false, inApp: true },
  { type: 'drift', email: true, inApp: true },
  { type: 'weekly_summary', email: true, inApp: false },
]
async function mockAccount(page: Page, blocked = false) {
  let user = {
    id: 'maya',
    name: 'Maya Chen',
    email: 'maya@northwind.co',
    emailVerified: true,
    image: null as string | null,
    timezone: 'Europe/Berlin',
  }
  let settings = defaults.map((setting) => ({ ...setting }))
  let newEmail = ''
  let deleted = false
  const updates: unknown[] = []
  const workspace = {
    id: '1',
    name: 'Northwind',
    slug: 'northwind',
    role: 'owner',
    isPersonal: false,
  }
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me' && request.method() === 'PATCH') {
      const change = request.postDataJSON()
      updates.push(change)
      user = { ...user, ...change }
      return route.fulfill({ headers, json: { user } })
    }
    if (path === '/me' && request.method() === 'DELETE') {
      if (blocked)
        return route.fulfill({
          status: 409,
          headers,
          json: {
            error: 'Make someone else owner first',
            workspaces: [{ id: workspace.id, name: workspace.name, slug: workspace.slug }],
          },
        })
      deleted = true
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === '/me') return route.fulfill({ headers, json: { user, workspaces: [workspace] } })
    if (path === '/me/notification-settings' && request.method() === 'PUT') {
      settings = request.postDataJSON().settings
      return route.fulfill({ headers, json: { settings } })
    }
    if (path === '/me/notification-settings') return route.fulfill({ headers, json: { settings } })
    if (path === '/me/email/start') {
      newEmail = request.postDataJSON().email
      if (newEmail === 'taken@example.com')
        return route.fulfill({
          status: 409,
          headers,
          json: { error: 'That email is already in use' },
        })
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === '/me/email/verify') {
      if (request.postDataJSON().code !== '123456')
        return route.fulfill({ status: 400, headers, json: { error: 'That code is not correct' } })
      user = { ...user, email: newEmail }
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/projects')
      return route.fulfill({
        headers,
        json: {
          projects: [],
          counts: { all: 0, active: 0, mine: 0, starred: 0 },
          nextCursor: null,
        },
      })
    if (path === '/me/tasks')
      return route.fulfill({
        headers,
        json: { tasks: [], counts: { assigned: 0, created: 0, completed: 0 }, nextCursor: null },
      })
    if (path === '/inbox')
      return route.fulfill({ headers, json: { items: [], unreadCount: 0, nextCursor: null } })
    return route.fulfill({ headers, json: {} })
  })
  return { updates, settings: () => settings, deleted: () => deleted }
}

test.use({ viewport: { width: 1440, height: 900 } })
test('account menu opens profile, edits name and time zone, and saves notification settings together', async ({
  page,
}) => {
  const state = await mockAccount(page)
  await page.goto('/northwind')
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Account settings', exact: true }).click()
  await expect(page).toHaveURL(/\/northwind\/account$/)
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Save changes' })
  await expect(save).toBeDisabled()
  await page.screenshot({ path: '/tmp/feature14-account-505.png', fullPage: true })
  await page.getByLabel('Full name', { exact: true }).fill('Maya Cooper')
  await page.getByRole('combobox', { name: 'Time zone' }).selectOption('Asia/Tokyo')
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Someone mentions you: In app' }).uncheck()
  await save.click()
  await expect(save).toBeDisabled()
  expect(state.updates.at(-1)).toMatchObject({ name: 'Maya Cooper', timezone: 'Asia/Tokyo' })
  expect(state.settings().find((setting) => setting.type === 'mention')?.inApp).toBe(false)
  await expect(page.getByRole('tab', { name: 'Security' })).toHaveCount(0)
})

test('change email verifies a dev code and reports a taken email', async ({ page }) => {
  await mockAccount(page)
  await page.goto('/northwind/account')
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Change email' })
  await dialog.getByRole('textbox', { name: 'New email' }).fill('taken@example.com')
  await dialog.getByRole('button', { name: 'Send code' }).click()
  await expect(dialog.getByText('That email is already in use', { exact: true })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'New email' }).fill('maya@example.com')
  await dialog.getByRole('button', { name: 'Send code' }).click()
  for (const [index, digit] of [...'123456'].entries())
    await dialog.getByRole('textbox', { name: `Code digit ${index + 1}`, exact: true }).fill(digit)
  await dialog.getByRole('button', { name: 'Verify email' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
    'maya@example.com',
  )
})

test('account deletion explains ownership blockers', async ({ page }) => {
  await mockAccount(page, true)
  await page.goto('/northwind/account')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete account' })
  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  await expect(dialog.getByText('Make someone else owner first', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Northwind', { exact: true })).toBeVisible()
})

test('account deletion requires confirmation and returns to sign in', async ({ page }) => {
  const state = await mockAccount(page)
  await page.goto('/northwind/account')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete account' })
  const remove = dialog.getByRole('button', { name: 'Delete account', exact: true })
  await expect(remove).toBeDisabled()
  await dialog.getByRole('textbox').fill('delete')
  await remove.click()
  await expect(page).toHaveURL(/\/sign-in$/)
  expect(state.deleted()).toBe(true)
})
