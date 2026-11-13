import { X } from 'lucide-react'
import { Button } from './button'

export function EmailListInput({
  id,
  values,
  onChange,
  input,
  onInputChange,
}: {
  id: string
  values: string[]
  onChange: (values: string[]) => void
  input: string
  onInputChange: (value: string) => void
}) {
  return (
    <div className="flex min-h-control flex-wrap items-center gap-1 rounded-control border border-border-strong bg-bg p-1 focus-within:outline focus-within:outline-2 focus-within:outline-accent">
      {values.map((value) => (
        <span
          key={value}
          className="flex items-center rounded-control bg-bg-subtle px-2 text-caption text-text"
        >
          {value}
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label={`Remove ${value}`}
            className="h-6 px-1"
            onClick={() => onChange(values.filter((item) => item !== value))}
          />
        </span>
      ))}
      <input
        id={id}
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== ',' && event.key !== 'Enter') return
          event.preventDefault()
          const next = input
            .split(/[\n,]+/)
            .map((item) => item.trim())
            .filter(Boolean)
          if (next.length) onChange([...new Set([...values, ...next])])
          onInputChange('')
        }}
        className="min-w-32 flex-1 bg-transparent px-1 text-ui text-text outline-none focus-visible:outline-none"
      />
    </div>
  )
}
