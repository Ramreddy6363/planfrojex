import type { TextareaHTMLAttributes } from 'react'
import { fieldClass } from './input'

export const Textarea = ({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={`h-22 resize-none py-2.5 ${fieldClass} ${className}`} {...props} />
)
