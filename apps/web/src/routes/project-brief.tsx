import { useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData, useNavigate } from '@tanstack/react-router'
import { CalendarDays, Link as LinkIcon, Pencil, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, call, RequestError } from '../api'
import { relativeTime } from '../relative-time'
import { queryClient } from '../session'
import { Avatar, AvatarStack } from '../ui/avatar'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'
import { EmptyState } from '../ui/empty-state'
import { Icon } from '../ui/icon'
import { Input } from '../ui/input'
import { Menu } from '../ui/menu'
import { Select } from '../ui/select'
import { StatusLabel } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { Tag } from '../ui/tag'
import { Textarea } from '../ui/textarea'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type SectionName = 'problem' | 'goals' | 'constraints' | 'outOfScope'
const sectionTitle: Record<SectionName, string> = {
  problem: 'Problem',
  goals: 'Goals',
  constraints: 'Constraints',
  outOfScope: 'Out of scope',
}
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`))
    : '—'
const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))

function ProjectBrief() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects/$projectId' })
  const { projectId } = projectBriefRoute.useParams()
  const editable = workspace.role === 'owner' || workspace.role === 'editor'
  const projectKey = ['project', projectId] as const
  const commentsKey = ['comments', projectId] as const
  const projectQuery = useQuery({
    queryKey: projectKey,
    queryFn: () => call(api.projects[':id'].$get({ param: { id: projectId } })),
  })
  const commentsQuery = useQuery({
    queryKey: commentsKey,
    queryFn: () => call(api.comments.$get({ query: { target: `project:${projectId}` } })),
  })
  const membersQuery = useQuery({
    queryKey: ['members', workspace.slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: workspace.slug } })),
  })
  const [editing, setEditing] = useState<SectionName | null>(null)
  const [sectionDraft, setSectionDraft] = useState('')
  const [editingTags, setEditingTags] = useState(false)
  const [tagsDraft, setTagsDraft] = useState('')
  const [editingProperty, setEditingProperty] = useState<'status' | 'lead' | 'targetDate' | null>(
    null,
  )
  const [commentDraft, setCommentDraft] = useState('')
  const [commentMentions, setCommentMentions] = useState<string[]>([])
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editingCommentDraft, setEditingCommentDraft] = useState('')
  const [editingMentions, setEditingMentions] = useState<string[]>([])
  const [deletingComment, setDeletingComment] = useState<string | null>(null)
  const action = useAction()
  const navigate = useNavigate()
  const project = projectQuery.data?.project
  const members = membersQuery.data?.members ?? []
  const getMentionOptions = (text: string) => {
    const match = text.match(/@([a-zA-Z0-9 ]*)$/)
    return match
      ? members.filter((member) =>
          member.name.toLowerCase().includes(match[1]?.trim().toLowerCase() ?? ''),
        )
      : []
  }
  const retainVisibleMentions = (
    text: string,
    current: string[],
    update: (value: string[]) => void,
  ) => {
    update(
      current.filter((id) => {
        const member = members.find((candidate) => candidate.id === id)
        return member && text.includes('@' + member.name)
      }),
    )
  }

  const refreshProject = async () => {
    await queryClient.invalidateQueries({ queryKey: projectKey })
    await queryClient.invalidateQueries({ queryKey: ['projects', workspace.slug] })
    await queryClient.invalidateQueries({ queryKey: ['projects', workspace.slug, 'home'] })
  }
  const saveProject = async (body: {
    name?: string
    status?: 'draft' | 'planning' | 'in-progress' | 'completed' | 'archived'
    leadId?: string
    targetDate?: string | null
    brief?: {
      problem?: string
      goals?: string[]
      constraints?: string
      outOfScope?: string
    }
    tags?: string[]
  }) => {
    await call(api.projects[':id'].$patch({ param: { id: projectId }, json: body }))
    setEditing(null)
    await refreshProject()
  }
  const sectionValue = (section: SectionName) => {
    if (!project) return ''
    if (section === 'goals') return project.brief.goals.join('\n')
    if (section === 'constraints') return project.brief.constraints
    if (section === 'outOfScope') return project.brief.outOfScope
    return project.brief.problem
  }
  const saveSection = async (section: SectionName) => {
    if (!project) return
    const value = sectionDraft.trim()
    const brief: {
      problem?: string
      goals?: string[]
      constraints?: string
      outOfScope?: string
    } = {}
    if (section === 'problem') brief.problem = value
    if (section === 'goals')
      brief.goals = value
        .split('\n')
        .map((goal) => goal.trim())
        .filter(Boolean)
    if (section === 'constraints') brief.constraints = value
    if (section === 'outOfScope') brief.outOfScope = value
    await saveProject({ brief })
  }
  const selectMention = (
    name: string,
    id: string,
    source: string,
    setSource: (value: string) => void,
    setMentions: (value: string[]) => void,
    existing: string[],
  ) => {
    const next = source.replace(/@[a-zA-Z0-9 ]*$/, `@${name} `)
    setSource(next)
    const retained = existing.filter((existingId) => {
      const member = members.find((candidate) => candidate.id === existingId)
      return member && next.includes('@' + member.name)
    })
    setMentions([...new Set([...retained, id])])
  }
  const renderMentionSuggestions = (
    text: string,
    setText: (value: string) => void,
    mentions: string[],
    setMentions: (value: string[]) => void,
  ) => {
    const options = getMentionOptions(text)
    if (!options.length) return null
    return (
      <div
        role="listbox"
        aria-label="Workspace members"
        className="absolute bottom-full z-10 mb-1 max-h-40 w-full overflow-y-auto rounded-panel border border-border bg-bg p-1 shadow-float"
      >
        {options.map((member) => (
          <Button
            key={member.id}
            role="option"
            aria-selected="false"
            variant="ghost"
            className="w-full justify-start"
            onClick={() =>
              selectMention(member.name, member.id, text, setText, setMentions, mentions)
            }
          >
            {member.name}
          </Button>
        ))}
      </div>
    )
  }
  const postComment = async () => {
    await call(
      api.comments.$post({
        json: {
          target: `project:${projectId}`,
          body: commentDraft,
          mentions: commentMentions,
        },
      }),
    )
    setCommentDraft('')
    setCommentMentions([])
    await queryClient.invalidateQueries({ queryKey: commentsKey })
  }
  const saveComment = async (commentId: string) => {
    await call(
      api.comments[':id'].$patch({
        param: { id: commentId },
        json: { body: editingCommentDraft, mentions: editingMentions },
      }),
    )
    setEditingComment(null)
    await queryClient.invalidateQueries({ queryKey: commentsKey })
  }
  const removeComment = async () => {
    if (!deletingComment) return
    await call(api.comments[':id'].$delete({ param: { id: deletingComment } }))
    setDeletingComment(null)
    await queryClient.invalidateQueries({ queryKey: commentsKey })
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
            <AvatarStack people={[{ id: project.leadId, name: project.leadName }]} />
            <Button variant="secondary" disabled icon={LinkIcon} aria-label="Share unavailable">
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
                  await refreshProject()
                })
              }
            />
          </div>
          <div className="border-b border-border px-8 pt-3 pb-0.5">
            <h1 className="text-display font-semibold">{project.name}</h1>
            <div className="flex h-10 items-center gap-6 text-ui">
              <StatusLabel status={project.status} />
              {editable ? (
                <span className="flex items-center gap-2">
                  <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                  {project.leadName}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                  {project.leadName}
                </span>
              )}
              <span className="flex items-center gap-2 text-text-muted">
                <Icon icon={CalendarDays} />
                {project.targetDate
                  ? `Due ${formatShortDate(project.targetDate)}`
                  : 'No target date'}
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
              value="brief"
              onChange={(tab) => {
                if (tab === 'tasks')
                  void navigate({
                    to: '/$ws/projects/$projectId/tasks',
                    params: { ws: workspace.slug, projectId },
                    search: { view: 'list' },
                  })
              }}
              tabs={[
                { id: 'brief', label: 'Brief' },
                { id: 'plan', label: 'Plan', disabled: true },
                { id: 'tasks', label: 'Tasks' },
                { id: 'diagrams', label: 'Diagrams', disabled: true },
                { id: 'activity', label: 'Activity', disabled: true },
              ]}
            />
          </div>
          <div className="grid min-h-[calc(100vh-171px)] lg:grid-cols-[minmax(0,1fr)_360px]">
            <main className="min-w-0 space-y-7 border-t border-border px-8 py-5">
              {(['problem', 'goals', 'constraints', 'outOfScope'] as SectionName[]).map(
                (section) => (
                  <section className="group" key={section} aria-labelledby={`brief-${section}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 id={`brief-${section}`} className="font-semibold">
                        {sectionTitle[section]}
                      </h2>
                      {editable && editing !== section && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          aria-label={`Edit ${sectionTitle[section]}`}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => {
                            setSectionDraft(sectionValue(section))
                            setEditing(section)
                          }}
                        />
                      )}
                    </div>
                    {editing === section ? (
                      <div className="space-y-2">
                        <Textarea
                          aria-label={sectionTitle[section]}
                          value={sectionDraft}
                          onChange={(event) => setSectionDraft(event.target.value)}
                          className="h-30 resize-y"
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            disabled={action.busy}
                            onClick={() => void action.run(() => saveSection(section))}
                          >
                            Save {sectionTitle[section]}
                          </Button>
                          <Button disabled={action.busy} onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : section === 'goals' ? (
                      project.brief.goals.length ? (
                        <ol className="list-decimal space-y-1 pl-7 marker:text-text-muted">
                          {project.brief.goals.map((goal) => (
                            <li className="pl-1.5" key={goal}>
                              {goal}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-text-muted">No goals yet.</p>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap leading-[22px]">
                        {project.brief[section] || (
                          <span className="text-text-muted">Not added yet.</span>
                        )}
                      </p>
                    )}
                  </section>
                ),
              )}
              <section className="group" aria-labelledby="project-tags">
                <div className="mb-2 flex items-center justify-between">
                  <h2 id="project-tags" className="font-semibold">
                    Tags
                  </h2>
                  {editable && !editingTags && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      aria-label="Edit tags"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        setTagsDraft(project.tags.join(', '))
                        setEditingTags(true)
                      }}
                    />
                  )}
                </div>
                {editingTags ? (
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Project tags"
                      value={tagsDraft}
                      onChange={(event) => setTagsDraft(event.target.value)}
                      placeholder="web, billing"
                    />
                    <Button
                      variant="primary"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          const tags = tagsDraft
                            .split(',')
                            .map((tag) => tag.trim())
                            .filter(Boolean)
                          await saveProject({ tags })
                          setEditingTags(false)
                        })
                      }
                    >
                      Save tags
                    </Button>
                    <Button onClick={() => setEditingTags(false)}>Cancel</Button>
                  </div>
                ) : project.tags.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {project.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                ) : (
                  <p className="text-text-muted">No tags yet.</p>
                )}
              </section>
              <ActionError error={action.error} />
            </main>
            <aside className="border-t border-border px-6 py-6.5 lg:border-t-0 lg:border-l">
              <section aria-labelledby="project-properties">
                <h2
                  id="project-properties"
                  className="mb-2 text-caption font-medium text-text-muted"
                >
                  Properties
                </h2>
                <dl className="space-y-2 text-ui">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">Status</dt>
                    <dd>
                      {editable && editingProperty === 'status' ? (
                        <Select
                          aria-label="Project status"
                          value={project.status}
                          onChange={(event) =>
                            void action.run(async () => {
                              await saveProject({
                                status: event.target.value as
                                  | 'draft'
                                  | 'planning'
                                  | 'in-progress'
                                  | 'completed'
                                  | 'archived',
                              })
                              setEditingProperty(null)
                            })
                          }
                          className="w-37"
                        >
                          <option value="draft">Draft</option>
                          <option value="planning">Planning</option>
                          <option value="in-progress">In progress</option>
                          <option value="completed">Completed</option>
                          <option value="archived">Archived</option>
                        </Select>
                      ) : editable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit status"
                          className="h-auto px-0 font-normal hover:bg-transparent"
                          onClick={() => setEditingProperty('status')}
                        >
                          <StatusLabel status={project.status} />
                        </Button>
                      ) : (
                        <StatusLabel status={project.status} />
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">Lead</dt>
                    <dd className="flex min-w-0 items-center gap-2">
                      {editable && editingProperty === 'lead' ? (
                        <Select
                          aria-label="Project lead"
                          value={project.leadId}
                          onChange={(event) =>
                            void action.run(async () => {
                              await saveProject({ leadId: event.target.value })
                              setEditingProperty(null)
                            })
                          }
                          className="w-37"
                        >
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </Select>
                      ) : editable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit lead"
                          className="h-auto min-w-0 gap-2 px-0 font-normal hover:bg-transparent"
                          onClick={() => setEditingProperty('lead')}
                        >
                          <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                          <span className="truncate">{project.leadName}</span>
                        </Button>
                      ) : (
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar id={project.leadId} name={project.leadName} className="!size-5" />
                          <span className="truncate">{project.leadName}</span>
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">Target date</dt>
                    <dd>
                      {editable && editingProperty === 'targetDate' ? (
                        <Input
                          aria-label="Target date"
                          className="w-37"
                          type="date"
                          value={project.targetDate ?? ''}
                          onChange={(event) =>
                            void action.run(async () => {
                              await saveProject({ targetDate: event.target.value || null })
                              setEditingProperty(null)
                            })
                          }
                        />
                      ) : editable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit target date"
                          className="h-auto px-0 font-normal hover:bg-transparent"
                          onClick={() => setEditingProperty('targetDate')}
                        >
                          {formatDate(project.targetDate)}
                        </Button>
                      ) : (
                        formatDate(project.targetDate)
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">Team</dt>
                    <dd>
                      <AvatarStack people={[{ id: project.leadId, name: project.leadName }]} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">Created</dt>
                    <dd className="text-right text-text-muted">
                      {formatDate(project.createdAt.slice(0, 10))}
                      {project.createdBy ? ` by ${project.createdBy.name}` : ''}
                    </dd>
                  </div>
                </dl>
              </section>
              <section
                aria-labelledby="project-comments"
                className="mt-4 border-t border-border pt-4"
              >
                <h2 id="project-comments" className="mb-4 text-caption font-medium text-text-muted">
                  Comments <span>{commentsQuery.data?.comments.length ?? ''}</span>
                </h2>
                {commentsQuery.isPending ? (
                  <p className="text-text-muted">Loading comments…</p>
                ) : commentsQuery.isError ? (
                  <EmptyState
                    title="Couldn’t load comments"
                    body="Try again to read the discussion."
                    action={<Button onClick={() => void commentsQuery.refetch()}>Retry</Button>}
                  />
                ) : commentsQuery.data.comments.length === 0 ? (
                  <p className="mb-4 text-caption text-text-muted">No comments yet.</p>
                ) : (
                  <ol className="space-y-4">
                    {commentsQuery.data.comments.map((comment) => (
                      <li key={comment.id} className="text-ui">
                        <div className="flex items-center gap-2">
                          <Avatar
                            id={comment.authorId}
                            name={comment.authorName}
                            className="!size-5"
                          />
                          <span className="font-medium">{comment.authorName}</span>
                          <time
                            className="text-caption text-text-muted"
                            dateTime={comment.createdAt}
                          >
                            {relativeTime(comment.createdAt)}
                          </time>
                          {(comment.authorId === me.user.id || workspace.role === 'owner') &&
                            editingComment !== comment.id && (
                              <Menu
                                label="Actions for your comment"
                                iconOnly
                                triggerClassName="ml-auto h-7 px-1"
                                items={[
                                  {
                                    label: 'Edit comment',
                                    icon: Pencil,
                                    onSelect: () => {
                                      setEditingComment(comment.id)
                                      setEditingCommentDraft(comment.body)
                                      setEditingMentions(comment.mentions)
                                    },
                                  },
                                  {
                                    label: 'Delete comment',
                                    icon: Trash2,
                                    danger: true,
                                    onSelect: () => setDeletingComment(comment.id),
                                  },
                                ]}
                              />
                            )}
                        </div>
                        {editingComment === comment.id ? (
                          <div className="mt-2 space-y-2">
                            <div className="relative">
                              <Textarea
                                aria-label="Edit comment"
                                value={editingCommentDraft}
                                onChange={(event) => {
                                  setEditingCommentDraft(event.target.value)
                                  retainVisibleMentions(
                                    event.target.value,
                                    editingMentions,
                                    setEditingMentions,
                                  )
                                }}
                                className="h-20 resize-y"
                              />
                              {renderMentionSuggestions(
                                editingCommentDraft,
                                setEditingCommentDraft,
                                editingMentions,
                                setEditingMentions,
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="primary"
                                disabled={action.busy}
                                onClick={() => void action.run(() => saveComment(comment.id))}
                              >
                                Save comment
                              </Button>
                              <Button onClick={() => setEditingComment(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap pl-7 leading-[20px]">
                            {comment.body}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="relative mt-4">
                  <Textarea
                    aria-label="Comment"
                    placeholder="Write a comment. Type @ to mention someone."
                    value={commentDraft}
                    onChange={(event) => {
                      setCommentDraft(event.target.value)
                      retainVisibleMentions(event.target.value, commentMentions, setCommentMentions)
                    }}
                    className="h-16 resize-y"
                  />
                  {renderMentionSuggestions(
                    commentDraft,
                    setCommentDraft,
                    commentMentions,
                    setCommentMentions,
                  )}
                  <Button
                    variant="primary"
                    className="mt-2 w-full"
                    disabled={!commentDraft.trim() || action.busy}
                    onClick={() => void action.run(postComment)}
                  >
                    Post comment
                  </Button>
                </div>
                <ActionError error={action.error} />
              </section>
            </aside>
          </div>
          <Dialog
            open={deletingComment !== null}
            onClose={() => setDeletingComment(null)}
            title="Delete comment"
            footer={
              <>
                <Button onClick={() => setDeletingComment(null)}>Cancel</Button>
                <Button
                  variant="danger-fill"
                  disabled={action.busy}
                  onClick={() => void action.run(removeComment)}
                >
                  Delete comment
                </Button>
              </>
            }
          >
            This comment will be removed from the project.
          </Dialog>
        </>
      ) : null}
    </WorkspaceShell>
  )
}

export const projectBriefRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/projects/$projectId',
  remountDeps: ({ params }) => ({ workspace: params.ws, project: params.projectId }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: ProjectBrief,
})
