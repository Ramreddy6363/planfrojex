import { useQuery } from '@tanstack/react-query'
import { Copy, Eye, Link as LinkIcon } from 'lucide-react'
import { useState } from 'react'
import { api, call } from './api'
import { relativeTime } from './relative-time'
import { queryClient } from './session'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog } from './ui/dialog'
import { EmptyState } from './ui/empty-state'
import { Icon } from './ui/icon'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import { ActionError, useAction } from './use-action'

const sections = ['brief', 'plan', 'diagrams', 'tasks'] as const
type Section = (typeof sections)[number]

export function ShareButton({
  workspace,
  project,
  iconOnly = false,
}: {
  workspace: { slug: string; role: string }
  project: { id: string; key: string; name: string }
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (workspace.role === 'viewer')
    return <ReviewProgressButton project={project} iconOnly={iconOnly} />
  if (workspace.role !== 'owner' && workspace.role !== 'editor') return null
  return (
    <>
      <Button
        icon={LinkIcon}
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? 'Share' : undefined}
        variant="secondary"
        className={
          iconOnly ? 'max-md:!size-11 max-md:!border-0 max-md:!bg-transparent max-md:px-0' : ''
        }
      >
        <span className={iconOnly ? 'max-md:hidden' : ''}>Share</span>
      </Button>
      {open ? (
        <ShareDialog ws={workspace.slug} project={project} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

function ReviewProgressButton({
  project,
  iconOnly,
}: {
  project: { id: string; name: string }
  iconOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        icon={Eye}
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? 'Review progress' : undefined}
        variant="secondary"
        className={
          iconOnly ? 'max-md:!size-11 max-md:!border-0 max-md:!bg-transparent max-md:px-0' : ''
        }
      >
        <span className={iconOnly ? 'max-md:hidden' : ''}>Review progress</span>
      </Button>
      {open ? <ReviewProgressDialog project={project} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function ReviewProgressDialog({
  project,
  onClose,
}: {
  project: { id: string; name: string }
  onClose: () => void
}) {
  const reviews = useQuery({
    queryKey: ['review-requests', project.id],
    queryFn: () => call(api.projects[':id']['review-requests'].$get({ param: { id: project.id } })),
    retry: false,
  })
  const requests = reviews.data?.requests.filter((request) => !request.cancelledAt) ?? []
  return (
    <Dialog
      open
      widthClassName="w-135"
      title={`Review progress · ${project.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {reviews.isPending ? (
        <p role="status">Loading review progress…</p>
      ) : reviews.isError ? (
        <EmptyState
          title="Couldn’t load review progress"
          body="Try again to see the reviewers and their decisions."
          action={<Button onClick={() => void reviews.refetch()}>Retry</Button>}
        />
      ) : requests.length ? (
        <div className="space-y-4">
          {requests.map((request) => (
            <section key={request.id} className="border-b border-border pb-3 last:border-0">
              <p className="text-caption text-text-muted">
                Sent {relativeTime(request.createdAt)}
                {request.dueDate
                  ? ` · Due ${new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(`${request.dueDate}T00:00:00Z`))}`
                  : ''}
              </p>
              <div className="mt-2 space-y-2">
                {request.reviewers.map((reviewer) => (
                  <p
                    key={reviewer.id}
                    className="flex flex-wrap justify-between gap-x-2 text-caption"
                  >
                    <span className="break-all">{reviewer.email}</span>
                    <span>
                      {reviewer.approvedCount} of {reviewer.totalSections} sections approved
                    </span>
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No reviewers yet"
          body="Review progress will appear here after an owner or editor sends a request."
        />
      )}
    </Dialog>
  )
}

function ShareDialog({
  ws,
  project,
  onClose,
}: {
  ws: string
  project: { id: string; key: string; name: string }
  onClose: () => void
}) {
  const action = useAction()
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [askForApproval, setAskForApproval] = useState(false)
  const [emails, setEmails] = useState('')
  const [dueDate, setDueDate] = useState('')
  const param = { ws, key: project.key }
  const queryKey = ['share', ws, project.key]
  const query = useQuery({
    queryKey,
    retry: false,
    queryFn: () => call(api.workspaces[':ws'].projects[':key'].share.$get({ param })),
  })
  const share = query.data?.share
  const reviewsKey = ['review-requests', project.id]
  const reviews = useQuery({
    queryKey: reviewsKey,
    enabled: Boolean(share?.enabled),
    queryFn: () => call(api.projects[':id']['review-requests'].$get({ param: { id: project.id } })),
    retry: false,
  })
  async function sendForReview() {
    const reviewers = emails.split(/[\s,;]+/).filter(Boolean)
    await call(
      api.projects[':id']['review-requests'].$post({
        param: { id: project.id },
        json: { emails: reviewers, dueDate: dueDate || null },
      }),
    )
    setEmails('')
    setDueDate('')
    setAskForApproval(false)
    await queryClient.invalidateQueries({ queryKey: reviewsKey })
  }
  async function cancelReview(id: string) {
    await call(api['review-requests'][':id'].$delete({ param: { id } }))
    await queryClient.invalidateQueries({ queryKey: reviewsKey })
  }
  async function update(enabled: boolean, include: Section[], rotate = false) {
    const result = await call(
      api.workspaces[':ws'].projects[':key'].share.$put({
        param,
        json: { enabled, include, ...(rotate ? { rotate: true } : {}) },
      }),
    )
    if (result.token) setToken(result.token)
    if (!enabled) setToken(null)
    setCopied(false)
    queryClient.setQueryData(queryKey, { share: result.share })
    await queryClient.invalidateQueries({ queryKey: ['share-links', ws] })
  }
  async function turnOff() {
    if (share) await update(false, share.include)
  }
  return (
    <Dialog
      open
      widthClassName="w-135"
      title={`Share ${project.name}`}
      onClose={onClose}
      footer={
        <>
          {share?.enabled ? (
            <Button
              variant="ghost"
              className="mr-auto !text-danger"
              disabled={action.busy}
              onClick={() => void action.run(turnOff)}
            >
              Turn off link
            </Button>
          ) : null}
          {share?.enabled ? (
            <Button
              disabled={!askForApproval || !emails.trim() || action.busy}
              onClick={() => void action.run(sendForReview)}
            >
              Send for review
            </Button>
          ) : null}
          <Button variant="primary" disabled={action.busy} onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {query.isPending ? (
        <p role="status">Loading share link…</p>
      ) : query.isError ? (
        <EmptyState
          title="Couldn’t load share link"
          body="Try again to manage this project’s link."
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        />
      ) : share ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-ui font-medium text-text">Public read-only link</p>
              <p className="mt-0.5 text-caption">
                Anyone with the link can read the plan. No account needed.
              </p>
            </div>
            <Switch
              aria-label="Public read-only link"
              className="max-md:after:absolute max-md:after:-inset-3"
              checked={share.enabled}
              disabled={action.busy}
              onClick={() =>
                void action.run(() => (share.enabled ? turnOff() : update(true, share.include)))
              }
            />
          </div>
          {share.enabled ? (
            <>
              <div className="mt-4 flex gap-2">
                <Input
                  aria-label="Share link"
                  readOnly
                  value={token ? `${window.location.origin}/share/${token}` : 'Link is on'}
                  className="min-w-0 flex-1 bg-bg-subtle font-mono text-caption"
                />
                <Button
                  icon={Copy}
                  disabled={!token || action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await navigator.clipboard.writeText(
                        `${window.location.origin}/share/${token}`,
                      )
                      setCopied(true)
                    })
                  }
                >
                  Copy
                </Button>
              </div>
              {copied ? (
                <p role="status" className="mt-1 text-caption">
                  Link copied
                </p>
              ) : null}
              {!token ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  disabled={action.busy}
                  onClick={() => void action.run(() => update(true, share.include, true))}
                >
                  Make a new link
                </Button>
              ) : null}
              <fieldset className="mt-4">
                <legend className="text-caption">Include</legend>
                <div className="mt-2 flex flex-wrap gap-5">
                  {sections.map((section) => (
                    <label
                      htmlFor={`share-include-${section}`}
                      key={section}
                      className="flex items-center gap-2 text-ui text-text"
                    >
                      <Checkbox
                        id={`share-include-${section}`}
                        checked={share.include.includes(section)}
                        disabled={action.busy}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? sections.filter(
                                (value) => value === section || share.include.includes(value),
                              )
                            : share.include.filter((value) => value !== section)
                          void action.run(() => update(true, next))
                        }}
                      />
                      {section[0]?.toUpperCase()}
                      {section.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-ui font-medium text-text">Ask for approval</p>
                    <p className="mt-0.5 text-caption">
                      Reviewers can approve sections or request changes. They confirm their email
                      first.
                    </p>
                  </div>
                  <Switch
                    aria-label="Ask for approval"
                    className="max-md:after:absolute max-md:after:-inset-3"
                    checked={askForApproval}
                    disabled={action.busy}
                    onClick={() => setAskForApproval(!askForApproval)}
                  />
                </div>
                {askForApproval ? (
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_152px] gap-2 max-md:grid-cols-1">
                    <Input
                      aria-label="Reviewer emails"
                      placeholder="Reviewer emails"
                      value={emails}
                      onChange={(event) => setEmails(event.target.value)}
                      className="min-w-0 max-md:min-h-11"
                    />
                    <Input
                      aria-label="Review due date"
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="max-md:min-h-11"
                    />
                  </div>
                ) : null}
                {reviews.data?.requests
                  .filter((request) => !request.cancelledAt)
                  .map((request) => (
                    <div key={request.id} className="mt-3 border-t border-border pt-3">
                      {request.reviewers.map((reviewer) => (
                        <p
                          key={reviewer.id}
                          className="flex flex-wrap justify-between gap-x-2 text-caption"
                        >
                          <span className="break-all">{reviewer.email}</span>
                          <span>
                            {reviewer.approvedCount} of {reviewer.totalSections} sections approved
                          </span>
                        </p>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={action.busy}
                        onClick={() => void action.run(() => cancelReview(request.id))}
                      >
                        Cancel request
                      </Button>
                    </div>
                  ))}
              </div>
              <p className="mt-6 flex items-center gap-1.5 text-caption">
                <Icon icon={Eye} />
                Opened {share.viewCount} times
                {share.lastViewedAt ? `, last ${relativeTime(share.lastViewedAt)}` : ''}
              </p>
            </>
          ) : null}
        </>
      ) : null}
      <ActionError error={action.error} />
    </Dialog>
  )
}
