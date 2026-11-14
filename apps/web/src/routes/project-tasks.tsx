import { useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData, useNavigate } from '@tanstack/react-router'
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Columns3,
  List,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'
import { useState } from 'react'
import { api, call, projectTasksClient, RequestError, tasksClient } from '../api'
import { relativeTime } from '../relative-time'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Dialog } from '../ui/dialog'
import { EmptyState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { Input } from '../ui/input'
import { Menu } from '../ui/menu'
import { Select } from '../ui/select'
import { StatusGlyph, StatusLabel } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { Textarea } from '../ui/textarea'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

const searchSchema = (search: Record<string, unknown>) => ({
  view: search.view === 'board' ? ('board' as const) : ('list' as const),
  task: typeof search.task === 'string' ? search.task : undefined,
})
type TaskStatus = 'todo' | 'in_progress' | 'done'
type TaskPriority = 'low' | 'medium' | 'high'
const statuses: { id: TaskStatus; label: string }[] = [
  { id: 'in_progress', label: 'In progress' },
  { id: 'todo', label: 'To do' },
  { id: 'done', label: 'Completed' },
]
const statusLabel = (value: TaskStatus) =>
  statuses.find((item) => item.id === value)?.label ?? value
const statusGlyph = (value: TaskStatus): 'draft' | 'in-progress' | 'completed' =>
  value === 'in_progress' ? 'in-progress' : value === 'done' ? 'completed' : 'draft'
const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
const formatProjectDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`))
    : '—'
const priorityLabel = (value: TaskPriority) =>
  value === 'high' ? 'High' : value === 'low' ? 'Low' : 'Medium'

function PriorityGlyph({ priority }: { priority: TaskPriority }) {
  return (
    <span
      role="img"
      aria-label={`${priorityLabel(priority)} priority`}
      className="inline-flex h-3 items-end gap-0.5"
    >
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={`w-0.5 rounded-full ${bar <= (priority === 'high' ? 3 : priority === 'medium' ? 2 : 1) ? 'bg-text-muted' : 'bg-border'}`}
          style={{ height: `${bar * 3 + 2}px` }}
        />
      ))}
    </span>
  )
}

function ProjectTasks() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects/$projectId/tasks' })
  const { projectId } = projectTasksRoute.useParams()
  const { view, task: taskId } = projectTasksRoute.useSearch()
  const navigate = useNavigate({ from: '/$ws/projects/$projectId/tasks' })
  const editable = workspace.role === 'owner' || workspace.role === 'editor'
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('')
  const [milestoneFilter, setMilestoneFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<TaskStatus[]>(['done'])
  const action = useAction()
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => call(api.projects[':id'].$get({ param: { id: projectId } })),
  })
  const membersQuery = useQuery({
    queryKey: ['members', workspace.slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: workspace.slug } })),
  })
  const planQuery = useQuery({
    queryKey: ['plan', projectId],
    queryFn: () => call(api.projects[':id'].plan.$get({ param: { id: projectId } })),
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks', projectId, { assignee, priority, milestoneFilter }],
    queryFn: () =>
      call(
        projectTasksClient.projects[':id'].tasks.$get({
          param: { id: projectId },
          query: {
            ...(assignee ? { assignee } : {}),
            ...(priority ? { priority: priority as TaskPriority } : {}),
            ...(milestoneFilter ? { milestone: milestoneFilter } : {}),
          },
        }),
      ),
  })
  const project = projectQuery.data?.project
  const tasks = tasksQuery.data?.tasks ?? []
  const members = membersQuery.data?.members ?? []
  const selectedFromList = tasks.find((task) => task.id === taskId)
  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => call(tasksClient.tasks[':id'].$get({ param: { id: taskId as string } })),
    enabled: Boolean(taskId && !selectedFromList),
  })
  const selectedTask = selectedFromList ?? taskQuery.data?.task

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['projects', workspace.slug] }),
    ])
  }
  const selectTask = (id?: string) => void navigate({ search: { view, task: id } })
  const changeStatus = async (id: string, status: TaskStatus, position?: number) => {
    await call(
      tasksClient.tasks[':id'].$patch({
        param: { id },
        json: { status, ...(position === undefined ? {} : { position }) },
      }),
    )
    await refresh()
  }
  const createTask = async (
    input: {
      title: string
      description: string
      status: TaskStatus
      assigneeId: string | null
      priority: TaskPriority
      dueDate: string | null
      milestoneId: string | null
    },
    keepOpen: boolean,
  ) => {
    const result = await call(
      projectTasksClient.projects[':id'].tasks.$post({ param: { id: projectId }, json: input }),
    )
    await refresh()
    if (!keepOpen) setCreateOpen(false)
    setTitle('')
    setDescription('')
    return result.task
  }
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [createStatus, setCreateStatus] = useState<TaskStatus>('todo')
  const [createAssignee, setCreateAssignee] = useState('')
  const [createPriority, setCreatePriority] = useState<TaskPriority>('medium')
  const [createDueDate, setCreateDueDate] = useState('')
  const [createMilestone, setCreateMilestone] = useState('')
  const [createAnotherChecked, setCreateAnotherChecked] = useState(false)

  const openCreate = (status: TaskStatus = 'todo') => {
    setCreateStatus(status)
    setTitle('')
    setDescription('')
    setCreateAssignee('')
    setCreatePriority('medium')
    setCreateDueDate('')
    setCreateMilestone('')
    setCreateAnotherChecked(false)
    setCreateOpen(true)
  }

  const handleDrop = (event: DragEvent, status: TaskStatus, position?: number) => {
    event.preventDefault()
    event.stopPropagation()
    const id = event.dataTransfer.getData('text/plain')
    if (id && editable) void action.run(() => changeStatus(id, status, position))
  }

  return (
    <WorkspaceShell workspace={workspace} me={me} active="projects">
      {projectQuery.isPending ? (
        <p className="p-8">Loading project…</p>
      ) : projectQuery.isError ? (
        projectQuery.error instanceof RequestError && projectQuery.error.status === 404 ? (
          <div className="p-8">
            <EmptyState
              title="Project not found"
              body="This project isn’t available in the current workspace."
              action={
                <Button onClick={() => void navigate({ to: `/${workspace.slug}/projects` })}>
                  Back to projects
                </Button>
              }
            />
          </div>
        ) : (
          <div className="p-8">
            <EmptyState
              title="Couldn’t load project"
              body="Try again to open this project."
              action={<Button onClick={() => void projectQuery.refetch()}>Retry</Button>}
            />
          </div>
        )
      ) : project ? (
        <>
          <div className="flex h-11 items-center gap-2 border-b border-border px-8">
            <Link
              to="/$ws/projects"
              params={{ ws: workspace.slug }}
              className="text-ui text-text-muted hover:text-text"
            >
              Projects
            </Link>
            <span aria-hidden className="text-text-faint">
              ›
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
            <Avatar id={project.leadId} name={project.leadName} className="!size-6" />
            <Button variant="secondary" disabled aria-label="Share unavailable">
              Share
            </Button>
            <Button
              variant="ghost"
              icon={Star}
              aria-label={project.starred ? 'Unstar project' : 'Star project'}
              aria-pressed={project.starred}
              className="!text-warning"
              onClick={() =>
                void action.run(async () => {
                  if (project.starred)
                    await call(api.projects[':id'].star.$delete({ param: { id: project.id } }))
                  else await call(api.projects[':id'].star.$put({ param: { id: project.id } }))
                  await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
                })
              }
            />
            <Button variant="ghost" aria-label="Project actions unavailable" disabled>
              <MoreHorizontal />
            </Button>
          </div>
          <div className="border-b border-border px-8 pt-3 pb-0.5">
            <h1 className="text-display font-semibold">{project.name}</h1>
            <div className="flex h-10 items-center gap-6 text-ui">
              <StatusLabel status={project.status} />
              <span className="flex items-center gap-2">
                <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                {project.leadName}
              </span>
              <span className="flex items-center gap-2 text-text-muted">
                <Icon icon={CalendarDays} />
                {project.targetDate ? `Due ${shortDate(project.targetDate)}` : 'No target date'}
              </span>
              <div className="flex items-center gap-2 text-text-muted">
                <span
                  role="progressbar"
                  aria-label="Task progress"
                  aria-valuemin={0}
                  aria-valuemax={project.taskProgress.total || 1}
                  aria-valuenow={project.taskProgress.done}
                  className="h-1 w-20 overflow-hidden rounded-full bg-bg-subtle"
                >
                  <span
                    className="block h-full bg-accent"
                    style={{
                      width: `${project.taskProgress.total ? (project.taskProgress.done / project.taskProgress.total) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span>
                  {project.taskProgress.done}/{project.taskProgress.total} tasks
                </span>
              </div>
            </div>
          </div>
          <div className="border-b border-border px-8 pt-1 pb-0">
            <Tabs
              value="tasks"
              onChange={(tab) => {
                if (tab === 'brief')
                  void navigate({
                    to: '/$ws/projects/$projectId',
                    params: { ws: workspace.slug, projectId },
                  })
                if (tab === 'plan')
                  void navigate({
                    to: '/$ws/projects/$projectId/plan',
                    params: { ws: workspace.slug, projectId },
                  })
              }}
              tabs={[
                { id: 'brief', label: 'Brief' },
                { id: 'plan', label: 'Plan' },
                {
                  id: 'tasks',
                  label: `Tasks ${tasksQuery.data ? tasksQuery.data.counts.todo + tasksQuery.data.counts.inProgress + tasksQuery.data.counts.done : 0}`,
                },
                { id: 'diagrams', label: 'Diagrams', disabled: true },
                { id: 'activity', label: 'Activity', disabled: true },
              ]}
            />
          </div>

          <div className="flex h-12 items-center gap-2 border-b border-border px-5 lg:px-8">
            <fieldset
              aria-label="Task view"
              className="flex rounded-control border border-border p-0.5"
            >
              <Button
                size="sm"
                variant={view === 'list' ? 'secondary' : 'ghost'}
                aria-pressed={view === 'list'}
                icon={List}
                onClick={() => void navigate({ search: { view: 'list', task: taskId } })}
              >
                List
              </Button>
              <Button
                size="sm"
                variant={view === 'board' ? 'secondary' : 'ghost'}
                aria-pressed={view === 'board'}
                icon={Columns3}
                onClick={() => void navigate({ search: { view: 'board', task: taskId } })}
              >
                Board
              </Button>
            </fieldset>
            {view === 'list' && (
              <>
                <Select
                  aria-label="Filter by assignee"
                  className="h-8 w-auto min-w-32 rounded-control text-caption"
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                >
                  <option value="">＋ Assignee</option>
                  <option value="unassigned">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by milestone"
                  className="h-8 w-auto min-w-32 rounded-control text-caption"
                  value={milestoneFilter}
                  onChange={(event) => setMilestoneFilter(event.target.value)}
                >
                  <option value="">＋ Milestone</option>
                  <option value="unassigned">No milestone</option>
                  {planQuery.data?.milestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.code} · {milestone.title}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by priority"
                  className="h-8 w-auto min-w-28 rounded-control text-caption"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  <option value="">＋ Priority</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </Select>
              </>
            )}
            <span className="flex-1" />
            {editable && (
              <Button variant="primary" size="sm" icon={Plus} onClick={() => openCreate()}>
                New task
              </Button>
            )}
          </div>

          {tasksQuery.isPending ? (
            <p className="p-8 text-text-muted">Loading tasks…</p>
          ) : tasksQuery.isError ? (
            <div className="p-8">
              <EmptyState
                title="Couldn’t load tasks"
                body="Try again to load the project tasks."
                action={<Button onClick={() => void tasksQuery.refetch()}>Retry</Button>}
              />
            </div>
          ) : view === 'board' ? (
            <div
              className={`grid min-h-[calc(100vh-218px)] grid-cols-1 gap-3 bg-bg px-5 py-4 md:grid-cols-3 lg:px-5 ${taskId ? 'lg:grid-cols-[repeat(3,minmax(0,1fr))_440px]' : ''}`}
            >
              {[
                { id: 'todo' as const, label: 'To do', count: tasksQuery.data.counts.todo },
                {
                  id: 'in_progress' as const,
                  label: 'In progress',
                  count: tasksQuery.data.counts.inProgress,
                },
                { id: 'done' as const, label: 'Completed', count: tasksQuery.data.counts.done },
              ].map((column) => {
                const columnTasks = tasks.filter((task) => task.status === column.id)
                return (
                  <section
                    key={column.id}
                    aria-label={`${column.label} tasks`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(event, column.id)}
                    className="min-h-60 rounded-panel bg-bg-subtle p-2.5"
                  >
                    <header className="mb-3 flex h-7 items-center gap-2 px-1">
                      <h2 className="flex items-center gap-1.5 text-ui font-medium">
                        <StatusGlyph status={statusGlyph(column.id)} />
                        {column.label}
                      </h2>
                      <span className="font-mono text-caption text-text-muted">{column.count}</span>
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Plus}
                          className="ml-auto h-7 px-1"
                          aria-label={`New task in ${column.label}`}
                          onClick={() => openCreate(column.id)}
                        />
                      )}
                    </header>
                    <div className="space-y-2">
                      {columnTasks.map((task, index) => (
                        <button
                          key={task.id}
                          type="button"
                          draggable={editable}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', task.id)
                            event.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleDrop(event, column.id, index)}
                          onClick={() => selectTask(task.id)}
                          aria-label={`${task.key} ${task.title}`}
                          className={`w-full rounded-control border border-border bg-bg p-2.5 text-left hover:border-border-strong ${taskId === task.id ? 'ring-1 ring-accent' : ''}`}
                        >
                          <span className="block font-mono text-caption text-text-muted">
                            {task.key}
                          </span>
                          <span className="mt-1 block text-ui leading-5">{task.title}</span>
                          {task.milestoneCode && (
                            <span className="mt-2 inline-flex rounded-control border border-border px-1.5 py-0.5 text-micro text-text-muted">
                              {task.milestoneCode}
                            </span>
                          )}
                          <span className="mt-2 flex items-center gap-2 text-caption text-text-muted">
                            <PriorityGlyph priority={task.priority} />
                            {task.dueDate && (
                              <span className="font-mono">{shortDate(task.dueDate)}</span>
                            )}
                            <span className="ml-auto">
                              {task.assigneeId && task.assigneeName ? (
                                <Avatar
                                  id={task.assigneeId}
                                  name={task.assigneeName}
                                  className="!size-5"
                                />
                              ) : (
                                '—'
                              )}
                            </span>
                          </span>
                        </button>
                      ))}
                      {!columnTasks.length && (
                        <p className="px-2 py-4 text-caption text-text-muted">No tasks</p>
                      )}
                    </div>
                  </section>
                )
              })}
              {taskId && (
                <aside className="min-w-0 border-l border-border bg-bg px-5 py-4">
                  {taskQuery.isError && !selectedFromList ? (
                    <EmptyState
                      title="Task not found"
                      body="This task may have been removed."
                      action={<Button onClick={() => selectTask()}>Close</Button>}
                    />
                  ) : !selectedTask ? (
                    <p className="text-ui text-text-muted">Loading task…</p>
                  ) : (
                    <>
                      <div className="mb-5 flex items-center gap-2">
                        <span className="flex-1 font-mono text-caption text-text-muted">
                          {selectedTask.key}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Copy task link"
                          onClick={() => void navigator.clipboard.writeText(window.location.href)}
                        >
                          <Icon icon={Clipboard} />
                        </Button>
                        {editable && (
                          <Menu
                            label="Task actions"
                            iconOnly
                            triggerClassName="h-7 px-1"
                            items={[
                              {
                                label: 'Delete task',
                                icon: Trash2,
                                danger: true,
                                onSelect: () => setDeleteOpen(true),
                              },
                            ]}
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Close task"
                          onClick={() => selectTask()}
                        >
                          <Icon icon={X} />
                        </Button>
                      </div>
                      <TaskPanel
                        key={selectedTask.id}
                        task={selectedTask}
                        members={members}
                        milestones={planQuery.data?.milestones ?? []}
                        editable={editable}
                        busy={action.busy}
                        onPatch={async (patch) => {
                          await action.run(async () => {
                            await call(
                              tasksClient.tasks[':id'].$patch({
                                param: { id: selectedTask.id },
                                json: patch,
                              }),
                            )
                            await refresh()
                          })
                        }}
                      />
                      <TaskComments
                        key={`comments-${selectedTask.id}`}
                        taskId={selectedTask.id}
                        workspaceRole={workspace.role}
                        userId={me.user.id}
                        members={members}
                      />
                    </>
                  )}
                </aside>
              )}
            </div>
          ) : (
            <div
              className={`grid min-h-[calc(100vh-218px)] ${taskId ? 'lg:grid-cols-[minmax(0,1fr)_440px]' : 'grid-cols-1'}`}
            >
              <main className="min-w-0 px-5 py-4 lg:px-5">
                {statuses.map((group) => {
                  const groupTasks = tasks.filter((task) => task.status === group.id)
                  return (
                    <section key={group.id} className="mb-3" aria-label={`${group.label} tasks`}>
                      <button
                        type="button"
                        className="flex h-8 items-center gap-2 px-1 text-left"
                        aria-expanded={!collapsed.includes(group.id)}
                        onClick={() =>
                          setCollapsed((current) =>
                            current.includes(group.id)
                              ? current.filter((id) => id !== group.id)
                              : [...current, group.id],
                          )
                        }
                      >
                        <Icon
                          icon={collapsed.includes(group.id) ? ChevronRight : ChevronDown}
                          className="text-text-muted"
                        />
                        <StatusGlyph status={statusGlyph(group.id)} />
                        <span className="font-semibold">{group.label}</span>
                        <span className="font-mono text-caption text-text-muted">
                          {groupTasks.length}
                        </span>
                      </button>
                      {!collapsed.includes(group.id) && groupTasks.length > 0 && (
                        <ul className="divide-y divide-border">
                          {groupTasks.map((task) => (
                            <li
                              key={task.id}
                              className={`grid min-h-10 grid-cols-[28px_72px_minmax(0,1fr)_24px_34px_70px] items-center gap-2 rounded-control px-2 hover:bg-bg-subtle ${taskId === task.id ? 'bg-bg-subtle' : ''}`}
                            >
                              <Checkbox
                                aria-label={`Mark ${task.key} complete`}
                                checked={task.status === 'done'}
                                disabled={!editable || action.busy}
                                onChange={() =>
                                  void action.run(() =>
                                    changeStatus(task.id, task.status === 'done' ? 'todo' : 'done'),
                                  )
                                }
                              />
                              <button
                                type="button"
                                aria-label={task.title}
                                onClick={() => selectTask(task.id)}
                                className="text-left font-mono text-caption text-text-muted hover:text-text"
                              >
                                {task.key}
                              </button>
                              <button
                                type="button"
                                onClick={() => selectTask(task.id)}
                                className="truncate text-left text-ui"
                              >
                                {task.title}
                                {task.milestoneCode && (
                                  <span className="rounded-control border border-border px-1.5 py-0.5 text-micro text-text-muted">
                                    {task.milestoneCode}
                                  </span>
                                )}
                              </button>
                              <PriorityGlyph priority={task.priority} />
                              <span className="flex justify-center">
                                {task.assigneeId && task.assigneeName ? (
                                  <Avatar
                                    id={task.assigneeId}
                                    name={task.assigneeName}
                                    className="!size-5"
                                  />
                                ) : null}
                              </span>
                              <span className="text-right font-mono text-caption text-text-muted">
                                {task.dueDate ? shortDate(task.dueDate) : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )
                })}
                {tasks.length === 0 && (
                  <EmptyState
                    title="No tasks yet"
                    body={
                      assignee || priority
                        ? 'No tasks match these filters.'
                        : 'Create a task to start tracking work in this project.'
                    }
                    action={
                      editable && !assignee && !priority ? (
                        <Button variant="primary" icon={Plus} onClick={() => openCreate()}>
                          New task
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </main>
              {taskId && (
                <aside className="min-w-0 border-l border-border bg-bg px-5 py-4">
                  {taskQuery.isError && !selectedFromList ? (
                    <EmptyState
                      title="Task not found"
                      body="This task may have been removed."
                      action={<Button onClick={() => selectTask()}>Close</Button>}
                    />
                  ) : !selectedTask ? (
                    <p className="text-ui text-text-muted">Loading task…</p>
                  ) : (
                    <>
                      <div className="mb-5 flex items-center gap-2">
                        <span className="flex-1 font-mono text-caption text-text-muted">
                          {selectedTask.key}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Copy task link"
                          onClick={() => void navigator.clipboard.writeText(window.location.href)}
                        >
                          <Icon icon={Clipboard} />
                        </Button>
                        {editable && (
                          <Menu
                            label="Task actions"
                            iconOnly
                            triggerClassName="h-7 px-1"
                            items={[
                              {
                                label: 'Delete task',
                                icon: Trash2,
                                danger: true,
                                onSelect: () => setDeleteOpen(true),
                              },
                            ]}
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Close task"
                          onClick={() => selectTask()}
                        >
                          <Icon icon={X} />
                        </Button>
                      </div>
                      <TaskPanel
                        key={selectedTask.id}
                        task={selectedTask}
                        members={members}
                        milestones={planQuery.data?.milestones ?? []}
                        editable={editable}
                        busy={action.busy}
                        onPatch={async (patch) => {
                          await action.run(async () => {
                            await call(
                              tasksClient.tasks[':id'].$patch({
                                param: { id: selectedTask.id },
                                json: patch,
                              }),
                            )
                            await refresh()
                          })
                        }}
                      />
                      <TaskComments
                        key={`comments-${selectedTask.id}`}
                        taskId={selectedTask.id}
                        workspaceRole={workspace.role}
                        userId={me.user.id}
                        members={members}
                      />
                    </>
                  )}
                </aside>
              )}
            </div>
          )}
          <ActionError error={action.error} />
          <CreateTaskDialog
            open={createOpen}
            title={title}
            description={description}
            status={createStatus}
            assignee={createAssignee}
            priority={createPriority}
            dueDate={createDueDate}
            milestoneId={createMilestone}
            createAnother={createAnotherChecked}
            members={members}
            milestones={planQuery.data?.milestones ?? []}
            projectName={project.name}
            busy={action.busy}
            error={action.error}
            onClose={() => setCreateOpen(false)}
            setTitle={setTitle}
            setDescription={setDescription}
            setStatus={setCreateStatus}
            setAssignee={setCreateAssignee}
            setPriority={setCreatePriority}
            setDueDate={setCreateDueDate}
            setMilestoneId={setCreateMilestone}
            setCreateAnother={setCreateAnotherChecked}
            onCreate={() =>
              action.run(async () => {
                await createTask(
                  {
                    title,
                    description,
                    status: createStatus,
                    assigneeId: createAssignee || null,
                    priority: createPriority,
                    dueDate: createDueDate || null,
                    milestoneId: createMilestone || null,
                  },
                  createAnotherChecked,
                )
              })
            }
          />
          <Dialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete task"
            footer={
              <>
                <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
                <Button
                  variant="danger-fill"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      if (!selectedTask) return
                      await call(
                        tasksClient.tasks[':id'].$delete({ param: { id: selectedTask.id } }),
                      )
                      setDeleteOpen(false)
                      selectTask()
                      await refresh()
                    })
                  }
                >
                  Delete task
                </Button>
              </>
            }
          >
            This task and its comments will be permanently deleted.
          </Dialog>
        </>
      ) : null}
    </WorkspaceShell>
  )
}

type Member = { id: string; name: string }
type TaskData = {
  id: string
  projectId: string
  number: number
  key: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  assigneeName: string | null
  dueDate: string | null
  milestoneId: string | null
  milestoneCode: string | null
  position: number
}

function TaskPanel({
  task,
  members,
  milestones,
  editable,
  busy,
  onPatch,
}: {
  task: TaskData
  members: Member[]
  milestones: { id: string; code: string; title: string }[]
  editable: boolean
  busy: boolean
  onPatch: (patch: {
    title?: string
    description?: string
    status?: TaskStatus
    assigneeId?: string | null
    priority?: TaskPriority
    dueDate?: string | null
    milestoneId?: string | null
  }) => Promise<void>
}) {
  const [titleEditing, setTitleEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [descriptionEditing, setDescriptionEditing] = useState(false)
  const [description, setDescription] = useState(task.description)
  return (
    <>
      {titleEditing ? (
        <div className="mb-4 space-y-2">
          <Input
            aria-label="Task title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                await onPatch({ title })
                setTitleEditing(false)
              }}
            >
              Save title
            </Button>
            <Button
              onClick={() => {
                setTitle(task.title)
                setTitleEditing(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <h2 className="mb-5 flex items-start gap-2 text-title font-semibold leading-6">
          <span className="min-w-0 flex-1">{task.title}</span>
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Edit task title"
              onClick={() => setTitleEditing(true)}
              className="-mt-1"
            >
              <span className="text-text-muted">Edit</span>
            </Button>
          )}
        </h2>
      )}
      <dl className="mb-5 space-y-3 text-ui">
        <PropertyRow label="Status">
          {editable ? (
            <Select
              aria-label="Task status"
              value={task.status}
              onChange={(event) => void onPatch({ status: event.target.value as TaskStatus })}
              className="w-40"
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Completed</option>
            </Select>
          ) : (
            statusLabel(task.status)
          )}
        </PropertyRow>
        <PropertyRow label="Assignee">
          {editable ? (
            <Select
              aria-label="Task assignee"
              value={task.assigneeId ?? ''}
              onChange={(event) => void onPatch({ assigneeId: event.target.value || null })}
              className="w-40"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          ) : (
            (task.assigneeName ?? 'Unassigned')
          )}
        </PropertyRow>
        <PropertyRow label="Priority">
          {editable ? (
            <Select
              aria-label="Task priority"
              value={task.priority}
              onChange={(event) => void onPatch({ priority: event.target.value as TaskPriority })}
              className="w-40"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          ) : (
            <span className="flex items-center gap-2">
              <PriorityGlyph priority={task.priority} />
              {priorityLabel(task.priority)}
            </span>
          )}
        </PropertyRow>
        <PropertyRow label="Due">
          {editable ? (
            <Input
              aria-label="Task due date"
              type="date"
              value={task.dueDate ?? ''}
              onChange={(event) => void onPatch({ dueDate: event.target.value || null })}
              className="w-40"
            />
          ) : (
            formatProjectDate(task.dueDate)
          )}
        </PropertyRow>
        <PropertyRow label="Milestone">
          {editable ? (
            <Select
              aria-label="Task milestone"
              value={task.milestoneId ?? ''}
              onChange={(event) => void onPatch({ milestoneId: event.target.value || null })}
              className="w-40"
            >
              <option value="">No milestone</option>
              {milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.code} · {milestone.title}
                </option>
              ))}
            </Select>
          ) : (
            (milestones.find((milestone) => milestone.id === task.milestoneId)?.code ??
            'No milestone')
          )}
        </PropertyRow>
      </dl>
      <section className="border-t border-border pt-4" aria-labelledby="task-description">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="task-description" className="font-semibold">
            Description
          </h3>
          {editable && !descriptionEditing && (
            <Button variant="ghost" size="sm" onClick={() => setDescriptionEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {descriptionEditing ? (
          <div className="space-y-2">
            <Textarea
              aria-label="Task description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="h-28 resize-y"
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  await onPatch({ description })
                  setDescriptionEditing(false)
                }}
              >
                Save description
              </Button>
              <Button
                onClick={() => {
                  setDescription(task.description)
                  setDescriptionEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="min-h-12 whitespace-pre-wrap text-ui leading-5 text-text-muted">
            {task.description || 'No description yet.'}
          </p>
        )}
      </section>
    </>
  )
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function CreateTaskDialog({
  open,
  title,
  description,
  status,
  assignee,
  priority,
  dueDate,
  milestoneId,
  createAnother,
  members,
  milestones,
  projectName,
  busy,
  error,
  onClose,
  setTitle,
  setDescription,
  setStatus,
  setAssignee,
  setPriority,
  setDueDate,
  setMilestoneId,
  setCreateAnother,
  onCreate,
}: {
  open: boolean
  title: string
  description: string
  status: TaskStatus
  assignee: string
  priority: TaskPriority
  dueDate: string
  milestoneId: string
  createAnother: boolean
  members: Member[]
  milestones: { id: string; code: string; title: string }[]
  projectName: string
  busy: boolean
  error: string
  onClose: () => void
  setTitle: (value: string) => void
  setDescription: (value: string) => void
  setStatus: (value: TaskStatus) => void
  setAssignee: (value: string) => void
  setPriority: (value: TaskPriority) => void
  setDueDate: (value: string) => void
  setMilestoneId: (value: string) => void
  setCreateAnother: (value: boolean) => void
  onCreate: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`New task in ${projectName}`}
      wide
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-caption text-text-muted">
            <Checkbox
              checked={createAnother}
              onChange={(event) => setCreateAnother(event.target.checked)}
              aria-label="Create another"
            />
            <span>Create another</span>
          </div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!title.trim() || busy} onClick={onCreate}>
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          aria-label="Task title"
          placeholder="Task title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          autoFocus
          className="h-9 border-transparent px-0 text-title font-semibold focus-visible:border-accent"
        />
        <Textarea
          aria-label="Task description"
          placeholder="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={10_000}
          className="!h-14 resize-y border-transparent px-0 text-ui focus-visible:border-accent"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Select
            aria-label="New task status"
            value={status}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Completed</option>
          </Select>
          <Select
            aria-label="New task assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="New task priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
          <Input
            aria-label="New task due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Select
            aria-label="New task milestone"
            value={milestoneId}
            onChange={(event) => setMilestoneId(event.target.value)}
          >
            <option value="">No milestone</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.code} · {milestone.title}
              </option>
            ))}
          </Select>
        </div>
        <ActionError error={error} />
      </div>
    </Dialog>
  )
}

