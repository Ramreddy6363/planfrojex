import { useQuery } from '@tanstack/react-query'
import { createRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, call, RequestError } from '../api'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'
import { EmailListInput } from '../ui/email-list-input'
import { EmptyState } from '../ui/empty-state'
import { Menu } from '../ui/menu'
import { Select } from '../ui/select'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

type Confirmation = { kind: 'remove' | 'revoke'; id: string; name: string }
const parseEmails = (text: string) => [
  ...new Set(
    text
      .split(/[\n,]+/)
      .map((email) => email.trim())
      .filter(Boolean),
  ),
]

function Members() {
  const { workspace, me } = useLoaderData({ from: '/$ws/members' })
  const router = useRouter()
  const owner = workspace.role === 'owner'
  const slug = workspace.slug
  const [inviteOpen, setInviteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [emails, setEmails] = useState('')
  const [emailChips, setEmailChips] = useState<string[]>([])
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const action = useAction()
  const members = useQuery({
    queryKey: ['members', slug],
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: slug } })),
  })
  const invitations = useQuery({
    queryKey: ['invites', slug],
    enabled: owner,
    queryFn: () => call(api.workspaces[':ws'].invites.$get({ param: { ws: slug } })),
  })
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members', slug] }),
      queryClient.invalidateQueries({ queryKey: ['invites', slug] }),
    ])
  }
  const list = members.data?.members ?? []
  const ownerCount = list.filter((member) => member.role === 'owner').length
  const emailList = [...new Set([...emailChips, ...parseEmails(emails)])]
  return (
    <WorkspaceShell workspace={workspace} me={me} active="members">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <h1 className="text-title font-semibold">Members</h1>
        {owner && (
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            Invite people
          </Button>
        )}
      </header>
      <div className="space-y-8 p-8">
        {members.isPending ? (
          <p>Loading members…</p>
        ) : members.isError ? (
          <EmptyState
            title="Couldn’t load members"
            body="Try again to see this workspace’s members."
            action={<Button onClick={() => void members.refetch()}>Retry</Button>}
          />
        ) : (
          <section aria-label="Workspace members">
            <h2 className="mb-3 font-semibold">
              {list.length} {list.length === 1 ? 'member' : 'members'}
            </h2>
            {list.length === 0 ? (
              <EmptyState title="No members" body="Members will appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-ui">
                  <thead className="bg-bg-subtle text-text-muted">
                    <tr>
                      <th className="p-3 font-normal">Name</th>
                      <th className="p-3 font-normal">Role</th>
                      <th className="p-3 font-normal">Projects</th>
                      <th className="p-3 font-normal">Last active</th>
                      <th className="p-3 font-normal">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((member) => (
                      <tr key={member.id} className="border-b border-border">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <Avatar id={member.id} name={member.name} />
                            <div>
                              <p className="font-medium">
                                {member.name}
                                {member.id === me.user.id ? ' (you)' : ''}
                              </p>
                              <p className="text-caption text-text-muted">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          {owner && !(member.role === 'owner' && ownerCount === 1) ? (
                            <Select
                              aria-label={`Role for ${member.name}`}
                              value={member.role}
                              disabled={action.busy}
                              onChange={(event) =>
                                void action.run(async () => {
                                  try {
                                    await call(
                                      api.workspaces[':ws'].members[':userId'].$patch({
                                        param: { ws: slug, userId: member.id },
                                        json: {
                                          role: event.target.value as 'owner' | 'editor' | 'viewer',
                                        },
                                      }),
                                    )
                                  } catch (error) {
                                    if (error instanceof RequestError && error.status === 409)
                                      throw new UserError(
                                        'A workspace must have at least one owner.',
                                      )
                                    throw error
                                  }
                                  await refresh()
                                  if (member.id === me.user.id) await router.invalidate()
                                })
                              }
                            >
                              <option value="owner">Owner</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </Select>
                          ) : (
                            <span className="capitalize text-text-muted">{member.role}</span>
                          )}
                        </td>
                        <td className="p-3 text-text-muted">—</td>
                        <td className="p-3 text-text-muted">—</td>
                        <td className="p-3">
                          {owner && !(member.role === 'owner' && ownerCount === 1) && (
                            <Menu
                              label={`Actions for ${member.name}`}
                              iconOnly
                              items={[
                                {
                                  label: 'Remove member',
                                  icon: Trash2,
                                  danger: true,
                                  onSelect: () =>
                                    setConfirmation({
                                      kind: 'remove',
                                      id: member.id,
                                      name: member.name,
                                    }),
                                },
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {owner && (
          <section aria-label="Pending invites">
            <h2 className="font-semibold">Pending invites</h2>
            <p className="mt-1 text-caption text-text-muted">Invites expire after 7 days.</p>
            {invitations.isPending ? (
              <p className="mt-4">Loading invitations…</p>
            ) : invitations.isError ? (
              <EmptyState
                title="Couldn’t load invitations"
                body="Try again to see pending invitations."
                action={<Button onClick={() => void invitations.refetch()}>Retry</Button>}
              />
            ) : invitations.data?.invites.length === 0 ? (
              <p className="mt-4 text-text-muted">No pending invitations.</p>
            ) : (
              invitations.data?.invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-4 border-b border-border py-3"
                >
                  <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                  <span className="capitalize text-text-muted">{invite.role}</span>
                  <span className="text-caption text-text-muted">
                    Invited {new Date(invite.createdAt).toLocaleDateString()} by {invite.invitedBy}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await call(api.invites[':id'].resend.$post({ param: { id: invite.id } }))
                        await refresh()
                      })
                    }
                  >
                    Resend
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setConfirmation({ kind: 'revoke', id: invite.id, name: invite.email })
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))
            )}
          </section>
        )}
        {!inviteOpen && !confirmation && <ActionError error={action.error} />}
      </div>
      <Dialog
        open={inviteOpen}
        wide
        onClose={() => setInviteOpen(false)}
        title={`Invite people to ${workspace.name}`}
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={action.busy || emailList.length === 0}
              onClick={() =>
                void action.run(async () => {
                  if (emailList.length > 20)
                    throw new UserError('You can invite up to 20 people at a time.')
                  await call(
                    api.workspaces[':ws'].invites.$post({
                      param: { ws: slug },
                      json: { emails: emailList, role },
                    }),
                  )
                  setEmails('')
                  setEmailChips([])
                  setInviteOpen(false)
                  await refresh()
                })
              }
            >
              Send {emailList.length} {emailList.length === 1 ? 'invite' : 'invites'}
            </Button>
          </>
        }
      >
        <label htmlFor="invite-emails" className="mb-2 block text-text">
          Email addresses
        </label>
        <EmailListInput
          id="invite-emails"
          values={emailChips}
          onChange={setEmailChips}
          input={emails}
          onInputChange={setEmails}
        />
        <p className="mt-1 text-caption">Separate addresses with a comma or Enter.</p>
        <label htmlFor="invite-role" className="mb-2 mt-5 block text-text">
          Role
        </label>
        <Select
          id="invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </Select>
        <p className="mt-1 text-caption">
          Editors can change projects, plans and tasks. Viewers can read and comment.
        </p>
        <ActionError error={action.error} />
      </Dialog>
      <Dialog
        open={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        title={confirmation?.kind === 'remove' ? 'Remove member?' : 'Revoke invitation?'}
        footer={
          <>
            <Button onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button
              variant="danger-fill"
              disabled={action.busy}
              onClick={() =>
                confirmation &&
                void action.run(async () => {
                  if (confirmation.kind === 'remove')
                    await call(
                      api.workspaces[':ws'].members[':userId'].$delete({
                        param: { ws: slug, userId: confirmation.id },
                      }),
                    )
                  else await call(api.invites[':id'].$delete({ param: { id: confirmation.id } }))
                  const removedSelf =
                    confirmation.kind === 'remove' && confirmation.id === me.user.id
                  setConfirmation(null)
                  await refresh()
                  if (removedSelf) await router.invalidate()
                })
              }
            >
              {confirmation?.kind === 'remove' ? 'Remove member' : 'Revoke invitation'}
            </Button>
          </>
        }
      >
        {confirmation?.kind === 'remove'
          ? `Remove ${confirmation.name} from this workspace?`
          : `Revoke the invitation for ${confirmation?.name ?? ''}?`}
        <ActionError error={action.error} />
      </Dialog>
    </WorkspaceShell>
  )
}

export const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/members',
  loader: ({ params }) => loadWorkspace(params.ws),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: Members,
})
