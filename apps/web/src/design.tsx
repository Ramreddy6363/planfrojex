import { CheckCircle2, FolderKanban, House, Inbox, Link, Pencil, Star, Trash2 } from 'lucide-react'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Avatar, AvatarStack } from './ui/avatar'
import { Brand, LogoMark, WorkspaceMark } from './ui/brand'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { CommandPalette } from './ui/command-palette'
import { DiagramCanvas } from './ui/diagram-canvas'
import { Dialog } from './ui/dialog'
import { EmailListInput } from './ui/email-list-input'
import { EmptyState } from './ui/empty-state'
import { Input } from './ui/input'
import { Menu } from './ui/menu'
import { MobileTabs } from './ui/mobile-tabs'
import { OtpInput } from './ui/otp-input'
import { Progress, StepMarks } from './ui/progress'
import { Select } from './ui/select'
import { SkeletonRow } from './ui/skeleton-row'
import { type Status, StatusLabel } from './ui/status'
import { Switch } from './ui/switch'
import { Tabs } from './ui/tabs'
import { Tag } from './ui/tag'
import { TextAction, TextLink } from './ui/text-link'
import { Textarea } from './ui/textarea'
import { ToastRegion } from './ui/toast'
import { UrlInput } from './ui/url-input'
import { WorkspacePreview } from './ui/workspace-preview'

const people = [
  { id: 'u1', name: 'Maya Chen' },
  { id: 'u2', name: 'Daniel Okafor' },
  { id: 'u3', name: 'Priya Raman' },
  { id: 'u4', name: 'Tom Baker' },
  { id: 'u5', name: 'Ana Ruiz' },
  { id: 'u6', name: 'Lee Park' },
]
const statuses: Status[] = ['draft', 'planning', 'in-progress', 'completed', 'archived']

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-caption font-medium text-text-muted">{title}</h2>
    <div className="flex flex-wrap items-center gap-6">{children}</div>
  </section>
)

