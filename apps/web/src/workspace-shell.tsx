import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  CheckCircle2,
  ChevronsUpDown,
  Folder,
  FolderKanban,
  House,
  Inbox,
  LogOut,
  Search,
  Settings,
  UsersRound,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { api, call } from './api'
import { auth } from './auth-client'
import type { getMe, getWorkspace } from './session'
import { Avatar } from './ui/avatar'
import { WorkspaceMark } from './ui/brand'
import { Button } from './ui/button'
import { Icon } from './ui/icon'
import { Menu } from './ui/menu'
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
  active: 'home' | 'members' | 'projects'
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { busy, error, run } = useAction()
  const displayName = me.user.name || me.user.email
  const starred = useQuery({
    queryKey: ['projects', workspace.slug, 'sidebar'],
    queryFn: async () => {
      let page = await call(
        api.workspaces[':ws'].projects.$get({
          param: { ws: workspace.slug },
          query: { view: 'starred' },
        }),
      )
      const projects = [...page.projects]
      const seen = new Set<string>()
      while (page.nextCursor && !seen.has(page.nextCursor)) {
        const cursor = page.nextCursor
        seen.add(cursor)
        page = await call(
          api.workspaces[':ws'].projects.$get({
            param: { ws: workspace.slug },
            query: { view: 'starred', cursor },
          }),
        )
        projects.push(...page.projects)
      }
      return { projects }
    },
  })
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <nav
        aria-label="Workspace navigation"
        className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle p-3"
      >
        <Menu
          label="Switch workspace"
          triggerClassName="w-full justify-start px-1"
          triggerContent={
            <>
              <WorkspaceMark name={workspace.name} />
              <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
              <Icon icon={ChevronsUpDown} className="text-text-muted" />
            </>
          }
          items={me.workspaces.map((item) => ({
            label: item.name,
            current: item.slug === workspace.slug,
            onSelect: () =>
              void navigate({
                to: `/${item.slug}${active === 'members' ? '/members' : active === 'projects' ? '/projects' : ''}`,
              }),
          }))}
        />
        <Button
          variant="secondary"
          disabled
          icon={Search}
          className="mt-3 justify-start font-normal"
        >
          Search
          <kbd className="ml-auto font-sans text-caption text-text-muted">⌘K</kbd>
        </Button>
        <Button
          variant="ghost"
          icon={House}
          aria-current={active === 'home' ? 'page' : undefined}
          className={`mt-3 justify-start font-normal ${active === 'home' ? '!bg-accent-subtle !text-accent' : ''}`}
          onClick={() => void navigate({ to: `/${workspace.slug}` })}
        >
          Home
        </Button>
        <Button variant="ghost" disabled icon={CheckCircle2} className="justify-start font-normal">
          My tasks
        </Button>
        <Button variant="ghost" disabled icon={Inbox} className="justify-start font-normal">
          Inbox
        </Button>
        <p className="mt-6 px-2 text-caption text-text-muted">Starred</p>
        {starred.data?.projects.length ? (
          starred.data.projects.map((project) => (
            <p key={project.id} className="flex items-center gap-2 px-1 py-2 text-ui">
              <Icon icon={Folder} className="shrink-0 text-text-muted" />
              <span className="truncate">{project.name}</span>
            </p>
          ))
        ) : (
          <p className="px-2 py-2 text-caption text-text-muted">No starred projects yet</p>
        )}
        <p className="mt-6 px-2 text-caption text-text-muted">Workspace</p>
        <Button
          variant="ghost"
          icon={FolderKanban}
          aria-current={active === 'projects' ? 'page' : undefined}
          className={`justify-start font-normal ${active === 'projects' ? '!bg-accent-subtle !text-accent' : ''}`}
          onClick={() => void navigate({ to: `/${workspace.slug}/projects` })}
        >
          Projects
        </Button>
        <Button
          variant="ghost"
          icon={UsersRound}
          aria-current={active === 'members' ? 'page' : undefined}
          className={`justify-start font-normal ${active === 'members' ? '!bg-accent-subtle !text-accent' : ''}`}
          onClick={() => void navigate({ to: `/${workspace.slug}/members` })}
        >
          Members
        </Button>
        <Button variant="ghost" disabled icon={Settings} className="justify-start font-normal">
          Settings
        </Button>
        <div className="mt-auto flex items-center gap-2 border-t border-border px-1 pt-3">
          <Avatar id={me.user.id} name={displayName} />
          <span className="min-w-0 flex-1 truncate">{displayName}</span>
          <Menu
            label="Account"
            iconOnly
            items={[
              {
                label: busy ? 'Signing out…' : 'Sign out',
                icon: LogOut,
                onSelect: () =>
                  void run(async () => {
                    const { error } = await auth.signOut()
                    if (error) throw new UserError('Could not sign out. Try again.')
                    sessionStorage.removeItem('displayName')
                    await navigate({ to: '/sign-in' })
                  }),
              },
            ]}
          />
        </div>
        <ActionError error={error} />
      </nav>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
