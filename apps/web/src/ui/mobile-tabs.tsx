import type { LucideIcon } from 'lucide-react'
import { Icon } from './icon'

export type MobileTab = {
  id: string
  label: string
  icon: LucideIcon
  href: string
  count?: number
  onSelect?: () => void
}

export function MobileTabs({
  items,
  active,
  className = '',
}: {
  items: MobileTab[]
  active: string
  className?: string
}) {
  return (
    <nav
      aria-label="Mobile navigation"
      className={`grid grid-cols-4 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] ${className}`}
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={active === item.id ? 'page' : undefined}
          onClick={(event) => {
            if (!item.onSelect || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
              return
            event.preventDefault()
            item.onSelect()
          }}
          className={`flex min-h-19 min-w-11 flex-col items-center justify-center gap-1 text-[11px] leading-4 ${active === item.id ? 'text-accent' : 'text-text-muted'}`}
        >
          <span className="relative">
            <Icon icon={item.icon} className="!size-5" />
            {item.count ? (
              <span className="absolute -top-2 -right-3 min-w-4 rounded-control bg-accent px-1 text-center text-[10px] leading-4 text-on-accent">
                {item.count}
              </span>
            ) : null}
          </span>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  )
}
