import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, CheckCircle2 } from 'lucide-react'
import { call, type TrackerIntegration as Integration, integrationsClient } from './api'
import { queryClient } from './session'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { EmptyState } from './ui/empty-state'
import { Icon } from './ui/icon'
import { Select } from './ui/select'
import { type Status, StatusLabel } from './ui/status'
import { ActionError, useAction } from './use-action'

type OptionKey = keyof Integration['options']
type MappingKey = keyof Integration['statusMapping']
const options: { key: OptionKey; title: string; detail: string }[] = [
  {
    key: 'pushMilestones',
    title: 'Push accepted milestones as Linear projects',
    detail: 'Tasks become issues with the same owner and due date.',
  },
  {
    key: 'pullStatus',
    title: 'Pull issue status back into the plan',
    detail: 'Done issues complete tasks. Used for drift detection.',
  },
  {
    key: 'importIssues',
    title: 'Create tasks for new Linear issues',
    detail: 'Issues added in Linear show up as tasks outside the plan.',
  },
]
const mappings: { key: MappingKey; status: Status; label: string }[] = [
  { key: 'planning', status: 'planning', label: 'Planning' },
  { key: 'in_progress', status: 'in-progress', label: 'In progress' },
  { key: 'completed', status: 'completed', label: 'Completed' },
  { key: 'archived', status: 'archived', label: 'Archived' },
]
function syncedLabel(value: string | null) {
  if (!value) return 'Not synced yet'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  return `Synced ${minutes} min ago`
}

