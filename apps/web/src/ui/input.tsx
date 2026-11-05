import type { ComponentProps } from 'react'

export const fieldClass =
  'w-full rounded-control border border-border-strong bg-bg px-2.5 text-ui text-text placeholder:text-text-muted aria-invalid:border-danger'

export const Input = ({
  className = '',
  height = 'control',
  ...props
}: ComponentProps<'input'> & { height?: 'control' | 'lg' | 'otp' }) => (
  <input
    className={`${height === 'otp' ? 'h-12' : height === 'lg' ? 'h-9' : 'h-control'} ${fieldClass} ${className}`}
    {...props}
  />
)
