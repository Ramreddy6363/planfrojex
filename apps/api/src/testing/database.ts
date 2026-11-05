import { readFile } from 'node:fs/promises'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

export async function startTestDatabase() {
  const container = await new PostgreSqlContainer('postgres:17')
    .withDatabase('planfrojex_test')
    .start()
  const client = new Client({ connectionString: container.getConnectionUri() })
  try {
    await client.connect()
    await client.query(await readFile('migrations/0000_kind_thunderbolt.sql', 'utf8'))
  } catch (error) {
    await client.end()
    await container.stop()
    throw error
  }
  return {
    client,
    connectionString: container.getConnectionUri(),
    async stop() {
      await client.end()
      await container.stop()
    },
  }
}
