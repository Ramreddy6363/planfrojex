import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { expect } from 'vitest'
import {
  diagrams,
  diagramVersions,
  memberships,
  milestones,
  projects,
  user,
  workspaces,
} from '../db/schema'
import { outbox } from '../email'
import type { Env } from '../env'
import { createApp } from '../index'
import { openTestDb } from '../testing/pg'

const env: Env['Bindings'] = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'test',
  BETTER_AUTH_SECRET: 'review-test-secret-that-is-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:8787',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  ANTHROPIC_API_KEY: '',
}

type Actor = 'owner' | 'editor' | 'viewer' | 'other'
type RequestOptions = {
  as?: Actor
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  json?: unknown
  cookie?: string
  ip?: string
  origin?: string
}
type ReviewerProgress = {
  id: string
  email: string
  verifiedAt: string | null
  approvedCount: number
  totalSections: number
}
type ReviewRequest = {
  id: string
  dueDate: string | null
  expiresAt: string
  createdAt: string
}
type RequestCreated = { request: ReviewRequest; reviewers: ReviewerProgress[] }
type RequestListed = {
  requests: (ReviewRequest & {
    cancelledAt: string | null
    reviewers: ReviewerProgress[]
  })[]
}
type ReviewSection = {
  key: string
  revision: string
  label: string
  outcome: 'approved' | 'changes_requested' | null
  comment: string | null
  updatedAt: string | null
}
export type PublicReview = {
  review: {
    revision: string
    requesterName: string
    reviewerEmail: string
    dueDate: string | null
    expiresAt: string
    sections: ReviewSection[]
    planChangeRequest: { comment: string } | null
    approvedCount: number
    totalSections: number
  }
}

export function findReviewSection(snapshot: PublicReview, key: string) {
  const section = snapshot.review.sections.find((entry) => entry.key === key)
  if (!section) throw new Error(`Review section ${key} not found`)
  return section
}

export const firstReviewer = 'first-reviewer@example.com'
export const secondReviewer = 'second-reviewer@example.com'
export const unknownToken = () => randomBytes(32).toString('base64url')
export const publicPath = (token: string) => `/public/share/${token}`

