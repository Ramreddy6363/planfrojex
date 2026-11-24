import { CalendarClock, CirclePlus, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { DriftAction, DriftReport } from './api'
import { Button } from './ui/button'
import { Icon } from './ui/icon'
import { Input } from './ui/input'

type Finding = DriftReport['findings'][number]
type Change = DriftReport['changes'][number]

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const dateLabel = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`))
const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function linearCheckLabel(time: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 60_000))
  return minutes < 1 ? 'just now' : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
}

function findingText(finding: Finding) {
  switch (finding.kind) {
    case 'milestone_late':
      return `${finding.code} ${finding.title} is ${finding.daysLate} days behind: ${finding.done} of ${finding.total} tasks done, due ${dateLabel(finding.dueDate)}.`
    case 'linear_tasks': {
      const keys = finding.tasks.map(({ key }) => key)
      const prefix = keys[0]?.slice(0, keys[0].lastIndexOf('-') + 1)
      const list = keys
        .map((key, index) =>
          index > 0 && prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key,
        )
        .join(', ')
      return `${keys.length === 1 ? '1 task was' : `${keys.length} tasks were`} added in Linear outside the plan (${list}).`
    }
    case 'risk_overdue':
      return `Risk ${finding.code}, ${finding.title}, needed a decision by ${dateLabel(finding.decideBy)} and is still open.`
  }
}

const findingIcons = {
  milestone_late: CalendarClock,
  linear_tasks: CirclePlus,
  risk_overdue: ShieldAlert,
}

function findingKey(finding: Finding) {
  switch (finding.kind) {
    case 'milestone_late':
      return finding.milestoneId
    case 'linear_tasks':
      return `linear-${finding.milestoneId ?? 'unassigned'}`
    case 'risk_overdue':
      return finding.riskId
  }
}

function diffLines(change: Change) {
  const label = `${change.code} ${change.title}`
  switch (change.kind) {
    case 'milestone_date':
      return {
        label: `${label} date change`,
        before: label,
        beforeDetail: `due ${dateLabel(change.before)}`,
        after: label,
        afterDetail: `due ${dateLabel(change.after)}`,
      }
    case 'milestone_tasks':
      return {
        label: `${label} task changes`,
        before: null,
        after: `Add ${change.tasks.map(({ key }) => key).join(', ')} to ${change.code}`,
      }
    case 'risk_severity':
      return {
        label: `${label} severity change`,
        before: label,
        beforeDetail: `severity ${capitalized(change.before)}`,
        after: label,
        afterDetail: `severity ${capitalized(change.after)}${change.ownerName ? `, owner ${change.ownerName}` : ''}`,
      }
  }
}

function DriftDiffRow({
  side,
  text,
  detail,
}: {
  side: 'before' | 'after'
  text: string
  detail?: string
}) {
  const before = side === 'before'
  return (
    <div
      className={`flex gap-3 px-3.5 py-1 break-words ${before ? 'bg-danger/5 text-text-muted' : 'bg-success/5'}`}
    >
      <span aria-hidden="true" className={before ? 'text-danger' : 'text-success'}>
        {before ? '-' : '+'}
      </span>
      <span className="min-w-0">
        <span className="sr-only">{before ? 'Current: ' : 'Proposed: '}</span>
        {text}
        {detail && <span className="ml-2">{detail}</span>}
      </span>
    </div>
  )
}

export function ProjectDriftCard({
  report,
  canManage,
  linearConnected,
  busy,
  note,
  onAction,
}: {
  report: DriftReport
  canManage: boolean
  linearConnected: boolean
  busy: boolean
  note?: string
  onAction: (input: DriftAction) => void
}) {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const reviewing = canManage && reviewOpen
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus()
  }, [reviewing])
  const pending = report.changes.some((change) => change.status === 'pending')
  const reasonField = reason.trim() ? { reason: reason.trim() } : {}

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      className="mt-6 rounded-panel border border-warning text-ui"
    >
      <header className="flex items-center gap-3 rounded-t-panel border-b border-border bg-bg-subtle px-4 py-3.5">
        <Icon icon={TriangleAlert} className="shrink-0 text-warning" />
        <div>
          <h2 id={titleId} className="text-body font-semibold">
            The plan has drifted from the work
          </h2>
          {linearConnected && report.checkedAgainstLinearAt && (
            <p className="text-caption text-text-muted">
              Checked against Linear {linearCheckLabel(report.checkedAgainstLinearAt)}
            </p>
          )}
        </div>
      </header>
      <div className="space-y-3.5 px-4 py-3.5">
        <div>
          <h3 className="mb-3 font-mono text-[11px] tracking-wide text-text-muted uppercase">
            What changed
          </h3>
          <ul className="space-y-3">
            {report.findings.map((finding) => (
              <li key={findingKey(finding)} className="flex items-start gap-2.5">
                <Icon
                  icon={findingIcons[finding.kind]}
                  className="mt-0.5 shrink-0 text-text-muted"
                />
                <span className="min-w-0 break-words">{findingText(finding)}</span>
              </li>
            ))}
          </ul>
        </div>
        {report.changes.length > 0 && (
          <div>
            <h3
              ref={reviewHeading}
              tabIndex={-1}
              className="mb-3 font-mono text-[11px] tracking-wide text-text-muted uppercase"
            >
              Suggested update
            </h3>
            <ul className="rounded-control border border-border py-2">
              {report.changes.map((change) => {
                const lines = diffLines(change)
                return (
                  <li
                    key={change.id}
                    className={
                      reviewing ? 'border-b border-border pt-2 first:pt-0 last:border-0' : ''
                    }
                  >
                    {lines.before && (
                      <DriftDiffRow side="before" text={lines.before} detail={lines.beforeDetail} />
                    )}
                    <DriftDiffRow side="after" text={lines.after} detail={lines.afterDetail} />
                    {reviewing && (
                      <div className="flex justify-end gap-2 px-3 py-2">
                        {change.status === 'pending' ? (
                          <>
                            <Button
                              size="sm"
                              className="max-md:min-h-11"
                              aria-label={`Reject ${lines.label}`}
                              disabled={busy}
                              onClick={() =>
                                onAction({
                                  action: 'reject_change',
                                  reportId: report.id,
                                  changeId: change.id,
                                  ...reasonField,
                                })
                              }
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              className="max-md:min-h-11"
                              aria-label={`Accept ${lines.label}`}
                              disabled={busy}
                              onClick={() =>
                                onAction({
                                  action: 'accept_change',
                                  reportId: report.id,
                                  changeId: change.id,
                                  ...reasonField,
                                })
                              }
                            >
                              Accept
                            </Button>
                          </>
                        ) : (
                          <span className="text-caption text-text-muted">
                            {capitalized(change.status)}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {canManage && pending && (
          <Input
            aria-label="Why?"
            placeholder="Why? Saved to the decision log (optional)"
            className="max-md:min-h-11"
            maxLength={2_000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </div>
      {(note || canManage) && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3">
          {note && <p className="text-caption text-text-muted">{note}</p>}
          {canManage && (
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                className="max-md:min-h-11"
                disabled={busy}
                onClick={() => onAction({ action: 'dismiss', reportId: report.id })}
              >
                Dismiss
              </Button>
              {pending && (
                <>
                  <Button
                    className="max-md:min-h-11"
                    aria-pressed={reviewing}
                    disabled={busy}
                    onClick={() => setReviewOpen((previous) => !previous)}
                  >
                    {reviewing ? 'Back to summary' : 'Review each'}
                  </Button>
                  <Button
                    variant="primary"
                    className="max-md:min-h-11"
                    disabled={busy}
                    onClick={() =>
                      onAction({ action: 'accept', reportId: report.id, ...reasonField })
                    }
                  >
                    Accept update
                  </Button>
                </>
              )}
            </div>
          )}
        </footer>
      )}
    </section>
  )
}
