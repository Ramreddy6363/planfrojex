import { describe, expect, it } from 'vitest'
import { personalSlug, slugForName } from './workspace-slug'

describe('personal workspace slugs', () => {
  it('makes short and punctuation-only names valid', () => {
    expect(slugForName('Jo')).toBe('jo-space')
    expect(slugForName('!')).toBe('my-space')
  })
  it('drops possessives and trailing generic words', () => {
    expect(slugForName("Maya's projects")).toBe('maya')
    expect(slugForName('Maya’s Workspace')).toBe('maya')
    expect(slugForName('Northwind Team Projects')).toBe('northwind')
    expect(slugForName('Acme Labs')).toBe('acme-labs')
    expect(slugForName('Team')).toBe('team')
    expect(slugForName("Jo's team")).toBe('jo-space')
  })
  it('adds a suffix on collision without exceeding the maximum length', () => {
    expect(personalSlug('jo-space', 1)).toBe('jo-space-2')
    expect(personalSlug('a'.repeat(40), 1)).toBe(`${'a'.repeat(38)}-2`)
  })
})
