import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData, useNavigate } from '@tanstack/react-router'
import { ArrowRight, CalendarDays, MoreHorizontal, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { api, call } from '../api'
import { queryClient } from '../session'
import { ShareButton } from '../share-dialog'
import { Avatar, AvatarStack } from '../ui/avatar'
import { Button } from '../ui/button'
import { EmptyState, ErrorState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { Progress } from '../ui/progress'
import { Select } from '../ui/select'
import { SkeletonRows } from '../ui/skeleton-row'
import { type Status, StatusGlyph } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type Category = '' | 'comments' | 'tasks' | 'plan' | 'diagrams' | 'project'
const categories: { value: Category; label: string }[] = [
  { value: '', label: 'All changes' },
  { value: 'comments', label: 'Comments' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'plan', label: 'Plan and drafts' },
  { value: 'diagrams', label: 'Diagrams' },
  { value: 'project', label: 'Project details' },
]
const getActivity = (projectId: string, actor: string, category: Category, cursor: string | null) =>
  call(
    api.projects[':id'].activity.$get({
      param: { id: projectId },
      query: {
        limit: '30',
        ...(actor ? { actor } : {}),
        ...(category ? { category } : {}),
        ...(cursor ? { cursor } : {}),
      },
    }),
  )
type ActivityEntry = Awaited<ReturnType<typeof getActivity>>['activity'][number]
const text = (value: unknown, fallback = '—') =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const sectionName = (value: unknown) =>
  (
    ({
      problem: 'Problem',
      goals: 'Goals',
      constraints: 'Constraints',
      outOfScope: 'Out of scope',
      requirements: 'Requirements',
      stories: 'User stories',
      milestones: 'Milestones',
      risks: 'Risks',
      stack: 'Tech stack',
      estimate: 'Estimate',
    }) as Record<string, string>
  )[text(value)] ?? text(value, 'plan')
const dateLabel = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
    : 'No date'
const clockLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(value),
  )
function groupLabel(value: string) {
  const day = new Date(value),
    now = new Date(),
    yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (same(day, now)) return 'Today'
  if (same(day, yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    ...(day.getFullYear() !== now.getFullYear() ? ({ year: 'numeric' } as const) : {}),
  }).format(day)
}
const statusInfo = (value: unknown): { glyph: Status; label: string } => {
  const labels: Record<string, { glyph: Status; label: string }> = {
    todo: { glyph: 'planning', label: 'To do' },
    in_progress: { glyph: 'in-progress', label: 'In progress' },
    done: { glyph: 'completed', label: 'Done' },
    draft: { glyph: 'draft', label: 'Draft' },
    planning: { glyph: 'planning', label: 'Planning' },
    'in-progress': { glyph: 'in-progress', label: 'In progress' },
    completed: { glyph: 'completed', label: 'Completed' },
    archived: { glyph: 'archived', label: 'Archived' },
  }
  return labels[text(value)] ?? { glyph: 'draft', label: text(value) }
}
const status = (value: unknown) => {
  const item = statusInfo(value)
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusGlyph status={item.glyph} />
      {item.label}
    </span>
  )
}
function activityContent(
  entry: ActivityEntry,
  memberNames: Map<string, string>,
): { sentence: string; detail?: ReactNode } {
  const payload = entry.payload
  const task = text(payload.taskKey, 'a task')
  const name = text(payload.name, 'a diagram')
  const member = (value: unknown, label: unknown) =>
    typeof label === 'string'
      ? label
      : value == null
        ? 'Unassigned'
        : (memberNames.get(String(value)) ?? 'Deleted user')
  const changes = (before: ReactNode, after: ReactNode) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{before}</span>
      <Icon icon={ArrowRight} className="text-text-muted" />
      <span>{after}</span>
    </span>
  )
  switch (entry.type) {
    case 'review.approved':
      return { sentence: `approved ${text(payload.section, 'the plan')}` }
    case 'review.changes_requested':
      return {
        sentence: `requested changes to ${text(payload.section, 'the plan')}`,
        detail: text(payload.comment, '') || undefined,
      }
    case 'comment.mentioned':
      return entry.comment
        ? {
            sentence:
              entry.comment.target === 'task'
                ? `added mentions to a comment on ${task}`
                : 'added mentions to a comment on the brief',
          }
        : { sentence: 'deleted a comment' }
    case 'comment.added':
      return entry.comment
        ? {
            sentence:
              entry.comment.target === 'task' ? `commented on ${task}` : 'commented on the brief',
            detail: <span className="whitespace-pre-wrap break-words">“{entry.comment.text}”</span>,
          }
        : { sentence: 'deleted a comment' }
    case 'project.status_changed':
      return {
        sentence: 'changed the project status',
        detail: changes(status(payload.before), status(payload.after)),
      }
    case 'project.lead_changed':
      return {
        sentence: 'changed the project lead',
        detail: changes(
          member(payload.before, payload.beforeName),
          member(payload.after, payload.afterName),
        ),
      }
    case 'project.target_date_changed':
      return {
        sentence: 'changed the target date',
        detail: changes(dateLabel(payload.before), dateLabel(payload.after)),
      }
    case 'project.name_changed':
      return {
        sentence: 'renamed the project',
        detail: changes(text(payload.before), text(payload.after)),
      }
    case 'project.brief_edited':
      return { sentence: `edited the ${sectionName(payload.section)} section` }
    case 'task.created':
      return { sentence: `created ${task}`, detail: text(payload.title, '') || undefined }
    case 'task.deleted':
      return { sentence: `deleted ${task}`, detail: text(payload.title, '') || undefined }
    case 'task.status_changed':
      return {
        sentence: `changed the status of ${task}`,
        detail: changes(status(payload.before), status(payload.after)),
      }
    case 'task.assignee_changed':
      return payload.after === entry.actorId
        ? { sentence: `took ${task}` }
        : {
            sentence: `changed the assignee of ${task}`,
            detail: changes(
              member(payload.before, payload.beforeName),
              member(payload.after, payload.afterName),
            ),
          }
    case 'task.priority_changed':
      return {
        sentence: `changed the priority of ${task}`,
        detail: changes(text(payload.before), text(payload.after)),
      }
    case 'task.due_date_changed':
      return {
        sentence: `changed the due date of ${task}`,
        detail: changes(dateLabel(payload.before), dateLabel(payload.after)),
      }
    case 'task.milestone_changed':
      return {
        sentence: `changed the milestone of ${task}`,
        detail: changes(
          text(payload.beforeName, payload.before == null ? 'No milestone' : 'Previous milestone'),
          text(payload.afterName, payload.after == null ? 'No milestone' : 'Milestone'),
        ),
      }
    case 'plan.section_edited':
      return { sentence: `edited the ${sectionName(payload.section)} section` }
    case 'draft.started':
      return {
        sentence:
          payload.kind === 'diagram'
            ? 'started a diagram draft'
            : 'started a plan draft from the brief',
        ...(payload.kind === 'diagram'
          ? {}
          : { detail: 'Nothing changes until a section is accepted.' }),
      }
    case 'draft.accepted':
      return {
        sentence:
          payload.source === 'drift'
            ? `accepted a drift suggestion for ${sectionName(payload.section)}`
            : `accepted the ${sectionName(payload.section)} section of the plan draft`,
      }
    case 'draft.rejected':
      return {
        sentence:
          payload.source === 'drift'
            ? `rejected a drift suggestion for ${sectionName(payload.section)}`
            : `rejected the ${sectionName(payload.section)} section of the plan draft`,
      }
    case 'draft.accepted_all':
      return { sentence: 'accepted the remaining sections of the plan draft' }
    case 'draft.undone':
      return { sentence: `undid the accepted ${sectionName(payload.section)} change` }
    case 'diagram.created':
      return { sentence: `created ${name}` }
    case 'diagram.deleted':
      return { sentence: `deleted ${name}` }
    case 'diagram.version_saved':
      return {
        sentence: `saved a new version of ${name}`,
        detail: changes(`v${text(payload.before, '0')}`, `v${text(payload.after, '1')}`),
      }
    case 'diagram.restored':
      return {
        sentence: `restored ${name} as a new version`,
        detail: changes(`v${text(payload.before, '0')}`, `v${text(payload.after, '1')}`),
      }
    case 'diagram.draft_accepted':
      return {
        sentence: `accepted a draft of ${name}`,
        detail: changes(`v${text(payload.before, '0')}`, `v${text(payload.after, '1')}`),
      }
    default: {
      const match = /^plan\.(milestone|risk)_(created|updated|deleted)$/.exec(entry.type)
      if (match)
        return {
          sentence: `${match[2] === 'updated' ? 'edited' : match[2]} a ${match[1]}`,
          detail:
            text(object(payload.after).title ?? object(payload.before).title, '') || undefined,
        }
      return { sentence: 'updated the project' }
    }
  }
}
function ProjectActivity() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects/$projectId/activity' })
  const { projectId } = projectActivityRoute.useParams()
  const navigate = useNavigate()
  const [actor, setActor] = useState(''),
    [category, setCategory] = useState<Category>('')
  const action = useAction()
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => call(api.projects[':id'].$get({ param: { id: projectId } })),
  })
  const membersQuery = useQuery({
    queryKey: ['members', workspace.slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: workspace.slug } })),
  })
  const diagramsQuery = useQuery({
    queryKey: ['diagrams', projectId],
    queryFn: () => call(api.projects[':id'].diagrams.$get({ param: { id: projectId } })),
  })
  const timeline = useInfiniteQuery({
    queryKey: ['activity', projectId, actor, category],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getActivity(projectId, actor, category, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const project = projectQuery.data?.project
  const rows = timeline.data?.pages.flatMap((page) => page.activity) ?? []
  const groups = new Map<string, ActivityEntry[]>()
  for (const row of rows) {
    const label = groupLabel(row.createdAt)
    const group = groups.get(label) ?? []
    group.push(row)
    groups.set(label, group)
  }
  const memberNames = new Map(membersQuery.data?.members.map((member) => [member.id, member.name]))
  if (!project)
    return (
      <WorkspaceShell workspace={workspace} me={me} active="projects">
        <div className="p-8">
          {projectQuery.isError ? (
            <ErrorState
              title="Couldn’t load project activity"
              onRetry={() => void projectQuery.refetch()}
            />
          ) : (
            <SkeletonRows />
          )}
        </div>
      </WorkspaceShell>
    )
  return (
    <WorkspaceShell workspace={workspace} me={me} active="projects">
      <div className="min-h-screen text-ui">
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-2 md:px-8">
          <Link
            to="/$ws/projects"
            params={{ ws: workspace.slug }}
            className="text-text-muted hover:text-text"
          >
            Projects
          </Link>
          <span className="text-text-faint">›</span>
          <Link
            to="/$ws/projects/$projectId"
            params={{ ws: workspace.slug, projectId }}
            className="truncate font-medium"
          >
            {project.name}
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <AvatarStack people={[{ id: project.leadId, name: project.leadName }]} />
            <ShareButton workspace={workspace} project={project} iconOnly />
            <Button
              variant="ghost"
              icon={Star}
              aria-label={project.starred ? 'Unstar project' : 'Star project'}
              aria-pressed={project.starred}
              className="!text-warning"
              onClick={() =>
                void action.run(async () => {
                  if (project.starred)
                    await call(api.projects[':id'].star.$delete({ param: { id: projectId } }))
                  else await call(api.projects[':id'].star.$put({ param: { id: projectId } }))
                  await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
                })
              }
            />
            <Button variant="ghost" aria-label="Project actions unavailable" disabled>
              <Icon icon={MoreHorizontal} />
            </Button>
          </div>
        </div>
        <div className="px-4 pt-2 md:px-8">
          <h1 className="text-display font-semibold max-md:break-words">{project.name}</h1>
          <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 pb-2 md:h-10 md:flex-nowrap md:gap-5 md:pb-0">
            <span className="flex items-center gap-2">
              <StatusGlyph status={project.status} />
              {statusInfo(project.status).label}
            </span>
            <span className="flex items-center gap-2">
              <Avatar
                id={project.leadId}
                name={project.leadName ?? 'Deleted user'}
                className="!size-5"
              />
              {project.leadName ?? 'Deleted user'}
            </span>
            <span className="flex items-center gap-2 text-text-muted">
              <Icon icon={CalendarDays} />
              {project.targetDate ? `Due ${dateLabel(project.targetDate)}` : 'No target date'}
            </span>
            <div className="flex items-center gap-2 font-mono text-caption text-text-muted">
              <Progress
                className="w-20"
                label="Task progress"
                value={
                  project.taskProgress.total
                    ? (project.taskProgress.done / project.taskProgress.total) * 100
                    : 0
                }
              />
              <span>
                {project.taskProgress.done}/{project.taskProgress.total} tasks
              </span>
            </div>
          </div>
        </div>
        <div className="border-b border-border px-4 pt-1 md:px-8">
          <Tabs
            value="activity"
            onChange={(tab) => {
              const params = { ws: workspace.slug, projectId }
              if (tab === 'brief') void navigate({ to: '/$ws/projects/$projectId', params })
              if (tab === 'plan') void navigate({ to: '/$ws/projects/$projectId/plan', params })
              if (tab === 'tasks')
                void navigate({
                  to: '/$ws/projects/$projectId/tasks',
                  params,
                  search: { view: 'list' },
                })
              if (tab === 'diagrams')
                void navigate({ to: '/$ws/projects/$projectId/diagrams', params })
            }}
            tabs={[
              { id: 'brief', label: 'Brief' },
              { id: 'plan', label: 'Plan' },
              { id: 'tasks', label: `Tasks ${project.taskProgress.total}` },
              { id: 'diagrams', label: `Diagrams ${diagramsQuery.data?.diagrams.length ?? 0}` },
              { id: 'activity', label: 'Activity' },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2.5 md:px-8">
          <div className="w-45">
            <Select
              aria-label="Filter by person"
              className="w-45"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
            >
              <option value="">Everyone</option>
              {membersQuery.data?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-45">
            <Select
              aria-label="Filter by change"
              className="w-45"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {categories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {membersQuery.isError && (
          <div
            role="alert"
            className="flex items-center gap-3 border-b border-border px-4 py-2 text-caption md:px-8"
          >
            <p className="text-danger">People could not be loaded.</p>
            <Button size="sm" onClick={() => void membersQuery.refetch()}>
              Retry people
            </Button>
          </div>
        )}
        <section className="w-full max-w-[824px] px-4 py-8 md:px-8" aria-label="Project activity">
          <div aria-live="polite">
            {timeline.isLoading ? <SkeletonRows /> : null}
            {timeline.isError ? (
              <ErrorState title="Couldn’t load activity" onRetry={() => void timeline.refetch()} />
            ) : null}
            {!timeline.isLoading && !timeline.isError && !rows.length ? (
              <EmptyState
                title="No activity yet"
                body="Changes to this project will appear here."
              />
            ) : null}
          </div>
          {[...groups].map(([label, entries]) => (
            <section key={label} className="mb-5">
              <h2 className="mb-3 text-caption font-medium text-text-muted">{label}</h2>
              <ol>
                {entries.map((entry) => {
                  const content = activityContent(entry, memberNames)
                  const actorName =
                    entry.actorId == null && entry.payload.source === 'linear'
                      ? 'Linear'
                      : entry.type.startsWith('review.')
                        ? 'External reviewer'
                        : (entry.actorName ?? 'Deleted user')
                  return (
                    <li key={entry.id} className="flex gap-2 border-b border-border py-3">
                      <Avatar id={entry.actorId} name={actorName} className="!size-5.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3">
                          <p className="min-w-0 flex-1">
                            <span className="mr-2 font-medium">{actorName}</span>
                            <span className="text-text-muted">{content.sentence}</span>
                          </p>
                          <time
                            dateTime={entry.createdAt}
                            title={new Date(entry.createdAt).toLocaleString()}
                            className="shrink-0 font-mono text-caption text-text-faint"
                          >
                            {clockLabel(entry.createdAt)}
                          </time>
                        </div>
                        {content.detail ? (
                          <div className="mt-1 text-text-muted">{content.detail}</div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
          {timeline.hasNextPage && (
            <Button
              disabled={timeline.isFetchingNextPage}
              onClick={() => void timeline.fetchNextPage()}
            >
              {timeline.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </section>
        <ActionError error={action.error} />
      </div>
    </WorkspaceShell>
  )
}
export const projectActivityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/projects/$projectId/activity',
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: ProjectActivity,
})
