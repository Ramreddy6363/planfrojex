import { useQuery } from '@tanstack/react-query'
import { createRoute, redirect, useLoaderData } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { api, call, RequestError } from '../api'
import { NewProjectDialog } from '../new-project-dialog'
import { getMe, getWorkspace } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { SkeletonRow } from '../ui/skeleton-row'
import { StatusLabel } from '../ui/status'
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

// ponytail: "your projects" = projects you lead, until project teams exist.
function YourProjects({ slug }: { slug: string }) {
  const list = useQuery({
    queryKey: ['projects', slug, 'home'],
    queryFn: () =>
      call(
        api.workspaces[':ws'].projects.$get({
          param: { ws: slug },
          query: { view: 'mine', limit: '5' },
        }),
      ),
  })
  return (
    <section aria-labelledby="your-projects">
      <h2 id="your-projects" className="mb-4 font-semibold">
        Your projects
      </h2>
      {list.isPending ? (
        <SkeletonRow />
      ) : list.isError ? (
        <p className="text-text-muted">Could not load projects.</p>
      ) : list.data.projects.length === 0 ? (
        <EmptyState title="No projects yet" body="Projects you lead will appear here." />
      ) : (
        <ul className="border-t border-border">
          {list.data.projects.map((project) => (
            <li
              key={project.id}
              className="flex h-11 items-center gap-4 border-b border-border px-3"
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{project.name}</span>
              <span className="w-32">
                <StatusLabel status={project.status} />
              </span>
              <span className="w-36 text-text-muted">No plan yet</span>
              <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
              <span className="w-14 text-right font-mono text-text-muted">
                {project.targetDate
                  ? new Intl.DateTimeFormat(undefined, {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(`${project.targetDate}T00:00:00Z`))
                  : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Workspace() {
  const { workspace, me } = useLoaderData({ from: '/$ws' })
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  return (
    <WorkspaceShell workspace={workspace} me={me} active="home">
      <header className="flex items-center gap-4 border-b border-border px-8 py-3">
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
          icon={Plus}
          disabled={workspace.role === 'viewer'}
          className="ml-auto"
          onClick={() => setNewProjectOpen(true)}
        >
          New project
        </Button>
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-8 p-8">
          <section>
            <h2 className="mb-4 font-semibold">My tasks</h2>
            <EmptyState title="No tasks yet" body="Your tasks will appear here." />
          </section>
          <YourProjects slug={workspace.slug} />
        </div>
        <section className="border-t border-border p-6 lg:min-h-[calc(100vh-56px)] lg:border-t-0 lg:border-l">
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
  remountDeps: ({ params }) => ({ workspace: params.ws }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: Workspace,
})
