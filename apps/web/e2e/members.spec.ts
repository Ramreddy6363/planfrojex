import { expect, test } from '@playwright/test'

test('owner can view members, invite people and update a role', async ({ page }) => {
  let editorRole = 'editor'
  let invited: unknown
  let removed = false
  let revoked = false
  let resent = false
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/me')
      return route.fulfill({
        json: {
          user: { id: 'owner', email: 'owner@example.com', emailVerified: true },
          workspaces: [
            { id: '1', name: 'Northwind', slug: 'northwind', role: 'owner', isPersonal: false },
          ],
        },
        headers,
      })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: {
          workspace: {
            id: '1',
            name: 'Northwind',
            slug: 'northwind',
            role: 'owner',
            isPersonal: false,
          },
        },
        headers,
      })
    if (path === '/workspaces/northwind/members' && request.method() === 'GET')
      return route.fulfill({
        json: {
          members: [
            {
              id: 'owner',
              name: 'Maya Chen',
              email: 'owner@example.com',
              image: null,
              role: 'owner',
            },
            ...(!removed
              ? [
                  {
                    id: 'editor',
                    name: 'Daniel',
                    email: 'daniel@example.com',
                    image: null,
                    role: editorRole,
                  },
                ]
              : []),
          ],
        },
        headers,
      })
    if (path === '/workspaces/northwind/members/editor' && request.method() === 'PATCH') {
      editorRole = request.postDataJSON().role
      return route.fulfill({ json: { ok: true }, headers })
    }
    if (path === '/workspaces/northwind/members/editor' && request.method() === 'DELETE') {
      removed = true
      return route.fulfill({ json: { ok: true }, headers })
    }
    if (path === '/workspaces/northwind/invites' && request.method() === 'GET')
      return route.fulfill({
        json: {
          invites: revoked
            ? []
            : [
                {
                  id: 'invite',
                  email: 'pending@example.com',
                  role: 'viewer',
                  invitedBy: 'Maya',
                  createdAt: '2026-11-01T00:00:00.000Z',
                  expiresAt: '2026-11-08T00:00:00.000Z',
                },
              ],
        },
        headers,
      })
    if (path === '/invites/invite/resend' && request.method() === 'POST') {
      resent = true
      return route.fulfill({ json: { ok: true }, headers })
    }
    if (path === '/invites/invite' && request.method() === 'DELETE') {
      revoked = true
      return route.fulfill({ json: { ok: true }, headers })
    }
    if (path === '/workspaces/northwind/invites' && request.method() === 'POST') {
      invited = request.postDataJSON()
      return route.fulfill({ status: 201, json: { created: 2 }, headers })
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' }, headers })
  })
  await page.goto('/northwind/members')
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  await expect(page.getByText('daniel@example.com')).toBeVisible()
  await page.getByLabel('Role for Daniel').selectOption('viewer')
  await expect(page.getByLabel('Role for Daniel')).toHaveValue('viewer')
  await page.getByRole('button', { name: 'Invite people' }).click()
  await page.getByLabel('Email addresses').fill('one@example.com, two@example.com')
  await page.getByLabel('Email addresses').press('Enter')
  await expect(page.getByRole('button', { name: 'Remove one@example.com' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove two@example.com' })).toBeVisible()
  await page.getByRole('button', { name: 'Send 2 invites' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(invited).toEqual({ emails: ['one@example.com', 'two@example.com'], role: 'editor' })
  await page.getByRole('button', { name: 'Resend' }).click()
  await expect.poll(() => resent).toBe(true)
  await page.getByRole('button', { name: 'Revoke' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke invitation' }).click()
  await expect(page.getByText('pending@example.com', { exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'Actions for Daniel' }).click()
  await page.getByRole('menuitem', { name: 'Remove member' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove member' }).click()
  await expect(page.getByText('daniel@example.com')).not.toBeVisible()
})

test('viewers see members without owner controls', async ({ page }) => {
  await page.route('http://localhost:8787/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    if (path === '/me')
      return route.fulfill({
        json: {
          user: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
          workspaces: [],
        },
        headers,
      })
    if (path === '/workspaces/northwind')
      return route.fulfill({
        json: {
          workspace: {
            id: '1',
            name: 'Northwind',
            slug: 'northwind',
            role: 'viewer',
            isPersonal: false,
          },
        },
        headers,
      })
    if (path === '/workspaces/northwind/members')
      return route.fulfill({
        json: {
          members: [
            {
              id: 'viewer',
              name: 'Kenji',
              email: 'viewer@example.com',
              image: null,
              role: 'viewer',
            },
          ],
        },
        headers,
      })
    return route.fulfill({ status: 404, json: {}, headers })
  })
  await page.goto('/northwind/members')
  await expect(page.getByText('viewer@example.com').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite people' })).toHaveCount(0)
  await expect(page.getByText('Pending invites')).toHaveCount(0)
  await expect(page.getByLabel('Role for Kenji')).toHaveCount(0)
})

test('members list shows loading and lets people retry after an error', async ({ page }) => {
  let requests = 0
  await page.route('http://localhost:8787/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = {
      'access-control-allow-origin': 'http://localhost:5199',
      'access-control-allow-credentials': 'true',
    }
    const workspace = {
      id: '1',
      name: 'Northwind',
      slug: 'northwind',
      role: 'viewer',
      isPersonal: false,
    }
    if (path === '/me')
      return route.fulfill({
        headers,
        json: {
          user: { id: 'viewer', email: 'viewer@example.com', emailVerified: true },
          workspaces: [workspace],
        },
      })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path === '/workspaces/northwind/members') {
      requests++
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (requests === 1)
        return route.fulfill({ headers, status: 500, json: { error: 'unavailable' } })
      return route.fulfill({
        headers,
        json: {
          members: [
            {
              id: 'viewer',
              name: 'Kenji',
              email: 'viewer@example.com',
              image: null,
              role: 'viewer',
            },
          ],
        },
      })
    }
    return route.fulfill({ headers, status: 404, json: {} })
  })
  await page.goto('/northwind/members')
  await expect(page.getByText('Loading members…')).toBeVisible()
  await expect(page.getByText('Couldn’t load members')).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('Kenji')).toBeVisible()
})
