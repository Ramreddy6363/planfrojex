import { useQuery } from '@tanstack/react-query'
import { createRoute } from '@tanstack/react-router'
import { Check, CircleCheck, Eye, MessageSquare } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useState } from 'react'
import { api, call, RequestError } from '../api'
import { Avatar } from '../ui/avatar'
import { Brand, LogoMark } from '../ui/brand'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'
import { Icon } from '../ui/icon'
import { Input } from '../ui/input'
import { Progress } from '../ui/progress'
import { Select } from '../ui/select'
import { StatusGlyph, StatusLabel } from '../ui/status'
import { Textarea } from '../ui/textarea'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
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

function Section({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="mt-6 md:mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5">
        <h2 className="min-w-0 text-body font-semibold [overflow-wrap:anywhere] md:text-dialog">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

function PublicShare() {
  const { token } = publicShareRoute.useParams()
  const isReview = new URLSearchParams(window.location.search).get('review') === '1'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [requestSection, setRequestSection] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [reviewUnavailable, setReviewUnavailable] = useState(false)
  const action = useAction()
  const shareQuery = useQuery({
    queryKey: ['public-share', token],
    enabled: !isReview,
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
  const reviewQuery = useQuery({
    queryKey: ['public-review', token],
    enabled: isReview,
    queryFn: () => call(api.public.share[':token'].review.$get({ param: { token } })),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
  const query = isReview ? reviewQuery : shareQuery
  const data = reviewUnavailable ? undefined : query.data
  const review = isReview ? reviewQuery.data?.review : undefined
  async function verify() {
    try {
      await call(
        api.public.share[':token']['verify-email'].$post({
          param: { token },
          json: sent ? { email, code } : { email },
        }),
      )
    } catch (error) {
      if (error instanceof RequestError) {
        if (error.status === 404) {
          setReviewUnavailable(true)
          throw new UserError('This review link has expired or was cancelled.')
        }
        if (error.status === 400)
          throw new UserError('That code is incorrect or expired. Send a new code.')
        if (error.status === 429) throw new UserError('Too many attempts. Please try again later.')
      }
      throw error
    }
    if (sent) await query.refetch()
    else setSent(true)
  }
  async function decide(section: string, outcome: 'approved' | 'changes_requested', text?: string) {
    const revision =
      section === 'all'
        ? review?.revision
        : review?.sections.find((item) => item.key === section)?.revision
    if (!revision) throw new UserError('Refresh the review before sending your decision.')
    try {
      await call(
        api.public.share[':token'].approvals.$post({
          param: { token },
          json: {
            section,
            outcome,
            revision,
            ...(text ? { comment: text } : {}),
          },
        }),
      )
    } catch (error) {
      if (error instanceof RequestError) {
        if (error.status === 409) {
          const latest = await query.refetch()
          if (latest.error instanceof RequestError && latest.error.status === 404) {
            setReviewUnavailable(true)
            throw new UserError('This review link has expired or was cancelled.')
          }
          throw new UserError(
            'The plan changed while you were reviewing it. The latest version is shown.',
          )
        }
        if (error.status === 404) {
          setReviewUnavailable(true)
          throw new UserError('This review link has expired or was cancelled.')
        }
        if (error.status === 429) throw new UserError('Too many attempts. Please try again later.')
      }
      throw error
    }
    setRequestSection(null)
    setComment('')
    await query.refetch()
  }
  function sectionActions(key: string) {
    const section = review?.sections.find((item) => item.key === key)
    if (!section) return null
    return (
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <span
          className={
            section.outcome === 'approved'
              ? 'text-success'
              : section.outcome === 'changes_requested'
                ? 'text-accent'
                : 'text-warning'
          }
        >
          {section.outcome === 'approved' && <Icon icon={CircleCheck} className="mr-1 inline" />}
          {section.outcome === 'changes_requested' && (
            <Icon icon={MessageSquare} className="mr-1 inline" />
          )}
          {section.outcome === 'approved'
            ? `Approved by you${section.updatedAt ? `, ${dateLabel(section.updatedAt)}` : ''}`
            : section.outcome === 'changes_requested'
              ? 'You asked for changes'
              : 'Waiting for your review'}
        </span>
        {section.outcome !== 'approved' && (
          <>
            <Button
              icon={MessageSquare}
              variant="ghost"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => setRequestSection(key)}
            >
              Comment
            </Button>
            <Button
              size="sm"
              className="max-md:min-h-11"
              aria-label={`Approve ${section.label}`}
              disabled={action.busy}
              onClick={() => void action.run(() => decide(key, 'approved'))}
            >
              Approve
            </Button>
          </>
        )}
      </div>
    )
  }
  function sectionComment(key: string) {
    const section = review?.sections.find((item) => item.key === key)
    if (!section?.comment || section.outcome !== 'changes_requested') return null
    return (
      <div className="mt-3 min-w-0 rounded-panel border border-border bg-bg-subtle p-3 text-ui">
        <p className="text-caption text-text-muted [overflow-wrap:anywhere]">
          {review?.reviewerEmail}
        </p>
        <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{section.comment}</p>
      </div>
    )
  }
  const showVerification =
    isReview &&
    !reviewUnavailable &&
    query.error instanceof RequestError &&
    query.error.status === 404
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
          {review && (
            <div className="flex flex-wrap items-center justify-between gap-4 bg-accent-subtle px-4 py-4 md:px-10">
              <div className="flex min-w-0 items-start gap-4">
                <Avatar id={review.requesterName} name={review.requesterName} className="size-7" />
                <div className="min-w-0">
                  <p className="min-w-0 text-ui font-semibold [overflow-wrap:anywhere]">
                    {review.requesterName} asked you to review this plan
                    {review.dueDate ? ` by ${dateLabel(review.dueDate)}` : ''}
                  </p>
                  <p className="[overflow-wrap:anywhere] break-all text-caption text-text-muted">
                    Reviewing as {review.reviewerEmail}. You can approve sections or the whole plan,
                    or ask for changes.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  icon={MessageSquare}
                  className="max-md:min-h-11"
                  onClick={() => setRequestSection('all')}
                >
                  Request changes
                </Button>
                <Button
                  icon={Check}
                  className="max-md:min-h-11"
                  variant="primary"
                  disabled={action.busy}
                  onClick={() => void action.run(() => decide('all', 'approved'))}
                >
                  Approve plan
                </Button>
              </div>
            </div>
          )}
          <main className="mx-auto max-w-[840px] px-4 pb-20 pt-5 md:px-10 md:pt-12">
            <h1 className="text-display font-semibold [overflow-wrap:anywhere] md:text-[28px] md:leading-10">
              {data.project.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-caption text-text-muted md:gap-x-5 md:text-ui">
              <span className="w-full md:w-auto">
                <StatusLabel status={data.project.status} />
              </span>
              {data.project.leadName && (
                <span className="[overflow-wrap:anywhere]">Led by {data.project.leadName}</span>
              )}
              {data.project.targetDate && (
                <span>Target {dateLabel(data.project.targetDate, true)}</span>
              )}
              <span className="hidden font-mono text-caption md:inline">
                Updated {dateLabel(data.project.updatedAt)}
              </span>
            </div>
            {review && (
              <div className="mt-8 flex flex-wrap items-center gap-4 rounded-panel border border-border px-4 py-3 text-caption">
                <span className="font-semibold text-text">Your review</span>
                <Progress
                  value={
                    review.totalSections ? (review.approvedCount / review.totalSections) * 100 : 0
                  }
                  label="Review progress"
                  className="w-40 [&>div]:bg-success"
                />
                <span className="font-mono">
                  {review.approvedCount} of {review.totalSections} sections approved
                </span>
              </div>
            )}
            {review?.planChangeRequest && (
              <div className="mt-3 rounded-panel border border-border bg-bg-subtle p-3 text-ui">
                <p className="text-caption text-text-muted">Your request for changes</p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {review.planChangeRequest.comment}
                </p>
              </div>
            )}
            <ActionError error={action.error} />
            {data.brief && (
              <Section title="Brief" actions={sectionActions('brief')}>
                <div className="min-w-0 space-y-3 text-body [overflow-wrap:anywhere]">
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
                {sectionComment('brief')}
              </Section>
            )}
            {data.plan && (
              <Section title="Milestones" actions={sectionActions('milestones')}>
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
                        <span className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">
                          {milestone.title}
                        </span>
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
                      <p className="mt-1 whitespace-pre-wrap text-text-muted [overflow-wrap:anywhere]">
                        {data.plan.estimate.note}
                      </p>
                    )}
                  </div>
                )}
                {sectionComment('milestones')}
              </Section>
            )}
            {data.diagrams?.map((diagram, index) => (
              <Section
                // biome-ignore lint/suspicious/noArrayIndexKey: the public snapshot never reorders; diagram names may repeat
                key={`${diagram.name}:${index}`}
                title={diagram.name}
                actions={sectionActions(
                  review?.sections.filter((section) => section.key.startsWith('diagram:'))[index]
                    ?.key ?? '',
                )}
              >
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
                {sectionComment(
                  review?.sections.filter((section) => section.key.startsWith('diagram:'))[index]
                    ?.key ?? '',
                )}
              </Section>
            ))}
            {data.tasks && (
              <Section title="Tasks">
                {data.tasks.length ? (
                  <ul>
                    {data.tasks.map((task) => (
                      <li key={task.key} className="flex min-h-11.5 items-center gap-2 md:gap-5">
                        <span className="font-mono text-caption text-text-muted">{task.key}</span>
                        <span className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">
                          {task.title}
                        </span>
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
          ) : showVerification ? (
            <form className="mx-auto max-w-110" onSubmit={action.submit(verify)}>
              <h1 className="text-title font-semibold">Confirm your email</h1>
              <p className="mt-3 text-body text-text-muted">
                Enter the email address this review was sent to. We’ll send you a code.
              </p>
              <label htmlFor="review-email" className="mt-5 block text-ui font-medium">
                Email
              </label>
              <Input
                id="review-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={sent || action.busy}
                className="mt-1 max-md:min-h-11"
              />
              {sent && (
                <>
                  <Button
                    variant="ghost"
                    className="mt-2 min-h-11"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        setSent(false)
                        setCode('')
                      })
                    }
                  >
                    Change email
                  </Button>
                  <label htmlFor="review-code" className="mt-4 block text-ui font-medium">
                    Code
                  </label>
                  <Input
                    id="review-code"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="mt-1 max-md:min-h-11"
                  />
                  <Button
                    variant="ghost"
                    className="mt-2 min-h-11"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await call(
                          api.public.share[':token']['verify-email'].$post({
                            param: { token },
                            json: { email },
                          }),
                        )
                        setCode('')
                      })
                    }
                  >
                    Resend code
                  </Button>
                </>
              )}
              <ActionError error={action.error} />
              <Button
                type="submit"
                variant="primary"
                disabled={action.busy}
                className="mt-4 min-h-11"
              >
                {sent ? 'Verify email' : 'Send code'}
              </Button>
            </form>
          ) : (
            <>
              <h1 className="text-title font-semibold">
                {reviewUnavailable ||
                (query.error instanceof RequestError && query.error.status === 404)
                  ? 'This link doesn’t work anymore'
                  : 'Please try again shortly'}
              </h1>
              {!(
                reviewUnavailable ||
                (query.error instanceof RequestError && query.error.status === 404)
              ) && (
                <p className="mt-3 text-body text-text-muted">
                  We couldn’t load this shared project. Please refresh the page in a moment.
                </p>
              )}
            </>
          )}
        </main>
      )}
      {review && requestSection && (
        <Dialog
          open
          title="Request changes"
          onClose={() => setRequestSection(null)}
          footer={
            <>
              <Button onClick={() => setRequestSection(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!comment.trim() || action.busy}
                onClick={() =>
                  void action.run(() => decide(requestSection, 'changes_requested', comment.trim()))
                }
              >
                Send request
              </Button>
            </>
          }
        >
          <label htmlFor="review-section" className="block text-ui font-medium">
            Section
          </label>
          <Select
            id="review-section"
            className="max-md:min-h-11"
            value={requestSection}
            onChange={(event) => setRequestSection(event.target.value)}
          >
            <option value="all">Whole plan</option>
            {review.sections.map((section) => (
              <option key={section.key} value={section.key}>
                {section.label}
              </option>
            ))}
          </Select>
          <label htmlFor="review-comment" className="mt-4 block text-ui font-medium">
            Comment
          </label>
          <Textarea
            id="review-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="mt-1"
          />
          <ActionError error={action.error} />
        </Dialog>
      )}
    </div>
  )
}

export const publicShareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/share/$token',
  component: PublicShare,
})
