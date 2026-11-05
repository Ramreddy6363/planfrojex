import { useNavigate } from '@tanstack/react-router'
import { LockKeyhole } from 'lucide-react'
import { CenterShell } from '../layouts'
import { nextPath } from '../session'
import { Button } from '../ui/button'
import { Icon } from '../ui/icon'
import { ActionError, useAction } from '../use-action'

export class NoAccessError extends Error {
  constructor(readonly email: string) {
    super('No access to this workspace')
  }
}

export function NoAccess({ error }: { error: unknown }) {
  const navigate = useNavigate()
  const { busy, error: failure, run } = useAction()
  if (!(error instanceof NoAccessError)) throw error
  return (
    <CenterShell>
      <div className="rounded-panel border border-border p-8 text-center">
        <Icon icon={LockKeyhole} className="mx-auto" />
        <h1 className="text-title font-semibold">You don't have access to this workspace</h1>
        <p className="mt-3 text-text-muted">
          Ask a workspace owner to invite you, or return to your workspace.
        </p>
        <Button
          className="mt-6"
          disabled={busy}
          onClick={() => void run(async () => navigate({ to: await nextPath() }))}
        >
          Return to workspace
        </Button>
        {error.email && (
          <p className="mt-4 text-caption text-text-muted">Signed in as {error.email}</p>
        )}
        <ActionError error={failure} />
      </div>
    </CenterShell>
  )
}
