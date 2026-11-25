import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { emailUnsubscribes, notificationSettings, reviewers } from '../db/schema'
import { outbox } from '../email'
import { testEnv } from '../integrations/test-fixture'
import { hash } from '../reviews/service'
import { integrationSuite } from '../testing/pg'
import { runWeeklyStatusEmails } from './service'
import { lastFriday, monday, statusFixture } from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
integrationSuite(url)('weekly status security', () => {
  let fixture: Awaited<ReturnType<typeof statusFixture>>
  beforeEach(async () => {
    fixture = await statusFixture(url as string)
    outbox.length = 0
  })
  afterEach(async () => fixture?.database.close())

  it('allows viewers to list only their workspace reports and restricts preview to owners/editors', async () => {
    expect((await fixture.list('viewer')).status).toBe(200)
    expect((await fixture.preview('viewer')).status).toBe(403)
    expect((await fixture.preview('editor')).status).toBe(200)
    expect((await fixture.preview('owner')).status).toBe(200)
    expect((await fixture.list('other')).status).toBe(404)
    expect((await fixture.preview('other')).status).toBe(404)
    expect((await fixture.list(null)).status).toBe(401)
    expect((await fixture.preview(null)).status).toBe(401)
  })

  it('stores a hash, requires a valid secret, and atomically applies a project-only unsubscribe once', async () => {
    const { db } = fixture
    const review = await fixture.addReview()
    await db.insert(reviewers).values({
      requestId: review.id,
      email: 'outside@example.com',
      tokenHash: 'external-a',
      verifiedAt: lastFriday,
    })
    await db.insert(notificationSettings).values({
      userId: 'editor',
      type: 'weekly_summary',
      email: false,
      inApp: false,
    })
    await runWeeklyStatusEmails(db, testEnv, monday)
    const mail = outbox.find(({ to }) => to === 'owner@example.com')
    const unsubscribeUrl = mail?.text.match(/Unsubscribe: (https?:\/\/\S+)/)?.[1]
    if (!unsubscribeUrl) throw new Error('Missing emailed unsubscribe link')
    const path = new URL(unsubscribeUrl).pathname
    const token = path.split('/').at(-1) ?? ''
    const table = await fixture.database.client.query('SELECT * FROM email_unsubscribes')
    expect(JSON.stringify(table.rows)).not.toContain(token)
    expect(table.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ token_hash: await hash(token) })]),
    )
    expect(JSON.stringify(table.rows)).not.toContain('owner@example.com')
    expect(JSON.stringify(await (await fixture.list()).json())).not.toContain(token)
    const revoke = (value: string) => fixture.request(value, 'POST', null)
    expect((await revoke(`${path.slice(0, -token.length)}${'X'.repeat(43)}`)).status).toBe(404)
    const confirm = await fixture.request(path, 'GET', null)
    expect(confirm.status).toBe(200)
    expect(confirm.headers.get('cache-control')).toBe('no-store')
    expect(await confirm.text()).not.toContain('owner@example.com')
    const [grant] = await db
      .select({
        projectId: emailUnsubscribes.projectId,
        recipientHash: emailUnsubscribes.recipientHash,
      })
      .from(emailUnsubscribes)
      .where(eq(emailUnsubscribes.tokenHash, await hash(token)))
    if (!grant) throw new Error('Missing unsubscribe grant')
    await db.insert(emailUnsubscribes).values({
      tokenHash: await hash('another-request-scoped-token'),
      projectId: grant.projectId,
      recipientHash: grant.recipientHash,
    })
    const results = await Promise.all([revoke(path), revoke(path)])
    expect(results.map(({ status }) => status).sort()).toEqual([200, 404])
    expect((await fixture.request(path, 'GET', null)).status).toBe(404)
    expect((await revoke(path)).status).toBe(404)

    outbox.length = 0
    const secondMonday = new Date('2026-11-30T09:00:00Z')
    const secondFriday = new Date('2026-11-27T10:00:00Z')
    await fixture.addActivity(secondFriday)
    await fixture.addActivity(secondFriday, fixture.quiet.id)
    await runWeeklyStatusEmails(
      db,
      { ...testEnv, BETTER_AUTH_SECRET: 'rotated-weekly-status-secret-long-enough' },
      secondMonday,
    )
    expect(
      outbox.some(
        ({ to, subject }) => to === 'owner@example.com' && subject.startsWith('Weekly portal:'),
      ),
    ).toBe(false)
    expect(
      outbox.some(({ to, subject }) => to === 'owner@example.com' && subject.startsWith('Quiet:')),
    ).toBe(true)
    expect(
      outbox.some(
        ({ to, subject }) => to === 'outside@example.com' && subject.startsWith('Weekly portal:'),
      ),
    ).toBe(true)
  })
})
