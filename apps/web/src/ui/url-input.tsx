import type { ComponentProps } from 'react'

export function UrlInput({ className = '', ...props }: ComponentProps<'input'>) {
  return (
    <fieldset
      aria-label="Workspace URL"
      className="flex h-control w-full items-center rounded-control border border-border-strong bg-bg px-2.5 text-ui text-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
    >
      <span className="shrink-0 text-text-muted">planfrojex.app/</span>
      <input className={`min-w-0 flex-1 bg-transparent outline-none ${className}`} {...props} />
    </fieldset>
  )
}
