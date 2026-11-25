import { useRouter } from '@tanstack/react-router'
import { CenterShell } from '../layouts'
import { ErrorState } from '../ui/empty-state'

export function LoadError() {
  const router = useRouter()
  return (
    <CenterShell>
      <ErrorState title="Something went wrong" onRetry={() => void router.invalidate()} />
    </CenterShell>
  )
}
