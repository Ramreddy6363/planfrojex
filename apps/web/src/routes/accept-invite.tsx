import { createRoute, redirect, useLoaderData, useNavigate } from '@tanstack/react-router'
import { RequestError } from '../api'
import { inviteAcceptMessage } from '../auth-errors'
import { AuthShell } from '../layouts'
import { acceptInvite, getMe, nextPath } from '../session'
import { Button } from '../ui/button'
import { ActionError, useAction } from '../use-action'
import { rootRoute } from './root'

function AcceptInvite() {
  const { error } = useLoaderData({ from: '/invite/$token' })
  const navigate = useNavigate()
  const action = useAction()
  return (
    <AuthShell>
      <ActionError error={error || action.error} />
      <Button
        variant="ghost"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            sessionStorage.removeItem('invite')
            await navigate({ to: await nextPath() })
          })
        }
      >
        Continue without invitation
      </Button>
    </AuthShell>
  )
}

export const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  beforeLoad: async ({ params }) => {
    sessionStorage.setItem('invite', params.token)
    try {
      await getMe()
    } catch {
      throw redirect({ to: '/sign-in' })
    }
  },
  loader: async ({ params }) => {
    let to: string
    try {
      to = await acceptInvite(params.token)
    } catch (error) {
      return {
        error: inviteAcceptMessage(error instanceof RequestError ? { status: error.status } : {}),
      }
    }
    throw redirect({ to })
  },
  component: AcceptInvite,
})
