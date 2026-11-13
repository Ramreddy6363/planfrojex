import { useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData } from '@tanstack/react-router'
import { ArrowUpDown, Plus, Star } from 'lucide-react'
import { useState } from 'react'
import { api, call } from '../api'
import { NewProjectDialog } from '../new-project-dialog'
import { relativeTime } from '../relative-time'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
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
      <header className="flex items-center justify-between border-b border-border px-8 py-3">
        <h1 className="text-title font-semibold">Projects</h1>
        {workspace.role !== 'viewer' && (
          <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
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
        <div className="flex flex-wrap gap-2 border-b border-border py-2.5">
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
          <span className="ml-auto flex items-center gap-1.5 self-center text-caption text-text-muted">
            <Icon icon={ArrowUpDown} />
            Last updated
          </span>
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
            <table className="w-full min-w-[900px] table-fixed text-left text-ui">
              <colgroup>
                <col className="w-[26.5%]" />
                <col className="w-[12.8%]" />
                <col className="w-[16.4%]" />
                <col className="w-[9.3%]" />
                <col className="w-[14.6%]" />
                <col className="w-[7.5%]" />
                <col className="w-[9.5%]" />
                <col className="w-[3.4%]" />
              </colgroup>
              <thead className="bg-bg-subtle text-text-muted">
                <tr>
                  {['Name', 'Status', 'Lead', 'Team', 'Progress', 'Due', 'Updated', ''].map(
                    (label) => (
                      <th className="px-3 py-1.5 text-caption font-normal" key={label}>
                        {label || <span className="sr-only">Star</span>}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {list.data.projects.map((project) => (
                  <tr key={project.id} className="border-b border-border">
                    <td className="truncate px-3 py-1.5 font-medium">
                      <Link
                        to="/$ws/projects/$projectId"
                        params={{ ws: slug, projectId: project.id }}
                        className="hover:text-accent hover:underline"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusLabel status={project.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                        <span className="truncate">{project.leadName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                    </td>
                    <td className="px-3 py-1.5 text-text-muted">No plan yet</td>
                    <td className="px-3 py-1.5 font-mono text-text-muted">
                      {project.targetDate
                        ? new Intl.DateTimeFormat(undefined, {
                            month: 'short',
                            day: 'numeric',
                            timeZone: 'UTC',
                          }).format(new Date(`${project.targetDate}T00:00:00Z`))
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-text-muted">
                      {relativeTime(project.updatedAt)}
                    </td>
                    <td className="px-0 py-1.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Star}
                        aria-pressed={project.starred}
                        className={`px-1.5 ${project.starred ? '!text-warning' : '!text-text-faint'}`}
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
            {view === 'all' && !status && !lead && !due && !cursor && !list.data.nextCursor && (
              <p className="px-3 py-3 text-caption text-text-muted">
                {counts.all} {counts.all === 1 ? 'project' : 'projects'}
              </p>
            )}
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
  remountDeps: ({ params }) => ({ workspace: params.ws }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: Projects,
})
