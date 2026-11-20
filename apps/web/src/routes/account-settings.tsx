import { createRoute, useLoaderData, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, call, RequestError } from '../api'
import { queryClient } from '../session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Dialog } from '../ui/dialog'
import { Input } from '../ui/input'
import { OtpInput } from '../ui/otp-input'
import { Select } from '../ui/select'
import { Tabs } from '../ui/tabs'
import { ToastRegion } from '../ui/toast'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { WorkspaceShell } from '../workspace-shell'
import { rootRoute } from './root'
import { loadWorkspace, WorkspaceError } from './workspace'

const notificationRows = [
  { type: 'mention', label: 'Someone mentions you' },
  { type: 'assigned', label: 'A task is assigned to you' },
  { type: 'draft_ready', label: 'A plan draft is ready to review' },
  { type: 'drift', label: 'The plan drifts from the work' },
  { type: 'weekly_summary', label: 'Weekly status summary' },
] as const
type NotificationSetting = {
  type: (typeof notificationRows)[number]['type']
  email: boolean
  inApp: boolean
}

function AccountSettings() {
  const { workspace, me, preferences } = useLoaderData({ from: '/$ws/account' })
  const navigate = useNavigate()
  const router = useRouter()
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [name, setName] = useState(me.user.name)
  const [timezone, setTimezone] = useState(me.user.timezone ?? browserZone)
  const [image, setImage] = useState(me.user.image)
  const [savedProfile, setSavedProfile] = useState({
    name: me.user.name,
    timezone: me.user.timezone ?? browserZone,
    image: me.user.image,
  })
  const [settings, setSettings] = useState<NotificationSetting[]>(preferences.settings)
  const [savedSettings, setSavedSettings] = useState<NotificationSetting[]>(preferences.settings)
  const [tab, setTab] = useState('profile')
  const [message, setMessage] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [blockers, setBlockers] = useState<{ id: string; name: string; slug: string }[]>([])
  const save = useAction(),
    email = useAction(),
    remove = useAction()
  const profileChanged =
    name.trim() !== savedProfile.name ||
    timezone !== savedProfile.timezone ||
    image !== savedProfile.image
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(savedSettings)
  const dirty = profileChanged || settingsChanged
  const timezones = [...new Set([timezone, ...Intl.supportedValuesOf('timeZone')])].sort()
  return (
    <WorkspaceShell workspace={workspace} me={me} active="account">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border px-4 pt-3.5 md:px-8">
          <h1 className="text-title font-semibold">Your account</h1>
          <div className="mt-2">
            <Tabs
              tabs={[
                { id: 'profile', label: 'Profile' },
                { id: 'notifications', label: 'Notifications' },
              ]}
              value={tab}
              onChange={(next) => {
                setTab(next)
                document
                  .getElementById(`account-${next}`)
                  ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }}
            />
          </div>
        </header>
        <div className="px-4 md:px-8">
          <section
            id="account-profile"
            aria-labelledby="account-profile-title"
            className="grid gap-8 border-b border-border py-6.5 md:grid-cols-[276px_minmax(0,520px)]"
          >
            <div>
              <h2 id="account-profile-title" className="font-semibold">
                Profile
              </h2>
              <p className="mt-1 max-w-65 text-caption text-text-muted">
                How teammates see you in comments, tasks and the activity log.
              </p>
            </div>
            <div>
              <div className="flex h-14 items-center gap-4">
                <Avatar
                  id={me.user.id}
                  name={name || me.user.name}
                  image={image}
                  className="!size-14 !text-body"
                />
                <Button variant="ghost" disabled={!image} onClick={() => setImage(null)}>
                  Remove
                </Button>
              </div>
              <div className="mt-4">
                <label htmlFor="account-name" className="mb-1 block">
                  Full name
                </label>
                <Input
                  id="account-name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="mt-4">
                <label htmlFor="account-email" className="mb-1 block">
                  Email
                </label>
                <div className="flex gap-2">
                  <Input id="account-email" readOnly value={me.user.email} />
                  <Button
                    onClick={() => {
                      setNewEmail('')
                      setCodeSent(false)
                      setCode('')
                      setEmailOpen(true)
                    }}
                  >
                    Change
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <label htmlFor="account-timezone" className="mb-1 block">
                  Time zone
                </label>
                <Select
                  id="account-timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </section>
          <section
            id="account-notifications"
            aria-labelledby="account-notifications-title"
            className="grid gap-8 border-b border-border pb-5 pt-7.5 md:grid-cols-[276px_minmax(0,520px)]"
          >
            <div>
              <h2 id="account-notifications-title" className="font-semibold">
                Notifications
              </h2>
              <p className="mt-1 max-w-65 text-caption text-text-muted">
                Where PlanFrojex tells you about things that need you.
              </p>
            </div>
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col />
                <col className="w-18" />
                <col className="w-18" />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Notification</span>
                  </th>
                  <th className="pb-2 text-center text-caption font-normal text-text-muted">
                    Email
                  </th>
                  <th className="pb-2 text-center text-caption font-normal text-text-muted">
                    In app
                  </th>
                </tr>
              </thead>
              <tbody>
                {notificationRows.map((row) => {
                  const setting = settings.find((value) => value.type === row.type)
                  return (
                    <tr key={row.type}>
                      <td className="h-8.5">{row.label}</td>
                      {(['email', 'inApp'] as const).map((channel) => (
                        <td key={channel} className="text-center">
                          <Checkbox
                            aria-label={`${row.label}: ${channel === 'email' ? 'Email' : 'In app'}`}
                            checked={setting?.[channel] ?? false}
                            onChange={(event) =>
                              setSettings((current) =>
                                current.map((value) =>
                                  value.type === row.type
                                    ? { ...value, [channel]: event.target.checked }
                                    : value,
                                ),
                              )
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          <section
            aria-labelledby="account-delete-title"
            className="grid gap-8 border-b border-border pb-6.5 pt-7.5 md:grid-cols-[276px_minmax(0,520px)]"
          >
            <div>
              <h2 id="account-delete-title" className="font-semibold">
                Delete account
              </h2>
              <p className="mt-1 max-w-65 text-caption text-text-muted">
                Removes your profile. Projects you own move to another owner first.
              </p>
            </div>
            <div>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm('')
                  setBlockers([])
                  setDeleting(true)
                }}
              >
                Delete my account
              </Button>
            </div>
          </section>
        </div>
        <form
          className="mt-auto flex items-center justify-end gap-4 border-t border-border px-4 pb-12 pt-3 md:px-8"
          onSubmit={save.submit(async () => {
            setMessage(null)
            if (!name.trim() || name.trim().length > 80)
              throw new UserError('Use a full name between 1 and 80 characters.')
            if (profileChanged) {
              await call(
                api.me.$patch({
                  json: {
                    ...(name.trim() !== savedProfile.name ? { name: name.trim() } : {}),
                    ...(timezone !== savedProfile.timezone ? { timezone } : {}),
                    ...(image !== savedProfile.image ? { image: null } : {}),
                  },
                }),
              )
              setSavedProfile({ name: name.trim(), timezone, image })
              setName(name.trim())
            }
            if (settingsChanged) {
              await call(api.me['notification-settings'].$put({ json: { settings } }))
              setSavedSettings(settings)
            }
            await queryClient.invalidateQueries({ queryKey: ['me'] })
            await router.invalidate()
            setMessage('Account saved')
          })}
        >
          <ActionError error={save.error} />
          <Button type="submit" variant="primary" disabled={!dirty || save.busy}>
            {save.busy ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </div>
      {emailOpen ? (
        <Dialog
          open
          title="Change email"
          onClose={() => setEmailOpen(false)}
          footer={
            <Button
              variant="primary"
              disabled={email.busy || (codeSent && code.length !== 6)}
              onClick={() =>
                void email.run(async () => {
                  if (!codeSent) {
                    try {
                      await call(
                        api.me.email.start.$post({
                          json: { email: newEmail.trim().toLowerCase() },
                        }),
                      )
                    } catch (error) {
                      if (error instanceof RequestError && error.status === 409)
                        throw new UserError('That email is already in use')
                      throw error
                    }
                    setCodeSent(true)
                  } else {
                    try {
                      await call(api.me.email.verify.$post({ json: { code } }))
                    } catch (error) {
                      setCode('')
                      throw error
                    }
                    await queryClient.invalidateQueries({ queryKey: ['me'] })
                    await router.invalidate()
                    setEmailOpen(false)
                    setMessage('Email changed')
                  }
                })
              }
            >
              {email.busy ? 'Please wait…' : codeSent ? 'Verify email' : 'Send code'}
            </Button>
          }
        >
          {codeSent ? (
            <>
              <p className="mb-4">
                We sent a 6-digit code to {newEmail}. It expires in 10 minutes.
              </p>
              <OtpInput
                value={code}
                onChange={setCode}
                invalid={!!email.error}
                describedBy="change-email-error"
              />
            </>
          ) : (
            <>
              <label htmlFor="account-new-email" className="mb-1 block text-text">
                New email
              </label>
              <Input
                id="account-new-email"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
            </>
          )}
          <ActionError error={email.error} id="change-email-error" />
        </Dialog>
      ) : null}
      {deleting ? (
        <Dialog
          open
          title="Delete account"
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Button onClick={() => setDeleting(false)} disabled={remove.busy}>
                Cancel
              </Button>
              <Button
                variant="danger-fill"
                disabled={confirm !== 'delete' || remove.busy}
                onClick={() =>
                  void remove.run(async () => {
                    const response = await api.me.$delete({ json: { confirm: 'delete' } })
                    if (response.status === 409) {
                      const result = await response.json()
                      setBlockers(result.workspaces)
                      return
                    }
                    await call(response)
                    queryClient.clear()
                    localStorage.removeItem('lastWorkspace')
                    sessionStorage.removeItem('displayName')
                    await navigate({ to: '/sign-in' })
                  })
                }
              >
                {remove.busy ? 'Deleting…' : 'Delete account'}
              </Button>
            </>
          }
        >
          <p>
            This removes your profile and your personal workspaces. Your comments in shared
            workspaces stay as Deleted user. This can't be undone.
          </p>
          {blockers.length ? (
            <div role="alert" className="mt-4 text-danger">
              <p>Make someone else owner first</p>
              <ul className="mt-2 list-inside list-disc">
                {blockers.map((item) => (
                  <li key={item.id}>{item.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <label htmlFor="account-delete-confirm" className="mb-1 mt-4 block text-text">
            Type <strong>delete</strong> to confirm.
          </label>
          <Input
            id="account-delete-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
          />
          <ActionError error={remove.error} />
        </Dialog>
      ) : null}
      <ToastRegion message={message} />
    </WorkspaceShell>
  )
}

export const accountSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$ws/account',
  remountDeps: ({ params }) => ({ workspace: params.ws }),
  loader: async ({ params }) => ({
    ...(await loadWorkspace(params.ws)),
    preferences: await call(api.me['notification-settings'].$get()),
  }),
  errorComponent: ({ error }) => <WorkspaceError error={error} />,
  component: AccountSettings,
})
