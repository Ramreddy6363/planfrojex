import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { account, invites, workspaces } from './schema'

describe('authentication schema', () => {
  it('does not store passwords', () => {
    expect(getTableConfig(account).columns.map((column) => column.name)).not.toContain('password')
  })
  it('provides database defaults for workspace and invite IDs', () => {
    for (const table of [workspaces, invites]) {
      const id = getTableConfig(table).columns.find((column) => column.name === 'id')
      expect(id?.hasDefault).toBe(true)
    }
  })
})
