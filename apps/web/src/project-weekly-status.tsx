import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import {
  call,
  projectStatusReportClient,
  type SentStatusReport,
  type WeeklyStatusReport,
} from './api'
import { Brand } from './ui/brand'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { EmptyState } from './ui/empty-state'
import { Icon } from './ui/icon'
import { Progress } from './ui/progress'
import { SkeletonRow } from './ui/skeleton-row'
import { TextLink } from './ui/text-link'

const statuses = {
  on_track: { label: 'On track', icon: CircleCheck, tone: 'text-success' },
  at_risk: { label: 'At risk', icon: TriangleAlert, tone: 'text-warning' },
  off_track: { label: 'Off track', icon: CircleAlert, tone: 'text-danger' },
}

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function ReportStatus({ status }: { status: WeeklyStatusReport['status'] }) {
  const { label, icon, tone } = statuses[status]
  return (
    <span className={`inline-flex items-center gap-2 font-medium ${tone}`}>
      <Icon icon={icon} />
      {label}
    </span>
  )
}

const sectionLabel = 'mb-4 font-mono text-caption uppercase tracking-wide text-text-muted'

function EmailPreview({ report }: { report: WeeklyStatusReport }) {
  const { body, status, subject, week } = report
  return (
    <div className="rounded-panel bg-bg-muted p-3 text-text [overflow-wrap:anywhere] md:p-6">
      <p className="mb-4 text-body font-semibold">{subject}</p>
      <article
        aria-label="Weekly status email"
        className="overflow-hidden rounded-panel border border-border bg-bg"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-7">
          <Brand />
          <p className="font-mono text-caption uppercase text-text-muted">
            Week of {shortDate.format(new Date(week))}
          </p>
        </div>
        <div className="space-y-6 px-4 py-6 md:px-7">
          <h3 className="text-title font-semibold">{body.projectName}</h3>
          <div className="flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-bg-subtle px-3 py-2 text-ui">
            <ReportStatus status={status} />
            {body.statusDetail && <p className="text-text-muted">{body.statusDetail}</p>}
          </div>
          <p className="text-body">{body.summary}</p>
          <section>
            <h4 className={sectionLabel}>Milestones</h4>
            {body.milestones.length ? (
              <ul className="space-y-5">
                {body.milestones.map((milestone) => {
                  const { code, title, dueDate, oldDueDate, total, done } = milestone
                  return (
                    <li key={code}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-ui">
                        <p>
                          <span className="mr-3 font-mono text-caption text-text-muted">
                            {code}
                          </span>
                          {title}
                        </p>
                        <p
                          className={`font-mono text-caption ${oldDueDate ? 'text-warning' : 'text-text-muted'}`}
                        >
                          {dueDate ? shortDate.format(new Date(dueDate)) : 'No due date'}
                          {oldDueDate && (
                            <span className="ml-3">
                              (was {shortDate.format(new Date(oldDueDate))})
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center gap-3 pl-7 md:pr-20 md:pl-10">
                        <Progress
                          label={`${code} ${title}`}
                          value={total ? Math.round((done / total) * 100) : 0}
                          className="min-w-0 flex-1"
                          tone={oldDueDate ? 'warning' : 'accent'}
                        />
                        <span className="min-w-8 shrink-0 font-mono text-caption text-text-muted">
                          {done}/{total}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-ui text-text-muted">No milestones yet.</p>
            )}
          </section>
          <section>
            <h4 className={sectionLabel}>Decisions this week</h4>
            {body.decisions.length ? (
              <ul className="space-y-5 text-ui">
                {body.decisions.map((decision, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: The report snapshot is immutable and captions can repeat.
                  <li key={`${index}:${decision}`} className="flex items-start gap-3">
                    <Icon icon={Check} className="mt-0.5 shrink-0 text-success" />
                    <span>{decision}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui text-text-muted">No decisions recorded this week.</p>
            )}
          </section>
          <section>
            <h4 className={sectionLabel}>Next week</h4>
            <p className="text-ui">{body.nextWeek}</p>
          </section>
          <TextLink
            href={body.planUrl}
            className="inline-flex min-h-10 items-center rounded-control bg-accent px-4 text-ui !font-medium !text-on-accent"
          >
            Open the plan
          </TextLink>
        </div>
        <p className="border-t border-border bg-bg-subtle px-4 py-4 text-caption text-text-muted md:px-7">
          Sent on Mondays to project reviewers and team members who get weekly summaries.{' '}
          <span title="This link is active in the sent email">Unsubscribe</span>
        </p>
      </article>
    </div>
  )
}

export function ProjectWeeklyStatus({
  projectId,
  editable,
}: {
  projectId: string
  editable: boolean
}) {
  const headingId = useId()
  const [selection, setSelection] = useState<'preview' | SentStatusReport | null>(null)
  const reports = useQuery({
    queryKey: ['status-reports', projectId],
    queryFn: () => call(projectStatusReportClient.$get({ param: { id: projectId } })),
  })
  const preview = useMutation({
    mutationFn: () => call(projectStatusReportClient.preview.$post({ param: { id: projectId } })),
  })
  const previewing = selection === 'preview'
  const report = previewing ? preview.data?.report : selection
  const close = () => setSelection(null)

  return (
    <section id="weekly-status" aria-labelledby={headingId} className="scroll-mt-24 py-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-semibold">
          Weekly status
        </h2>
        {editable && (
          <Button
            size="sm"
            className="max-md:h-11"
            onClick={() => {
              setSelection('preview')
              preview.mutate()
            }}
          >
            Preview this week
          </Button>
        )}
      </div>
      <h3 className="mb-2 text-caption font-medium text-text-muted">Sent reports</h3>
      {reports.isPending ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading weekly status reports.</span>
          <SkeletonRow />
        </div>
      ) : reports.isError ? (
        <EmptyState
          title="We couldn’t load sent reports"
          body="Try again to see previous weekly updates."
          action={
            <Button size="sm" onClick={() => void reports.refetch()}>
              Try again
            </Button>
          }
        />
      ) : reports.data.reports.length ? (
        <ul className="divide-y divide-border">
          {reports.data.reports.map((item) => {
            const week = longDate.format(new Date(item.week))
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui">
                  <span className="font-medium">Week of {week}</span>
                  <ReportStatus status={item.status} />
                  <p className="text-text-muted">
                    Sent {shortDate.format(new Date(item.sentAt))} · {item.recipientsCount}{' '}
                    {item.recipientsCount === 1 ? 'recipient' : 'recipients'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="max-md:h-11"
                  aria-label={`View report for ${week}`}
                  onClick={() => setSelection(item)}
                >
                  View report
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          title="No reports sent yet"
          body="Updates are sent on Mondays when an in-progress project has recent activity."
        />
      )}
      <Dialog
        open={selection !== null}
        onClose={close}
        title={previewing ? 'Weekly status preview' : 'Sent weekly status'}
        widthClassName="w-[730px]"
        fullHeight
        footer={<Button onClick={close}>Done</Button>}
      >
        {previewing && preview.isPending && (
          <div role="status" aria-busy="true">
            <span className="sr-only">Preparing the weekly status preview.</span>
            <SkeletonRow />
          </div>
        )}
        {previewing && preview.isError && (
          <EmptyState
            title="We couldn’t load the preview"
            body="Try again to see this week’s update."
            action={<Button onClick={() => preview.mutate()}>Try again</Button>}
          />
        )}
        {report && <EmailPreview report={report} />}
      </Dialog>
    </section>
  )
}
