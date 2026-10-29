import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'
import { Icon } from './icon'
import { fieldClass } from './input'

export const Select = ({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <span className="relative block">
    <select className={`h-control appearance-none pr-8 ${fieldClass} ${className}`} {...props} />
    <Icon
      icon={ChevronDown}
      className="pointer-events-none absolute top-2 right-2.5 text-text-muted"
    />
  </span>
)
