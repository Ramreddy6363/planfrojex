import { describe, expect, it } from 'vitest'
import { dueDateGroup } from './my-tasks-grouping'

describe('My tasks due date groups', () => {
  const now = new Date(2026, 10, 17, 23, 30)

  it('uses browser calendar dates for overdue, today, this week, later and no date', () => {
    expect(dueDateGroup('2026-11-16', now)).toBe('Overdue')
    expect(dueDateGroup('2026-11-17', now)).toBe('Today')
    expect(dueDateGroup('2026-11-22', now)).toBe('This week')
    expect(dueDateGroup('2026-11-23', now)).toBe('Later')
    expect(dueDateGroup(null, now)).toBe('No due date')
  })

  it('treats Sunday as the end of the current week and rolls over at local midnight', () => {
    expect(dueDateGroup('2026-11-23', new Date(2026, 10, 22, 23, 59))).toBe('Later')
    expect(dueDateGroup('2026-11-22', new Date(2026, 10, 23, 0, 1))).toBe('Overdue')
    expect(dueDateGroup('2026-11-23', new Date(2026, 10, 23, 0, 1))).toBe('Today')
  })
})
