import { type KeyboardEvent, useId } from 'react'

type Tab = { id: string; label: string }

export const Tabs = ({
  tabs,
  value,
  onChange,
}: {
  tabs: Tab[]
  value: string
  onChange: (id: string) => void
}) => {
  const prefix = useId()
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const i = tabs.findIndex((t) => t.id === value)
    const next = tabs[(i + step + tabs.length) % tabs.length]
    if (!next) return
    onChange(next.id)
    document.getElementById(`${prefix}-${next.id}`)?.focus()
  }
  return (
    <div role="tablist" className="flex gap-6" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${prefix}-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`h-9 border-b-2 text-ui font-medium ${t.id === value ? 'border-text text-text' : 'border-transparent text-text-muted'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
