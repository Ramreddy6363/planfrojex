import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Folder, House, Inbox, Plus, UsersRound } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, call } from './api'
import { NewProjectDialog } from './new-project-dialog'
import type { getWorkspace } from './session'
import { CommandPalette, type CommandPaletteGroup } from './ui/command-palette'
import { Icon } from './ui/icon'
import { type Status, StatusGlyph } from './ui/status'

type Workspace = Awaited<ReturnType<typeof getWorkspace>>['workspace']
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
export function WorkspaceSearch({
  workspace,
  userId,
  open,
  setOpen,
}: {
  workspace: Workspace
  userId: string
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [newProject, setNewProject] = useState(false)
  const prefix = useRef(0)
  const editable = workspace.role !== 'viewer'
  const shortcutState = useRef({
    open,
    newProject,
    editable,
    slug: workspace.slug,
    navigate,
    setOpen,
  })
  shortcutState.current = { open, newProject, editable, slug: workspace.slug, navigate, setOpen }
  const close = () => setOpen(false)
  const go = (path: string) => {
    close()
    void navigate({ to: `/${workspace.slug}${path}` })
  }
  const create = () => {
    close()
    setNewProject(true)
  }
  useEffect(() => {
    if (open) {
      setQuery('')
      setDebounced('')
    }
  }, [open])
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query.trim()), 150)
    return () => clearTimeout(timeout)
  }, [query])
  useLayoutEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const state = shortcutState.current
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        state.setOpen(!state.open)
        return
      }
      if (
        state.open ||
        state.newProject ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat ||
        editableTarget(event.target) ||
        document.querySelector('dialog[open]')
      ) {
        prefix.current = 0
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'g') {
        prefix.current = Date.now()
        return
      }
      if (prefix.current && Date.now() - prefix.current < 2000) {
        prefix.current = 0
        const path = (
          { h: '', t: '/my-tasks', i: '/inbox', p: '/projects', m: '/members' } as Record<
            string,
            string
          >
        )[key]
        if (path !== undefined) {
          event.preventDefault()
          state.setOpen(false)
          void state.navigate({ to: `/${state.slug}${path}` })
        }
        return
      }
      prefix.current = 0
      if (key === 'c' && state.editable) {
        event.preventDefault()
        state.setOpen(false)
        setNewProject(true)
      }
    }
    document.addEventListener('keydown', listener)
    document.documentElement.dataset.shortcutsReady = 'true'
    return () => {
      document.removeEventListener('keydown', listener)
      delete document.documentElement.dataset.shortcutsReady
    }
  }, [])
  useLayoutEffect(() => {
    document.documentElement.dataset.shortcutsRoute = pathname
    return () => {
      delete document.documentElement.dataset.shortcutsRoute
    }
  }, [pathname])
  const search = useQuery({
    queryKey: ['search', workspace.slug, debounced],
    enabled: open && debounced.length > 0,
    queryFn: () =>
      call(
        api.workspaces[':ws'].search.$get({
          param: { ws: workspace.slug },
          query: { q: debounced },
        }),
      ),
  })
  const recent = useQuery({
    queryKey: ['projects', workspace.slug, 'search-recent'],
    enabled: open && !debounced,
    queryFn: () =>
      call(
        api.workspaces[':ws'].projects.$get({
          param: { ws: workspace.slug },
          query: { limit: '5' },
        }),
      ),
  })
  const projects = debounced ? (search.data?.projects ?? []) : (recent.data?.projects ?? [])
  const tasks = debounced ? (search.data?.tasks ?? []) : []
  const commands = [
    ...(editable
      ? [{ id: 'create', label: 'Create project', shortcut: 'C', icon: Plus, run: create }]
      : []),
    { id: 'home', label: 'Go to Home', shortcut: 'G H', icon: House, run: () => go('') },
    {
      id: 'my-tasks',
      label: 'Go to My tasks',
      shortcut: 'G T',
      icon: ArrowRight,
      run: () => go('/my-tasks'),
    },
    { id: 'inbox', label: 'Go to Inbox', shortcut: 'G I', icon: Inbox, run: () => go('/inbox') },
    {
      id: 'projects',
      label: 'Go to Projects',
      shortcut: 'G P',
      icon: Folder,
      run: () => go('/projects'),
    },
    {
      id: 'members',
      label: 'Go to Members',
      shortcut: 'G M',
      icon: UsersRound,
      run: () => go('/members'),
    },
  ].filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()))
  const groups: CommandPaletteGroup[] = [
    {
      label: 'Projects',
      items: projects.map((project) => ({
        id: `project-${project.id}`,
        label: project.name,
        leading: <Icon icon={Folder} />,
        content: <span className="truncate">{project.name}</span>,
        trailing:
          project.status === 'in-progress'
            ? 'In progress'
            : project.status.charAt(0).toUpperCase() + project.status.slice(1),
        onSelect: () => go(`/projects/${project.id}`),
      })),
    },
    {
      label: 'Tasks',
      items: tasks.map((task) => ({
        id: `task-${task.id}`,
        label: `${task.key} ${task.title}`,
        leading: (
          <StatusGlyph
            status={
              (
                { todo: 'planning', in_progress: 'in-progress', done: 'completed' } as Record<
                  string,
                  Status
                >
              )[task.status] ?? 'planning'
            }
          />
        ),
        content: (
          <>
            <span className="shrink-0 font-mono text-caption text-text-muted">{task.key}</span>
            <span className="truncate">{task.title}</span>
          </>
        ),
        trailing: task.projectName,
        onSelect: () => go(`/projects/${task.projectId}/tasks?view=list&task=${task.id}`),
      })),
    },
    {
      label: 'Commands',
      items: commands.map((command) => ({
        id: command.id,
        label: command.label,
        leading: <Icon icon={command.icon} />,
        content: <span>{command.label}</span>,
        trailing: <kbd className="font-mono">{command.shortcut}</kbd>,
        onSelect: command.run,
      })),
    },
  ]
  const activeQuery = debounced ? search : recent
  return (
    <>
      <CommandPalette
        open={open}
        onClose={close}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        loading={activeQuery.isFetching || query.trim() !== debounced}
        error={activeQuery.isError ? 'Couldn’t search this workspace.' : undefined}
        onRetry={() => void activeQuery.refetch()}
      />
      {newProject ? (
        <NewProjectDialog
          open
          onClose={() => setNewProject(false)}
          slug={workspace.slug}
          userId={userId}
        />
      ) : null}
    </>
  )
}
