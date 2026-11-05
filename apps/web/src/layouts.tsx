import type { ReactNode } from 'react'
import { Brand } from './ui/brand'

export const label = 'block text-ui font-medium mb-1.5'

export const Loading = () => <p className="p-8">Loading…</p>

// Sign-in style pages: form on the left, product preview on the right.
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        <section className="flex w-full max-w-[560px] flex-col px-8 py-10 sm:px-16">
          <Brand />
          <div className="flex flex-1 flex-col justify-center py-12">
            <div className="w-full max-w-[360px]">{children}</div>
          </div>
          {footer && <div className="pb-2">{footer}</div>}
        </section>
        <aside
          aria-hidden="true"
          className="relative hidden flex-1 overflow-hidden border-l border-border bg-bg-subtle lg:block"
        >
          <img
            src="/auth-preview.png"
            alt=""
            className="absolute left-[-63.6%] top-0 w-[163.6%] max-w-none"
          />
        </aside>
      </div>
    </main>
  )
}

export function OnboardingShell({
  children,
  previewTitle,
  preview,
  footer,
  compact = false,
}: {
  children: ReactNode
  previewTitle: string
  preview: ReactNode
  footer?: ReactNode
  compact?: boolean
}) {
  return (
    <div className="min-h-screen bg-bg-subtle text-text">
      <header className="flex items-center justify-between gap-4 px-8 pt-5">
        <Brand />
        <span className="truncate text-caption text-text-muted">
          {sessionStorage.getItem('email') ?? ''}
        </span>
      </header>
      <main className="flex w-full flex-col px-8 pb-10">
        <div
          className={`mx-auto w-full max-w-[480px] rounded-panel border border-border bg-bg p-8 ${compact ? 'mt-11' : 'mt-15'}`}
        >
          {children}
        </div>
        <div className="mx-auto mt-6 w-full max-w-[480px]">
          <div className="flex items-center gap-2 text-caption text-text-muted">
            <span className="h-px flex-1 bg-border" />
            <p className="text-center">{previewTitle}</p>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-4">{preview}</div>
          {footer}
        </div>
      </main>
    </div>
  )
}

export function CenterShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-bg text-text">
      <section className="flex min-h-screen w-full flex-col px-8 py-10">
        <Brand />
        <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center py-12">
          {children}
        </div>
      </section>
    </main>
  )
}
