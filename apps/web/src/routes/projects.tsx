import { useQuery } from '@tanstack/react-query'
import { createRoute, useLoaderData } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import { useState } from 'react'
import { api, call } from '../api'
import { NewProjectDialog } from '../new-project-dialog'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { Select } from '../ui/select'
import { StatusLabel } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type View = 'all' | 'active' | 'mine' | 'starred'
type Status = 'draft' | 'planning' | 'in-progress' | 'completed' | 'archived'
function Projects() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects' })
  const slug = workspace.slug
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('all')
  const [status, setStatus] = useState<Status | ''>('')
  const [lead, setLead] = useState('')
  const [due, setDue] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const action = useAction()
  const list = useQuery({
    queryKey: ['projects', slug, view, status, lead, due, cursor],
    queryFn: () =>
      call(
        api.workspaces[':ws'].projects.$get({
          param: { ws: slug },
          query: {
            view,
            ...(status && { status }),
            ...(lead && { lead }),
            ...(due && { dueBefore: due }),
            ...(cursor && { cursor }),
          },
        }),
      ),
  })
  const members = useQuery({
    queryKey: ['members', slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: slug } })),
  })
  const counts = list.data?.counts ?? { all: 0, active: 0, mine: 0, starred: 0 }
  return (
    <WorkspaceShell workspace={workspace} me={me} active="projects">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <h1 className="text-title font-semibold">Projects</h1>
        {workspace.role !== 'viewer' && (
          <Button variant="primary" onClick={() => setOpen(true)}>
            New project
          </Button>
        )}
      </header>
      <div className="px-8">
        <Tabs
          value={view}
          onChange={(value) => {
            setView(value as View)
            setCursor(undefined)
          }}
          tabs={[
            { id: 'all', label: `All ${counts.all}` },
            { id: 'active', label: `Active ${counts.active}` },
            { id: 'mine', label: `Led by me ${counts.mine}` },
            { id: 'starred', label: `Starred ${counts.starred}` },
          ]}
        />
        <div className="flex flex-wrap gap-2 border-b border-border py-3">
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status | '')
              setCursor(undefined)
            }}
            className="w-36"
          >
            <option value="">Status</option>
            <option value="draft">Draft</option>
            <option value="planning">Planning</option>
            <option value="in-progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </Select>
          <Select
            aria-label="Lead"
            value={lead}
            onChange={(e) => {
              setLead(e.target.value)
              setCursor(undefined)
            }}
            className="w-36"
          >
            <option value="">Lead</option>
            {members.data?.members.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <div className="w-40">
            <Input
              aria-label="Due before"
              type="date"
              value={due}
              onChange={(e) => {
                setDue(e.target.value)
                setCursor(undefined)
              }}
            />
          </div>
          <span className="ml-auto self-center text-caption text-text-muted">Last updated</span>
        </div>
        {list.isPending ? (
          <p className="py-6">Loading projects…</p>
        ) : list.isError ? (
          <EmptyState
            title="Couldn’t load projects"
            body="Try again to see your projects."
            action={<Button onClick={() => void list.refetch()}>Retry</Button>}
          />
        ) : list.data.projects.length === 0 ? (
          <EmptyState
            title={
              view !== 'all' || status || lead || due ? 'No matching projects' : 'No projects yet'
            }
            body={
              view !== 'all' || status || lead || due
                ? 'Try another view or change the filters.'
                : 'Create a project to start planning.'
            }
            action={
              view === 'all' && !status && !lead && !due && workspace.role !== 'viewer' ? (
                <Button onClick={() => setOpen(true)}>New project</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-ui">
              <thead className="bg-bg-subtle text-text-muted">
                <tr>
                  {['Name', 'Status', 'Lead', 'Team', 'Progress', 'Due', 'Updated', ''].map(
                    (label) => (
                      <th className="p-3 font-normal" key={label}>
                        {label || <span className="sr-only">Star</span>}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {list.data.projects.map((project) => (
                  <tr key={project.id} className="border-b border-border">
                    <td className="p-3 font-medium">{project.name}</td>
                    <td className="p-3">
                      <StatusLabel status={project.status} />
                    </td>
                    <td className="p-3">{project.leadName}</td>
                    <td className="p-3">
                      <Avatar id={project.leadId} name={project.leadName} />
                    </td>
                    <td className="p-3 text-text-muted">No plan yet</td>
                    <td className="p-3 text-text-muted">{project.targetDate || '—'}</td>
                    <td className="p-3 text-text-muted">
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Star}
                        aria-pressed={project.starred}
                        className={project.starred ? '!text-warning [&_svg]:fill-current' : ''}
                        aria-label={`${project.starred ? 'Unstar' : 'Star'} ${project.name}`}
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            if (project.starred)
                              await call(
                                api.projects[':id'].star.$delete({ param: { id: project.id } }),
                              )
                            else
                              await call(
                                api.projects[':id'].star.$put({ param: { id: project.id } }),
                              )
                            await queryClient.invalidateQueries({ queryKey: ['projects', slug] })
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
            {list.data.nextCursor && (
              <Button onClick={() => setCursor(list.data.nextCursor ?? undefined)}>
                Next page
              </Button>
            )}
          </div>
        )}
        <ActionError error={action.error} />
      </div>
      <NewProjectDialog
        open={open}
        onClose={() => setOpen(false)}
        slug={slug}
        userId={me.user.id}
      />
    </WorkspaceShell>
  )
}
export const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/projects',
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: Projects,
})
