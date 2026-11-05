import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { integrationSuite } from '../testing/pg'
import { connectLocal } from './local'

const url = process.env.PLANFROJEX_TEST_DATABASE_URL

integrationSuite(url)('local database driver', () => {
  it('queries a PostgreSQL server over TCP without a Neon proxy', async () => {
    const rows = await connectLocal(url as string).execute(sql`select 1 as value`)
    expect(rows).toMatchObject({ rows: [{ value: 1 }] })
  })
})
