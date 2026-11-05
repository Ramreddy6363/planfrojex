import type { TextareaHTMLAttributes } from 'react'
import { fieldClass } from './input'

export const Textarea = ({
  className = '',
  height = 'default',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { height?: 'default' | 'invite' }) => (
  <textarea
    className={`${height === 'invite' ? 'h-18' : 'h-22'} resize-none py-2.5 ${fieldClass} ${className}`}
    {...props}
  />
)
