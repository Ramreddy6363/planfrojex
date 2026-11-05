import { describe, expect, it } from 'vitest'
import { startTestDatabase } from './database'

const suite = process.env.PLANFROJEX_TEST_CONTAINERS ? describe : describe.skip
suite('test database', () => {
  it('starts PostgreSQL with the application migration', async () => {
    const database = await startTestDatabase()
    try {
      const result = await database.client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workspaces'",
      )
      expect(result.rowCount).toBe(1)
    } finally {
      await database.stop()
    }
  }, 120000)
})
