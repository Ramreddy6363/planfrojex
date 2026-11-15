import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData } from '@tanstack/react-router'
import { CalendarDays, Check, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { api, call } from '../api'
import { getInbox, inboxKey } from '../inbox'
import { relativeTime } from '../relative-time'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { StatusGlyph } from '../ui/status'
import { Textarea } from '../ui/textarea'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type InboxItem = Awaited<ReturnType<typeof getInbox>>['items'][number]
function description(item: InboxItem) {
  if ((item.type === 'mention' || item.type === 'reply') && !item.comment)
    return 'deleted a comment'
  if (item.type === 'mention') return 'mentioned you'
  if (item.type === 'assigned') return 'assigned you'
  if (item.type === 'reply') return 'replied to your comment'
  return `${item.outcome === 'rejected' ? 'rejected' : 'accepted'} your plan draft`
}
function itemTime(value: string) {
  const date = new Date(value),
    now = new Date()
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
    : relativeTime(value)
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(`${value}T00:00:00`),
  )
}

function Inbox() {
  const { workspace, me } = useLoaderData({ from: '/$ws/inbox' })
  const list = useInfiniteQuery({
    queryKey: [...inboxKey(workspace.slug), 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getInbox(workspace.slug, pageParam),
    getNextPageParam: (page) => page.nextCursor,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const action = useAction()
  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  const selected = items.find((item) => item.id === selectedId)
  const deletedTask = Boolean(selected?.target?.startsWith('task:') && !selected.task)
  const target = deletedTask
    ? null
    : (selected?.target ?? (selected?.task ? `task:${selected.task.id}` : null))
  const thread = useQuery({
    queryKey: ['inbox-thread', target],
    queryFn: () => call(api.comments.$get({ query: { target: target as string } })),
    enabled: !!target,
  })
  const members = useQuery({
    queryKey: ['members', workspace.slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: workspace.slug } })),
    enabled: !!target,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: inboxKey(workspace.slug) })
  const markRead = async (item: InboxItem) => {
    await call(api.inbox[':id'].read.$post({ param: { id: item.id } }))
    await refresh()
  }
  const open = async (item: InboxItem) => {
    setSelectedId(item.id)
    setReply('')
    setMentions([])
    if (!item.readAt) await markRead(item)
  }
  const sendReply = async () => {
    if (!target) return
    await call(api.comments.$post({ json: { target, body: reply, mentions } }))
    setReply('')
    setMentions([])
    await queryClient.invalidateQueries({ queryKey: ['inbox-thread', target] })
    await refresh()
  }
  const mentionMatch = reply.match(/@([a-zA-Z0-9 ]*)$/)
  const suggestions = mentionMatch
    ? (members.data?.members ?? []).filter((member) =>
        member.name.toLowerCase().includes(mentionMatch[1]?.trim().toLowerCase() ?? ''),
      )
    : []
  const taskStatus = selected?.task?.status
  const dueDate = selected?.task?.dueDate
  const dueToday = dueDate === new Date().toLocaleDateString('en-CA')

  return (
    <WorkspaceShell workspace={workspace} me={me} active="inbox">
      <header className="flex h-14 items-center justify-between border-b border-border px-8">
        <h1 className="text-title font-semibold">Inbox</h1>
        <Button
          variant="ghost"
          icon={CheckCheck}
          disabled={action.busy || !list.data?.pages[0]?.unreadCount}
          onClick={() =>
            void action.run(async () => {
              await call(api.inbox['read-all'].$post({ query: { ws: workspace.slug } }))
              await refresh()
            })
          }
        >
          Mark all as read
        </Button>
      </header>
      <div className="flex min-h-[calc(100vh-56px)]">
        <section className="w-[440px] shrink-0 border-r border-border" aria-label="Notifications">
          {list.isPending ? (
            <p className="p-5 text-text-muted">Loading inbox…</p>
          ) : list.isError && !list.data ? (
            <EmptyState
              title="Couldn’t load your inbox"
              body="Try again to see your notifications."
              action={<Button onClick={() => void list.refetch()}>Retry</Button>}
            />
          ) : items.length === 0 ? (
            <EmptyState
              title="You’re all caught up"
              body="Mentions, assignments and replies will appear here."
            />
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    size="auto"
                    onClick={() => void action.run(() => open(item))}
                    aria-pressed={selectedId === item.id}
                    className={`min-h-[72px] w-full !items-start !justify-start !gap-3 !rounded-none !border-0 !border-b !border-b-border !px-5 py-3 text-left !font-normal hover:!bg-bg-subtle ${selectedId === item.id ? '!bg-bg-subtle ring-1 ring-inset ring-accent' : ''}`}
                  >
                    <Avatar
                      id={item.actor.id}
                      name={item.actor.name ?? 'Deleted user'}
                      className="!size-[22px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`min-w-0 truncate ${item.readAt ? 'text-text-muted' : 'font-semibold'}`}
                        >
                          {item.actor.name ?? 'Deleted user'} {description(item)}
                        </span>
                        <time
                          dateTime={item.createdAt}
                          className="ml-auto shrink-0 text-[11px] text-text-muted"
                        >
                          {itemTime(item.createdAt)}
                        </time>
                      </span>
                      <span className="mt-1 block truncate text-caption text-text-muted">
                        {item.task
                          ? `${item.task.key}  ${item.task.title}`
                          : item.target?.startsWith('task:')
                            ? `${item.project.name}  Task no longer available`
                            : `${item.project.name}  ${item.type === 'draft_decision' ? 'Plan' : 'Brief'}`}
                      </span>
                      {item.comment ? (
                        <span
                          className={`mt-0.5 block truncate text-caption ${item.readAt ? 'text-text-muted' : ''}`}
                        >
                          {item.comment.body}
                        </span>
                      ) : item.section ? (
                        <span className="mt-0.5 block truncate text-caption text-text-muted">
                          {item.section} section
                        </span>
                      ) : null}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {list.isFetchNextPageError ? (
            <p role="alert" className="px-5 py-3 text-danger">
              Couldn’t load more notifications. Try again.
            </p>
          ) : null}
          {list.hasNextPage ? (
            <div className="p-4 text-center">
              <Button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
          <div className="px-5">
            <ActionError error={action.error} />
          </div>
        </section>
        {selected ? (
          <section aria-label="Notification details" className="min-w-0 flex-1 px-8 py-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-caption text-text-muted">
                  {selected.project.name}
                  {deletedTask
                    ? '  Task no longer available'
                    : selected.task
                      ? `  ${selected.task.key}`
                      : `  ${selected.type === 'draft_decision' ? 'Plan' : 'Brief'}`}
                </p>
                <h2 className="mt-1 text-title font-semibold">
                  {selected.task?.title ??
                    (deletedTask ? 'Task no longer available' : selected.project.name)}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  icon={Check}
                  disabled={action.busy}
                  onClick={() => void action.run(() => markRead(selected))}
                >
                  Mark as read
                </Button>
                {selected.task ||
                selected.type === 'draft_decision' ||
                selected.target?.startsWith('project:') ? (
                  <Link
                    to={
                      selected.task
                        ? '/$ws/projects/$projectId/tasks'
                        : selected.type === 'draft_decision'
                          ? '/$ws/projects/$projectId/plan'
                          : '/$ws/projects/$projectId'
                    }
                    params={{ ws: workspace.slug, projectId: selected.project.id }}
                    search={selected.task ? { view: 'list', task: selected.task.id } : {}}
                    className="inline-flex h-control items-center rounded-control border border-border bg-bg px-3 font-medium hover:bg-bg-subtle"
                  >
                    Open{' '}
                    {selected.task ? 'task' : selected.type === 'draft_decision' ? 'plan' : 'brief'}
                  </Link>
                ) : null}
              </div>
            </div>
            {selected.task ? (
              <div className="mt-5 flex items-center gap-5">
                <span className="inline-flex h-5.5 items-center gap-1.5">
                  <StatusGlyph
                    status={
                      taskStatus === 'in_progress'
                        ? 'in-progress'
                        : taskStatus === 'done'
                          ? 'completed'
                          : 'draft'
                    }
                  />
                  {taskStatus === 'in_progress'
                    ? 'In progress'
                    : taskStatus === 'done'
                      ? 'Completed'
                      : 'To do'}
                </span>
                {dueDate ? (
                  <span
                    className={`inline-flex items-center gap-1.5 ${dueToday ? 'text-warning' : 'text-text-muted'}`}
                  >
                    <Icon icon={CalendarDays} />
                    {dueToday ? 'Due today' : `Due ${shortDate(dueDate)}`}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 max-w-[640px] border-t border-border pt-5">
              {deletedTask ? (
                <p className="text-text-muted">This task is no longer available.</p>
              ) : target ? (
                <>
                  {thread.isPending ? (
                    <p className="text-text-muted">Loading comments…</p>
                  ) : thread.isError ? (
                    <p role="alert" className="text-text-muted">
                      Couldn’t load comments.{' '}
                      <Button variant="ghost" onClick={() => void thread.refetch()}>
                        Retry
                      </Button>
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {thread.data.comments.map((comment) => (
                        <article
                          key={comment.id}
                          className={`rounded-panel ${comment.id === selected.comment?.id ? 'bg-accent-subtle p-3' : ''}`}
                        >
                          <div className="flex items-center gap-2">
                            <Avatar
                              id={comment.authorId}
                              name={comment.authorName ?? 'Deleted user'}
                              className="!size-5"
                            />
                            <span className="font-medium">
                              {comment.authorName ?? 'Deleted user'}
                            </span>
                            <time
                              dateTime={comment.createdAt}
                              className="text-caption text-text-muted"
                            >
                              {relativeTime(comment.createdAt)}
                            </time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap pl-7">{comment.body}</p>
                        </article>
                      ))}
                    </div>
                  )}
                  {!selected.comment &&
                  (selected.type === 'mention' || selected.type === 'reply') ? (
                    <p className="mt-4 text-text-muted">This comment was deleted.</p>
                  ) : null}
                  <form className="mt-5" onSubmit={action.submit(sendReply)}>
                    <div className="relative">
                      {suggestions.length ? (
                        <div
                          role="listbox"
                          aria-label="Workspace members"
                          className="absolute bottom-full z-10 mb-1 max-h-40 w-full overflow-y-auto rounded-panel border border-border bg-bg p-1 shadow-float"
                        >
                          {suggestions.map((member) => (
                            <Button
                              key={member.id}
                              role="option"
                              aria-selected="false"
                              variant="ghost"
                              className="w-full justify-start"
                              onClick={() => {
                                setReply(reply.replace(/@[a-zA-Z0-9 ]*$/, `@${member.name} `))
                                setMentions([...new Set([...mentions, member.id])])
                              }}
                            >
                              {member.name}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      <Textarea
                        height="invite"
                        aria-label={`Reply to ${selected.actor.name ?? 'Deleted user'}`}
                        placeholder={`Reply to ${selected.actor.name ? selected.actor.name.split(' ')[0] : 'Deleted user'}`}
                        maxLength={5000}
                        value={reply}
                        onChange={(event) => {
                          const text = event.target.value
                          setReply(text)
                          setMentions(
                            mentions.filter((id) => {
                              const member = members.data?.members.find((item) => item.id === id)
                              return member && text.includes(`@${member.name}`)
                            }),
                          )
                        }}
                      />
                    </div>
                    {reply ? (
                      <div className="mt-2 flex justify-end">
                        <Button type="submit" disabled={action.busy || !reply.trim()}>
                          Send reply
                        </Button>
                      </div>
                    ) : null}
                  </form>
                </>
              ) : (
                <p className="text-text-muted">
                  {selected.actor.name ?? 'Deleted user'} {description(selected)}
                  {selected.section ? `: ${selected.section}` : ''}.
                </p>
              )}
            </div>
          </section>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-center text-text-muted">
            Select a notification to see the details.
          </div>
        )}
      </div>
    </WorkspaceShell>
  )
}

export const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/inbox',
  remountDeps: ({ params }) => ({ workspace: params.ws }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: Inbox,
})
