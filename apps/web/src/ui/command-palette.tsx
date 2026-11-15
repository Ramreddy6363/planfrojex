import { Search } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Button } from './button'
import { Dialog } from './dialog'
import { Icon } from './icon'
import { Input } from './input'

export type CommandPaletteItem = {
  id: string
  label: string
  leading: ReactNode
  content: ReactNode
  trailing?: ReactNode
  onSelect: () => void
}
export type CommandPaletteGroup = { label: string; items: CommandPaletteItem[] }
export function CommandPalette({
  open,
  onClose,
  query,
  onQueryChange,
  groups,
  loading = false,
  error,
  onRetry,
}: {
  open: boolean
  onClose: () => void
  query: string
  onQueryChange: (query: string) => void
  groups: CommandPaletteGroup[]
  loading?: boolean
  error?: string
  onRetry?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const visibleGroups = loading ? [] : groups
  const items = visibleGroups.flatMap((group) => group.items)
  const [active, setActive] = useState(0)
  const selected = items[active]
  useEffect(() => {
    if (open) {
      input.current?.focus()
      setActive(0)
    }
  }, [open])
  useEffect(() => {
    if (selected)
      document.getElementById(`${listId}-${selected.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, listId])
  return (
    <Dialog
      plain
      title="Search"
      open={open}
      onClose={onClose}
      footer={
        <footer className="flex h-9 items-center gap-5 rounded-b-panel border-t border-border bg-bg-subtle px-4 text-caption text-text-muted">
          <span>
            <kbd className="font-mono text-text">↑ ↓</kbd> to move
          </span>
          <span>
            <kbd className="font-mono text-text">↵</kbd> to open
          </span>
          <span>
            <kbd className="font-mono text-text">esc</kbd> to close
          </span>
        </footer>
      }
    >
      <div className="flex h-[52px] items-center gap-3 border-b border-border px-4">
        <Icon icon={Search} className="shrink-0" />
        <Input
          ref={input}
          role="combobox"
          aria-label="Search projects, tasks and commands"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={100}
          value={query}
          placeholder="Search projects, tasks and commands…"
          className="!h-auto !border-0 !px-0 !outline-none"
          onChange={(event) => {
            setActive(0)
            onQueryChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) =>
                items.length
                  ? (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  : 0,
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              selected?.onSelect()
            }
          }}
        />
        <kbd className="font-mono text-caption text-text-faint">esc</kbd>
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="max-h-[calc(100vh-232px)] overflow-y-auto px-1.5 py-2"
      >
        {loading ? (
          <p role="status" className="px-2.5 py-2 text-caption text-text-muted">
            Searching…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="px-2.5 py-2 text-caption text-danger">
            {error}{' '}
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          </p>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <p className="px-2.5 py-6 text-text-muted">No results</p>
        ) : null}
        {visibleGroups
          .filter((group) => group.items.length)
          .map((group) => (
            <fieldset key={group.label} aria-label={group.label}>
              <legend className="px-2.5 pb-1 pt-2 text-caption text-text-muted">
                {group.label}
              </legend>
              {group.items.map((item) => (
                <Button
                  variant="ghost"
                  size="auto"
                  tabIndex={-1}
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-label={item.label}
                  aria-selected={selected?.id === item.id}
                  onMouseEnter={() => setActive(items.findIndex((value) => value.id === item.id))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={item.onSelect}
                  className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-left !font-normal ${selected?.id === item.id ? '!bg-bg-muted' : ''}`}
                >
                  <span className="shrink-0 text-text-muted">{item.leading}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">{item.content}</span>
                  {item.trailing ? (
                    <span className="ml-auto shrink-0 text-caption text-text-muted">
                      {item.trailing}
                    </span>
                  ) : null}
                </Button>
              ))}
            </fieldset>
          ))}
      </div>
    </Dialog>
  )
}
