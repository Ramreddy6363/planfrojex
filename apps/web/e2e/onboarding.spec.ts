import { expect, test } from '@playwright/test'

const signedInUser = { id: '1', email: 'test@example.com', emailVerified: true }

test('signs in with a code and creates a personal workspace', async ({ page }) => {
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/auth/email-otp/send-verification-otp')
      return route.fulfill({ json: { success: true }, headers })
    if (path === '/api/auth/sign-in/email-otp')
      return route.fulfill({
        json: {
          token: 'session',
          user: { id: '1', name: 'Test', email: 'test@example.com', emailVerified: true },
        },
        headers,
      })
    if (path === '/me')
      return route.fulfill({ json: { user: signedInUser, workspaces: [] }, headers })
    if (path === '/workspaces' && request.method() === 'POST')
      return route.fulfill({
        status: 201,
        json: { workspace: { name: 'My space', slug: 'my-space' } },
        headers,
      })
    if (path === '/workspaces/my-space')
      return route.fulfill({
        json: { workspace: { name: 'My space', slug: 'my-space', role: 'owner' } },
        headers,
      })
    return route.fulfill({ status: 404, json: { error: 'Not found' }, headers })
  })
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: true }).fill('test@example.com')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.getByLabel('Code digit 1').fill('123456')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('heading', { name: 'How will you use PlanFrojex?' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('displayName'))).toBe('Test')
  await page.getByRole('button', { name: 'Just me' }).click()
  await page.getByLabel('Name your space').fill('My space')
  await page.getByRole('button', { name: 'Start planning' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('an invitee signs in and joins the invited workspace', async ({ page }) => {
  let signedIn = false
  const token = 'ab'.repeat(32)
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn ? { user: signedInUser, workspaces: [] } : { error: 'Sign in required' },
        headers,
      })
    if (path === '/api/auth/email-otp/send-verification-otp')
      return route.fulfill({ json: { success: true }, headers })
    if (path === '/api/auth/sign-in/email-otp') {
      signedIn = true
      return route.fulfill({
        json: {
          token: 'session',
          user: { id: '2', name: 'Invitee', email: 'invitee@example.com', emailVerified: true },
        },
        headers,
      })
    }
    if (path === '/invites/accept') {
      expect(request.postDataJSON()).toEqual({ token })
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind' } },
        headers,
      })
    }
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'editor' } },
        headers,
      })
    return route.fulfill({ status: 404, json: { error: 'Not found' }, headers })
  })
  await page.goto(`/invite/${token}`)
  await expect(page.getByRole('heading', { name: 'Sign in to PlanFrojex' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill('invitee@example.com')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByLabel('Code digit 1').fill('123456')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('sign-up collects a name and passes it when verifying the code', async ({ page }) => {
  let verifiedName = ''
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/auth/email-otp/send-verification-otp')
      return route.fulfill({ json: { success: true }, headers })
    if (path === '/api/auth/sign-in/email-otp') {
      verifiedName = request.postDataJSON().name
      return route.fulfill({
        json: {
          token: 'session',
          user: { id: '1', name: verifiedName, email: 'jo@example.com', emailVerified: true },
        },
        headers,
      })
    }
    if (path === '/me') return route.fulfill({ json: { workspaces: [] }, headers })
    return route.fulfill({ status: 404, json: { error: 'Not found' }, headers })
  })
  await page.goto('/sign-up')
  await page.getByLabel('Full name').fill('Jo Smith')
  await page.getByLabel('Work email').fill('jo@example.com')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByLabel('Code digit 1').fill('123456')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('heading', { name: 'How will you use PlanFrojex?' })).toBeVisible()
  expect(verifiedName).toBe('Jo Smith')
})

test('an expired invitation can be dismissed so sign-in can continue', async ({ page }) => {
  await page.route('http://localhost:8787/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me') return route.fulfill({ json: { workspaces: [] }, headers })
    if (path === '/invites/accept')
      return route.fulfill({ status: 400, json: { error: 'Invitation expired' }, headers })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto(`/invite/${'ab'.repeat(32)}`)
  await expect(page.getByRole('alert')).toContainText('This invitation is invalid, has expired')
  await page.getByRole('button', { name: 'Continue without invitation' }).click()
  await expect(page.getByRole('heading', { name: 'How will you use PlanFrojex?' })).toBeVisible()
})

