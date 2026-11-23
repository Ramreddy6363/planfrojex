import { expect, type Page, test } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1360 } })

const publicShare = {
  workspaceName: 'Northwind',
  sharedBy: 'Maya Chen',
  project: {
    name: 'Customer portal rebuild',
    status: 'in-progress',
    leadName: 'Maya Chen',
    targetDate: '2026-12-12',
    updatedAt: '2026-10-13T12:00:00Z',
  },
  brief: {
    problem: 'Customers need a self-service portal.',
    goals: ['Reduce account-related support tickets.'],
  },
  plan: {
    milestones: [
      {
        code: 'M1',
        title: 'Sign-in and account settings',
        status: 'in_progress',
        dueDate: '2026-10-31',
      },
      { code: 'M2', title: 'Billing and invoices', status: 'planning', dueDate: '2026-11-21' },
    ],
  },
  diagrams: [
    {
      name: 'Checkout flow',
      type: 'flowchart',
      scene: {
        nodes: [
          { type: 'rectangle', position: { x: 100, y: 0 }, data: { label: 'Open Billing' } },
          { type: 'rectangle', position: { x: 100, y: 100 }, data: { label: 'Download PDF' } },
        ],
        edges: [{ source: 0, target: 1 }],
      },
    },
  ],
}

const reviewRevision = 'a'.repeat(64)
const briefRevision = 'b'.repeat(64)
const milestonesRevision = 'c'.repeat(64)
const diagramRevision = 'd'.repeat(64)
const revisedBriefRevision = 'e'.repeat(64)
const revisedProblem = 'Customers need secure access to their invoices.'

async function mockReview(page: Page, { staleBrief = false } = {}) {
  const approvals: Record<string, { outcome: string; comment?: string; updatedAt?: string }> = {}
  const writes: unknown[] = []
  let verified = false
  let briefChanged = false
  let planChangeRequest: { comment: string } | null = null
  const headers = {
    'access-control-allow-origin': 'http://localhost:5199',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
  await page.route('http://localhost:8787/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/public/share/review-token/verify-email') {
      if (request.postDataJSON().code) verified = true
      return route.fulfill({ headers, json: verified ? { ok: true } : { sent: true } })
    }
    if (path === '/public/share/review-token/approvals') {
      const body = request.postDataJSON()
      writes.push(body)
      if (staleBrief && body.section === 'brief' && !briefChanged) {
        briefChanged = true
        return route.fulfill({ status: 409, headers, json: { error: 'Stale revision' } })
      }
      if (body.section === 'all' && body.outcome === 'changes_requested')
        planChangeRequest = { comment: body.comment }
      for (const section of body.section === 'all'
        ? body.outcome === 'approved'
          ? ['brief', 'milestones', 'diagram:opaque']
          : []
        : [body.section])
        approvals[section] = {
          outcome: body.outcome,
          comment: body.comment,
          updatedAt: '2026-10-14T12:00:00Z',
        }
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (path === '/public/share/review-token/review')
      return route.fulfill({
        status: verified ? 200 : 404,
        headers,
        json: {
          ...publicShare,
          brief: {
            ...publicShare.brief,
            problem: briefChanged ? revisedProblem : publicShare.brief.problem,
          },
          review: {
            requesterName: 'Maya Chen',
            reviewerEmail: 'lena@example.com',
            dueDate: '2026-12-20',
            expiresAt: '2026-12-21T00:00:00Z',
            approvedCount: Object.values(approvals).filter((a) => a.outcome === 'approved').length,
            totalSections: 3,
            revision: briefChanged ? 'f'.repeat(64) : reviewRevision,
            planChangeRequest,
            sections: [
              {
                key: 'brief',
                label: 'Brief',
                revision: briefChanged ? revisedBriefRevision : briefRevision,
                ...approvals.brief,
              },
              {
                key: 'milestones',
                label: 'Milestones',
                revision: milestonesRevision,
                ...approvals.milestones,
              },
              {
                key: 'diagram:opaque',
                label: 'Checkout flow',
                revision: diagramRevision,
                ...approvals['diagram:opaque'],
              },
            ],
          },
        },
      })
    return route.fulfill({ status: 404, headers, json: { error: 'Not found' } })
  })
  return writes
}

