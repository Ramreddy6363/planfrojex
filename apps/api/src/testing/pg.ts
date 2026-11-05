import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { describe } from 'vitest'
import * as schema from '../db/schema'

// Opens a private schema on the server named by PLANFROJEX_TEST_DATABASE_URL and applies the migrations.
export async function openTestDb(url: string) {
  const client = new Client({ connectionString: url })
  await client.connect()
  const name = `test_${randomUUID().replaceAll('-', '')}`
  await client.query(`CREATE SCHEMA ${name}`)
  await client.query(`SET search_path TO ${name}`)
  const migration = await readFile('migrations/0000_kind_thunderbolt.sql', 'utf8')
  await client.query(migration.replaceAll('"public".', ''))
  return {
    client,
    db: drizzle(client, { schema }),
    async close() {
      await client.query(`DROP SCHEMA ${name} CASCADE`)
      await client.end()
    },
  }
}

// Integration suites skip locally without a database, but must fail in CI instead of silently skipping.
export function integrationSuite(url: string | undefined) {
  if (!url && process.env.CI) throw new Error('PLANFROJEX_TEST_DATABASE_URL is required in CI')
  return url ? describe : describe.skip
}
