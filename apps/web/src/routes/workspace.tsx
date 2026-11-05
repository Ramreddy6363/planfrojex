import { createRoute, redirect, useLoaderData, useNavigate } from '@tanstack/react-router'
import { RequestError } from '../api'
import { auth } from '../auth-client'
import { AuthShell } from '../layouts'
import { getMe, getWorkspace } from '../session'
import { Button } from '../ui/button'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { LoadError } from './load-error'
import { NoAccess, NoAccessError } from './no-access'
import { rootRoute } from './root'

function Workspace() {
  const { workspace } = useLoaderData({ from: '/$ws' })
  const navigate = useNavigate()
  const { busy, error, run } = useAction()
  return (
    <AuthShell>
      <h1 className="text-display font-semibold">{workspace.name}</h1>
      <p className="mt-4 text-body text-text-muted">Your workspace is ready.</p>
      <Button
        className="mt-6 self-start"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const { error } = await auth.signOut()
            if (error) throw new UserError('Could not sign out. Try again.')
            sessionStorage.removeItem('displayName')
            await navigate({ to: '/sign-in' })
          })
        }
      >
        Sign out
      </Button>
      <ActionError error={error} />
    </AuthShell>
  )
}

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws',
  loader: async ({ params }) => {
    try {
      const { workspace } = await getWorkspace(params.ws)
      localStorage.setItem('lastWorkspace', workspace.slug)
      return { workspace }
    } catch (error) {
      if (!(error instanceof RequestError)) throw error
      if (error.status === 401) throw redirect({ to: '/sign-in' })
      if (error.status !== 404) throw error
      const email = await getMe().then(
        (me) => me.user.email,
        () => '',
      )
      throw new NoAccessError(email)
    }
  },
  errorComponent: ({ error }) =>
    error instanceof NoAccessError ? <NoAccess error={error} /> : <LoadError />,
  component: Workspace,
})
