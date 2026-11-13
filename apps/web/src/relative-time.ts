// "Just now", "45m ago", "2h ago" (same day), "Yesterday", then "Oct 9".
export function relativeTime(iso: string, now = new Date()) {
  const then = new Date(iso)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(then)) / 86400000)
  if (days === 0) return `${Math.floor(minutes / 60)}h ago`
  if (days === 1) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(then)
}
