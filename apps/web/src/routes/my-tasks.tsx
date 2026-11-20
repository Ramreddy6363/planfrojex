import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData } from '@tanstack/react-router'
import { useState } from 'react'
import { api, call, tasksClient } from '../api'
import { getMyTasks, type MyTasksView, myTasksKey } from '../my-tasks'
import { dueDateGroup, dueDateGroups, formatTaskDueDate } from '../my-tasks-grouping'
import { queryClient } from '../session'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { EmptyState } from '../ui/empty-state'
import { Select } from '../ui/select'
import { Tabs } from '../ui/tabs'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type GroupBy = 'due' | 'project' | 'priority'
type Task = Awaited<ReturnType<typeof getMyTasks>>['tasks'][number]
const priorities = ['high', 'medium', 'low'] as const
const priorityName = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function MyTasks() {
  const { workspace, me } = useLoaderData({ from: '/$ws/my-tasks' })
  const [view, setView] = useState<MyTasksView>('assigned')
  const [groupBy, setGroupBy] = useState<GroupBy>('due')
  const [projectFilter, setProjectFilter] = useState('')
  const action = useAction()
  const editable = workspace.role !== 'viewer'
  const list = useInfiniteQuery({
    queryKey: [...myTasksKey(workspace.slug), view, projectFilter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getMyTasks(workspace.slug, view, projectFilter, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
  const projects = useQuery({
    queryKey: ['projects', workspace.slug, 'my-tasks-filter'],
    queryFn: async () => {
      let result = await call(
        api.workspaces[':ws'].projects.$get({
          param: { ws: workspace.slug },
          query: { limit: '100' },
        }),
      )
      const all = [...result.projects]
      const seen = new Set<string>()
      while (result.nextCursor && !seen.has(result.nextCursor)) {
        seen.add(result.nextCursor)
        result = await call(
          api.workspaces[':ws'].projects.$get({
            param: { ws: workspace.slug },
            query: { limit: '100', cursor: result.nextCursor },
          }),
        )
        all.push(...result.projects)
      }
      return all
    },
  })
  const tasks = list.data?.pages.flatMap((page) => page.tasks) ?? []
  const counts = list.data?.pages[0]?.counts
  const grouped = new Map<string, Task[]>()
  const order =
    groupBy === 'due'
      ? dueDateGroups
      : groupBy === 'priority'
        ? priorities.map(priorityName)
        : [...new Set(tasks.map((task) => task.projectId))].sort((a, b) =>
            (tasks.find((task) => task.projectId === a)?.projectName ?? '').localeCompare(
              tasks.find((task) => task.projectId === b)?.projectName ?? '',
            ),
          )
  for (const title of order) grouped.set(title, [])
  for (const task of tasks) {
    const title =
      groupBy === 'due'
        ? dueDateGroup(task.dueDate)
        : groupBy === 'priority'
          ? priorityName(task.priority)
          : task.projectId
    grouped.get(title)?.push(task)
  }
  const changeStatus = async (task: Task) => {
    await call(
      tasksClient.tasks[':id'].$patch({
        param: { id: task.id },
        json: { status: task.status === 'done' ? 'todo' : 'done' },
      }),
    )
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: myTasksKey(workspace.slug) }),
      queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] }),
      queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['project', task.projectId] }),
      queryClient.invalidateQueries({ queryKey: ['activity', task.projectId] }),
    ])
  }

  return (
    <WorkspaceShell workspace={workspace} me={me} active="my-tasks">
      <header className="flex min-h-14 flex-col items-stretch gap-3 border-b border-border px-4 py-3 md:h-14 md:flex-row md:items-center md:gap-4 md:px-8 md:py-0">
        <h1 className="text-title font-semibold">My tasks</h1>
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto md:flex-nowrap">
          <label htmlFor="my-tasks-group" className="text-caption text-text-muted max-md:sr-only">
            Group by
          </label>
          <Select
            id="my-tasks-group"
            aria-label="Group by"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
            className="!w-full md:!w-[151px]"
          >
            <option value="due">Due date</option>
            <option value="project">Project</option>
            <option value="priority">Priority</option>
          </Select>
          <Select
            aria-label="Project"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="!w-full md:!w-[171px]"
          >
            <option value="">All projects</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
      </header>
      <div className="border-b border-border px-4 md:px-8">
        <Tabs
          value={view}
          onChange={(value) => setView(value as MyTasksView)}
          tabs={[
            { id: 'assigned', label: `Assigned${counts ? `  ${counts.assigned}` : ''}` },
            { id: 'created', label: `Created by me${counts ? `  ${counts.created}` : ''}` },
            { id: 'completed', label: `Completed${counts ? `  ${counts.completed}` : ''}` },
          ]}
        />
      </div>
      <div className="px-4 py-3 md:px-5">
        <ActionError error={action.error} />
        {projects.isError ? (
          <p role="alert" className="px-3 py-2 text-text-muted">
            Couldn’t load the project filter.{' '}
            <Button variant="ghost" onClick={() => void projects.refetch()}>
              Retry
            </Button>
          </p>
        ) : null}
        {list.isPending ? (
          <p className="p-3 text-text-muted">Loading tasks…</p>
        ) : list.isError && !list.data ? (
          <EmptyState
            title="Couldn’t load your tasks"
            body="Try again to see your tasks."
            action={<Button onClick={() => void list.refetch()}>Retry</Button>}
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            title={view === 'completed' ? 'No completed tasks' : 'No tasks here'}
            body={
              view === 'completed'
                ? 'Tasks assigned to you and completed in the last 90 days appear here.'
                : 'Your open tasks in this workspace appear here.'
            }
          />
        ) : (
          <>
            {[...grouped]
              .filter(([, items]) => items.length > 0)
              .map(([title, items]) => (
                <section
                  key={title}
                  aria-label={groupBy === 'project' ? items[0]?.projectName : title}
                >
                  <h2
                    className={`flex h-10 items-center gap-2 border-b border-border px-3 text-caption font-medium ${title === 'Overdue' ? 'text-danger' : title === 'No due date' ? 'text-text-muted' : ''}`}
                  >
                    {groupBy === 'project' ? items[0]?.projectName : title}
                    <span className="font-normal text-text-muted">{items.length}</span>
                  </h2>
                  <ul>
                    {items.map((task) => (
                      <li
                        key={task.id}
                        className="flex h-row items-center gap-3 border-b border-border px-3 hover:bg-bg-subtle"
                      >
                        <span
                          title={!editable ? 'Viewers can’t change tasks.' : undefined}
                          className="inline-flex"
                        >
                          <Checkbox
                            aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}
                            checked={task.status === 'done'}
                            disabled={!editable || action.busy}
                            onChange={() => void action.run(() => changeStatus(task))}
                          />
                        </span>
                        <Link
                          to="/$ws/projects/$projectId/tasks"
                          params={{ ws: workspace.slug, projectId: task.projectId }}
                          search={{ view: 'list', task: task.id }}
                          className="flex min-w-0 flex-1 items-center gap-6 hover:text-accent"
                        >
                          <span className="w-14 shrink-0 font-mono text-caption text-text-muted">
                            {task.key}
                          </span>
                          <span className="truncate">{task.title}</span>
                          <span
                            role="img"
                            aria-label={`${priorityName(task.priority)} priority`}
                            className="ml-auto inline-flex h-3 w-8 shrink-0 items-end justify-end gap-0.5 text-text-muted"
                          >
                            {[1, 2, 3].map((bar) => (
                              <span
                                key={bar}
                                className={`w-0.5 rounded-full ${bar <= (task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1) ? 'bg-text-muted' : 'bg-border'}`}
                                style={{ height: `${bar * 3}px` }}
                              />
                            ))}
                          </span>
                          <span
                            className={`w-16 shrink-0 text-right font-mono text-caption ${task.status !== 'done' && dueDateGroup(task.dueDate) === 'Overdue' ? 'text-danger' : 'text-text-muted'}`}
                          >
                            {task.dueDate ? formatTaskDueDate(task.dueDate) : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            {list.isFetchNextPageError ? (
              <p role="alert" className="p-3 text-text-muted">
                Couldn’t load more tasks. Try again.
              </p>
            ) : null}
            {list.hasNextPage ? (
              <div className="flex justify-center py-5">
                <Button
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceShell>
  )
}

export const myTasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/my-tasks',
  remountDeps: ({ params }) => ({ workspace: params.ws }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: MyTasks,
})
