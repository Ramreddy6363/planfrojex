import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Icon } from './icon'

const variants = {
  primary: 'bg-accent text-on-accent border-transparent',
  secondary: 'bg-bg text-text border-border-strong',
  ghost: 'bg-transparent text-text border-transparent hover:bg-bg-muted',
  danger: 'bg-bg text-danger border-border-strong',
  'danger-fill': 'bg-danger text-on-accent border-transparent',
  choice: 'bg-bg text-text border-border',
  'choice-selected': 'bg-accent-subtle text-text border-accent',
}

export type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof variants
  size?: 'sm' | 'md' | 'lg' | 'auto'
  icon?: LucideIcon
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center gap-1.5 rounded-control border px-3 text-ui font-medium disabled:opacity-50 ${variant.startsWith('choice') ? 'relative' : ''} ${size === 'sm' ? 'h-control-sm' : size === 'md' ? 'h-control' : size === 'lg' ? 'h-9' : ''} ${variants[variant]} ${className}`}
    {...props}
  >
    {icon && <Icon icon={icon} />}
    {children}
    {variant.startsWith('choice') && (
      <span
        aria-hidden="true"
        className={`absolute right-4 top-4 h-4 w-4 rounded-full border ${variant === 'choice-selected' ? 'border-[5px] border-accent bg-bg' : 'border-border-strong bg-bg'}`}
      />
    )}
  </button>
)
