import { createRoute, redirect, useLoaderData, useNavigate } from '@tanstack/react-router'
import {
  CheckCircle2,
  FolderKanban,
  House,
  Inbox,
  Search,
  Settings,
  UsersRound,
} from 'lucide-react'
import { RequestError } from '../api'
import { auth } from '../auth-client'
import { getMe, getWorkspace } from '../session'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { Select } from '../ui/select'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { LoadError } from './load-error'
import { NoAccess, NoAccessError } from './no-access'
import { rootRoute } from './root'

function Workspace() {
  const { workspace, me } = useLoaderData({ from: '/$ws' })
  const navigate = useNavigate()
  const { busy, error, run } = useAction()
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <nav
        aria-label="Workspace navigation"
        className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle p-3"
      >
        <Select
          aria-label="Switch workspace"
          value={
            me.workspaces.some((item: { slug: string }) => item.slug === workspace.slug)
              ? workspace.slug
              : ''
          }
          onChange={(event) => void navigate({ to: `/${event.target.value}` })}
        >
          <option value="" disabled>
            Choose a workspace
          </option>
          {me.workspaces.map((item: { id: string; slug: string; name: string }) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" disabled icon={Search} className="mt-3 justify-start">
          Search
        </Button>
        <p className="mt-3 flex items-center gap-2 rounded-control bg-accent-subtle px-2 py-2 text-accent">
          <Icon icon={House} />
          Home
        </p>
        <Button variant="ghost" disabled icon={CheckCircle2} className="justify-start">
          My tasks
        </Button>
        <Button variant="ghost" disabled icon={Inbox} className="justify-start">
          Inbox
        </Button>
        <p className="mt-6 px-2 text-caption text-text-muted">Starred</p>
        <p className="px-2 py-2 text-caption text-text-muted">No starred projects yet</p>
        <p className="mt-6 px-2 text-caption text-text-muted">Workspace</p>
        <Button variant="ghost" disabled icon={FolderKanban} className="justify-start">
          Projects
        </Button>
        <Button variant="ghost" disabled icon={UsersRound} className="justify-start">
          Members
        </Button>
        <Button variant="ghost" disabled icon={Settings} className="justify-start">
          Settings
        </Button>
        <div className="mt-auto border-t border-border pt-3">
          <p className="truncate px-2 text-text-muted">{me.user.email}</p>
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
        </div>
      </nav>
      <main className="min-w-0 flex-1">
        <header className="flex items-center gap-4 border-b border-border px-8 py-4">
          <h1 className="text-title font-semibold">Home</h1>
          <span className="text-text-muted">
            {new Intl.DateTimeFormat(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }).format(new Date())}
          </span>
          <Button variant="primary" disabled className="ml-auto">
            New project
          </Button>
        </header>
        <div className="grid gap-8 p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-8">
            <section>
              <h2 className="mb-4 font-semibold">My tasks</h2>
              <EmptyState title="No tasks yet" body="Your tasks will appear here." />
            </section>
            <section>
              <h2 className="mb-4 font-semibold">Your projects</h2>
              <EmptyState title="No projects yet" body="Your projects will appear here." />
            </section>
          </div>
          <section>
            <h2 className="mb-4 font-semibold">Recent activity</h2>
            <EmptyState title="No activity yet" body="Workspace activity will appear here." />
          </section>
        </div>
      </main>
    </div>
  )
}

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws',
  loader: async ({ params }) => {
    let workspace: Awaited<ReturnType<typeof getWorkspace>>['workspace']
    try {
      ;({ workspace } = await getWorkspace(params.ws))
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
    const me = await getMe().catch((error: unknown) => {
      if (error instanceof RequestError && error.status === 401) throw redirect({ to: '/sign-in' })
      throw error
    })
    localStorage.setItem('lastWorkspace', workspace.slug)
    return { workspace, me }
  },
  errorComponent: ({ error }) =>
    error instanceof NoAccessError ? <NoAccess error={error} /> : <LoadError />,
  component: Workspace,
})
