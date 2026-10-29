import type { InputHTMLAttributes } from 'react'

export const fieldClass =
  'w-full rounded-control border border-border-strong bg-bg px-2.5 text-ui text-text placeholder:text-text-muted'

export const Input = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`h-control ${fieldClass} ${className}`} {...props} />
)
