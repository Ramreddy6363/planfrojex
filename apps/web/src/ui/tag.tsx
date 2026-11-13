import type { ReactNode } from 'react'

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-control border border-border bg-bg-subtle px-2 text-caption text-text-muted">
      {children}
    </span>
  )
}
