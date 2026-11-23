import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { projects } from '../db/schema'
import { outbox } from '../email'
import { integrationSuite } from '../testing/pg'
import {
  cookieFrom,
  findReviewSection,
  firstReviewer,
  mailedCode,
  mailedToken,
  reviewFixture,
  secondReviewer,
  unknownToken,
} from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
const briefApproval = { section: 'brief', outcome: 'approved', revision: '0'.repeat(64) }
const requestBody = { emails: [firstReviewer], dueDate: null }

integrationSuite(url)('stakeholder review security', () => {
  let fixture: Awaited<ReturnType<typeof reviewFixture>>
  let seed: Awaited<ReturnType<typeof fixture.seed>>
  beforeAll(async () => {
    fixture = await reviewFixture(url as string)
  })
  beforeEach(async () => {
    seed = await fixture.seed()
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => fixture?.close())

  it('requires a session and scopes each project request endpoint to the workspace', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    const { request } = await seed.create()
    for (const [path, method, json] of [
      [seed.path, 'GET', undefined],
      [seed.path, 'POST', requestBody],
      [`/review-requests/${request.id}`, 'DELETE', undefined],
    ] as const) {
      expect((await fixture.request(path, { method, json })).status).toBe(401)
      expect((await fixture.request(path, { as: 'other', method, json })).status).toBe(404)
    }
    expect(
      (await fixture.request(seed.path, { as: 'viewer', method: 'POST', json: requestBody }))
        .status,
    ).toBe(403)
    expect(
      (await fixture.request(`/review-requests/${request.id}`, { as: 'viewer', method: 'DELETE' }))
        .status,
    ).toBe(403)
  })

  it('does not allow a member of another workspace to use the public review endpoints with only a read-only link', async () => {
    const share = await seed.enableShare()
    expect(share.status).toBe(200)
    const { token } = (await share.json()) as { token: string }
    await seed.create()
    const otherShare = await seed.enableShare(true)
    expect(otherShare.status).toBe(200)
    const other = await fixture.request(`/projects/${seed.otherProject.id}/review-requests`, {
      as: 'other',
      method: 'POST',
      json: { emails: [secondReviewer], dueDate: null },
    })
    expect(other.status).toBe(201)
    const otherCookie = await fixture.verify(mailedToken(secondReviewer), secondReviewer)
    const options = { as: 'other', cookie: otherCookie } as const
    expect((await fixture.sendCode(token, firstReviewer, options)).status).toBe(404)
    expect((await fixture.review(token, options)).status).toBe(404)
    expect((await fixture.approve(token, briefApproval, options)).status).toBe(404)
    expect((await fixture.review(mailedToken(), options)).status).toBe(404)
    expect((await fixture.approve(mailedToken(), briefApproval, options)).status).toBe(404)
  })

  it('stores hashes only and keeps raw links and codes out of logs and API responses', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const share = await seed.enableShare()
    expect(share.status).toBe(200)
    const shareToken = ((await share.json()) as { token: string }).token
    const created = await seed.create()
    const token = mailedToken()
    expect(token).not.toBe(shareToken)
    expect(JSON.stringify(created)).not.toContain(token)

    const send = await fixture.sendCode(token, firstReviewer)
    expect(send.status).toBe(200)
    const code = mailedCode()
    expect(await send.json()).toEqual({ sent: true })
    const { rows } = await fixture.client.query<{
      token_hash: string
      data: Record<string, unknown>
    }>('SELECT token_hash, to_jsonb(reviewers) AS data FROM reviewers WHERE email = $1', [
      firstReviewer,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(rows[0]?.data.verification_code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.values(rows[0]?.data ?? {})).not.toContain(code)
    expect(Object.values(rows[0]?.data ?? {})).not.toContain(Number(code))
    const requests = await fixture.client.query('SELECT * FROM review_requests')
    for (const persisted of [rows, requests.rows])
      expect(JSON.stringify(persisted)).not.toContain(token)
    expect(JSON.stringify(log.mock.calls)).not.toContain(token)
    expect(JSON.stringify(log.mock.calls)).not.toContain(` ${code}`)
  })

  it('requires a valid code and cannot verify another email against the same link', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const beforeVerify = await fixture.review(token)
    expect(beforeVerify.status).toBe(404)
    expect((await fixture.approve(token, briefApproval)).status).toBe(404)

    const before = outbox.length
    const different = await fixture.sendCode(token, secondReviewer)
    expect(different.status).toBe(200)
    expect(await different.json()).toEqual({ sent: true })
    expect(outbox).toHaveLength(before)
    expect(different.headers.get('set-cookie')).toBeNull()
    expect((await fixture.sendCode(token, firstReviewer)).status).toBe(200)
    const code = mailedCode()
    for (const [email, value] of [
      [secondReviewer, code],
      [firstReviewer, code === '000000' ? '000001' : '000000'],
    ] as const) {
      const verification = await fixture.submitCode(token, email, value)
      expect(verification.ok).toBe(false)
      expect(verification.headers.get('set-cookie')).toBeNull()
    }
    const verified = await fixture.submitCode(token, firstReviewer, code)
    expect(verified.status).toBe(200)
    const cookie = cookieFrom(verified)
    expect((await fixture.review(token, { cookie })).status).toBe(200)
    const replay = await fixture.submitCode(token, firstReviewer, code)
    expect(replay.ok).toBe(false)
    expect(replay.headers.get('set-cookie')).toBeNull()
    expect((await fixture.review(token)).status).toBe(404)
  })

  it('expires verification codes and locks a code after five wrong submissions', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    expect((await fixture.sendCode(token, firstReviewer)).status).toBe(200)
    const expiredCode = mailedCode()
    await fixture.client.query(
      'UPDATE reviewers SET verification_code_expires_at = $1 WHERE email = $2',
      [new Date(Date.now() - 60_000), firstReviewer],
    )
    const expired = await fixture.submitCode(token, firstReviewer, expiredCode)
    expect(expired.ok).toBe(false)
    expect(expired.headers.get('set-cookie')).toBeNull()

    expect((await fixture.sendCode(token, firstReviewer)).status).toBe(200)
    const code = mailedCode()
    const wrong = code === '000000' ? '000001' : '000000'
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await fixture.submitCode(token, firstReviewer, wrong)
      expect(result.ok).toBe(false)
      expect(result.headers.get('set-cookie')).toBeNull()
    }
    const locked = await fixture.submitCode(token, firstReviewer, code)
    expect(locked.ok).toBe(false)
    expect(locked.headers.get('set-cookie')).toBeNull()
    await fixture.verify(token)
  })

  it('restricts each reviewer to their own review and excludes internal IDs and other emails', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    const { request, reviewers } = await seed.create({ emails: [firstReviewer, secondReviewer] })
    const firstToken = mailedToken(firstReviewer)
    const secondToken = mailedToken(secondReviewer)
    expect(firstToken).not.toBe(secondToken)
    const firstCookie = await fixture.verify(firstToken, firstReviewer)
    const secondCookie = await fixture.verify(secondToken, secondReviewer)

    expect((await fixture.review(secondToken, { cookie: firstCookie })).status).toBe(404)
    expect(
      (await fixture.approve(secondToken, briefApproval, { cookie: firstCookie })).status,
    ).toBe(404)
    expect((await fixture.review(firstToken, { cookie: `${firstCookie}tampered` })).status).toBe(
      404,
    )

    const snapshot = await fixture.readReview(firstToken, firstCookie)
    const brief = findReviewSection(snapshot, 'brief')
    const comment = 'Add a way to download receipts.'
    expect(
      (
        await fixture.approve(
          firstToken,
          {
            section: brief.key,
            revision: brief.revision,
            outcome: 'changes_requested',
            comment,
          },
          { cookie: firstCookie },
        )
      ).status,
    ).toBe(200)
    const response = await fixture.review(secondToken, { cookie: secondCookie })
    expect(response.status).toBe(200)
    const raw = await response.text()
    const internalIds = [
      seed.project.id,
      seed.project.workspaceId,
      request.id,
      ...reviewers.map(({ id }) => id),
      ...seed.chartIds.map(({ id }) => id),
    ]
    for (const privateValue of [comment, firstReviewer, firstToken, secondToken, ...internalIds]) {
      expect(raw).not.toContain(privateValue)
    }
    expect(JSON.parse(raw)).toMatchObject({
      review: {
        reviewerEmail: secondReviewer,
        approvedCount: 0,
        sections: expect.arrayContaining([
          expect.objectContaining({ key: 'brief', outcome: null, comment: null }),
        ]),
      },
    })
  })

  for (const gone of [
    'expired',
    'cancelled',
    'revoked',
    're-enabled',
    'project deleted',
  ] as const) {
    it(`rejects a review link after ${gone} even with a verified cookie`, async () => {
      const share = await seed.enableShare()
      expect(share.status).toBe(200)
      const { token: shareToken } = (await share.json()) as { token: string }
      const { request } = await seed.create()
      const token = mailedToken()
      const cookie = await fixture.verify(token)
      switch (gone) {
        case 'expired':
          await fixture.client.query('UPDATE review_requests SET expires_at = $1 WHERE id = $2', [
            new Date(Date.now() - 60_000),
            request.id,
          ])
          break
        case 'cancelled':
          expect(
            (
              await fixture.request(`/review-requests/${request.id}`, {
                as: 'owner',
                method: 'DELETE',
              })
            ).status,
          ).toBe(200)
          break
        case 'revoked':
        case 're-enabled':
          expect(
            (await fixture.request(seed.sharePath, { as: 'owner', method: 'DELETE' })).status,
          ).toBe(200)
          if (gone === 're-enabled') {
            const reenabled = await seed.enableShare()
            expect(reenabled.status).toBe(200)
            const { token: newShareToken } = (await reenabled.json()) as { token: string }
            expect(newShareToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
            expect(newShareToken).not.toBe(shareToken)
          }
          break
        case 'project deleted':
          await fixture.db
            .update(projects)
            .set({ deletedAt: new Date() })
            .where(eq(projects.id, seed.project.id))
          break
      }
      const missing = unknownToken()
      for (const lookup of [
        (value: string) => fixture.sendCode(value, firstReviewer),
        (value: string) => fixture.submitCode(value, firstReviewer, '000000'),
        (value: string) => fixture.review(value, { cookie }),
        (value: string) => fixture.approve(value, briefApproval, { cookie }),
      ]) {
        const [unavailable, unknown] = await Promise.all([lookup(token), lookup(missing)])
        expect(unavailable.status).toBe(404)
        expect(unknown.status).toBe(404)
        expect(await unavailable.text()).toBe(await unknown.text())
      }
    })
  }

  it('rate limits code requests and approvals', async () => {
    expect((await seed.enableShare()).status).toBe(200)
    await seed.create()
    const token = mailedToken()
    const cookie = await fixture.verify(token)
    const snapshot = await fixture.readReview(token, cookie)
    const brief = findReviewSection(snapshot, 'brief')
    const approve = { section: brief.key, outcome: 'approved', revision: brief.revision }
    for (const send of [
      () => fixture.sendCode(token, firstReviewer, { ip: '192.0.2.19' }),
      () => fixture.approve(token, approve, { cookie, ip: '192.0.2.20' }),
    ]) {
      let status: number | undefined
      for (let attempt = 0; attempt <= 60; attempt++) {
        status = (await send()).status
        if (status === 429) break
        expect(status).toBe(200)
      }
      expect(status).toBe(429)
    }
    const keys = await fixture.client.query('SELECT key FROM rate_limits')
    for (const privateValue of [token, firstReviewer, '192.0.2.19', '192.0.2.20']) {
      expect(JSON.stringify(keys.rows)).not.toContain(privateValue)
    }
  })
})