const Panel = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [tab, setTab] = useState('plan')
  const [otp, setOtp] = useState('')
  const [dialog, setDialog] = useState(false)
  const [sizedDialog, setSizedDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [closes, setCloses] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [emailChips, setEmailChips] = useState<string[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  return (
    <div
      data-theme={theme}
      data-testid={theme}
      className="relative flex flex-1 flex-col gap-8 bg-bg p-8 text-text"
    >
      <h1 className="text-title font-semibold">Components ({theme})</h1>
      <Section title="Mobile navigation">
        <MobileTabs
          className="w-96"
          active="projects"
          items={[
            { id: 'home', label: 'Home', icon: House, href: '#home' },
            { id: 'my-tasks', label: 'My tasks', icon: CheckCircle2, href: '#my-tasks' },
            { id: 'inbox', label: 'Inbox', icon: Inbox, href: '#inbox', count: 3 },
            { id: 'projects', label: 'Projects', icon: FolderKanban, href: '#projects' },
          ]}
        />
      </Section>
      <Section title="Command palette">
        <Button onClick={() => setCommandOpen(true)}>Open command palette</Button>
        <CommandPalette
          open={commandOpen}
          onClose={() => setCommandOpen(false)}
          query={commandQuery}
          onQueryChange={setCommandQuery}
          groups={[
            {
              label: 'Commands',
              items: [
                {
                  id: 'create-project',
                  label: 'Create project',
                  leading: <span>+</span>,
                  content: <span>Create project</span>,
                  trailing: <kbd>C</kbd>,
                  onSelect: () => setCommandOpen(false),
                },
              ],
            },
          ]}
        />
      </Section>
      <Section title="Diagram canvas">
        <div className="h-64 w-full border border-border">
          <DiagramCanvas
            readOnly
            scene={{
              nodes: [
                {
                  id: 'gallery-start',
                  type: 'rectangle',
                  position: { x: 40, y: 30 },
                  data: { label: 'Start' },
                },
                {
                  id: 'gallery-end',
                  type: 'rectangle',
                  position: { x: 40, y: 150 },
                  data: { label: 'Complete' },
                },
              ],
              edges: [{ id: 'gallery-edge', source: 'gallery-start', target: 'gallery-end' }],
            }}
          />
        </div>
      </Section>
      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="danger-fill">Delete project</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button icon={Pencil}>With icon</Button>
        <Button disabled>Disabled</Button>
        <Button variant="choice" size="auto">
          Choice
        </Button>
        <Button variant="choice-selected" size="auto">
          Selected choice
        </Button>
        <TextLink href="#gallery-links">Text link</TextLink>
        <TextAction>Text action</TextAction>
      </Section>
      <Section title="Inputs">
        <div className="w-60 space-y-2">
          <Input placeholder="Project name" aria-label="Project name" />
          <Input height="lg" placeholder="Large input" aria-label="Large input" />
          <Input aria-invalid placeholder="Invalid input" aria-label="Invalid input" />
        </div>
        <div className="w-80">
          <UrlInput aria-label="Workspace URL slug" placeholder="northwind" />
        </div>
        <div className="w-80">
          <OtpInput value={otp} onChange={setOtp} />
        </div>
        <div className="w-60">
          <Textarea
            placeholder="Describe the problem this project solves."
            aria-label="Description"
          />
        </div>
        <div className="w-60">
          <Textarea height="invite" placeholder="Team email addresses" aria-label="Invite emails" />
        </div>
        <div className="w-80">
          <label htmlFor={`email-list-${theme}`}>Email addresses</label>
          <EmailListInput
            id={`email-list-${theme}`}
            values={emailChips}
            onChange={setEmailChips}
            input={emailInput}
            onInputChange={setEmailInput}
          />
        </div>
        <div className="w-60">
          <Select aria-label="Status" defaultValue="In progress">
            <option>Planning</option>
            <option>In progress</option>
            <option>Completed</option>
          </Select>
        </div>
        <Checkbox aria-label="Unchecked" />
        <Checkbox aria-label="Checked" defaultChecked />
        <Switch aria-label="Switch off" checked={false} />
        <Switch aria-label="Switch on" checked />
      </Section>
      <Section title="Tabs, avatars, progress">
        <Tabs
          tabs={[
            { id: 'tasks', label: 'Tasks' },
            { id: 'plan', label: 'Plan' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Avatar id="u1" name="Maya Chen" />
        <AvatarStack people={people} />
        <Progress value={60} label="Plan progress" />
        <StepMarks step={1} />
        <StepMarks step={2} />
      </Section>
      <Section title="Status">
        {statuses.map((s) => (
          <StatusLabel key={s} status={s} />
        ))}
      </Section>
      <Section title="Tags">
        <Tag>web</Tag>
        <Tag>billing</Tag>
        <Tag>self-serve</Tag>
      </Section>
      <Section title="Brand">
        <Brand />
        <LogoMark size={24} />
        <WorkspaceMark name="Northwind" />
      </Section>
      <Section title="Floating layers">
        <Menu
          label="Actions"
          items={[
            { label: 'Rename', icon: Pencil, onSelect: () => setToast('Renamed') },
            { label: 'Star', icon: Star, onSelect: () => setToast('Starred') },
            { label: 'Copy link', icon: Link, onSelect: () => setToast('Link copied') },
            {
              label: 'Delete project',
              icon: Trash2,
              danger: true,
              separated: true,
              onSelect: () => setDialog(true),
            },
          ]}
        />
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button onClick={() => setSizedDialog(true)}>Open 540px dialog</Button>
        <Button onClick={() => setSheet(true)}>Open full height sheet</Button>
        <Button onClick={() => setToast('Plan draft rejected.')}>Show toast</Button>
        <Dialog
          open={dialog}
          onClose={() => {
            setDialog(false)
            setCloses((c) => c + 1)
          }}
          title="Delete project"
          footer={
            <>
              <Button onClick={() => setDialog(false)}>Cancel</Button>
              <Button variant="danger-fill" onClick={() => setDialog(false)}>
                Delete project
              </Button>
            </>
          }
        >
          Customer portal rebuild and its 42 tasks, 4 diagrams and comments will be deleted. This
          can't be undone.
        </Dialog>
        <Dialog
          open={sizedDialog}
          onClose={() => setSizedDialog(false)}
          title="Custom dialog width"
          widthClassName="w-135"
          footer={<Button onClick={() => setSizedDialog(false)}>Done</Button>}
        >
          Use a 540px dialog for the project sharing controls.
        </Dialog>
        <Dialog
          open={sheet}
          onClose={() => setSheet(false)}
          title="Comments"
          fullHeight
          footer={<Button onClick={() => setSheet(false)}>Done</Button>}
        >
          On phones, longer threads open in a full height sheet.
        </Dialog>
        <p data-testid="closes" className="sr-only">
          {closes}
        </p>
        <ToastRegion
          className="absolute bottom-4 left-4"
          message={toast}
          action="Undo"
          onAction={() => setToast(null)}
        />
      </Section>
      <Section title="Workspace preview">
        <div className="w-100">
          <WorkspacePreview
            name="Northwind"
            slug="northwind"
            owner="Maya Chen"
            emails={[]}
            inviteRole="editor"
            invitations={false}
          />
        </div>
      </Section>
      <Section title="States">
        <div className="w-100">
          <EmptyState
            title="No projects yet"
            body="Projects hold a brief, a plan, tasks and diagrams."
            action={<Button>New project</Button>}
          />
        </div>
        <div className="w-100">
          <SkeletonRow />
        </div>
      </Section>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <div className="flex">
      <Panel theme="light" />
      <Panel theme="dark" />
    </div>
  </StrictMode>,
)