async function verifyReview(page: Page) {
  await page.goto('/share/review-token?review=1')
  await page.getByLabel('Email', { exact: true }).fill('lena@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page.getByText(/Maya Chen asked you to review this plan/)).toBeVisible()
}

test('reviewer verifies email, approves sections and asks for changes', async ({ page }) => {
  const writes = await mockReview(page)
  await verifyReview(page)
  await expect(page.getByText('0 of 3 sections approved')).toBeVisible()
  await page.getByRole('button', { name: 'Approve Brief' }).click()
  await expect(page.getByText('1 of 3 sections approved')).toBeVisible()
  await expect(page.getByText('Approved by you, Oct 14')).toBeVisible()
  expect(writes).toContainEqual({ section: 'brief', outcome: 'approved', revision: briefRevision })
  await page.getByRole('button', { name: 'Request changes', exact: true }).click()
  await page.getByLabel('Comment').fill('Please clarify the timeline.')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect
    .poll(() => writes)
    .toContainEqual({
      section: 'all',
      outcome: 'changes_requested',
      revision: reviewRevision,
      comment: 'Please clarify the timeline.',
    })
  await expect(page.getByText('Please clarify the timeline.')).toBeVisible()
  await page.getByRole('button', { name: 'Request changes', exact: true }).click()
  await page.getByLabel('Section').selectOption('milestones')
  await page.getByLabel('Comment').fill('Please clarify the launch date.')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText('Please clarify the launch date.')).toBeVisible()
  expect(writes).toContainEqual({
    section: 'milestones',
    outcome: 'changes_requested',
    revision: milestonesRevision,
    comment: 'Please clarify the launch date.',
  })
  await page.screenshot({ path: test.info().outputPath('review-602.png'), fullPage: true })
  await page.getByRole('button', { name: 'Approve plan' }).click()
  await expect(page.getByText('3 of 3 sections approved')).toBeVisible()
  await expect
    .poll(() => writes)
    .toContainEqual({ section: 'all', outcome: 'approved', revision: reviewRevision })
})

test('reviewer sees the latest brief and can approve it after a stale approval response', async ({
  page,
}) => {
  const writes = await mockReview(page, { staleBrief: true })
  await verifyReview(page)
  await expect(page.getByText(publicShare.brief.problem)).toBeVisible()

  await page.getByRole('button', { name: 'Approve Brief' }).click()
  await expect(page.getByRole('alert')).toHaveText(/plan .*changed/i)
  await expect(page.getByText(revisedProblem)).toBeVisible()
  await expect(page.getByText('0 of 3 sections approved')).toBeVisible()

  await page.getByRole('button', { name: 'Approve Brief' }).click()
  await expect(page.getByText('1 of 3 sections approved')).toBeVisible()
  expect(writes).toEqual([
    { section: 'brief', outcome: 'approved', revision: briefRevision },
    { section: 'brief', outcome: 'approved', revision: revisedBriefRevision },
  ])
})

test('reviewer can correct their email and resend an expired or wrong code', async ({ page }) => {
  await mockReview(page)
  const attempts: unknown[] = []
  await page.route(
    'http://localhost:8787/public/share/review-token/verify-email',
    async (route) => {
      const headers = {
        'access-control-allow-origin': 'http://localhost:5199',
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const body = route.request().postDataJSON()
      attempts.push(body)
      if (body.code)
        return route.fulfill({ status: 400, headers, json: { error: 'Invalid or expired code' } })
      return route.fulfill({ headers, json: { sent: true } })
    },
  )
  await page.goto('/share/review-token?review=1')
  await page.getByLabel('Email', { exact: true }).fill('wrong@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('button', { name: 'Change email' }).click()
  await page.getByLabel('Email', { exact: true }).fill('lena@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page.getByRole('alert')).toHaveText(/code is incorrect or expired/i)
  await page.getByRole('button', { name: 'Resend code' }).click()
  await expect
    .poll(() => attempts)
    .toEqual([
      { email: 'wrong@example.com' },
      { email: 'lena@example.com' },
      { email: 'lena@example.com', code: '123456' },
      { email: 'lena@example.com' },
    ])
})
