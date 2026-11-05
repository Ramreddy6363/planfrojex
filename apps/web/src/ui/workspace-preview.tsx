import { CheckCircle2, FolderKanban, House, Inbox, Lock, Mail } from 'lucide-react'
import { Avatar } from './avatar'
import { Icon } from './icon'

export function WorkspacePreview({
  name,
  slug,
  owner,
  ownerName,
  emails,
  inviteRole,
  invitations,
}: {
  name: string
  slug: string
  owner: string
  ownerName?: string
  emails: string[]
  inviteRole: 'editor' | 'viewer'
  invitations: boolean
}) {
  return (
    <section
      aria-label="Workspace preview"
      className="overflow-hidden rounded-panel border border-border bg-bg text-caption"
    >
      {invitations ? (
        <>
          <div className="flex justify-between border-b border-border bg-bg-subtle px-3 py-2 font-medium">
            <span>{name} members</span>
            <span>{emails.length + 1}</span>
          </div>
          <div className="flex items-center gap-2 border-b border-border p-2">
            <Avatar id={owner} name={ownerName || owner || 'Owner'} />
            <span className="flex-1 truncate">{ownerName || owner || 'You'}</span>
            <span className="text-text-muted">Owner</span>
          </div>
          {emails.map((email) => (
            <div key={email} className="flex items-center gap-2 border-b border-border p-2">
              <Icon icon={Mail} />
              <span className="flex-1 truncate">{email}</span>
              <span className="text-text-muted">Invite pending</span>
              <span className="text-text-muted">
                {inviteRole === 'editor' ? 'Editor' : 'Viewer'}
              </span>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border bg-bg-subtle px-2.5 py-2">
            <span aria-hidden className="flex gap-1">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="size-2 rounded-sm bg-border-strong" />
              ))}
            </span>
            <span className="flex h-5 min-w-0 flex-1 items-center gap-1.5 rounded-control border border-border bg-bg px-1.5 font-mono">
              <Icon icon={Lock} className="size-3 shrink-0 text-text-muted" />
              <span className="truncate text-text-muted">
                planfrojex.app/<span className="ml-1 text-text">{slug || 'workspace'}</span>
              </span>
            </span>
          </div>
          <div className="flex min-h-40">
            <div className="w-5/12 border-r border-border bg-bg-subtle p-1.5">
              <div className="flex items-center gap-2 rounded-control border border-accent bg-bg px-2 py-1.5 font-medium">
                <span
                  aria-hidden
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-control bg-text text-[10px] font-semibold text-bg"
                >
                  {(name || 'Y').charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{name || 'Your workspace'}</span>
              </div>
              <div className="mt-2 space-y-2 px-1.5 text-text-muted">
                {[
                  [House, 'Home'],
                  [CheckCircle2, 'My tasks'],
                  [Inbox, 'Inbox'],
                  [FolderKanban, 'Projects'],
                ].map(([icon, label]) => (
                  <div key={String(label)} className="flex items-center gap-2">
                    <Icon icon={icon as typeof House} />
                    {String(label)}
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1 p-3">
              <p className="font-medium">Home</p>
              {[40, 32, 44, 28].map((width) => (
                <div
                  key={width}
                  aria-hidden
                  className="flex h-8 items-center gap-2 border-b border-border"
                >
                  <span className="size-3 shrink-0 rounded-sm border border-border-strong bg-bg" />
                  <span
                    className="h-1.5 rounded-sm bg-bg-muted"
                    style={{ width: `${width * 2}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
