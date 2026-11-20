import {
  ArrowUpRight,
  ChevronDown,
  FolderKanban,
  House,
  Inbox,
  Search,
  Settings,
  Users,
} from 'lucide-react'
import { Avatar } from '../ui/avatar'
import { WorkspaceMark } from '../ui/brand'
import { Button } from '../ui/button'
import { Icon } from '../ui/icon'
import { Progress } from '../ui/progress'
import { StatusLabel } from '../ui/status'
import { Tabs } from '../ui/tabs'

const requirements = [
  'Customers sign in with email and SSO for enterprise accounts.',
  'Account owners update the card or bank account used for billing.',
  'Members with billing access download invoices as PDF.',
  'Account owners invite, remove and change teammate roles.',
  'Every change to billing details is recorded in an audit log.',
]

const tabs = [
  { id: 'brief', label: 'Brief' },
  { id: 'plan', label: 'Plan' },
  {
    id: 'tasks',
    label: (
      <>
        <span className="md:hidden">Tasks</span>
        <span className="hidden md:inline">Tasks 42</span>
      </>
    ),
  },
  {
    id: 'diagrams',
    label: (
      <>
        <span className="md:hidden">Diagrams</span>
        <span className="hidden md:inline">Diagrams 4</span>
      </>
    ),
  },
  { id: 'activity', label: 'Activity' },
]

export function ProductWindow() {
  return (
    <section
      aria-label="PlanFrojex product preview"
      className="relative mx-auto w-full max-w-[790px] overflow-hidden rounded-panel border border-border bg-bg shadow-xl"
    >
      <div className="grid min-h-[500px] grid-cols-1 md:grid-cols-[184px_minmax(0,1fr)]">
        <aside className="hidden flex-col border-r border-border bg-bg-subtle px-3 py-4 md:flex md:px-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <WorkspaceMark name="Northwind" />
            <span className="min-w-0 flex-1 truncate text-caption font-semibold">Northwind</span>
            <Icon icon={ChevronDown} className="text-text-faint" />
          </div>
          <div className="mt-3 rounded-control border border-border bg-bg px-2 py-1.5 text-caption text-text-muted">
            <Icon icon={Search} className="mr-1 inline-block" /> Search{' '}
            <span className="float-right font-mono">⌘K</span>
          </div>
          <div className="mt-4 space-y-1 text-caption text-text-muted">
            <div className="rounded-control px-2 py-1.5">
              <Icon icon={House} className="mr-1 inline-block" /> Home
            </div>
            <div className="rounded-control px-2 py-1.5">
              <Icon icon={FolderKanban} className="mr-1 inline-block" /> My tasks
            </div>
            <div className="rounded-control px-2 py-1.5">
              <Icon icon={Inbox} className="mr-1 inline-block" /> Inbox
            </div>
          </div>
          <p className="mb-1 mt-5 px-2 text-[11px] text-text-faint">Starred</p>
          <div className="rounded-control bg-accent-subtle px-2 py-2 text-caption font-medium text-text">
            <Icon icon={FolderKanban} className="mr-1.5 inline-block text-accent" /> Customer portal
            rebuild
          </div>
          <div className="rounded-control px-2 py-2 text-caption text-text-muted">
            <Icon icon={FolderKanban} className="mr-1.5 inline-block" /> Billing migration
          </div>
          <p className="mb-1 mt-5 px-2 text-[11px] text-text-faint">Workspace</p>
          <div className="rounded-control px-2 py-2 text-caption text-text-muted">
            <Icon icon={FolderKanban} className="mr-1 inline-block" /> Projects
          </div>
          <div className="rounded-control px-2 py-2 text-caption text-text-muted">
            <Icon icon={Users} className="mr-1 inline-block" /> Members
          </div>
          <div className="rounded-control px-2 py-2 text-caption text-text-muted">
            <Icon icon={Settings} className="mr-1 inline-block" /> Settings
          </div>
          <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
            <Avatar id="maya" name="Maya Chen" className="size-5" />
            <span className="truncate text-caption">Maya Chen</span>
          </div>
        </aside>

        <div className="min-w-0 bg-bg">
          <div className="flex items-center gap-2 border-b border-border bg-bg-subtle px-4 py-2 text-caption md:hidden">
            <WorkspaceMark name="Northwind" />
            <span className="font-medium">Northwind</span>
            <span aria-hidden="true" className="text-text-muted">
              ›
            </span>
            <span className="min-w-0 truncate text-text-muted">Customer portal rebuild</span>
          </div>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <div className="mb-2 flex items-center gap-2 text-caption text-text-muted">
              <span>Projects</span>
              <span aria-hidden="true">›</span>
              <span className="truncate text-text">Customer portal rebuild</span>
            </div>
            <h3 className="text-title font-semibold">Customer portal rebuild</h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-text-muted">
              <StatusLabel status="in-progress" />
              <span className="inline-flex items-center gap-1.5">
                <Avatar id="maya" name="Maya Chen" className="size-5" /> Maya Chen
              </span>
              <span>Due Dec 12</span>
              <span className="inline-flex items-center gap-2">
                <Progress value={43} label="Task progress" className="w-14" />
                <span className="font-mono">18/42 tasks</span>
              </span>
            </div>
          </div>

          <div className="border-b border-border px-4 sm:px-5 [&_[role=tablist]]:gap-2 [&_[role=tab]]:max-md:h-11">
            <Tabs tabs={tabs} value="plan" onChange={() => {}} readOnly />
          </div>

          <div className="border-b border-border px-4 py-3 text-caption text-text-muted sm:px-5">
            Last changed Oct 11 by Maya Chen
          </div>

          <div className="p-4 sm:p-5">
            <div className="mb-5 flex flex-wrap items-start gap-3 rounded-control border border-border bg-bg-subtle px-3 py-3 md:items-center">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-control border border-warning text-warning">
                <Icon icon={ArrowUpRight} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold text-text">
                  Draft from the brief is ready for review
                </p>
                <p className="mt-0.5 text-caption text-text-muted">
                  4 of 6 sections reviewed. Nothing changes until you accept a section.
                </p>
              </div>
              <div className="flex w-full justify-end gap-1 md:w-auto">
                <Button size="sm" variant="ghost" disabled>
                  Discard draft
                </Button>
                <Button size="sm" disabled>
                  Accept all
                </Button>
              </div>
            </div>

            <div className="mb-5 flex items-center justify-between">
              <h4 className="text-body font-semibold">Requirements</h4>
              <span className="font-mono text-caption text-text-muted">5</span>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {requirements.map((item, index) => (
                <div
                  key={item}
                  className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 py-3 text-caption"
                >
                  <span className="font-mono text-text-faint">R{index + 1}</span>
                  <span className="text-text">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 border-b border-border pb-2 text-caption font-semibold">
              User stories&nbsp; 3
            </div>
            <p className="mt-3 text-caption text-text-muted">
              As a customer, I can download an invoice without contacting support.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
