import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Button } from './button'
import { Icon } from './icon'

// Native <dialog>: focus trap, Esc, and focus return come from the platform.
export const Dialog = ({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  extraWide = false,
  widthClassName,
  sidebar,
  plain = false,
  fullHeight = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer: ReactNode
  wide?: boolean
  extraWide?: boolean
  widthClassName?: string
  sidebar?: ReactNode
  plain?: boolean
  fullHeight?: boolean
}) => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`${plain ? 'mx-auto mt-[120px] w-160 max-md:mt-0 max-md:h-dvh max-md:rounded-none' : `m-auto ${widthClassName ?? (extraWide ? 'w-190 md:-translate-y-5' : wide ? 'w-150' : 'w-110')}`} max-w-[calc(100vw-32px)] rounded-panel border border-border bg-bg p-0 text-text shadow-float backdrop:bg-scrim max-md:m-0 max-md:mt-auto max-md:w-full max-md:max-w-full max-md:max-h-dvh max-md:overflow-y-auto max-md:rounded-b-none ${fullHeight ? 'max-md:h-dvh max-md:rounded-none' : ''}`}
    >
      {plain ? (
        <>
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
          {children}
          {footer}
        </>
      ) : (
        <div
          className={`${sidebar ? `grid md:grid-cols-[250px_minmax(0,1fr)] ${extraWide ? 'md:min-h-[500px]' : ''}` : ''} ${fullHeight ? 'max-md:min-h-full' : ''}`}
        >
          {sidebar && (
            <aside className="border-b border-border bg-bg-subtle p-2 md:border-b-0 md:border-r">
              {sidebar}
            </aside>
          )}
          <div className="flex min-w-0 flex-col">
            <div className="flex items-start justify-between px-5 py-4">
              <h2 id={titleId} className="text-dialog font-semibold">
                {title}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close"
                onClick={() => ref.current?.close()}
                className="-m-1 px-1.5 max-md:!size-11"
              >
                <Icon icon={X} className="text-text-muted" />
              </Button>
            </div>
            <div className="px-5 pb-5 text-body text-text-muted">{children}</div>
            <div className="mt-auto flex justify-end gap-2 rounded-b-panel border-t border-border bg-bg-subtle px-5 py-3">
              {footer}
            </div>
          </div>
        </div>
      )}
    </dialog>
  )
}