export function IntegrationsSettings({ slug }: { slug: string }) {
  const queryKey = ['integrations', slug]
  const integrations = useQuery({
    queryKey,
    queryFn: () =>
      call(integrationsClient.workspaces[':ws'].integrations.$get({ param: { ws: slug } })),
  })
  const action = useAction()
  const authorizationFailed = new URLSearchParams(window.location.search).has('integrationError')
  const integration = integrations.data?.integration
  const update = (input: {
    options?: Partial<Integration['options']>
    statusMapping?: Partial<Integration['statusMapping']>
  }) => {
    if (!integration) return
    queryClient.setQueryData(
      queryKey,
      (current: typeof integrations.data) =>
        current && {
          ...current,
          integration: {
            ...integration,
            options: { ...integration.options, ...input.options },
            statusMapping: { ...integration.statusMapping, ...input.statusMapping },
          },
        },
    )
    void action.run(async () => {
      try {
        const result = await call(
          integrationsClient.integrations[':id'].$patch({
            param: { id: integration.id },
            json: input,
          }),
        )
        queryClient.setQueryData(
          queryKey,
          (current: typeof integrations.data) =>
            current && { ...current, integration: result.integration },
        )
      } catch (error) {
        await integrations.refetch()
        throw error
      }
    })
  }
  return (
    <section aria-label="Integrations" className="space-y-5">
      {authorizationFailed ? (
        <p role="alert" className="text-danger">
          Couldn’t connect Linear. Please try again.
        </p>
      ) : null}
      <div>
        <h2 className="font-semibold">Keep using your tracker. PlanFrojex keeps the plan.</h2>
        <p className="mt-1 text-text-muted">
          Accepted milestones go out as issues. Progress comes back, so the plan can tell you when
          it drifts.
        </p>
      </div>
      {integrations.isPending ? (
        <p role="status" className="text-text-muted">
          Loading integrations…
        </p>
      ) : integrations.isError ? (
        <EmptyState
          title="Couldn’t load integrations"
          body="Try again to see your integrations."
          action={<Button onClick={() => void integrations.refetch()}>Try again</Button>}
        />
      ) : (
        <div className="rounded-panel border border-border">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-panel bg-accent text-on-accent font-semibold"
            >
              L
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">Linear</h3>
              <p className="break-words text-caption text-text-muted">
                {!integrations.data.configured
                  ? 'Linear is not set up'
                  : integration
                    ? `Connected to ${integration.name}`
                    : 'Connect your Linear workspace.'}
              </p>
            </div>
            {integration ? (
              <div className="flex flex-wrap items-center gap-3">
                {integrations.data.configured ? (
                  <span className="inline-flex items-center gap-1 text-caption text-text-muted">
                    <Icon icon={CheckCircle2} className="text-success" />
                    {syncedLabel(integration.lastSyncedAt)}
                  </span>
                ) : null}
                <Button
                  disabled={action.busy || !integrations.data.configured}
                  onClick={() =>
                    void action.run(async () => {
                      const result = await call(
                        integrationsClient.integrations[':id'].sync.$post({
                          param: { id: integration.id },
                        }),
                      )
                      queryClient.setQueryData(
                        queryKey,
                        (current: typeof integrations.data) =>
                          current && { ...current, integration: result.integration },
                      )
                    })
                  }
                >
                  Sync now
                </Button>
                <Button
                  variant="ghost"
                  className="!text-danger"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await call(
                        integrationsClient.integrations[':id'].$delete({
                          param: { id: integration.id },
                        }),
                      )
                      await integrations.refetch()
                    })
                  }
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                disabled={action.busy || !integrations.data.configured}
                onClick={() =>
                  void action.run(async () => {
                    const result = await call(
                      integrationsClient.workspaces[':ws'].integrations[':provider'].connect.$post({
                        param: { ws: slug, provider: 'linear' },
                      }),
                    )
                    window.location.assign(result.authorizationUrl)
                  })
                }
              >
                Connect Linear
              </Button>
            )}
          </div>
          {integration ? (
            <div className="grid gap-6 border-t border-border px-5 py-4 md:grid-cols-2">
              <div>
                <h4 className="mb-2 font-mono text-caption uppercase text-text-faint">Sync</h4>
                <div className="space-y-3">
                  {options.map((option) => (
                    <label
                      key={option.key}
                      htmlFor={`integration-${option.key}`}
                      className="flex min-h-11 cursor-pointer items-start gap-2"
                    >
                      <Checkbox
                        id={`integration-${option.key}`}
                        checked={integration.options[option.key]}
                        disabled={action.busy || !integrations.data.configured}
                        onChange={(event) =>
                          update({ options: { [option.key]: event.target.checked } })
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium">{option.title}</span>
                        <span className="block text-caption text-text-muted">{option.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-2 font-mono text-caption uppercase text-text-faint">
                  Status mapping
                </h4>
                {mappings.map((mapping) => (
                  <div
                    key={mapping.key}
                    className="flex min-h-11 min-w-0 items-center gap-2 border-b border-border"
                  >
                    <div className="min-w-0 flex-1">
                      <StatusLabel status={mapping.status} />
                    </div>
                    <Icon icon={ArrowLeftRight} className="shrink-0 text-text-muted" />
                    <Select
                      aria-label={`${mapping.label} Linear state`}
                      className="min-h-11 w-36 max-w-full md:min-h-0 md:w-50"
                      disabled={action.busy || !integrations.data.configured}
                      value={integration.statusMapping[mapping.key] ?? ''}
                      onChange={(event) =>
                        update({ statusMapping: { [mapping.key]: event.target.value || null } })
                      }
                    >
                      <option value="">Not mapped</option>
                      {integration.states.map((state) => (
                        <option
                          key={state.id}
                          value={state.id}
                          disabled={Object.entries(integration.statusMapping).some(
                            ([key, value]) => key !== mapping.key && value === state.id,
                          )}
                        >
                          {state.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      <ActionError error={action.error} />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { name: 'GitHub', detail: 'Link pull requests to tasks. Merged PRs complete them.' },
          { name: 'Jira', detail: 'Two-way sync with a Jira project.' },
          { name: 'Slack', detail: 'Post accepted drafts and drift alerts to a channel.' },
        ].map((provider) => (
          <div key={provider.name} className="rounded-panel border border-border p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-panel bg-bg-muted font-semibold"
              >
                {provider.name[0]}
              </span>
              <div>
                <h3 className="font-semibold">{provider.name}</h3>
                <p className="text-caption text-text-muted">Coming soon</p>
              </div>
            </div>
            <p className="mt-4 text-caption text-text-muted">{provider.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
