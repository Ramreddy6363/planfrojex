import { createRoute, redirect, useLoaderData } from '@tanstack/react-router'
import { useState } from 'react'
import { RequestError } from '../api'
import { NewProjectDialog } from '../new-project-dialog'
import { getMe, getWorkspace } from '../session'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { WorkspaceShell } from '../workspace-shell'
import { LoadError } from './load-error'
import { NoAccess, NoAccessError } from './no-access'
import { rootRoute } from './root'

export async function loadWorkspace(slug: string) {
  let workspace: Awaited<ReturnType<typeof getWorkspace>>['workspace']
  try {
    ;({ workspace } = await getWorkspace(slug))
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
}

export function WorkspaceError({ error }: { error: unknown }) {
  return error instanceof NoAccessError ? <NoAccess error={error} /> : <LoadError />
}

function Workspace() {
  const { workspace, me } = useLoaderData({ from: '/$ws' })
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  return (
    <WorkspaceShell workspace={workspace} me={me} active="home">
      <header className="flex items-center gap-4 border-b border-border px-8 py-4">
        <h1 className="text-title font-semibold">Home</h1>
        <span className="text-text-muted">
          {new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          }).format(new Date())}
        </span>
        <Button
          variant="primary"
          disabled={workspace.role === 'viewer'}
          className="ml-auto"
          onClick={() => setNewProjectOpen(true)}
        >
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
      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        slug={workspace.slug}
        userId={me.user.id}
      />
    </WorkspaceShell>
  )
}

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws',
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: Workspace,
})
