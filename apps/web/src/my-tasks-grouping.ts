export const dueDateGroups = ['Overdue', 'Today', 'This week', 'Later', 'No due date'] as const

// Due dates have no time component. Parse them as local dates so the browser's
// calendar day determines Today and the current Monday–Sunday week.
export function dueDateGroup(dueDate: string | null, now = new Date()) {
  if (!dueDate) return 'No due date'
  const [year = 0, month = 1, day = 1] = dueDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (date < today) return 'Overdue'
  if (date.getTime() === today.getTime()) return 'Today'
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + ((7 - today.getDay()) % 7))
  return date <= endOfWeek ? 'This week' : 'Later'
}

export function formatTaskDueDate(value: string) {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, day),
  )
}
