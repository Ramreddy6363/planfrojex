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
    <section className="mt-10">
      <h2 className="mb-3 border-b border-border pb-1.5 text-dialog font-semibold">{title}</h2>
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
          <header className="flex h-14 items-center justify-between gap-6 border-b border-border px-10">
            <div className="flex items-center gap-4">
              <Brand />
              <span className="border-l border-border pl-4 text-ui text-text-muted">
                {data.workspaceName}
              </span>
            </div>
            <p className="flex items-center gap-2 text-caption text-text-muted">
              <Icon icon={Eye} />
              Read-only link shared by {data.sharedBy}
            </p>
          </header>
          <main className="mx-auto max-w-[840px] px-10 pb-20 pt-12">
            <h1 className="text-[28px] leading-10 font-semibold">{data.project.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-ui text-text-muted">
              <StatusLabel status={data.project.status} />
              {data.project.leadName && <span>Led by {data.project.leadName}</span>}
              {data.project.targetDate && (
                <span>Target {dateLabel(data.project.targetDate, true)}</span>
              )}
              <span className="font-mono text-caption">
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
                      <li key={milestone.code} className="flex min-h-11.5 items-center gap-5">
                        <span className="w-6 shrink-0 font-mono text-caption text-text-muted">
                          {milestone.code}
                        </span>
                        <span className="flex-1 text-body">{milestone.title}</span>
                        <StatusLabel
                          status={
                            milestone.status === 'in_progress' ? 'in-progress' : milestone.status
                          }
                        />
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
                <div className="h-[530px] overflow-hidden rounded-panel border border-border">
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
                      <li key={task.key} className="flex min-h-11.5 items-center gap-5">
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
        <main className="mx-auto max-w-[840px] px-10 py-20">
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
