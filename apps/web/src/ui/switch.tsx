import type { ComponentProps } from 'react'

export function Switch({
  checked,
  className = '',
  ...props
}: Omit<ComponentProps<'button'>, 'role' | 'aria-checked'> & { checked: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative h-5 w-8.5 shrink-0 rounded-full disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-border-strong'} ${className}`}
      {...props}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 size-4 rounded-full bg-bg ${checked ? 'right-0.5' : 'left-0.5'}`}
      />
    </button>
  )
}
