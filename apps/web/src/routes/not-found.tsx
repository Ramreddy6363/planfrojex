import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, call, RequestError } from '../api'
import { CenterShell } from '../layouts'
import { nextPath } from '../session'
import { Button } from '../ui/button'
import { ErrorState } from '../ui/empty-state'
import { ActionError, useAction } from '../use-action'

// Tick marks along a line, with a marker above the middle: the page that is not on the plan.
const ticks = Array.from({ length: 21 }, (_, n) => n)

export function NotFound() {
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['me'], queryFn: () => call(api.me.$get()) })
  const { busy, error, run } = useAction()
  const signedOut = me.error instanceof RequestError && me.error.status === 401
  return (
    <CenterShell>
      <div className="text-center">
        <svg
          width="260"
          height="40"
          viewBox="0 0 260 40"
          fill="none"
          aria-hidden
          className="mx-auto text-text-faint"
        >
          <path d="M0 30h260" stroke="currentColor" />
          {ticks.map((n) => (
            <path
              key={n}
              d={`M${n * 13} ${n % 5 === 0 ? 24 : 27}v${n % 5 === 0 ? 12 : 6}`}
              stroke="currentColor"
            />
          ))}
          <path d="M130 2l5 5-5 5-5-5z" stroke="currentColor" />
          <path d="M130 12v14" stroke="currentColor" />
        </svg>
        <p className="mt-6 font-mono text-caption text-text-faint">404</p>
        <h1 className="mt-4 text-display font-semibold">This page isn't on the plan</h1>
        <p className="mt-4 text-text-muted">
          The link may be old, or the project was moved or deleted.
        </p>
        {me.isPending ? null : me.isError && !signedOut ? (
          <div className="mt-8">
            <ErrorState title="Couldn’t check your sign-in" onRetry={() => void me.refetch()} />
          </div>
        ) : (
          <Button
            variant="primary"
            className="mt-8"
            disabled={busy}
            onClick={() =>
              void run(async () => navigate({ to: me.isSuccess ? await nextPath() : '/sign-in' }))
            }
          >
            {me.isSuccess ? 'Go to Home' : 'Sign in'}
          </Button>
        )}
        <ActionError error={error} />
      </div>
    </CenterShell>
  )
}
