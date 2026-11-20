import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
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
  UserRound,
  UsersRound,
} from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useContext,
  useState,
} from 'react'
import { api, call } from './api'
import { auth } from './auth-client'
import { getInbox, inboxKey } from './inbox'
import { getMyTasks, myTasksKey } from './my-tasks'
import type { getMe, getWorkspace } from './session'
import { Avatar } from './ui/avatar'
import { WorkspaceMark } from './ui/brand'
import { Button } from './ui/button'
import { Icon } from './ui/icon'
import { Menu } from './ui/menu'
import { MobileTabs } from './ui/mobile-tabs'
import { ActionError, useAction } from './use-action'
import { UserError } from './user-error'
import { WorkspaceSearch } from './workspace-search'

const OpenWorkspaceSearch = createContext<(() => void) | null>(null)

export function WorkspaceSearchButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const openSearch = useContext(OpenWorkspaceSearch)
  return (
    <Button
      variant="ghost"
      icon={Search}
      aria-label="Search"
      {...props}
      className={`!size-11 shrink-0 px-0 ${props.className ?? ''}`}
      onClick={() => openSearch?.()}
    />
  )
}

export function WorkspaceShell({
  workspace,
  me,
  active,
  children,
}: {
  workspace: Awaited<ReturnType<typeof getWorkspace>>['workspace']
  me: Awaited<ReturnType<typeof getMe>>
  active: 'home' | 'members' | 'projects' | 'my-tasks' | 'inbox' | 'settings' | 'account'
  children: ReactNode
}) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const { busy, error, run } = useAction()
  const displayName = me.user.name || me.user.email
  const [searchOpen, setSearchOpen] = useState(false)
  const myTasks = useQuery({
    queryKey: [...myTasksKey(workspace.slug), 'sidebar'],
    queryFn: () => getMyTasks(workspace.slug, 'assigned', '', null, '1'),
  })
  const inbox = useQuery({
    queryKey: [...inboxKey(workspace.slug), 'sidebar', pathname],
    queryFn: () => getInbox(workspace.slug, null, '1'),
    refetchInterval: 60_000,
  })
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
  const navigation = [
    { id: 'home', label: 'Home', icon: House, href: `/${workspace.slug}` },
    {
      id: 'my-tasks',
      label: 'My tasks',
      icon: CheckCircle2,
      href: `/${workspace.slug}/my-tasks`,
      count: myTasks.data?.counts?.assigned,
    },
    {
      id: 'inbox',
      label: 'Inbox',
      icon: Inbox,
      href: `/${workspace.slug}/inbox`,
      count: inbox.data?.unreadCount,
    },
    { id: 'projects', label: 'Projects', icon: FolderKanban, href: `/${workspace.slug}/projects` },
  ]
  return (
    <OpenWorkspaceSearch value={() => setSearchOpen(true)}>
      <div className="flex min-h-screen bg-bg text-text">
        <nav
          aria-label="Workspace navigation"
          className="hidden w-60 shrink-0 flex-col border-r border-border bg-bg-subtle p-3 md:flex"
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
                  to: `/${item.slug}${active === 'members' ? '/members' : active === 'projects' ? '/projects' : active === 'my-tasks' ? '/my-tasks' : active === 'inbox' ? '/inbox' : active === 'settings' ? '/settings' : active === 'account' ? '/account' : ''}`,
                }),
            }))}
          />
          <Button
            variant="secondary"
            icon={Search}
            onClick={() => setSearchOpen(true)}
            className="mt-3 justify-start font-normal"
          >
            Search
            <kbd className="ml-auto font-sans text-caption text-text-muted">⌘K</kbd>
          </Button>
          {navigation.slice(0, 3).map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              icon={item.icon}
              aria-current={active === item.id ? 'page' : undefined}
              className={`${item.id === 'home' ? 'mt-3 ' : ''}justify-start font-normal ${active === item.id ? '!bg-accent-subtle !text-accent' : ''}`}
              onClick={() => void navigate({ to: item.href })}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="ml-auto text-caption text-text-muted">{item.count}</span>
              ) : null}
            </Button>
          ))}
          <p className="mt-6 px-2 text-caption text-text-muted">Starred</p>
          {starred.data?.projects.length ? (
            starred.data.projects.map((project) => (
              <Link
                key={project.id}
                to="/$ws/projects/$projectId"
                params={{ ws: workspace.slug, projectId: project.id }}
                className="flex items-center gap-2 rounded-control px-1 py-2 text-ui hover:bg-bg-muted"
              >
                <Icon icon={Folder} className="shrink-0 text-text-muted" />
                <span className="truncate">{project.name}</span>
              </Link>
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
          <Button
            variant="ghost"
            icon={Settings}
            aria-current={active === 'settings' ? 'page' : undefined}
            className={`justify-start font-normal ${active === 'settings' ? '!bg-accent-subtle !text-accent' : ''}`}
            onClick={() => void navigate({ to: `/${workspace.slug}/settings` })}
          >
            Settings
          </Button>
          <div
            className={`mt-auto flex items-center gap-2 border-t border-border px-1 pt-3 ${active === 'account' ? 'bg-accent-subtle' : ''}`}
          >
            <Avatar id={me.user.id} name={displayName} image={me.user.image} />
            <span className="min-w-0 flex-1 truncate">{displayName}</span>
            <Menu
              label="Account"
              iconOnly
              items={[
                {
                  label: 'Account settings',
                  icon: UserRound,
                  onSelect: () => void navigate({ to: `/${workspace.slug}/account` }),
                },
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
        <main className="min-w-0 flex-1 pb-19 md:pb-0">{children}</main>
        <MobileTabs
          className="fixed inset-x-0 bottom-0 z-30 md:hidden"
          active={active}
          items={navigation.map((item) => ({
            ...item,
            count: item.id === 'inbox' ? item.count : undefined,
            onSelect: () => void navigate({ to: item.href }),
          }))}
        />
        <WorkspaceSearch
          workspace={workspace}
          userId={me.user.id}
          open={searchOpen}
          setOpen={setSearchOpen}
        />
      </div>
    </OpenWorkspaceSearch>
  )
}
