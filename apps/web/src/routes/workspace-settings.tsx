import { validWorkspaceName, validWorkspaceSlug } from '@planfrojex/api/rules'
import { useQuery } from '@tanstack/react-query'
import { createRoute, useLoaderData, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, call, RequestError } from '../api'
import { getMe, queryClient } from '../session'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'
import { EmptyState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { ToastRegion } from '../ui/toast'
import { UrlInput } from '../ui/url-input'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

function WorkspaceSettings() {
  const { workspace, me } = useLoaderData({ from: '/$ws/settings' })
  const navigate = useNavigate()
  const router = useRouter()
  const owner = workspace.role === 'owner'
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [slugError, setSlugError] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState('')
  const save = useAction()
  const remove = useAction()
  const projects = useQuery({
    queryKey: ['projects', workspace.slug, 'settings-count'],
    enabled: owner && !workspace.isPersonal,
    queryFn: () =>
      call(
        api.workspaces[':ws'].projects.$get({
          param: { ws: workspace.slug },
          query: { limit: '1' },
        }),
      ),
  })
  const projectCount = projects.data?.counts.all
  const changed = name.trim() !== workspace.name || slug !== workspace.slug
  return (
    <WorkspaceShell workspace={workspace} me={me} active="settings">
      <header className="flex h-14 items-center border-b border-border px-8">
        <h1 className="text-title font-semibold">Settings</h1>
      </header>
      <div className="space-y-8 px-8 pb-8 pt-6">
        <section aria-labelledby="settings-general">
          <h2 id="settings-general" className="font-semibold">
            General
          </h2>
          <form
            className="mt-6 max-w-160"
            onSubmit={save.submit(async () => {
              setSlugError('')
              setMessage(null)
              if (!validWorkspaceName(name.trim(), 60))
                throw new UserError(
                  'Use a workspace name between 1 and 60 characters, without links.',
                )
              if (!validWorkspaceSlug(slug)) {
                setSlugError(
                  'Use 3–40 lowercase letters, numbers or dashes. Choose an unreserved URL.',
                )
                return
              }
              let updated: { workspace: typeof workspace }
              try {
                const result = await call(
                  api.workspaces[':ws'].$patch({
                    param: { ws: workspace.slug },
                    json: {
                      ...(name.trim() !== workspace.name ? { name: name.trim() } : {}),
                      ...(slug !== workspace.slug ? { slug } : {}),
                    },
                  }),
                )
                updated = result
              } catch (error) {
                if (error instanceof RequestError && error.status === 409) {
                  setSlugError('That URL is taken')
                  return
                }
                if (error instanceof RequestError && error.status === 400)
                  throw new UserError('Check the workspace name and URL, then try again.')
                throw error
              }
              await queryClient.invalidateQueries({ queryKey: ['me'] })
              await queryClient.invalidateQueries({ queryKey: ['workspace', workspace.slug] })
              const newSlug = updated.workspace.slug
              if (newSlug !== workspace.slug) await navigate({ to: `/${newSlug}/settings` })
              else await router.invalidate()
              setName(updated.workspace.name)
              setSlug(newSlug)
              setMessage('Workspace saved')
            })}
          >
            <div>
              <label htmlFor="settings-name" className="mb-1 block">
                Workspace name
              </label>
              <Input
                id="settings-name"
                required
                maxLength={60}
                value={name}
                readOnly={!owner}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="mt-3">
              <label htmlFor="settings-slug" className="mb-1 block">
                Workspace URL
              </label>
              <UrlInput
                id="settings-slug"
                required
                minLength={3}
                maxLength={40}
                value={slug}
                readOnly={!owner}
                aria-invalid={slugError ? true : undefined}
                aria-describedby={
                  slugError ? 'settings-slug-error settings-slug-hint' : 'settings-slug-hint'
                }
                onChange={(event) => {
                  setSlug(event.target.value)
                  setSlugError('')
                }}
              />
              <p id="settings-slug-hint" className="mt-1 text-caption text-text-muted">
                Changing the URL breaks links people have saved.
              </p>
              {slugError ? (
                <p id="settings-slug-error" role="alert" className="mt-1 text-caption text-danger">
                  {slugError}
                </p>
              ) : null}
            </div>
            {owner ? (
              <Button type="submit" disabled={!changed || save.busy} className="mt-3">
                {save.busy ? 'Saving…' : 'Save changes'}
              </Button>
            ) : null}
            <ActionError error={save.error} />
          </form>
        </section>
        <section aria-labelledby="settings-share-links">
          <h2 id="settings-share-links" className="font-semibold">
            Share links
          </h2>
          <p className="mb-2 text-text-muted">
            Anyone with a link can read that project. Revoking a link stops it working immediately.
          </p>
          <EmptyState title="No share links yet" body="Shared project links will appear here." />
        </section>
        {owner && !workspace.isPersonal ? (
          <section
            aria-labelledby="settings-delete"
            className="flex items-center justify-between gap-6 rounded-panel border border-border px-5 py-4"
          >
            <div>
              <h2 id="settings-delete" className="font-semibold">
                Delete workspace
              </h2>
              <p className="text-caption text-text-muted">
                {projectCount === undefined
                  ? 'Deletes this workspace and its projects, tasks, diagrams and comments for every member.'
                  : `Deletes all ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}, their tasks, diagrams and comments for every member.`}{' '}
                This can't be undone.
              </p>
              {projects.isError ? (
                <p role="alert" className="mt-1 text-danger">
                  Couldn’t load the project count.{' '}
                  <Button size="sm" onClick={() => void projects.refetch()}>
                    Retry
                  </Button>
                </p>
              ) : null}
            </div>
            <Button
              variant="danger"
              className="shrink-0"
              disabled={projectCount === undefined}
              onClick={() => {
                setConfirm('')
                setDeleting(true)
              }}
            >
              Delete workspace
            </Button>
          </section>
        ) : null}
      </div>
      {deleting ? (
        <Dialog
          open
          title="Delete workspace"
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Button disabled={remove.busy} onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button
                variant="danger-fill"
                disabled={confirm !== workspace.name || remove.busy}
                onClick={() =>
                  void remove.run(async () => {
                    await call(
                      api.workspaces[':ws'].$delete({
                        param: { ws: workspace.slug },
                        json: { confirm },
                      }),
                    )
                    await queryClient.invalidateQueries({ queryKey: ['me'] })
                    queryClient.removeQueries({ queryKey: ['workspace', workspace.slug] })
                    const fresh = await getMe()
                    const next = fresh.workspaces[0]
                    localStorage.removeItem('lastWorkspace')
                    await navigate({ to: next ? `/${next.slug}` : '/onboarding' })
                  })
                }
              >
                {remove.busy ? 'Deleting…' : 'Delete workspace'}
              </Button>
            </>
          }
        >
          <p>
            Delete {workspace.name} and all {projectCount}{' '}
            {projectCount === 1 ? 'project' : 'projects'}, including their tasks, diagrams and
            comments for every member. This can't be undone.
          </p>
          <label htmlFor="delete-workspace-confirm" className="mb-1 mt-4 block text-text">
            Type <strong>{workspace.name}</strong> to confirm.
          </label>
          <Input
            id="delete-workspace-confirm"
            autoComplete="off"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <ActionError error={remove.error} />
        </Dialog>
      ) : null}
      <ToastRegion message={message} />
    </WorkspaceShell>
  )
}

export const workspaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/settings',
  remountDeps: ({ params }) => ({ workspace: params.ws }),
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: WorkspaceSettings,
})
