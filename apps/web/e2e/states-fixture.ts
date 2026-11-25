import type { Page } from '@playwright/test'
import { webOrigin } from './test-origin'

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
export const headers = {
  'access-control-allow-origin': webOrigin(),
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
export const projectId = 'b4a3a1d9-9f71-4d75-9b9d-6b7e8f21c715'
export const projectName = 'Customer portal rebuild'
const project = {
  id: projectId,
  key: 'PORTAL',
  name: projectName,
  status: 'in-progress',
  leadId: 'owner',
  leadName: 'Maya Chen',
  targetDate: '2026-12-12',
  brief: { problem: 'Support calls are too frequent.', goals: [], constraints: '', outOfScope: '' },
  tags: [],
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
  createdBy: { id: 'owner', name: 'Maya Chen' },
  starred: false,
  taskProgress: { done: 0, total: 0 },
}
const kinds = ['requirements', 'stories', 'milestones', 'risks', 'stack', 'estimate']
const bodies: Record<string, unknown> = {
  [`/projects/${projectId}`]: { project },
  [`/projects/${projectId}/plan`]: {
    sections: kinds.map((kind) => ({
      kind,
      content: null,
      version: 0,
      updatedAt: '',
      updatedBy: null,
    })),
    milestones: [],
    risks: [],
    lastChanged: null,
  },
  [`/projects/${projectId}/tasks`]: {
    tasks: [],
    counts: { todo: 0, inProgress: 0, done: 0 },
    nextCursor: null,
  },
  '/workspaces/northwind/integrations': { configured: true, integration: null },
  '/workspaces/northwind/share-links': { links: [] },
}
const none = {
  comments: [],
  activity: [],
  diagrams: [],
  decisions: [],
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
  const state = { mode: initial, meFails: false }
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('http://localhost:8787/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(req.url()).pathname
    if (path === '/me')
      return state.meFails
        ? route.fulfill({ status: 500, headers, json: { error: 'x' } })
        : route.fulfill({ headers, json: { user, workspaces: [workspace] } })
    if (path === '/workspaces/northwind') return route.fulfill({ headers, json: { workspace } })
    if (path !== target) return route.fulfill({ headers, json: bodies[path] ?? none })
    if (state.mode === 'fail') return route.fulfill({ status: 500, headers, json: { error: 'x' } })
    if (state.mode === 'slow') await gate
    return route.fulfill({ headers, json: bodies[path] ?? none })
  })
  return { state, release }
}

export async function mockSignedOut(page: Page, status = 401) {
  const state = { status }
  await page.route('http://localhost:8787/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(route.request().url()).pathname
    if (path === '/me')
      return route.fulfill({ status: state.status, headers, json: { error: 'x' } })
    return route.fulfill({ status: 404, headers, json: { error: 'not found' } })
  })
  return { state }
}

export type ProjectScreen = {
  name: string
  path: string
  target: string
  error: string
  ok: string
}
const p = `/projects/${projectId}`
const base = `/northwind${p}`
// Page-level loads (the project itself) and the main list of each project tab.
export const projectScreens: ProjectScreen[] = [
  { name: 'Brief', path: base, target: p, error: 'Couldn’t load project', ok: projectName },
  {
    name: 'Brief comments',
    path: base,
    target: '/comments',
    error: 'Couldn’t load comments',
    ok: 'No comments yet.',
  },
  {
    name: 'Tasks',
    path: `${base}/tasks`,
    target: p,
    error: 'Couldn’t load project',
    ok: projectName,
  },
  {
    name: 'Task list',
    path: `${base}/tasks`,
    target: `${p}/tasks`,
    error: 'Couldn’t load tasks',
    ok: projectName,
  },
  {
    name: 'Plan',
    path: `${base}/plan`,
    target: p,
    error: 'Couldn’t load the plan',
    ok: projectName,
  },
  {
    name: 'Activity',
    path: `${base}/activity`,
    target: p,
    error: 'Couldn’t load project activity',
    ok: projectName,
  },
  {
    name: 'Timeline',
    path: `${base}/activity`,
    target: `${p}/activity`,
    error: 'Couldn’t load activity',
    ok: 'No activity yet',
  },
  {
    name: 'Diagrams',
    path: `${base}/diagrams`,
    target: p,
    error: 'Couldn’t load diagrams',
    ok: projectName,
  },
  {
    name: 'Share links',
    path: '/northwind/settings',
    target: '/workspaces/northwind/share-links',
    error: 'Couldn’t load share links',
    ok: 'No share links yet',
  },
  {
    name: 'Integrations',
    path: '/northwind/settings?tab=integrations',
    target: '/workspaces/northwind/integrations',
    error: 'Couldn’t load integrations',
    ok: 'Connect Linear',
  },
]
