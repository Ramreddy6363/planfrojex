import { useRouter } from '@tanstack/react-router'
import { CenterShell } from '../layouts'
import { Button } from '../ui/button'

export function LoadError() {
  const router = useRouter()
  return (
    <CenterShell>
      <div role="alert" className="rounded-panel border border-border p-8 text-center">
        <h1 className="text-title font-semibold">Something went wrong</h1>
        <p className="mt-3 text-text-muted">We could not load this page. Please try again.</p>
        <Button className="mt-6" onClick={() => void router.invalidate()}>
          Retry
        </Button>
      </div>
    </CenterShell>
  )
}
