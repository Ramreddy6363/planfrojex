import type { LucideIcon } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from './button'
import { Icon } from './icon'

export type MenuItem = {
  label: string
  icon: LucideIcon
  onSelect: () => void
  danger?: boolean
  separated?: boolean
}

// Native popover: light dismiss, Esc, and focus return to the trigger. We add placement and arrow keys.
export const Menu = ({ label, items }: { label: string; items: MenuItem[] }) => {
  const id = useId()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const buttons = () => [...(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]

  const onToggle = (e: { newState: string }) => {
    setOpen(e.newState === 'open')
    if (e.newState !== 'open' || !list.current || !trigger.current) return
    const r = trigger.current.getBoundingClientRect()
    const l = list.current
    const below = r.bottom + 4
    l.style.left = `${Math.max(8, Math.min(r.left, innerWidth - l.offsetWidth - 8))}px`
    l.style.top = `${below + l.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - l.offsetHeight - 4) : below}px`
    buttons()[0]?.focus()
  }

  // Fixed placement goes stale on scroll or resize, so close instead of chasing the trigger.
  useEffect(() => {
    if (!open) return
    const close = () => list.current?.hidePopover()
    addEventListener('scroll', close, true)
    addEventListener('resize', close)
    return () => {
      removeEventListener('scroll', close, true)
      removeEventListener('resize', close)
    }
  }, [open])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Tab') return list.current?.hidePopover()
    const all = buttons()
    const i = all.indexOf(document.activeElement as HTMLElement)
    const to =
      e.key === 'ArrowDown'
        ? (i + 1) % all.length
        : e.key === 'ArrowUp'
          ? (i - 1 + all.length) % all.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : -1
    if (to < 0) return
    e.preventDefault()
    all[to]?.focus()
  }

  return (
    <>
      <Button ref={trigger} popoverTarget={id} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </Button>
      <div
        ref={list}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onToggle={onToggle}
        onKeyDown={onKey}
        className="fixed m-0 w-55 flex-col gap-0.5 rounded-panel border border-border bg-bg p-1 text-text shadow-float [&:popover-open]:flex"
      >
        {items.map((it, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, labels may repeat
          <div key={i} className="contents">
            {it.separated && <hr className="my-0.5 h-px border-0 bg-border" />}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                list.current?.hidePopover()
                it.onSelect()
              }}
              className={`flex h-7.5 items-center gap-2 rounded-control px-2 text-ui hover:bg-bg-muted focus-visible:bg-bg-muted ${it.danger ? 'text-danger' : 'text-text'}`}
            >
              <Icon icon={it.icon} className={it.danger ? '' : 'text-text-muted'} />
              {it.label}
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