export async function reviewFixture(url: string) {
  const database = await openTestDb(url)
  const { db } = database
  const app = createApp({
    database: () => db,
    auth: () =>
      ({
        api: {
          getSession: async ({ headers }: { headers: Headers }) => {
            const id = headers.get('x-test-actor')
            return id ? { user: { id, email: `${id}@example.com` } } : null
          },
        },
      }) as never,
  })

  const request = (path: string, options: RequestOptions = {}) => {
    const headers = new Headers({
      origin: options.origin ?? env.WEB_ORIGIN,
      'CF-Connecting-IP': options.ip ?? '192.0.2.18',
    })
    if (options.as) headers.set('x-test-actor', options.as)
    if (options.cookie) headers.set('cookie', options.cookie)
    if (options.json !== undefined) headers.set('content-type', 'application/json')
    return app.request(
      path,
      { method: options.method, headers, body: JSON.stringify(options.json) },
      env,
    )
  }

  const seed = async () => {
    outbox.length = 0
    await database.client.query('TRUNCATE users, workspaces, rate_limits CASCADE')
    await db.insert(user).values(
      ['owner', 'editor', 'viewer', 'other'].map((id) => ({
        id,
        email: `${id}@example.com`,
        name: id === 'owner' ? 'Maya Chen' : id,
      })),
    )
    const [workspace, otherWorkspace] = await db
      .insert(workspaces)
      .values([
        { name: 'Northwind', slug: 'northwind' },
        { name: 'Other', slug: 'other' },
      ])
      .returning()
    if (!workspace || !otherWorkspace) throw new Error('Workspaces were not seeded')
    await db.insert(memberships).values([
      { workspaceId: workspace.id, userId: 'owner', role: 'owner' },
      { workspaceId: workspace.id, userId: 'editor', role: 'editor' },
      { workspaceId: workspace.id, userId: 'viewer', role: 'viewer' },
      { workspaceId: otherWorkspace.id, userId: 'other', role: 'owner' },
    ])
    const [project, otherProject] = await db
      .insert(projects)
      .values([
        {
          workspaceId: workspace.id,
          name: 'Customer portal rebuild',
          key: 'PORTAL',
          leadId: 'owner',
          brief: { problem: 'Customers need a self-serve portal.' },
        },
        {
          workspaceId: otherWorkspace.id,
          name: 'Other workspace project',
          key: 'OTHER',
          leadId: 'other',
          brief: { problem: 'Other workspace content.' },
        },
      ])
      .returning()
    if (!project || !otherProject) throw new Error('Projects were not seeded')
    await db.insert(milestones).values({
      projectId: project.id,
      code: 'M1',
      title: 'Account settings',
    })
    for (const name of ['Checkout flow', 'Account flow']) {
      const [diagram] = await db
        .insert(diagrams)
        .values({ projectId: project.id, name, type: 'flowchart', currentVersion: 1 })
        .returning()
      if (!diagram) throw new Error('Diagram was not seeded')
      await db.insert(diagramVersions).values({
        diagramId: diagram.id,
        version: 1,
        scene: { nodes: [], edges: [] },
      })
    }
    const chartIds = await db
      .select({ id: diagrams.id })
      .from(diagrams)
      .where(eq(diagrams.projectId, project.id))
    const path = `/projects/${project.id}/review-requests`
    const sharePath = '/workspaces/northwind/projects/PORTAL/share'
    const enableShare = (other = false) =>
      request(other ? '/workspaces/other/projects/OTHER/share' : sharePath, {
        as: other ? 'other' : 'owner',
        method: 'PUT',
        json: { enabled: true, include: ['brief', 'plan', 'diagrams'] },
      })
    const create = async (options: { emails?: string[]; dueDate?: string; as?: Actor } = {}) => {
      const response = await request(path, {
        as: options.as ?? 'owner',
        method: 'POST',
        json: { emails: options.emails ?? [firstReviewer], dueDate: options.dueDate ?? null },
      })
      expect(response.status).toBe(201)
      return (await response.json()) as RequestCreated
    }
    const list = async (as: Actor) => {
      const response = await request(path, { as })
      expect(response.status).toBe(200)
      return (await response.json()) as RequestListed
    }
    return { project, otherProject, chartIds, path, sharePath, enableShare, create, list }
  }

  const sendCode = (token: string, email: string, options: RequestOptions = {}) =>
    request(`${publicPath(token)}/verify-email`, {
      ...options,
      method: 'POST',
      json: { email },
    })
  const submitCode = (token: string, email: string, code: string, options: RequestOptions = {}) =>
    request(`${publicPath(token)}/verify-email`, {
      ...options,
      method: 'POST',
      json: { email, code },
    })
  const verify = async (token: string, email = firstReviewer) => {
    const send = await sendCode(token, email)
    expect(send.status).toBe(200)
    expect(await send.json()).toEqual({ sent: true })
    const response = await submitCode(token, email, mailedCode(email))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    return cookieFrom(response)
  }
  const review = (token: string, options: RequestOptions = {}) =>
    request(`${publicPath(token)}/review`, options)
  const readReview = async (token: string, cookie: string) => {
    const response = await review(token, { cookie })
    expect(response.status).toBe(200)
    return (await response.json()) as PublicReview
  }
  const approve = (token: string, json: unknown, options: RequestOptions = {}) =>
    request(`${publicPath(token)}/approvals`, { ...options, method: 'POST', json })

  return { ...database, request, seed, sendCode, submitCode, verify, review, readReview, approve }
}

export function mailedToken(email = firstReviewer) {
  const link = [...outbox]
    .reverse()
    .find((message) => message.to === email)
    ?.text.match(/https?:\/\/\S+/)?.[0]
  if (!link) throw new Error('Reviewer link was not delivered')
  const url = new URL(link)
  expect(url.origin).toBe(env.WEB_ORIGIN)
  expect(url.searchParams.get('review')).toBe('1')
  const match = url.pathname.match(/^\/share\/([A-Za-z0-9_-]{43})$/)
  if (!match?.[1]) throw new Error('Reviewer link is invalid')
  return match[1]
}

export function cookieFrom(response: Response) {
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie).toMatch(/;\s*HttpOnly\b/i)
  const cookie = setCookie?.split(';')[0]
  if (!cookie) throw new Error('Reviewer cookie was not set')
  return cookie
}

export function mailedCode(email = firstReviewer) {
  const code = [...outbox]
    .reverse()
    .find((message) => message.to === email)
    ?.text.match(/\b\d{6}\b/)?.[0]
  if (!code) throw new Error('Reviewer code was not delivered')
  return code
}
