import { useQuery } from '@tanstack/react-query'
import { Cpu, File, LayoutGrid, ShoppingCart, Smartphone, UserRound } from 'lucide-react'
import { useState } from 'react'
import { api, call } from './api'
import { queryClient } from './session'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Icon } from './ui/icon'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Textarea } from './ui/textarea'
import { ActionError, useAction } from './use-action'

type TemplateId = 'blank' | 'saas' | 'ml' | 'mobile' | 'commerce' | 'portfolio'
const templateIcons = {
  blank: File,
  saas: LayoutGrid,
  ml: Cpu,
  mobile: Smartphone,
  commerce: ShoppingCart,
  portfolio: UserRound,
}
export function NewProjectDialog({
  open,
  onClose,
  slug,
  userId,
}: {
  open: boolean
  onClose: () => void
  slug: string
  userId: string
}) {
  const [name, setName] = useState('')
  const [brief, setBrief] = useState('')
  const [leadId, setLeadId] = useState(userId)
  const [targetDate, setTargetDate] = useState('')
  const [template, setTemplate] = useState<TemplateId>('blank')
  const action = useAction()
  const templates = useQuery({
    queryKey: ['templates'],
    enabled: open,
    queryFn: () => call(api.templates.$get()),
  })
  const members = useQuery({
    queryKey: ['members', slug],
    enabled: open,
    queryFn: () => call(api.workspaces[':ws'].members.$get({ param: { ws: slug } })),
  })
  const submit = () =>
    void action.run(async () => {
      await call(
        api.workspaces[':ws'].projects.$post({
          param: { ws: slug },
          json: { name, brief, leadId, targetDate: targetDate || null, template },
        }),
      )
      await queryClient.invalidateQueries({ queryKey: ['projects', slug] })
      setName('')
      setBrief('')
      setTargetDate('')
      setTemplate('blank')
      setLeadId(userId)
      onClose()
    })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      extraWide
      sidebar={
        <section aria-label="Start from">
          <p className="px-2 py-2 text-caption text-text-muted">Start from</p>
          {templates.isPending ? (
            <p>Loading templates…</p>
          ) : templates.isError ? (
            <>
              <p>Couldn’t load templates.</p>
              <Button onClick={() => void templates.refetch()}>Retry</Button>
            </>
          ) : (
            templates.data.templates.map((item) => (
              <Button
                key={item.id}
                variant={template === item.id ? 'secondary' : 'ghost'}
                size="auto"
                aria-pressed={template === item.id}
                className="mb-1 flex w-full items-start justify-start gap-2 px-2 py-2 text-left"
                onClick={() => {
                  setTemplate(item.id)
                  setBrief(item.brief)
                }}
              >
                <Icon icon={templateIcons[item.id]} className="mt-1 shrink-0 text-text-muted" />
                <span className="flex flex-col items-start">
                  <span>{item.name}</span>
                  <span className="text-caption font-normal text-text-muted">
                    {item.description}
                  </span>
                </span>
              </Button>
            ))
          )}
        </section>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              action.busy || !name.trim() || !leadId || templates.isError || members.isError
            }
            onClick={submit}
          >
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-text">
        <div>
          <label htmlFor="project-name" className="mb-1 block">
            Name
          </label>
          <Input
            id="project-name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="project-brief" className="mb-1 block">
            Brief
          </label>
          <Textarea
            id="project-brief"
            value={brief}
            maxLength={20000}
            className="h-36"
            onChange={(e) => setBrief(e.target.value)}
          />
          <p className="mt-1 text-caption text-text-muted">
            You can draft a plan from the brief after the project is created.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="project-lead" className="mb-1 block">
              Lead
            </label>
            <Select
              id="project-lead"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              disabled={members.isPending || members.isError}
            >
              {members.data?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
            {members.isError && (
              <Button onClick={() => void members.refetch()}>Retry loading members</Button>
            )}
          </div>
          <div>
            <label htmlFor="project-date" className="mb-1 block">
              Target date
            </label>
            <Input
              id="project-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
        </div>
        <ActionError error={action.error} />
      </div>
    </Dialog>
  )
}
