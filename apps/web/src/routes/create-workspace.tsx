import { createRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { RequestError } from '../api'
import { workspaceCreationMessage } from '../auth-errors'
import { label, OnboardingShell } from '../layouts'
import { createWorkspace, requireSignedIn } from '../session'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { StepMarks } from '../ui/progress'
import { UrlInput } from '../ui/url-input'
import { WorkspacePreview } from '../ui/workspace-preview'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { slugForName } from '../workspace-slug'
import { rootRoute } from './root'

function CreateWorkspace() {
  const navigate = useNavigate()
  const { busy, error, submit } = useAction()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  return (
    <OnboardingShell
      previewTitle="Preview"
      preview={
        <WorkspacePreview
          name={name || 'Your workspace'}
          slug={slug}
          owner={sessionStorage.getItem('email') ?? ''}
          emails={[]}
          inviteRole="editor"
          invitations={false}
        />
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-muted">Step 1 of 2</p>
        <StepMarks step={1} />
      </div>
      <h1 className="mt-5 text-display font-semibold">Create your workspace</h1>
      <p className="mt-4 text-body text-text-muted">
        A workspace holds your team's projects, plans and tasks.
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={submit(async () => {
          try {
            await createWorkspace({ name, slug: () => slug, isPersonal: false })
          } catch (error) {
            throw new UserError(
              workspaceCreationMessage(
                error instanceof RequestError ? { status: error.status } : {},
                name,
              ),
            )
          }
          await navigate({ to: '/onboarding/invite' })
        })}
      >
        <div>
          <label htmlFor="name" className={label}>
            Workspace name
          </label>
          <Input
            id="name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSlug(slugForName(e.target.value))
            }}
          />
        </div>
        <div>
          <label htmlFor="slug" className={label}>
            URL
          </label>
          <UrlInput
            id="slug"
            required
            minLength={3}
            maxLength={40}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <p className="mt-1 text-caption text-text-muted">
            Lowercase letters, numbers and dashes.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy}>
            Continue
          </Button>
        </div>
      </form>
      <ActionError error={error} />
    </OnboardingShell>
  )
}

export const createWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding/workspace',
  beforeLoad: requireSignedIn,
  component: CreateWorkspace,
})
