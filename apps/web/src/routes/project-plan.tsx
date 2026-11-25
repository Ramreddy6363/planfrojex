import { useMutation, useQuery } from '@tanstack/react-query'
import { createRoute, Link, useLoaderData, useNavigate } from '@tanstack/react-router'
import { CalendarDays, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, call, type DriftAction, projectDriftClient, RequestError } from '../api'
import { ProjectDriftCard } from '../project-drift-card'
import { ProjectWeeklyStatus } from '../project-weekly-status'
import { relativeTime } from '../relative-time'
import { queryClient } from '../session'
import { ShareButton } from '../share-dialog'
import { Avatar, AvatarStack } from '../ui/avatar'
import { Button } from '../ui/button'
import { ErrorState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { Menu } from '../ui/menu'
import { Select } from '../ui/select'
import { SkeletonRows } from '../ui/skeleton-row'
import { StatusGlyph } from '../ui/status'
import { Tabs } from '../ui/tabs'
import { Textarea } from '../ui/textarea'
import { ToastRegion } from '../ui/toast'
import { ActionError, useAction } from '../use-action'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type Kind = 'requirements' | 'stories' | 'stack' | 'estimate'
const names: Record<Kind, string> = {
  requirements: 'Requirements',
  stories: 'User stories',
  stack: 'Tech stack',
  estimate: 'Estimate',
}
const asText = (value: unknown, kind: Kind) => {
  if (kind === 'estimate') {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const estimate = value as { value?: unknown; note?: unknown }
      return [estimate.value, estimate.note].filter((part) => typeof part === 'string').join('\n')
    }
    return ''
  }
  return Array.isArray(value) ? value.join('\n') : ''
}
const fromText = (value: string, kind: Kind): string[] | { value: string; note: string } => {
  const lines = value.split('\n').map((line) => line.trim())
  return kind === 'estimate'
    ? { value: lines[0] ?? '', note: lines.slice(1).join('\n') }
    : lines.filter(Boolean)
}
const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`))
    : '—'

function ProjectPlan() {
  const { workspace, me } = useLoaderData({ from: '/$ws/projects/$projectId/plan' })
  const { projectId } = projectPlanRoute.useParams()
  const navigate = useNavigate()
  const editable = workspace.role === 'owner' || workspace.role === 'editor'
  const [editing, setEditing] = useState<Kind | null>(null)
  const [draft, setDraft] = useState('')
  const [milestoneTitle, setMilestoneTitle] = useState('')
  const [milestoneDate, setMilestoneDate] = useState('')
  const [milestoneTitleDraft, setMilestoneTitleDraft] = useState('')
  const [riskTitle, setRiskTitle] = useState('')
  const [riskTitleDraft, setRiskTitleDraft] = useState('')
  const [riskSeverity, setRiskSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [riskOwner, setRiskOwner] = useState('')
  const [riskDate, setRiskDate] = useState('')
  const [addingMilestone, setAddingMilestone] = useState(false)
  const [addingRisk, setAddingRisk] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<string | null>(null)
  const [editingRisk, setEditingRisk] = useState<string | null>(null)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; decisionId?: string } | null>(null)
  const action = useAction()
  const driftAction = useAction()
  const driftKey = ['drift', projectId]
  const planQuery = useQuery({
    queryKey: ['plan', projectId],
    queryFn: () => call(api.projects[':id'].plan.$get({ param: { id: projectId } })),
  })
  const diagramsQuery = useQuery({
    queryKey: ['diagrams', projectId],
    queryFn: () => call(api.projects[':id'].diagrams.$get({ param: { id: projectId } })),
  })
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => call(api.projects[':id'].$get({ param: { id: projectId } })),
  })
  const membersQuery = useQuery({
    queryKey: ['members', workspace.slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: workspace.slug } })),
  })
  const draftQuery = useQuery({
    queryKey: ['draft', activeDraftId],
    enabled: Boolean(activeDraftId),
    queryFn: () => {
      if (!activeDraftId) throw new Error('No active draft')
      return call(api.drafts[':id'].$get({ param: { id: activeDraftId } }))
    },
    refetchInterval: (query) =>
      query.state.data?.draft.status === 'queued' || query.state.data?.draft.status === 'running'
        ? 2_000
        : false,
  })
  const decisionsQuery = useQuery({
    queryKey: ['decisions', projectId],
    queryFn: () => call(api.projects[':id'].decisions.$get({ param: { id: projectId } })),
  })
  const driftQuery = useQuery({
    queryKey: driftKey,
    queryFn: () => call(projectDriftClient.$get({ param: { id: projectId } })),
  })
  const canManageDrift = editable && driftQuery.data?.canManage === true
  const driftReport = driftQuery.data?.report
  const driftUnavailable =
    driftQuery.isError &&
    !(driftQuery.error instanceof RequestError && driftQuery.error.status === 404)
  const plan = planQuery.data
  const project = projectQuery.data?.project
  const sections = plan?.sections ?? []
  const mutation = useMutation({
    mutationFn: async ({
      kind,
      content,
      version,
    }: {
      kind: Kind
      content: string[] | { value: string; note: string }
      version: number
    }) =>
      call(
        api.projects[':id'].plan.sections[':kind'].$patch({
          param: { id: projectId, kind },
          json: { content, version },
        }),
      ),
    onSuccess: () => {
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['plan', projectId] })
    },
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['plan', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
  }
  const updateDrift = async (json: DriftAction) => {
    await queryClient.cancelQueries({ queryKey: driftKey })
    try {
      const result = await call(projectDriftClient.check.$post({ param: { id: projectId }, json }))
      queryClient.setQueryData(driftKey, result)
      if (json?.action === 'accept' || json?.action === 'accept_change') {
        setToast({ message: 'Plan update accepted' })
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ['decisions', projectId] }),
          queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        ])
      } else if (json?.action === 'reject_change') {
        setToast({ message: 'Plan change rejected' })
        await queryClient.invalidateQueries({ queryKey: ['decisions', projectId] })
      } else if (json?.action === 'check') {
        setToast({ message: 'Drift check complete' })
      }
    } catch (error) {
      if (error instanceof RequestError && error.status === 409)
        await queryClient.invalidateQueries({ queryKey: driftKey })
      throw error
    }
  }
  const addMilestone = async () => {
    await call(
      api.projects[':id'].milestones.$post({
        param: { id: projectId },
        json: { title: milestoneTitle, status: 'planning', dueDate: milestoneDate || null },
      }),
    )
    setMilestoneTitle('')
    setMilestoneDate('')
    setAddingMilestone(false)
    await refresh()
  }
  const addRisk = async () => {
    await call(
      api.projects[':id'].risks.$post({
        param: { id: projectId },
        json: {
          title: riskTitle,
          severity: riskSeverity,
          ownerId: riskOwner || null,
          decideBy: riskDate || null,
        },
      }),
    )
    setRiskTitle('')
    setRiskDate('')
    setAddingRisk(false)
    await refresh()
  }
  const editSection = (kind: Kind) => {
    const section = sections.find((item) => item.kind === kind)
    setDraft(asText(section?.content, kind))
    setEditing(kind)
  }
  const startDraft = async () => {
    const result = await call(
      api.projects[':id'].drafts.$post({ param: { id: projectId }, json: { kind: 'plan' } }),
    )
    setActiveDraftId(result.draft.id)
    setToast({ message: 'Drafting plan from the brief…' })
  }
  const acceptChange = async (changeId: string) => {
    if (!activeDraftId) return
    const result = await call(
      api.drafts[':id'].changes[':changeId'].accept.$post({
        param: { id: activeDraftId, changeId },
        json: {},
      }),
    )
    setToast({ message: 'Plan change accepted', decisionId: result.decision.id })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plan', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['decisions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['draft', activeDraftId] }),
    ])
  }
  const rejectChange = async (changeId: string) => {
    if (!activeDraftId) return
    await call(
      api.drafts[':id'].changes[':changeId'].reject.$post({
        param: { id: activeDraftId, changeId },
        json: {},
      }),
    )
    setToast({ message: 'Plan change rejected' })
    await queryClient.invalidateQueries({ queryKey: ['draft', activeDraftId] })
    await queryClient.invalidateQueries({ queryKey: ['decisions', projectId] })
  }
  const acceptRemaining = async () => {
    if (!activeDraftId) return
    const result = await call(
      api.drafts[':id']['accept-all'].$post({ param: { id: activeDraftId }, json: {} }),
    )
    setToast({ message: `${result.accepted} plan changes accepted` })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plan', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['draft', activeDraftId] }),
      queryClient.invalidateQueries({ queryKey: ['decisions', projectId] }),
    ])
  }
  const discardDraft = async () => {
    if (!activeDraftId) return
    await call(api.drafts[':id'].$delete({ param: { id: activeDraftId } }))
    setActiveDraftId(null)
    setToast({ message: 'Draft discarded' })
  }
  const undoDecision = async (decisionId: string) => {
    await call(api.decisions[':id'].undo.$post({ param: { id: decisionId } }))
    setToast({ message: 'Plan change undone' })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plan', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['decisions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['draft', activeDraftId] }),
    ])
  }
  if (planQuery.isLoading || projectQuery.isLoading)
    return (
      <WorkspaceShell workspace={workspace} me={me} active="projects">
        <div className="p-8">
          <SkeletonRows />
        </div>
      </WorkspaceShell>
    )
  if (!project || !plan)
    return (
      <WorkspaceShell workspace={workspace} me={me} active="projects">
        <div className="p-8">
          <ErrorState
            title="Couldn’t load the plan"
            onRetry={() => {
              void planQuery.refetch()
              void projectQuery.refetch()
            }}
          />
        </div>
      </WorkspaceShell>
    )
  const lastMilestone = plan.milestones.at(-1)
  const unchangedMilestone =
    lastMilestone &&
    driftReport?.changes.length &&
    !driftReport.changes.some(
      (change) => change.kind !== 'risk_severity' && change.code === lastMilestone.code,
    )
      ? lastMilestone.code
      : undefined
  const driftNote =
    driftReport?.changes.length && project.targetDate
      ? unchangedMilestone
        ? `${unchangedMilestone} and the launch date stay the same.`
        : 'The launch date stays the same.'
      : undefined
  const section = (kind: Kind) =>
    sections.find((item) => item.kind === kind) ?? {
      kind,
      content: null,
      version: 0,
      updatedAt: '',
      updatedBy: null,
    }
  const drawChange = (kind: string) => {
    const change = draftQuery.data?.draft.changes.find((item) => item.kind === kind)
    if (change?.status !== 'pending') return null
    const valueLines = (value: unknown): string[] => {
      if (value == null) return []
      if (
        kind === 'requirements' ||
        kind === 'stories' ||
        kind === 'stack' ||
        kind === 'estimate'
      ) {
        const snapshot =
          typeof value === 'object' && !Array.isArray(value)
            ? (value as { content?: unknown })
            : null
        const content = snapshot && 'content' in snapshot ? snapshot.content : value
        if (content == null) return []
        if (kind === 'estimate' && typeof content === 'object' && !Array.isArray(content)) {
          const estimate = content as { value?: unknown; note?: unknown }
          return [estimate.value, estimate.note].filter(
            (part): part is string => typeof part === 'string' && part.length > 0,
          )
        }
        return Array.isArray(content) ? content.map(String) : [String(content)]
      }
      if (Array.isArray(value))
        return value.map((entry) => {
          if (!entry || typeof entry !== 'object') return String(entry)
          const item = entry as Record<string, unknown>
          const code = typeof item.code === 'string' ? `${item.code} · ` : ''
          const title = typeof item.title === 'string' ? item.title : ''
          if (kind === 'milestones') {
            const status = typeof item.status === 'string' ? item.status.replace('_', ' ') : ''
            const date = typeof item.dueDate === 'string' ? ` · due ${item.dueDate}` : ''
            return `${code}${title}${status ? ` · ${status}` : ''}${date}`
          }
          const severity = typeof item.severity === 'string' ? ` · ${item.severity} risk` : ''
          const ownerName =
            typeof item.ownerId === 'string'
              ? (membersQuery.data?.members.find((member) => member.id === item.ownerId)?.name ??
                'Assigned owner')
              : 'Unassigned'
          const owner = ` · ${ownerName}`
          const date = typeof item.decideBy === 'string' ? ` · decide by ${item.decideBy}` : ''
          return `${code}${title}${severity}${owner}${date}`
        })
      return [String(value)]
    }
    const label =
      {
        requirements: 'Requirements',
        stories: 'User stories',
        milestones: 'Milestones',
        risks: 'Risks',
        stack: 'Tech stack',
        estimate: 'Estimate',
      }[kind] ?? kind
    const before = valueLines(change.before)
    const after = valueLines(change.after)
    return (
      <article className="mt-4 rounded-panel border border-border bg-bg-subtle p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Draft from brief</h3>
          <span className="text-caption text-text-muted">{label} · Pending</span>
        </div>
        <div className="grid gap-3 text-ui sm:grid-cols-2">
          <div>
            <p className="mb-1 text-caption text-text-muted">Current</p>
            {before.length ? (
              before.map((line) => (
                <p key={`before-${line}`} className="text-danger">
                  − {line}
                </p>
              ))
            ) : (
              <p className="text-text-muted">No content</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-caption text-text-muted">Proposed</p>
            {after.length ? (
              after.map((line) => (
                <p key={`after-${line}`} className="text-success">
                  + {line}
                </p>
              ))
            ) : (
              <p className="text-text-muted">No content</p>
            )}
          </div>
        </div>
        {editable && (
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void action.run(() => rejectChange(change.id))}
            >
              Reject
            </Button>
            <Button size="sm" onClick={() => void action.run(() => acceptChange(change.id))}>
              Accept
            </Button>
          </div>
        )}
      </article>
    )
  }
  const drawSection = (kind: Kind) => {
    const item = section(kind)
    const lines = Array.isArray(item.content) ? (item.content as string[]) : []
    const estimate =
      item.content && typeof item.content === 'object' && !Array.isArray(item.content)
        ? (item.content as { value?: unknown; note?: unknown })
        : null
    return (
      <section
        id={kind}
        key={kind}
        className="scroll-mt-24 border-b border-border py-6 last:border-0"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">
            {names[kind]}{' '}
            <span className="ml-1 font-normal text-caption text-text-muted">
              {kind === 'estimate' ? '' : lines.length || ''}
            </span>
          </h2>
          {editable && editing !== kind && (
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Edit ${names[kind]}`}
              onClick={() => editSection(kind)}
            />
          )}
        </div>
        {editing === kind ? (
          <div className="space-y-2">
            <Textarea
              aria-label={names[kind]}
              rows={kind === 'estimate' ? 3 : 5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                kind === 'estimate' ? 'Add an estimate and notes' : 'Add one item per line'
              }
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void action.run(async () => {
                    await mutation.mutateAsync({
                      kind,
                      content: fromText(draft, kind),
                      version: item.version,
                    })
                  })
                }
              >
                Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : kind === 'estimate' ? (
          estimate?.value ? (
            <div className="space-y-1">
              <p className="text-title font-semibold">{String(estimate.value)}</p>
              {typeof estimate.note === 'string' && (
                <p className="whitespace-pre-wrap text-ui text-text-muted">{estimate.note}</p>
              )}
            </div>
          ) : (
            <p className="text-ui text-text-muted">No estimate yet</p>
          )
        ) : kind === 'stack' && lines.length ? (
          <div className="flex flex-wrap gap-2">
            {lines.map((line) => (
              <span
                key={`stack-${line}`}
                className="rounded-control border border-border px-2 py-1 text-caption"
              >
                {line}
              </span>
            ))}
          </div>
        ) : lines.length ? (
          <div className="divide-y divide-border">
            {lines.map((line, i) => (
              <div key={`${kind}-${line}`} className="flex gap-4 py-3 text-ui">
                <span className="w-8 shrink-0 text-caption text-text-muted">
                  {kind === 'requirements' ? `R${i + 1}` : kind === 'stories' ? `S${i + 1}` : ''}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ui text-text-muted">Nothing added yet</p>
        )}
        {drawChange(kind)}
      </section>
    )
  }
  return (
    <WorkspaceShell workspace={workspace} me={me} active="projects">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-3 text-ui md:px-8">
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
            className="min-w-0 truncate font-medium"
          >
            {project.name}
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
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
                    await call(api.projects[':id'].star.$delete({ param: { id: project.id } }))
                  else await call(api.projects[':id'].star.$put({ param: { id: project.id } }))
                  await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
                })
              }
            />
            {canManageDrift ? (
              <Menu
                label="Plan actions"
                iconOnly
                items={[
                  {
                    label: driftAction.busy ? 'Updating drift…' : 'Check now',
                    onSelect: () => {
                      if (!driftAction.busy)
                        void driftAction.run(() => updateDrift({ action: 'check' }))
                    },
                  },
                ]}
              />
            ) : (
              <Button variant="ghost" aria-label="Project actions unavailable" disabled>
                <MoreHorizontal />
              </Button>
            )}
          </div>
        </div>
        <div className="border-b border-border px-4 pt-4 md:px-8">
          <h1 className="text-display font-semibold max-md:break-words">{project.name}</h1>
          <div className="flex h-10 items-center gap-6 text-ui">
            <span className="flex items-center gap-2">
              <StatusGlyph status={project.status} />
              {project.status.replace('-', ' ')}
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
              <CalendarDays className="size-4" />
              {project.targetDate ? `Due ${dateLabel(project.targetDate)}` : 'No target date'}
            </span>
            <span className="text-text-muted">
              {project.taskProgress.done}/{project.taskProgress.total} tasks
            </span>
          </div>
        </div>
        <div className="border-b border-border px-4 pt-1 md:px-8">
          <Tabs
            value="plan"
            onChange={(tab) => {
              if (tab === 'activity')
                void navigate({
                  to: '/$ws/projects/$projectId/activity',
                  params: { ws: workspace.slug, projectId },
                })
              if (tab === 'diagrams')
                void navigate({
                  to: '/$ws/projects/$projectId/diagrams',
                  params: { ws: workspace.slug, projectId },
                })
              if (tab === 'brief')
                void navigate({
                  to: '/$ws/projects/$projectId',
                  params: { ws: workspace.slug, projectId },
                })
              if (tab === 'tasks')
                void navigate({
                  to: '/$ws/projects/$projectId/tasks',
                  params: { ws: workspace.slug, projectId },
                  search: { view: 'list' },
                })
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-caption text-text-muted md:px-8">
          <span>
            {plan.lastChanged
              ? `Last changed ${relativeTime(plan.lastChanged.at)}${plan.lastChanged.by ? ` by ${plan.lastChanged.by}` : ''}`
              : 'No plan changes yet'}
          </span>
          {editable && !activeDraftId && (
            <Button size="sm" onClick={() => void action.run(startDraft)}>
              Draft plan from brief
            </Button>
          )}
        </div>
        {activeDraftId && draftQuery.data && (
          <section
            aria-label="Plan draft"
            className="border-b border-border bg-bg-subtle px-4 py-4 md:px-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {draftQuery.data.draft.status === 'ready'
                    ? 'Draft from the brief is ready for review'
                    : draftQuery.data.draft.status === 'failed'
                      ? 'Draft could not be created'
                      : 'Drafting plan from the brief…'}
                </h2>
                {draftQuery.data.draft.status === 'ready' && (
                  <p className="text-caption text-text-muted">
                    {
                      draftQuery.data.draft.changes.filter((item) => item.status !== 'pending')
                        .length
                    }{' '}
                    of 6 sections reviewed. Nothing changes until you accept a section.
                  </p>
                )}
                {draftQuery.data.draft.status === 'failed' && (
                  <p className="mt-1 text-ui text-danger">
                    {draftQuery.data.draft.error ?? 'The plan could not be drafted. Try again.'}
                  </p>
                )}
              </div>
              {editable &&
                (draftQuery.data.draft.status === 'ready' ||
                  draftQuery.data.draft.status === 'failed') && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => void action.run(discardDraft)}>
                      Discard draft
                    </Button>
                    {draftQuery.data.draft.status === 'ready' && (
                      <Button onClick={() => void action.run(acceptRemaining)}>
                        Accept remaining
                      </Button>
                    )}
                  </div>
                )}
            </div>
          </section>
        )}
        <div className="grid min-h-[calc(100vh-220px)] min-w-0 gap-8 px-4 lg:grid-cols-[minmax(0,760px)_180px] lg:justify-between md:px-8">
          <main className="min-w-0">
            {driftReport && (
              <ProjectDriftCard
                key={driftReport.id}
                report={driftReport}
                canManage={canManageDrift}
                linearConnected={driftQuery.data?.linearConnected ?? false}
                note={driftNote}
                busy={driftAction.busy}
                onAction={(input) => void driftAction.run(() => updateDrift(input))}
              />
            )}
            {driftUnavailable && (
              <div className="mt-6 flex flex-wrap items-center gap-3 text-ui">
                <p className="text-text-muted">Drift could not be loaded.</p>
                <Button size="sm" onClick={() => void driftQuery.refetch()}>
                  Try again
                </Button>
              </div>
            )}
            <ActionError error={driftAction.error} />
            {drawSection('requirements')}
            {drawSection('stories')}
            <section id="milestones" className="scroll-mt-24 border-b border-border py-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  Milestones{' '}
                  <span className="ml-1 font-normal text-caption text-text-muted">
                    {plan.milestones.length || ''}
                  </span>
                </h2>
              </div>
              {plan.milestones.length ? (
                <div className="divide-y divide-border">
                  {plan.milestones.map((milestone) => (
                    <div key={milestone.id} className="group flex items-center gap-4 py-3 text-ui">
                      <span className="w-8 text-caption text-text-muted">{milestone.code}</span>
                      {editable && editingMilestone === milestone.id ? (
                        <Input
                          aria-label={`Edit milestone title ${milestone.title}`}
                          className="min-w-0 flex-1"
                          value={milestoneTitleDraft}
                          onChange={(event) => setMilestoneTitleDraft(event.target.value)}
                        />
                      ) : (
                        <span className="min-w-0 flex-1">{milestone.title}</span>
                      )}
                      {editable && editingMilestone === milestone.id ? (
                        <Select
                          aria-label={`${milestone.title} status`}
                          className="w-28"
                          value={milestone.status}
                          onChange={(event) =>
                            void action.run(async () => {
                              await call(
                                api.milestones[':id'].$patch({
                                  param: { id: milestone.id },
                                  json: {
                                    status: event.target.value as
                                      | 'planning'
                                      | 'in_progress'
                                      | 'completed',
                                  },
                                }),
                              )
                              await refresh()
                            })
                          }
                        >
                          <option value="planning">Planning</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                        </Select>
                      ) : (
                        <span className="flex items-center gap-2 text-text-muted">
                          <StatusGlyph
                            status={
                              milestone.status === 'completed'
                                ? 'completed'
                                : milestone.status === 'in_progress'
                                  ? 'in-progress'
                                  : 'planning'
                            }
                          />
                          {milestone.status.replace('_', ' ')}
                        </span>
                      )}
                      {editable && editingMilestone === milestone.id ? (
                        <Input
                          aria-label={`${milestone.title} due date`}
                          type="date"
                          className="w-32"
                          value={milestone.dueDate ?? ''}
                          onChange={(event) =>
                            void action.run(async () => {
                              await call(
                                api.milestones[':id'].$patch({
                                  param: { id: milestone.id },
                                  json: { dueDate: event.target.value || null },
                                }),
                              )
                              await refresh()
                            })
                          }
                        />
                      ) : (
                        <span className="w-16 text-right font-mono text-caption text-text-muted">
                          {dateLabel(milestone.dueDate)}
                        </span>
                      )}
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          aria-label={`Edit ${milestone.title}`}
                          onClick={() => {
                            setMilestoneTitleDraft(milestone.title)
                            setEditingMilestone(
                              editingMilestone === milestone.id ? null : milestone.id,
                            )
                          }}
                        />
                      )}
                      {editable && editingMilestone === milestone.id && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              void action.run(async () => {
                                await call(
                                  api.milestones[':id'].$patch({
                                    param: { id: milestone.id },
                                    json: { title: milestoneTitleDraft },
                                  }),
                                )
                                setEditingMilestone(null)
                                await refresh()
                              })
                            }
                          >
                            Save title
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingMilestone(null)}
                          >
                            Done
                          </Button>
                        </>
                      )}
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          aria-label={`Delete ${milestone.title}`}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() =>
                            void action.run(async () => {
                              await call(
                                api.milestones[':id'].$delete({ param: { id: milestone.id } }),
                              )
                              await refresh()
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-ui text-text-muted">No milestones yet</p>
              )}
              {editable && !addingMilestone && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="ghost"
                  icon={Plus}
                  onClick={() => setAddingMilestone(true)}
                >
                  Add milestone
                </Button>
              )}
              {editable && addingMilestone && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label
                    htmlFor="new-milestone-title"
                    className="min-w-48 flex-1 text-caption text-text-muted"
                  >
                    Milestone title
                    <Input
                      aria-label="Milestone title"
                      id="new-milestone-title"
                      value={milestoneTitle}
                      onChange={(e) => setMilestoneTitle(e.target.value)}
                      placeholder="Add a milestone"
                    />
                  </label>
                  <label htmlFor="new-milestone-date" className="text-caption text-text-muted">
                    Due date
                    <Input
                      type="date"
                      aria-label="Milestone due date"
                      id="new-milestone-date"
                      value={milestoneDate}
                      onChange={(e) => setMilestoneDate(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    icon={Plus}
                    disabled={!milestoneTitle.trim()}
                    onClick={() => void action.run(addMilestone)}
                  >
                    Create milestone
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingMilestone(false)}>
                    Cancel
                  </Button>
                </div>
              )}
              {drawChange('milestones')}
            </section>
            <section id="risks" className="scroll-mt-24 border-b border-border py-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  Risks{' '}
                  <span className="ml-1 font-normal text-caption text-text-muted">
                    {plan.risks.length || ''}
                  </span>
                </h2>
              </div>
              {plan.risks.length ? (
                <div className="divide-y divide-border">
                  {plan.risks.map((risk) => (
                    <div key={risk.id} className="group flex items-center gap-3 py-3 text-ui">
                      <span className="w-8 text-caption text-text-muted">{risk.code}</span>
                      {editable && editingRisk === risk.id ? (
                        <Input
                          aria-label={`Edit risk title ${risk.title}`}
                          className="min-w-0 flex-1"
                          value={riskTitleDraft}
                          onChange={(event) => setRiskTitleDraft(event.target.value)}
                        />
                      ) : (
                        <span className="min-w-0 flex-1">{risk.title}</span>
                      )}
                      {editable && editingRisk === risk.id ? (
                        <Select
                          aria-label={`${risk.title} severity`}
                          className="w-28"
                          value={risk.severity}
                          onChange={(event) =>
                            void action.run(async () => {
                              await call(
                                api.risks[':id'].$patch({
                                  param: { id: risk.id },
                                  json: {
                                    severity: event.target.value as
                                      | 'low'
                                      | 'medium'
                                      | 'high'
                                      | 'critical',
                                  },
                                }),
                              )
                              await refresh()
                            })
                          }
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </Select>
                      ) : (
                        <span className="text-caption text-text-muted">{risk.severity}</span>
                      )}
                      {editable && editingRisk === risk.id ? (
                        <Select
                          aria-label={`${risk.title} owner`}
                          className="w-36"
                          value={risk.ownerId ?? ''}
                          onChange={(event) =>
                            void action.run(async () => {
                              await call(
                                api.risks[':id'].$patch({
                                  param: { id: risk.id },
                                  json: { ownerId: event.target.value || null },
                                }),
                              )
                              await refresh()
                            })
                          }
                        >
                          <option value="">Unassigned</option>
                          {membersQuery.data?.members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-caption text-text-muted">
                          {membersQuery.data?.members.find((member) => member.id === risk.ownerId)
                            ?.name ?? 'Unassigned'}
                        </span>
                      )}
                      {editable && editingRisk === risk.id ? (
                        <Input
                          aria-label={`${risk.title} decide by`}
                          type="date"
                          className="w-32"
                          value={risk.decideBy ?? ''}
                          onChange={(event) =>
                            void action.run(async () => {
                              await call(
                                api.risks[':id'].$patch({
                                  param: { id: risk.id },
                                  json: { decideBy: event.target.value || null },
                                }),
                              )
                              await refresh()
                            })
                          }
                        />
                      ) : (
                        <span className="w-16 text-right font-mono text-caption text-text-muted">
                          {dateLabel(risk.decideBy)}
                        </span>
                      )}
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          aria-label={`Edit ${risk.title}`}
                          onClick={() => {
                            setRiskTitleDraft(risk.title)
                            setEditingRisk(editingRisk === risk.id ? null : risk.id)
                          }}
                        />
                      )}
                      {editable && editingRisk === risk.id && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              void action.run(async () => {
                                await call(
                                  api.risks[':id'].$patch({
                                    param: { id: risk.id },
                                    json: { title: riskTitleDraft },
                                  }),
                                )
                                setEditingRisk(null)
                                await refresh()
                              })
                            }
                          >
                            Save title
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingRisk(null)}>
                            Done
                          </Button>
                        </>
                      )}
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          aria-label={`Delete ${risk.title}`}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() =>
                            void action.run(async () => {
                              await call(api.risks[':id'].$delete({ param: { id: risk.id } }))
                              await refresh()
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-ui text-text-muted">No risks yet</p>
              )}
              {editable && !addingRisk && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="ghost"
                  icon={Plus}
                  onClick={() => setAddingRisk(true)}
                >
                  Add risk
                </Button>
              )}
              {editable && addingRisk && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label
                    htmlFor="new-risk-title"
                    className="min-w-48 flex-1 text-caption text-text-muted"
                  >
                    Risk title
                    <Input
                      aria-label="Risk title"
                      id="new-risk-title"
                      value={riskTitle}
                      onChange={(e) => setRiskTitle(e.target.value)}
                      placeholder="Add a risk"
                    />
                  </label>
                  <label htmlFor="new-risk-severity" className="text-caption text-text-muted">
                    Severity
                    <Select
                      aria-label="Risk severity"
                      id="new-risk-severity"
                      value={riskSeverity}
                      onChange={(e) => setRiskSeverity(e.target.value as typeof riskSeverity)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                  </label>
                  <label htmlFor="new-risk-owner" className="text-caption text-text-muted">
                    Owner
                    <Select
                      aria-label="Risk owner"
                      id="new-risk-owner"
                      value={riskOwner}
                      onChange={(e) => setRiskOwner(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {membersQuery.data?.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label htmlFor="new-risk-date" className="text-caption text-text-muted">
                    Decide by
                    <Input
                      id="new-risk-date"
                      aria-label="Risk decide by"
                      type="date"
                      value={riskDate}
                      onChange={(event) => setRiskDate(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    icon={Plus}
                    disabled={!riskTitle.trim()}
                    onClick={() => void action.run(addRisk)}
                  >
                    Create risk
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingRisk(false)}>
                    Cancel
                  </Button>
                </div>
              )}
              {drawChange('risks')}
            </section>
            {drawSection('stack')}
            {drawSection('estimate')}
            <ProjectWeeklyStatus key={projectId} projectId={projectId} editable={editable} />
          </main>
          <aside className="hidden pt-6 lg:block">
            <p className="mb-2 text-caption font-medium text-text-muted">On this page</p>
            <nav aria-label="On this page" className="sticky top-5 border-l border-border text-ui">
              {[
                { id: 'requirements', label: 'Requirements' },
                { id: 'stories', label: 'User stories' },
                { id: 'milestones', label: 'Milestones' },
                { id: 'risks', label: 'Risks' },
                { id: 'stack', label: 'Tech stack' },
                { id: 'estimate', label: 'Estimate' },
                { id: 'weekly-status', label: 'Weekly status' },
              ].map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="block border-l-2 border-transparent py-1 pl-3 text-text-muted capitalize hover:border-accent hover:text-text"
                >
                  <span className="flex items-center justify-between gap-2">
                    {item.label}
                    {activeDraftId &&
                      draftQuery.data?.draft.status === 'ready' &&
                      (() => {
                        const change = draftQuery.data.draft.changes.find(
                          (entry) => entry.kind === item.id,
                        )
                        return change ? <span>{change.status}</span> : null
                      })()}
                  </span>
                </a>
              ))}
            </nav>
          </aside>
        </div>
        {decisionsQuery.data?.decisions.length ? (
          <section className="border-t border-border px-4 py-6 md:px-8">
            <h2 className="mb-3 font-semibold">Decision log</h2>
            <div className="max-w-[760px] divide-y divide-border">
              {decisionsQuery.data.decisions.map((decision) => (
                <div
                  key={decision.id}
                  className="flex items-center justify-between gap-3 py-3 text-ui"
                >
                  <div className="min-w-0 break-words">
                    <p>
                      {decision.actorName ?? 'Deleted user'} {decision.outcome} {decision.kind}
                    </p>
                    {decision.reason && <p className="text-text-muted">{decision.reason}</p>}
                  </div>
                  {editable && decision.outcome === 'accepted' && !decision.reversesDecisionId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void action.run(() => undoDecision(decision.id))}
                    >
                      Undo
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <ToastRegion
          message={toast?.message ?? null}
          action={toast?.decisionId ? 'Undo' : undefined}
          onAction={() => {
            const decisionId = toast?.decisionId
            if (decisionId) void action.run(() => undoDecision(decisionId))
          }}
        />
        <ActionError error={action.error} />
      </div>
    </WorkspaceShell>
  )
}

export const projectPlanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/projects/$projectId/plan',
  validateSearch: () => ({}),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: ProjectPlan,
})
