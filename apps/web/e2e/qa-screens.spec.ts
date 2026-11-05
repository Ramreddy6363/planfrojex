import { expect, type Page, test } from '@playwright/test'

const OUT =
  '/tmp/claude-1001/-home-ramreddey-Documents-personal-planforjex/8ac40bf8-0c66-4311-8f13-0d94b986b00f/scratchpad/qa1/final/'
const H = {
  'access-control-allow-origin': 'http://localhost:5199',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
type Mock = Record<string, { status?: number; json: unknown }>
async function mock(page: Page, m: Mock) {
  await page.route('http://localhost:8787/**', (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H })
    const hit = m[new URL(r.url()).pathname]
    return route.fulfill({
      status: hit ? (hit.status ?? 200) : 404,
      json: hit?.json ?? {},
      headers: H,
    })
  })
}
const shot = (page: Page, n: string) => page.screenshot({ path: `${OUT}${n}.png` })
test.use({ viewport: { width: 1440, height: 900 } })
const seed = (page: Page) =>
  page.addInitScript(() => {
    sessionStorage.setItem('email', 'maya@northwind.co')
    sessionStorage.setItem(
      'onboardingWorkspace',
      JSON.stringify({ name: 'Northwind', slug: 'northwind' }),
    )
  })

test('shots auth', async ({ page }) => {
  await seed(page)
  await mock(page, { '/me': { status: 401, json: {} } })
  for (const [p, n] of [
    ['/sign-in', '201-sign-in'],
    ['/sign-up', '202-sign-up'],
    ['/verify', '203-verify'],
  ] as [string, string][]) {
    await page.goto(p)
    await page.getByRole('heading').waitFor()
    await shot(page, n)
  }
})
test('shots onboarding', async ({ page }) => {
  await seed(page)
  await mock(page, { '/me': { json: { user: { email: 'maya@northwind.co' }, workspaces: [] } } })
  await page.goto('/onboarding')
  await page.getByLabel('Name your space').fill("Maya's projects")
  await shot(page, '204-onboarding')
  await page.goto('/onboarding/workspace')
  await page.getByLabel('Workspace name').fill('Northwind')
  await shot(page, '205-workspace')
  await page.goto('/onboarding/invite')
  await page
    .getByLabel('Email addresses')
    .fill('daniel@northwind.co, priya@northwind.co, tom@northwind.co')
  await shot(page, '206-invite')
})
test('shots states', async ({ page }) => {
  await mock(page, {
    '/me': { json: { user: { email: 'kenji@northwind.co' }, workspaces: [] } },
    '/workspaces/private': { status: 404, json: { error: 'x' } },
    '/workspaces/boom': { status: 500, json: { error: 'x' } },
    '/invites/accept': { status: 400, json: { error: 'Invitation expired' } },
    '/workspaces': { status: 409, json: { error: 'Slug taken' } },
    '/api/auth/sign-in/email-otp': {
      status: 400,
      json: { message: 'Invalid OTP', code: 'INVALID_OTP' },
    },
  })
  await page.goto('/private')
  await page.getByRole('heading').waitFor()
  await shot(page, '506-no-access')
  await page.goto('/boom')
  await page.getByRole('heading').waitFor()
  await shot(page, 'load-error')
  await page.goto('/invite/' + 'ab'.repeat(32))
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, 'invite-invalid')
  await seed(page)
  await page.goto('/onboarding/workspace')
  await page.getByLabel('Workspace name').fill('Northwind')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, 'slug-taken')
  await page.goto('/verify')
  await page.getByLabel('Code digit 1').fill('000000')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, 'wrong-code')
  const after = await page.evaluate(() => ({
    focus: document.activeElement?.getAttribute('aria-label'),
    d1: (document.querySelector('[aria-label="Code digit 1"]') as HTMLInputElement).value,
    invalid: document.querySelector('[aria-invalid="true"]') !== null,
  }))
  expect(after, 'code state after wrong code').toEqual({
    focus: 'Code digit 1',
    d1: '',
    invalid: true,
  })
})
test('keyboard path', async ({ page }) => {
  await mock(page, {
    '/me': { json: { workspaces: [] } },
    '/api/auth/email-otp/send-verification-otp': { json: { success: true } },
    '/api/auth/sign-in/email-otp': {
      json: { token: 't', user: { id: '1', name: 'a', email: 'a@b.co', emailVerified: true } },
    },
  })
  await page.goto('/sign-in')
  await page.getByRole('heading').waitFor()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
  await page.keyboard.type('a@b.co')
  await shot(page, 'kbd-focus-email')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.getByLabel('Code digit 1').focus()
  await page.keyboard.type('123456')
  await expect(page.getByLabel('Code digit 6')).toBeFocused()
  await shot(page, 'kbd-code')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'How will you use PlanFrojex?' })).toBeVisible()
})
test('rule7 text scan', async ({ page }) => {
  await mock(page, { '/me': { json: { workspaces: [] } } })
  for (const p of [
    '/sign-in',
    '/sign-up',
    '/verify',
    '/onboarding',
    '/onboarding/workspace',
    '/onboarding/invite',
  ]) {
    await page.goto(p)
    const t = await page.evaluate(
      () =>
        document.body.innerText +
        [...document.querySelectorAll('*')]
          .map((e) => getComputedStyle(e).backgroundImage)
          .join(' '),
    )
    expect(t, p).not.toMatch(/\bAI\b|gradient/)
    expect(t, p).not.toMatch(/\p{Extended_Pictographic}/u)
  }
})
