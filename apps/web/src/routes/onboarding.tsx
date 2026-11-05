import { createRoute, useNavigate } from '@tanstack/react-router'
import { UserRound, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { RequestError } from '../api'
import { workspaceCreationMessage } from '../auth-errors'
import { label, OnboardingShell } from '../layouts'
import { createWorkspace, requireSignedIn } from '../session'
import { Button } from '../ui/button'
import { Icon } from '../ui/icon'
import { Input } from '../ui/input'
import { StepMarks } from '../ui/progress'
import { WorkspacePreview } from '../ui/workspace-preview'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { personalSlug, slugForName } from '../workspace-slug'
import { rootRoute } from './root'

const choice = 'min-h-36 flex-1 flex-col items-start justify-start gap-3 p-4 text-left'

function Onboarding() {
  const navigate = useNavigate()
  const { busy, error, submit } = useAction()
  const [personal, setPersonal] = useState(
    () => sessionStorage.getItem('onboardingMode') !== 'team',
  )
  const [name, setName] = useState('')
  const pick = (value: boolean) => {
    setPersonal(value)
    sessionStorage.setItem('onboardingMode', value ? 'personal' : 'team')
  }
  return (
    <OnboardingShell
      previewTitle="Preview"
      preview={
        <WorkspacePreview
          name={name || 'Your workspace'}
          slug={slugForName(name)}
          owner={sessionStorage.getItem('email') ?? ''}
          emails={[]}
          inviteRole="editor"
          invitations={false}
        />
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-muted">Step 1</p>
        <StepMarks step={1} />
      </div>
      <h1 className="mt-5 text-display font-semibold">How will you use PlanFrojex?</h1>
      <p className="mt-2 text-body text-text-muted">
        You can change this later. Inviting one person turns team features on.
      </p>
      <div className="mt-6 flex gap-3">
        <Button
          className={choice}
          size="auto"
          variant={personal ? 'choice-selected' : 'choice'}
          aria-pressed={personal}
          aria-label="Just me"
          onClick={() => pick(true)}
        >
          <Icon icon={UserRound} className="shrink-0" />
          <span>Just me</span>
          <span className="font-normal text-text-muted">
            Plan your own projects. Team features stay hidden until you invite someone.
          </span>
        </Button>
        <Button
          className={choice}
          size="auto"
          variant={!personal ? 'choice-selected' : 'choice'}
          aria-pressed={!personal}
          aria-label="With a team"
          onClick={() => pick(false)}
        >
          <Icon icon={UsersRound} className="shrink-0" />
          <span>With a team</span>
          <span className="font-normal text-text-muted">
            Create a shared workspace. You'll invite teammates in the next step.
          </span>
        </Button>
      </div>
      {personal ? (
        <form
          className="mt-6 space-y-4"
          onSubmit={submit(async () => {
            let workspace: Awaited<ReturnType<typeof createWorkspace>>
            try {
              workspace = await createWorkspace({
                name,
                slug: (attempt) => personalSlug(slugForName(name), attempt),
                isPersonal: true,
              })
            } catch (error) {
              throw new UserError(
                workspaceCreationMessage(
                  error instanceof RequestError ? { status: error.status } : {},
                  name,
                ),
              )
            }
            await navigate({ to: `/${workspace.slug}` })
          })}
        >
          <label htmlFor="personal-name" className={label}>
            Name your space
          </label>
          <Input
            id="personal-name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy}>
              Start planning
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-6 flex justify-end">
          <Button variant="primary" onClick={() => void navigate({ to: '/onboarding/workspace' })}>
            Continue
          </Button>
        </div>
      )}
      <ActionError error={error} />
    </OnboardingShell>
  )
}

export const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: requireSignedIn,
  component: Onboarding,
})
