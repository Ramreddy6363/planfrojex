import { Link, Pencil, Star, Trash2 } from 'lucide-react'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Avatar, AvatarStack } from './ui/avatar'
import { Brand, LogoMark } from './ui/brand'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog } from './ui/dialog'
import { EmptyState } from './ui/empty-state'
import { Input } from './ui/input'
import { Menu } from './ui/menu'
import { Progress } from './ui/progress'
import { Select } from './ui/select'
import { SkeletonRow } from './ui/skeleton-row'
import { type Status, StatusLabel } from './ui/status'
import { Tabs } from './ui/tabs'
import { Textarea } from './ui/textarea'
import { ToastRegion } from './ui/toast'

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
  const [dialog, setDialog] = useState(false)
  const [closes, setCloses] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  return (
    <div
      data-theme={theme}
      data-testid={theme}
      className="relative flex flex-1 flex-col gap-8 bg-bg p-8 text-text"
    >
      <h1 className="text-title font-semibold">Components ({theme})</h1>
      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="danger-fill">Delete project</Button>
        <Button size="sm">Small</Button>
        <Button icon={Pencil}>With icon</Button>
        <Button disabled>Disabled</Button>
      </Section>
      <Section title="Inputs">
        <div className="w-60">
          <Input placeholder="Project name" aria-label="Project name" />
        </div>
        <div className="w-60">
          <Textarea
            placeholder="Describe the problem this project solves."
            aria-label="Description"
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
      </Section>
      <Section title="Status">
        {statuses.map((s) => (
          <StatusLabel key={s} status={s} />
        ))}
      </Section>
      <Section title="Brand">
        <Brand />
        <LogoMark size={24} />
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
