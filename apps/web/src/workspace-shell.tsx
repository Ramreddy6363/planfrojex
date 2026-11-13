import { useNavigate } from '@tanstack/react-router'
import {
  CheckCircle2,
  FolderKanban,
  House,
  Inbox,
  Search,
  Settings,
  UsersRound,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { auth } from './auth-client'
import type { getMe, getWorkspace } from './session'
import { Button } from './ui/button'
import { Select } from './ui/select'
import { ActionError, useAction } from './use-action'
import { UserError } from './user-error'

export function WorkspaceShell({
  workspace,
  me,
  active,
  children,
}: {
  workspace: Awaited<ReturnType<typeof getWorkspace>>['workspace']
  me: Awaited<ReturnType<typeof getMe>>
  active: 'home' | 'members'
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { busy, error, run } = useAction()
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <nav
        aria-label="Workspace navigation"
        className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle p-3"
      >
        <Select
          aria-label="Switch workspace"
          value={
            me.workspaces.some((item: { slug: string }) => item.slug === workspace.slug)
              ? workspace.slug
              : ''
          }
          onChange={(event) =>
            void navigate({ to: `/${event.target.value}${active === 'members' ? '/members' : ''}` })
          }
        >
          <option value="" disabled>
            Choose a workspace
          </option>
          {me.workspaces.map((item: { id: string; slug: string; name: string }) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" disabled icon={Search} className="mt-3 justify-start">
          Search
        </Button>
        <Button
          variant="ghost"
          icon={House}
          aria-current={active === 'home' ? 'page' : undefined}
          className={`mt-3 justify-start ${active === 'home' ? '!bg-accent-subtle !text-accent' : ''}`}
          onClick={() => void navigate({ to: `/${workspace.slug}` })}
        >
          Home
        </Button>
        <Button variant="ghost" disabled icon={CheckCircle2} className="justify-start">
          My tasks
        </Button>
        <Button variant="ghost" disabled icon={Inbox} className="justify-start">
          Inbox
        </Button>
        <p className="mt-6 px-2 text-caption text-text-muted">Starred</p>
        <p className="px-2 py-2 text-caption text-text-muted">No starred projects yet</p>
        <p className="mt-6 px-2 text-caption text-text-muted">Workspace</p>
        <Button variant="ghost" disabled icon={FolderKanban} className="justify-start">
          Projects
        </Button>
        <Button
          variant="ghost"
          icon={UsersRound}
          aria-current={active === 'members' ? 'page' : undefined}
          className={`justify-start ${active === 'members' ? '!bg-accent-subtle !text-accent' : ''}`}
          onClick={() => void navigate({ to: `/${workspace.slug}/members` })}
        >
          Members
        </Button>
        <Button variant="ghost" disabled icon={Settings} className="justify-start">
          Settings
        </Button>
        <div className="mt-auto border-t border-border pt-3">
          <p className="truncate px-2 text-text-muted">{me.user.email}</p>
          <Button
            className="mt-6 self-start"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await auth.signOut()
                if (error) throw new UserError('Could not sign out. Try again.')
                sessionStorage.removeItem('displayName')
                await navigate({ to: '/sign-in' })
              })
            }
          >
            Sign out
          </Button>
          <ActionError error={error} />
        </div>
      </nav>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
