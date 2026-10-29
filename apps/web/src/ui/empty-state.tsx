import type { ReactNode } from 'react'

export const EmptyState = ({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) => (
  <div className="flex flex-col items-center gap-2 rounded-panel border border-border px-6 py-10 text-center">
    <h3 className="text-body font-semibold text-text">{title}</h3>
    <p className="text-ui text-text-muted">{body}</p>
    {action && <div className="pt-2">{action}</div>}
  </div>
)
