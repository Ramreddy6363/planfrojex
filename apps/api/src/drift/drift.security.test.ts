import { afterEach, beforeEach, expect, it } from 'vitest'
import { integrationSuite } from '../testing/pg'
import { driftFixture } from './test-fixture'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL
integrationSuite(url)('drift access controls', () => {
  let fixture: Awaited<ReturnType<typeof driftFixture>>
  beforeEach(async () => {
    fixture = await driftFixture(url as string)
  })
  afterEach(async () => fixture?.database.close())

  it('hides both endpoints and every action from another workspace', async () => {
    const check = await fixture.action()
    expect(check.status).toBe(200)
    const { report } = (await check.json()) as { report: { id: string; changes: { id: string }[] } }
    expect((await fixture.get('other')).status).toBe(404)
    const inputs = [
      { action: 'check' },
      { action: 'accept', reportId: report.id },
      { action: 'dismiss', reportId: report.id },
      { action: 'accept_change', reportId: report.id, changeId: report.changes[0]?.id },
      { action: 'reject_change', reportId: report.id, changeId: report.changes[0]?.id },
    ]
    for (const input of inputs) expect((await fixture.action(input, 'other')).status).toBe(404)
  })

  it('shows a read-only report to viewers and forbids all actions', async () => {
    const checked = await fixture.action()
    expect(checked.status).toBe(200)
    const { report } = (await checked.json()) as {
      report: { id: string; changes: { id: string }[] }
    }
    const visible = await fixture.get('viewer')
    expect(visible.status).toBe(200)
    expect(await visible.json()).toMatchObject({ report: { id: report.id }, canManage: false })
    for (const input of [
      { action: 'check' },
      { action: 'accept', reportId: report.id },
      { action: 'dismiss', reportId: report.id },
      { action: 'accept_change', reportId: report.id, changeId: report.changes[0]?.id },
      { action: 'reject_change', reportId: report.id, changeId: report.changes[0]?.id },
    ])
      expect((await fixture.action(input, 'viewer')).status).toBe(403)
  })

  it('requires authentication and valid action input', async () => {
    expect((await fixture.get(null)).status).toBe(401)
    expect((await fixture.action({ action: 'check' }, null)).status).toBe(401)
    expect((await fixture.action({ action: 'accept', reportId: 'invalid' })).status).toBe(400)
    expect((await fixture.action({ action: 'check', workspaceId: fixture.other.id })).status).toBe(
      400,
    )
  })

  it('refuses a real report on the wrong project within the same workspace', async () => {
    const { report } = (await (await fixture.action()).json()) as { report: { id: string } }
    const response = await fixture.request(
      `/projects/${fixture.sibling.id}/drift/check`,
      'POST',
      'owner',
      {
        action: 'accept',
        reportId: report.id,
      },
    )
    expect(response.status).toBe(409)
  })
})
