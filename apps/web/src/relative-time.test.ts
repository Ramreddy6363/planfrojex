import { expect, it } from 'vitest'
import { relativeTime } from './relative-time'

const now = new Date('2026-11-13T12:00:00')
const at = (s: string) => new Date(s).toISOString()

it('shows recent, yesterday and older updates like the design', () => {
  expect(relativeTime(at('2026-11-13T11:59:30'), now)).toBe('Just now')
  expect(relativeTime(at('2026-11-13T11:15:00'), now)).toBe('45m ago')
  expect(relativeTime(at('2026-11-13T10:00:00'), now)).toBe('2h ago')
  expect(relativeTime(at('2026-11-12T09:00:00'), now)).toBe('Yesterday')
  const old = new Date('2026-10-09T09:00:00')
  expect(relativeTime(old.toISOString(), now)).toBe(
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(old),
  )
})
