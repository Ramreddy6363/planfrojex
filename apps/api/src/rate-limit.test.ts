import { describe, expect, it, vi } from 'vitest'
import type { Db } from './db'
import { consumeRateLimit } from './rate-limit'

describe('persistent email limits', () => {
  it('rejects a request larger than the entire limit without touching the database', async () => {
    const db = { insert: vi.fn() }
    expect(await consumeRateLimit(db as unknown as Db, 'invite', 'user-1', 11, 10, 60_000)).toBe(
      false,
    )
    expect(db.insert).not.toHaveBeenCalled()
  })
})
