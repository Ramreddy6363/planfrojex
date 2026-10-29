import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Icon } from './icon'

const variants = {
  primary: 'bg-accent text-on-accent border-transparent',
  secondary: 'bg-bg text-text border-border-strong',
  ghost: 'bg-transparent text-text border-transparent hover:bg-bg-muted',
  danger: 'bg-bg text-danger border-border-strong',
  'danger-fill': 'bg-danger text-on-accent border-transparent',
}

export type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof variants
  size?: 'sm' | 'md'
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
    className={`inline-flex items-center justify-center gap-1.5 rounded-control border px-3 text-ui font-medium disabled:opacity-50 ${size === 'sm' ? 'h-control-sm' : 'h-control'} ${variants[variant]} ${className}`}
    {...props}
  >
    {icon && <Icon icon={icon} />}
    {children}
  </button>
)
