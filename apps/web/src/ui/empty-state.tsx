import type { LucideIcon } from 'lucide-react'
import { CloudOff, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './button'
import { Icon } from './icon'

export const EmptyState = ({
  title,
  body,
  action,
  icon,
  tone,
}: {
  title: string
  body: string
  action?: ReactNode
  icon?: LucideIcon
  tone?: 'danger'
}) => (
  <div
    role={tone === 'danger' ? 'alert' : undefined}
    className="flex flex-col items-center gap-2 rounded-panel border border-border px-6 py-10 text-center"
  >
    {icon && (
      <span
        className={`mb-1 inline-flex size-11 items-center justify-center rounded-panel border border-border bg-bg-subtle ${tone === 'danger' ? 'text-danger' : 'text-text'}`}
      >
        <Icon icon={icon} />
      </span>
    )}
    <h3 className="text-body font-semibold text-text">{title}</h3>
    <p className="text-ui text-text-muted">{body}</p>
    {action && <div className="pt-2">{action}</div>}
  </div>
)

// The drawn error state: every failed load reads and recovers the same way.
export const ErrorState = ({ title, onRetry }: { title: string; onRetry: () => void }) => (
  <EmptyState
    icon={CloudOff}
    tone="danger"
    title={title}
    body="Check your connection and try again. Nothing you changed was lost."
    action={
      <Button icon={RotateCw} onClick={onRetry}>
        Try again
      </Button>
    }
  />
)