test('creates a team workspace and invites two teammates', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('displayName', 'Maya Chen'))
  let invitations: unknown
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({ json: { user: signedInUser, workspaces: [] }, headers })
    if (path === '/workspaces' && request.method() === 'POST')
      return route.fulfill({
        status: 201,
        json: { workspace: { name: 'Northwind', slug: 'northwind' } },
        headers,
      })
    if (path === '/workspaces/northwind/invites') {
      invitations = request.postDataJSON()
      return route.fulfill({ status: 201, json: { created: 2 }, headers })
    }
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind', role: 'owner' } },
        headers,
      })
    return route.fulfill({ status: 404, json: { error: 'Not found' }, headers })
  })
  await page.goto('/onboarding')
  await page.getByRole('button', { name: 'With a team' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Workspace name').fill('Northwind')
  await expect(page.getByText('Step 1 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Step 2 of 2')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Workspace preview' })).toContainText('Maya Chen')
  await page.getByLabel('Email addresses').fill('one@example.com, two@example.com')
  await expect(page.getByRole('region', { name: 'Workspace preview' })).toContainText(
    'one@example.com',
  )
  await page.getByRole('button', { name: 'Send 2 invites' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  expect(invitations).toEqual({ emails: ['one@example.com', 'two@example.com'], role: 'editor' })
})

test('redirects signed-out visitors from a workspace to sign-in', async ({ page }) => {
  await page.route('http://localhost:8787/workspaces/northwind', (route) =>
    route.fulfill({
      status: 401,
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: { error: 'Sign in required' },
    }),
  )
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Sign in to PlanFrojex' })).toBeVisible()
})

test('creates a unique personal workspace for a short name', async ({ page }) => {
  const slugs: string[] = []
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({ json: { user: signedInUser, workspaces: [] }, headers })
    if (path === '/workspaces' && request.method() === 'POST') {
      const slug = request.postDataJSON().slug as string
      slugs.push(slug)
      if (slugs.length === 1)
        return route.fulfill({ status: 409, json: { error: 'taken' }, headers })
      return route.fulfill({ status: 201, json: { workspace: { name: 'Jo', slug } }, headers })
    }
    if (path === '/workspaces/jo-space-2')
      return route.fulfill({ json: { workspace: { name: 'Jo', slug: 'jo-space-2' } }, headers })
    return route.fulfill({ status: 404, json: { error: 'Not found' }, headers })
  })
  await page.goto('/onboarding')
  await page.getByLabel('Name your space').fill('Jo')
  await page.getByRole('button', { name: 'Start planning' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  expect(slugs).toEqual(['jo-space', 'jo-space-2'])
})

test('shows the no-access state for another workspace', async ({ page }) => {
  await page.route('http://localhost:8787/me', (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: { user: { email: 'other@example.com' }, workspaces: [] },
    }),
  )
  await page.route('http://localhost:8787/workspaces/private', (route) =>
    route.fulfill({
      status: 404,
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: { error: 'Workspace not found' },
    }),
  )
  await page.goto('/private')
  await expect(
    page.getByRole('heading', { name: "You don't have access to this workspace" }),
  ).toBeVisible()
  await expect(page.getByText('Signed in as other@example.com')).toBeVisible()
})

test('shows the selected onboarding choice', async ({ page }) => {
  await page.goto('/onboarding')
  const personal = page.getByRole('button', { name: 'Just me' })
  const team = page.getByRole('button', { name: 'With a team' })
  await expect(personal).toHaveAttribute('aria-pressed', 'true')
  expect(await personal.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    await team.evaluate((element) => getComputedStyle(element).backgroundColor),
  )
  await team.click()
  await expect(team).toHaveAttribute('aria-pressed', 'true')
  expect(await team.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    await personal.evaluate((element) => getComputedStyle(element).backgroundColor),
  )
})

test('workspace preview follows a custom workspace URL', async ({ page }) => {
  await page.goto('/onboarding/workspace')
  await page.getByLabel('Workspace name').fill('Northwind')
  await page.getByLabel('URL', { exact: true }).fill('custom-team')
  await expect(page.getByRole('region', { name: 'Workspace preview' })).toContainText(
    'planfrojex.app/custom-team',
  )
})

test('a server error on a workspace shows a retry, not no-access', async ({ page }) => {
  let fail = true
  await page.route('http://localhost:8787/me', (route) =>
    route.fulfill({
      json: { user: signedInUser, workspaces: [] },
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
    }),
  )
  await page.route('http://localhost:8787/workspaces/northwind', (route) =>
    route.fulfill({
      status: fail ? 500 : 200,
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: fail ? { error: 'boom' } : { workspace: { name: 'Northwind', slug: 'northwind' } },
    }),
  )
  await page.goto('/northwind')
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  await expect(page.getByText("You don't have access")).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('a wrong code clears the boxes and explains how to retry', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('email', 'maya@example.com'))
  let sent = 0
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/api/auth/sign-in/email-otp')
      return route.fulfill({
        status: 400,
        json: { code: 'INVALID_OTP', message: 'Invalid OTP' },
        headers,
      })
    if (path === '/api/auth/email-otp/send-verification-otp') {
      sent++
      return route.fulfill({ json: { success: true }, headers })
    }
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/verify')
  const codeBox = await page.getByLabel('Code digit 1').boundingBox()
  expect(codeBox?.height).toBeGreaterThanOrEqual(48)
  await page.getByLabel('Code digit 1').fill('123456')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('alert')).toContainText('That code didn’t work')
  await expect(page.getByLabel('Code digit 1')).toHaveValue('')
  await expect(page.getByLabel('Code digit 6')).toHaveValue('')
  await expect(page.getByText("Didn't get it?")).toBeVisible()
  await page.getByRole('button', { name: 'Send a new code' }).click()
  expect(sent).toBe(1)
  await expect(page.getByRole('link', { name: 'Use a different email' })).toBeVisible()
})

test('onboarding shows the signed-in email and keeps the URL prefix inside its field', async ({
  page,
}) => {
  await page.route('http://localhost:8787/me', (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
      },
      json: { user: { email: 'maya@example.com' }, workspaces: [] },
    }),
  )
  await page.goto('/onboarding')
  await expect(page.getByRole('banner')).toContainText('maya@example.com')
  await expect(page.getByRole('progressbar', { name: 'Onboarding steps' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  )
  await page.goto('/onboarding/workspace')
  const prefix = await page.getByText('planfrojex.app/', { exact: true }).boundingBox()
  const field = await page.getByRole('group', { name: 'Workspace URL' }).boundingBox()
  if (!prefix || !field) throw new Error('Workspace URL field is missing')
  expect(prefix.x).toBeGreaterThanOrEqual(field.x)
  expect(prefix.y).toBeGreaterThanOrEqual(field.y)
  expect(prefix.y + prefix.height).toBeLessThanOrEqual(field.y + field.height)
})

test('the invite preview shows the owner by name with two-letter initials', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('email', 'maya@northwind.co')
    sessionStorage.setItem('displayName', 'Maya Chen')
    sessionStorage.setItem(
      'onboardingWorkspace',
      JSON.stringify({ name: 'Northwind', slug: 'northwind' }),
    )
  })
  await page.goto('/onboarding/invite')
  const preview = page.getByRole('region', { name: 'Workspace preview' })
  await expect(preview.getByRole('img', { name: 'Maya Chen' })).toHaveText('MC')
  await expect(preview).toContainText('Maya Chen')
  await expect(preview).not.toContainText('maya@northwind.co')
})

