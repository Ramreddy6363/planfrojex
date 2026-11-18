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
}: {
  workspace: { slug: string; role: string }
  project: { key: string; name: string }
}) {
  const [open, setOpen] = useState(false)
  if (workspace.role !== 'owner' && workspace.role !== 'editor') return null
  return (
    <>
      <Button icon={LinkIcon} onClick={() => setOpen(true)}>
        Share
      </Button>
      {open ? (
        <ShareDialog ws={workspace.slug} project={project} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

function ShareDialog({
  ws,
  project,
  onClose,
}: {
  ws: string
  project: { key: string; name: string }
  onClose: () => void
}) {
  const action = useAction()
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const param = { ws, key: project.key }
  const queryKey = ['share', ws, project.key]
  const query = useQuery({
    queryKey,
    retry: false,
    queryFn: () => call(api.workspaces[':ws'].projects[':key'].share.$get({ param })),
  })
  const share = query.data?.share
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
