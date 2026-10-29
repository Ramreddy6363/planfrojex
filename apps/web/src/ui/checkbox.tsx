import { Check } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

// Pass aria-label or wrap in a <label>; the box has no text of its own.
export const Checkbox = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <span className={`relative inline-flex size-4 ${className}`}>
    <input
      type="checkbox"
      className="peer size-4 appearance-none rounded-sm border border-border-strong bg-bg checked:border-accent checked:bg-accent"
      {...props}
    />
    <Check
      size={12}
      strokeWidth={2}
      aria-hidden
      className="pointer-events-none absolute top-0.5 left-0.5 hidden text-on-accent peer-checked:block"
    />
  </span>
)