test('a wrong code clears the boxes, refocuses digit 1 and marks them invalid', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('email', 'a@b.co'))
  await page.route('http://localhost:8787/**', (route) =>
    route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 400,
      json: { code: 'INVALID_OTP', message: 'Invalid OTP' },
      headers: {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type',
      },
    }),
  )
  await page.goto('/verify')
  await page.getByLabel('Code digit 1').fill('000000')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toHaveText('That code didn’t work. Check it and try again.')
  const id = await alert.getAttribute('id')
  expect(id).toBeTruthy()
  for (let digit = 1; digit <= 6; digit++) {
    const box = page.getByLabel(`Code digit ${digit}`)
    await expect(box).toHaveValue('')
    await expect(box).toHaveAttribute('aria-invalid', 'true')
    await expect(box).toHaveAttribute('aria-describedby', id as string)
  }
  await expect(page.getByLabel('Code digit 1')).toBeFocused()
})

test('a failed sign-out stays on the workspace and says so', async ({ page }) => {
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({ json: { user: signedInUser, workspaces: [] }, headers })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: { workspace: { name: 'Northwind', slug: 'northwind' } },
        headers,
      })
    if (path === '/api/auth/sign-out')
      return route.fulfill({ status: 500, json: { message: 'internal' }, headers })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/northwind')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('alert')).toHaveText('Could not sign out. Try again.')
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
})

test('a link in the workspace name gets a plain message', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (new URL(route.request().url()).pathname === '/workspaces')
      return route.fulfill({ status: 400, json: { error: 'Invalid workspace details' }, headers })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/onboarding/workspace')
  await page.getByLabel('Workspace name').fill('Win at www.prizes.example')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('can’t contain links')
})
