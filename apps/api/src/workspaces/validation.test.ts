import { describe, expect, it } from 'vitest'
import { createWorkspaceSchema, inviteSchema } from './validation'

describe('workspace request validation', () => {
  it('accepts a valid workspace and rejects invalid or reserved slugs', () => {
    expect(
      createWorkspaceSchema.safeParse({ name: 'Northwind', slug: 'northwind', isPersonal: false })
        .success,
    ).toBe(true)
    for (const slug of ['ab', 'Bad-Slug', 'two words', 'api', 'sign-in', '-bad', 'bad-']) {
      expect(
        createWorkspaceSchema.safeParse({ name: 'Northwind', slug, isPersonal: false }).success,
      ).toBe(false)
    }
  })

  it('limits invites to twenty valid email addresses and an assignable role', () => {
    expect(inviteSchema.safeParse({ emails: ['person@example.com'], role: 'editor' }).success).toBe(
      true,
    )
    expect(
      inviteSchema.safeParse({ emails: Array(21).fill('person@example.com'), role: 'viewer' })
        .success,
    ).toBe(false)
    expect(inviteSchema.safeParse({ emails: ['not-an-email'], role: 'viewer' }).success).toBe(false)
    expect(inviteSchema.safeParse({ emails: ['person@example.com'], role: 'owner' }).success).toBe(
      false,
    )
  })

  it('normalizes invitation emails before validation and use', () => {
    expect(
      inviteSchema.parse({ emails: ['  Person@Example.COM  '], role: 'viewer' }).emails,
    ).toEqual(['person@example.com'])
  })

  it.each(['Visit https://evil.example', 'go to www.evil.example', 'two\nlines'])(
    'rejects the workspace name %j',
    (name) => {
      expect(
        createWorkspaceSchema.safeParse({ name, slug: 'northwind', isPersonal: false }).success,
      ).toBe(false)
    },
  )
})
