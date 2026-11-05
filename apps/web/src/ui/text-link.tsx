import type { ComponentProps } from 'react'

const textLinkClass = 'inline p-0 font-normal text-accent underline-offset-2 hover:underline'

export function TextLink({ className = '', ...props }: ComponentProps<'a'>) {
  return <a className={`${textLinkClass} ${className}`} {...props} />
}

export function TextAction({
  className = '',
  type = 'button',
  ...props
}: ComponentProps<'button'>) {
  return <button type={type} className={`${textLinkClass} ${className}`} {...props} />
}
