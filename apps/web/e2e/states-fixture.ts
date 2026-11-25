import type { Page } from '@playwright/test'

export type Mode = 'empty' | 'slow' | 'fail'
export type Screen = {
  name: string
  path: string
  target: string
  empty: string
  error: string
}

const workspace = {
  id: 'w1',
  name: 'Northwind',
  slug: 'northwind',
  role: 'owner',
  isPersonal: false,
}
const user = { id: 'owner', name: 'Maya Chen', email: 'maya@example.com', emailVerified: true }
const headers = {
  'access-control-allow-origin': 'http://localhost:5199',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const none = {
  projects: [],
  tasks: [],
  items: [],
  members: [],
  invites: [],
  nextCursor: null,
  unreadCount: 0,
  counts: { all: 0, mine: 0, starred: 0, active: 0, assigned: 0, created: 0, completed: 0 },
}

// One row per workspace screen: its main list endpoint, and the empty and error titles it must show.
export const screens: Screen[] = [
  {
    name: 'Home',
    path: '/northwind',
    target: '/workspaces/northwind/projects',
    empty: 'Nothing assigned to you',
    error: 'Couldn’t load projects',
  },
  {
    name: 'Projects',
    path: '/northwind/projects',
    target: '/workspaces/northwind/projects',
    empty: 'No projects yet',
    error: 'Couldn’t load projects',
  },
  {
    name: 'My tasks',
    path: '/northwind/my-tasks',
    target: '/me/tasks',
    empty: 'No tasks here',
    error: 'Couldn’t load your tasks',
  },
  {
    name: 'Inbox',
    path: '/northwind/inbox',
    target: '/inbox',
    empty: 'You’re all caught up',
    error: 'Couldn’t load your inbox',
  },
  {
    name: 'Members',
    path: '/northwind/members',
    target: '/workspaces/northwind/members',
    empty: 'No members',
    error: 'Couldn’t load members',
  },
]

// Signed-in mock. `state.mode` can change mid-test; `release()` lets held ("slow") responses through.
export async function mockStates(page: Page, target: string, initial: Mode) {
  const state = { mode: initial }
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('http://localhost:8787/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(req.url()).pathname
    if (path === '/me') return route.fulfill({ headers, json: { user, workspaces: [workspace] } })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path !== target) return route.fulfill({ headers, json: none })
    if (state.mode === 'fail') return route.fulfill({ status: 500, headers, json: { error: 'x' } })
    if (state.mode === 'slow') await gate
    return route.fulfill({ headers, json: none })
  })
  return { state, release }
}

export async function mockSignedOut(page: Page, status = 401) {
  await page.route('http://localhost:8787/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(route.request().url()).pathname
    if (path === '/me') return route.fulfill({ status, headers, json: { error: 'x' } })
    return route.fulfill({ status: 404, headers, json: { error: 'not found' } })
  })
}