function TaskComments({
  taskId,
  workspaceRole,
  userId,
  members,
}: {
  taskId: string
  workspaceRole: 'owner' | 'editor' | 'viewer'
  userId: string
  members: Member[]
}) {
  const queryKey = ['comments', 'task', taskId] as const
  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => call(api.comments.$get({ query: { target: `task:${taskId}` } })),
  })
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [editingMentions, setEditingMentions] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const action = useAction()
  const mentionOptions = (text: string) => {
    const match = text.match(/@([a-zA-Z0-9 ]*)$/)
    return match
      ? members.filter((member) =>
          member.name.toLowerCase().includes(match[1]?.trim().toLowerCase() ?? ''),
        )
      : []
  }
  const retainMentions = (text: string, values: string[]) =>
    values.filter((id) => {
      const member = members.find((candidate) => candidate.id === id)
      return member && text.includes(`@${member.name}`)
    })
  const chooseMention = (text: string, existing: string[], member: Member) => ({
    text: text.replace(/@[a-zA-Z0-9 ]*$/, `@${member.name} `),
    ids: [...new Set([...retainMentions(text, existing), member.id])],
  })
  const suggestions = (
    text: string,
    current: string[],
    onChoose: (value: string, ids: string[]) => void,
  ) => {
    const options = mentionOptions(text)
    if (!options.length) return null
    return (
      <div
        role="listbox"
        aria-label="Workspace members"
        className="absolute bottom-full z-10 mb-1 max-h-36 w-full overflow-y-auto rounded-panel border border-border bg-bg p-1 shadow-float"
      >
        {options.map((member) => (
          <Button
            key={member.id}
            role="option"
            aria-selected="false"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              const result = chooseMention(text, current, member)
              onChoose(result.text, result.ids)
            }}
          >
            {member.name}
          </Button>
        ))}
      </div>
    )
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey })
  const post = async () => {
    await call(api.comments.$post({ json: { target: `task:${taskId}`, body: draft, mentions } }))
    setDraft('')
    setMentions([])
    await refresh()
  }
  const save = async (id: string) => {
    await call(
      api.comments[':id'].$patch({
        param: { id },
        json: { body: editingDraft, mentions: editingMentions },
      }),
    )
    setEditing(null)
    await refresh()
  }
  const remove = async () => {
    if (!deleting) return
    await call(api.comments[':id'].$delete({ param: { id: deleting } }))
    setDeleting(null)
    await refresh()
  }
  return (
    <section className="mt-5 border-t border-border pt-4" aria-labelledby="task-comments">
      <h3 id="task-comments" className="mb-3 text-caption font-medium text-text-muted">
        Comments <span>{commentsQuery.data?.comments.length ?? ''}</span>
      </h3>
      {commentsQuery.isPending ? (
        <p className="text-caption text-text-muted">Loading comments…</p>
      ) : commentsQuery.isError ? (
        <p className="text-caption text-text-muted">
          Couldn’t load comments.{' '}
          <Button size="sm" variant="ghost" onClick={() => void commentsQuery.refetch()}>
            Retry
          </Button>
        </p>
      ) : (
        <ol className="space-y-4">
          {commentsQuery.data.comments.map((comment) => (
            <li key={comment.id}>
              <div className="flex items-center gap-2">
                <Avatar id={comment.authorId} name={comment.authorName} className="!size-5" />
                <strong className="text-ui">{comment.authorName}</strong>
                <span className="text-caption text-text-muted">
                  {relativeTime(comment.createdAt)}
                </span>
                {(workspaceRole === 'owner' || comment.authorId === userId) &&
                  editing !== comment.id && (
                    <Menu
                      label="Comment actions"
                      iconOnly
                      triggerClassName="ml-auto h-7 px-1"
                      items={[
                        {
                          label: 'Edit comment',
                          onSelect: () => {
                            setEditing(comment.id)
                            setEditingDraft(comment.body)
                            setEditingMentions(comment.mentions)
                          },
                        },
                        {
                          label: 'Delete comment',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setDeleting(comment.id),
                        },
                      ]}
                    />
                  )}
              </div>
              {editing === comment.id ? (
                <div className="mt-2 space-y-2">
                  <div className="relative">
                    <Textarea
                      aria-label="Edit comment"
                      value={editingDraft}
                      onChange={(event) => {
                        const value = event.target.value
                        setEditingDraft(value)
                        setEditingMentions((current) => retainMentions(value, current))
                      }}
                      className="h-20 resize-y"
                    />
                    {suggestions(editingDraft, editingMentions, (value, ids) => {
                      setEditingDraft(value)
                      setEditingMentions(ids)
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={action.busy}
                      onClick={() => void action.run(() => save(comment.id))}
                    >
                      Save comment
                    </Button>
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap pl-7 text-ui leading-5">{comment.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="relative mt-4">
        <Textarea
          aria-label="Task comment"
          placeholder="Write a comment. Type @ to mention someone."
          value={draft}
          onChange={(event) => {
            const value = event.target.value
            setDraft(value)
            setMentions((current) => retainMentions(value, current))
          }}
          className="h-16 resize-y"
        />
        {suggestions(draft, mentions, (value, ids) => {
          setDraft(value)
          setMentions(ids)
        })}
        <Button
          variant="primary"
          className="mt-2 w-full"
          disabled={!draft.trim() || action.busy}
          onClick={() => void action.run(post)}
        >
          Post comment
        </Button>
      </div>
      <ActionError error={action.error} />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete comment"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger-fill"
              disabled={action.busy}
              onClick={() => void action.run(remove)}
            >
              Delete comment
            </Button>
          </>
        }
      >
        This comment will be removed from the task.
      </Dialog>
    </section>
  )
}

export const projectTasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/projects/$projectId/tasks',
  validateSearch: searchSchema,
  remountDeps: ({ params, search }) => ({
    workspace: params.ws,
    project: params.projectId,
    view: search.view,
  }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: ProjectTasks,
})
