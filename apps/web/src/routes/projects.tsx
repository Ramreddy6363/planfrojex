import { useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpDown,
  ChevronsUpDown,
  FolderKanban,
  LogOut,
  Plus,
  Settings,
  Star,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { api, call } from '../api'
import { auth } from '../auth-client'
import { NewProjectDialog } from '../new-project-dialog'
import { relativeTime } from '../relative-time'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { WorkspaceMark } from '../ui/brand'
import { Button } from '../ui/button'
import { EmptyState, ErrorState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { Input } from '../ui/input'
import { Menu } from '../ui/menu'
import { Select } from '../ui/select'
import { SkeletonRows } from '../ui/skeleton-row'
import { StatusGlyph, StatusLabel } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { WorkspaceSearchButton, WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type View = 'all' | 'active' | 'mine' | 'starred'
type Status = 'draft' | 'planning' | 'in-progress' | 'completed' | 'archived'
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia('(max-width: 767px)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const phoneSnapshot = () => window.matchMedia('(max-width: 767px)').matches
const shortDate = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${date}T00:00:00Z`))
    : '—'

function MobileProjectRow({
  project,
  slug,
  busy,
  onStar,
}: {
  project: {
    id: string
    name: string
    status: Status
    leadId: string | null
    leadName: string | null
    targetDate: string | null
    starred: boolean
  }
  slug: string
  busy: boolean
  onStar: () => void
}) {
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false)
  const detail = useQuery({
    queryKey: ['project', project.id],
    queryFn: () => call(api.projects[':id'].$get({ param: { id: project.id } })),
    enabled: phone,
  })
  const progress = detail.data?.project.taskProgress
  return (
    <li className="min-h-20 border-b border-border px-4 pb-3">
      <div className="flex min-w-0 items-center gap-1">
        <Link
          to="/$ws/projects/$projectId"
          params={{ ws: slug, projectId: project.id }}
          className="flex min-h-11 min-w-0 flex-1 items-center font-semibold"
        >
          <span className="truncate">{project.name}</span>
        </Link>
        <Button
          variant="ghost"
          size="auto"
          icon={Star}
          aria-label={`${project.starred ? 'Unstar' : 'Star'} ${project.name}`}
          aria-pressed={project.starred}
          disabled={busy}
          className={`size-11 shrink-0 px-0 ${project.starred ? '!text-warning' : '!text-text-faint'}`}
          onClick={onStar}
        />
        <Avatar
          id={project.leadId}
          name={project.leadName ?? 'Deleted user'}
          className="!size-5.5"
        />
      </div>
      <div className="flex min-w-0 items-center gap-3 text-caption text-text-muted">
        {progress?.total ? (
          <>
            <StatusLabel status={project.status} />
            <span
              role="progressbar"
              aria-label={`${project.name} task progress`}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-1 w-14 shrink-0 overflow-hidden rounded-control bg-bg-muted"
            >
              <span
                className={`block h-full rounded-control ${project.status === 'completed' ? 'bg-success' : 'bg-accent'}`}
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </span>
            <span className="font-mono text-caption">
              {progress.done}/{progress.total}
            </span>
          </>
        ) : detail.isError ? (
          <span>Couldn’t load progress</span>
        ) : progress ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusGlyph status="draft" />
            Draft · No plan yet
          </span>
        ) : (
          <span>Loading progress…</span>
        )}
        {progress?.total ? (
          <span className="ml-auto shrink-0 font-mono">{shortDate(project.targetDate)}</span>
        ) : null}
      </div>
    </li>
  )
}
function Projects() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects' })
  const navigate = useNavigate()
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
      <header className="flex h-16 items-center justify-between gap-2 px-4 md:h-auto md:border-b md:border-border md:px-8 md:py-3">
        <span className="mr-1 md:hidden">
          <Menu
            label="Workspace menu"
            triggerClassName="!size-11 !border-0 !p-0"
            triggerContent={<WorkspaceMark name={workspace.name} />}
            items={[
              ...me.workspaces.map((item: { name: string; slug: string }) => ({
                label: item.name,
                icon: ChevronsUpDown,
                current: item.slug === slug,
                onSelect: () => void navigate({ to: `/${item.slug}/projects` }),
              })),
              {
                label: 'Members',
                icon: UsersRound,
                onSelect: () => void navigate({ to: `/${slug}/members` }),
              },
              {
                label: 'Settings',
                icon: Settings,
                onSelect: () => void navigate({ to: `/${slug}/settings` }),
              },
              {
                label: 'Account settings',
                icon: UserRound,
                onSelect: () => void navigate({ to: `/${slug}/account` }),
              },
              {
                label: 'Sign out',
                icon: LogOut,
                separated: true,
                onSelect: () =>
                  void action.run(async () => {
                    const { error } = await auth.signOut()
                    if (error) throw new UserError('Could not sign out. Try again.')
                    sessionStorage.removeItem('displayName')
                    await navigate({ to: '/sign-in' })
                  }),
              },
            ]}
          />
        </span>
        <h1 className="text-title font-semibold">Projects</h1>
        <WorkspaceSearchButton
          aria-label="Search projects"
          className="ml-auto size-11 px-0 md:hidden"
        />
        {workspace.role !== 'viewer' && (
          <Button
            variant="primary"
            icon={Plus}
            aria-label="New project"
            className="h-11 w-11 px-0 md:ml-auto md:h-control md:w-auto md:px-3"
            onClick={() => setOpen(true)}
          >
            <span className="hidden md:inline">New project</span>
          </Button>
        )}
      </header>
      <div className="md:px-8">
        <div className="overflow-x-auto border-b border-border px-4 md:overflow-visible md:border-0 md:px-0 [&_[role=tablist]]:w-max md:[&_[role=tablist]]:w-auto [&_[role=tab]]:h-11 md:[&_[role=tab]]:h-9">
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
        </div>
        <div className="hidden flex-wrap gap-2 border-b border-border py-2.5 md:flex">
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
          <SkeletonRows />
        ) : list.isError ? (
          <ErrorState title="Couldn’t load projects" onRetry={() => void list.refetch()} />
        ) : list.data.projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={
              view !== 'all' || status || lead || due ? 'No matching projects' : 'No projects yet'
            }
            body={
              view !== 'all' || status || lead || due
                ? 'Try another view or change the filters.'
                : 'A project holds a brief, a plan, tasks and diagrams. Start from a template or a blank page.'
            }
            action={
              view === 'all' && !status && !lead && !due && workspace.role !== 'viewer' ? (
                <Button onClick={() => setOpen(true)}>New project</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <ul className="md:hidden" aria-label="Projects">
              {list.data.projects.map((project) => (
                <MobileProjectRow
                  key={project.id}
                  project={project}
                  slug={slug}
                  busy={action.busy}
                  onStar={() =>
                    void action.run(async () => {
                      if (project.starred)
                        await call(api.projects[':id'].star.$delete({ param: { id: project.id } }))
                      else await call(api.projects[':id'].star.$put({ param: { id: project.id } }))
                      await queryClient.invalidateQueries({ queryKey: ['projects', slug] })
                    })
                  }
                />
              ))}
            </ul>
            <table className="hidden w-full min-w-[900px] table-fixed text-left text-ui md:table">
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
                        <Avatar
                          id={project.leadId}
                          name={project.leadName ?? 'Deleted user'}
                          className="!size-5"
                        />
                        <span className="truncate">{project.leadName ?? 'Deleted user'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <Avatar
                        id={project.leadId}
                        name={project.leadName ?? 'Deleted user'}
                        className="!size-5"
                      />
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
              <p className="hidden px-3 py-3 text-caption text-text-muted md:block">
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
      {open ? (
        <NewProjectDialog open onClose={() => setOpen(false)} slug={slug} userId={me.user.id} />
      ) : null}
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
