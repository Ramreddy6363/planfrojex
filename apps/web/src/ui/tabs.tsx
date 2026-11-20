import { type KeyboardEvent, type ReactNode, useId } from 'react'

type Tab = { id: string; label: ReactNode; disabled?: boolean }

export const Tabs = ({
  tabs,
  value,
  onChange,
  readOnly = false,
}: {
  tabs: Tab[]
  value: string
  onChange: (id: string) => void
  readOnly?: boolean
}) => {
  const prefix = useId()
  const onKey = (e: KeyboardEvent) => {
    if (readOnly) return
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const available = tabs.filter((t) => !t.disabled)
    const i = available.findIndex((t) => t.id === value)
    const next = available[(i + step + available.length) % available.length]
    if (!next) return
    onChange(next.id)
    document.getElementById(`${prefix}-${next.id}`)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-disabled={readOnly || undefined}
      className="flex min-w-0 gap-6 overflow-x-auto md:overflow-visible"
      onKeyDown={onKey}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${prefix}-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          aria-disabled={t.disabled || undefined}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          onClick={() => !t.disabled && !readOnly && onChange(t.id)}
          className={`h-9 shrink-0 border-b-2 text-ui font-medium ${t.id === value ? 'border-text text-text' : 'border-transparent text-text-muted'} ${t.disabled ? 'cursor-not-allowed opacity-55' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
