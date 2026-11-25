import { describe, expect, it, vi } from 'vitest'
import app, { dispatchScheduledChecks } from './index'

describe('api', () => {
  it('reports health', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('runs the daily status retry even when tracker and drift checks fail', async () => {
    const checks = vi.fn(async () => {
      throw new Error('tracker unavailable')
    })
    const weeklyStatusEmails = vi.fn(async () => {})
    await expect(
      dispatchScheduledChecks(
        {} as never,
        {} as never,
        { cron: '0 3 * * *', scheduledTime: Date.UTC(2026, 10, 25) },
        { checks, weeklyStatusEmails },
      ),
    ).rejects.toThrow('tracker unavailable')
    expect(weeklyStatusEmails).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      new Date(Date.UTC(2026, 10, 25)),
      true,
    )
  })
})
