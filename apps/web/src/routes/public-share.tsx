import { useQuery } from '@tanstack/react-query'
import { createRoute } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { lazy, type ReactNode, Suspense } from 'react'
import { api, call, RequestError } from '../api'
import { Brand, LogoMark } from '../ui/brand'
import { Icon } from '../ui/icon'
import { StatusGlyph, StatusLabel } from '../ui/status'
import { rootRoute } from './root'

const DiagramCanvas = lazy(() =>
  import('../ui/diagram-canvas').then((module) => ({ default: module.DiagramCanvas })),
)

const dateLabel = (value: string, year = false) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value))

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 md:mt-10">
      <h2 className="mb-3 border-b border-border pb-1.5 text-body font-semibold md:text-dialog">
        {title}
      </h2>
      {children}
    </section>
  )
}

function PublicShare() {
  const { token } = publicShareRoute.useParams()
  const query = useQuery({
    queryKey: ['public-share', token],
    queryFn: () =>
      call(
        api.share[':token'].$get(
          { param: { token } },
          { init: { credentials: 'omit', referrerPolicy: 'no-referrer' } },
        ),
      ),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  return (
    <div className="min-h-screen bg-bg text-text">
      <meta name="robots" content="noindex" />
      <meta name="referrer" content="no-referrer" />
      <title>{data ? `${data.project.name} | planfrojex` : 'Shared project | planfrojex'}</title>
      {data ? (
        <>
          <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4 md:gap-6 md:px-10">
            <div className="flex items-center gap-4">
              <Brand />
              <span className="hidden border-l border-border pl-4 text-ui text-text-muted md:block">
                {data.workspaceName}
              </span>
            </div>
            <p className="flex items-center gap-2 text-caption text-text-muted">
              <Icon icon={Eye} />
              <span className="md:hidden">Read-only</span>
              <span className="hidden md:inline">Read-only link shared by {data.sharedBy}</span>
            </p>
          </header>
          <main className="mx-auto max-w-[840px] px-4 pb-20 pt-5 md:px-10 md:pt-12">
            <h1 className="text-display font-semibold max-md:break-words md:text-[28px] md:leading-10">
              {data.project.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-caption text-text-muted md:gap-x-5 md:text-ui">
              <span className="w-full md:w-auto">
                <StatusLabel status={data.project.status} />
              </span>
              {data.project.leadName && <span>Led by {data.project.leadName}</span>}
              {data.project.targetDate && (
                <span>Target {dateLabel(data.project.targetDate, true)}</span>
              )}
              <span className="hidden font-mono text-caption md:inline">
                Updated {dateLabel(data.project.updatedAt)}
              </span>
            </div>
            {data.brief && (
              <Section title="Brief">
                <div className="space-y-3 text-body">
                  <p className="whitespace-pre-wrap">{data.brief.problem}</p>
                  {data.brief.goals?.map((goal) => (
                    <p key={goal}>Goal: {goal}</p>
                  ))}
                  {data.brief.constraints && (
                    <p className="whitespace-pre-wrap">
                      <span className="font-medium">Constraints: </span>
                      {data.brief.constraints}
                    </p>
                  )}
                  {data.brief.outOfScope && (
                    <p className="whitespace-pre-wrap">
                      <span className="font-medium">Out of scope: </span>
                      {data.brief.outOfScope}
                    </p>
                  )}
                </div>
              </Section>
            )}
            {data.plan && (
              <Section title="Milestones">
                {data.plan.milestones.length ? (
                  <ul className="-mt-2">
                    {data.plan.milestones.map((milestone) => (
                      <li
                        key={milestone.code}
                        className="flex min-h-11.5 items-center gap-2 md:gap-5"
                      >
                        <span className="w-6 shrink-0 font-mono text-caption text-text-muted">
                          {milestone.code}
                        </span>
                        <span className="flex-1 text-body">{milestone.title}</span>
                        <span className="hidden md:inline">
                          <StatusLabel
                            status={
                              milestone.status === 'in_progress' ? 'in-progress' : milestone.status
                            }
                          />
                        </span>
                        <span className="md:hidden">
                          <StatusGlyph
                            status={
                              milestone.status === 'in_progress' ? 'in-progress' : milestone.status
                            }
                          />
                        </span>
                        <span className="w-12 text-right font-mono text-caption text-text-muted">
                          {milestone.dueDate ? dateLabel(milestone.dueDate) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-text-muted">No milestones yet.</p>
                )}
                {data.plan.estimate && (
                  <div className="mt-3 text-ui">
                    <p>
                      <span className="mr-2 text-text-muted">Estimate</span>
                      {data.plan.estimate.value}
                    </p>
                    {data.plan.estimate.note && (
                      <p className="mt-1 whitespace-pre-wrap text-text-muted">
                        {data.plan.estimate.note}
                      </p>
                    )}
                  </div>
                )}
              </Section>
            )}
            {data.diagrams?.map((diagram, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the public snapshot never reorders; diagram names may repeat
              <Section key={`${diagram.name}:${index}`} title={diagram.name}>
                <div className="h-[180px] w-full overflow-hidden rounded-panel border border-border md:h-[530px]">
                  <Suspense
                    fallback={
                      <p role="status" className="p-6 text-text-muted">
                        Loading diagram canvas…
                      </p>
                    }
                  >
                    <DiagramCanvas
                      scene={{
                        ...diagram.scene,
                        nodes: diagram.scene.nodes.map((node, position) => ({
                          ...node,
                          id: `public-node-${position}`,
                        })),
                        edges: diagram.scene.edges.map((edge, position) => ({
                          ...edge,
                          id: `public-edge-${position}`,
                          source: `public-node-${edge.source}`,
                          target: `public-node-${edge.target}`,
                        })),
                      }}
                      readOnly
                      showControls={false}
                      compact
                    />
                  </Suspense>
                </div>
              </Section>
            ))}
            {data.tasks && (
              <Section title="Tasks">
                {data.tasks.length ? (
                  <ul>
                    {data.tasks.map((task) => (
                      <li key={task.key} className="flex min-h-11.5 items-center gap-2 md:gap-5">
                        <span className="font-mono text-caption text-text-muted">{task.key}</span>
                        <span className="flex-1 text-body">{task.title}</span>
                        <span className="inline-flex items-center gap-1.5 text-ui">
                          <StatusGlyph
                            status={
                              task.status === 'done'
                                ? 'completed'
                                : task.status === 'in_progress'
                                  ? 'in-progress'
                                  : 'planning'
                            }
                          />
                          {task.status === 'done'
                            ? 'Done'
                            : task.status === 'todo'
                              ? 'To do'
                              : 'In progress'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-text-muted">No tasks yet.</p>
                )}
              </Section>
            )}
            <footer className="mt-10 flex items-center gap-2 border-t border-border pt-6 text-caption text-text-muted">
              <LogoMark size={14} />
              Made with planfrojex
            </footer>
          </main>
        </>
      ) : (
        <main className="mx-auto max-w-[840px] px-4 py-20 md:px-10">
          {query.isPending ? (
            <p role="status">Loading shared project…</p>
          ) : (
            <>
              <h1 className="text-title font-semibold">
                {query.error instanceof RequestError && query.error.status === 404
                  ? 'This link doesn’t work anymore'
                  : 'Please try again shortly'}
              </h1>
              {!(query.error instanceof RequestError && query.error.status === 404) && (
                <p className="mt-3 text-body text-text-muted">
                  We couldn’t load this shared project. Please refresh the page in a moment.
                </p>
              )}
            </>
          )}
        </main>
      )}
    </div>
  )
}

export const publicShareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/share/$token',
  component: PublicShare,
})
