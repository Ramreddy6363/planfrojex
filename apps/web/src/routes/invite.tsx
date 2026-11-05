import { createRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, call, RequestError } from '../api'
import { invitationMessage } from '../auth-errors'
import { label, OnboardingShell } from '../layouts'
import { requireSignedIn, storedWorkspace } from '../session'
import { Button } from '../ui/button'
import { StepMarks } from '../ui/progress'
import { Select } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { WorkspacePreview } from '../ui/workspace-preview'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { rootRoute } from './root'

const split = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((email) => email.trim())
    .filter(Boolean)

function InviteTeam() {
  const navigate = useNavigate()
  const { busy, error, submit } = useAction()
  const workspace = storedWorkspace()
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const list = [...new Set(split(emails))]
  return (
    <OnboardingShell
      previewTitle="Your team after sending"
      preview={
        <WorkspacePreview
          name={workspace?.name || 'Your workspace'}
          slug={workspace?.slug ?? ''}
          owner={sessionStorage.getItem('email') ?? ''}
          ownerName={sessionStorage.getItem('displayName') ?? ''}
          emails={list}
          inviteRole={role}
          invitations
        />
      }
      footer={
        <p className="mt-4 text-center text-caption text-text-muted">
          They get an email from {sessionStorage.getItem('email') ?? 'you'}. Invites expire after 7
          days.
        </p>
      }
      compact
    >
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-muted">Step 2 of 2</p>
        <StepMarks step={2} />
      </div>
      <h1 className="mt-5 text-display font-semibold">Invite your team</h1>
      <p className="mt-1 text-body text-text-muted">
        Plans work better when the people doing the work can comment on them. You can do this later
        from Members.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={submit(async () => {
          if (!workspace) throw new UserError('Workspace not found.')
          try {
            await call(
              api.workspaces[':ws'].invites.$post({
                param: { ws: workspace.slug },
                json: { emails: split(emails), role },
              }),
            )
          } catch (error) {
            throw new UserError(
              invitationMessage(error instanceof RequestError ? { status: error.status } : {}),
            )
          }
          await navigate({ to: `/${workspace.slug}` })
        })}
      >
        <div>
          <label htmlFor="invites" className={label}>
            Email addresses
          </label>
          <Textarea
            id="invites"
            height="invite"
            required
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div>
          <label htmlFor="invite-role" className={label}>
            Role
          </label>
          <Select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </Select>
          <p className="mt-1 text-caption text-text-muted">
            Editors can change projects. Viewers can read and comment.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => workspace && void navigate({ to: `/${workspace.slug}` })}
          >
            Skip for now
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Send {list.length} {list.length === 1 ? 'invite' : 'invites'}
          </Button>
        </div>
      </form>
      <ActionError error={error} />
    </OnboardingShell>
  )
}

export const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding/invite',
  beforeLoad: requireSignedIn,
  component: InviteTeam,
})
