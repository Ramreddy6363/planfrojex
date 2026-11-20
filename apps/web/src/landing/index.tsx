import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Bell,
  BookOpenCheck,
  Boxes,
  Braces,
  CircleCheck,
  Clock3,
  FileText,
  GitBranch,
  LayoutGrid,
  MessageSquareText,
  Search,
  ShoppingCart,
  Smartphone,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useState } from 'react'
import { Brand, LogoMark } from '../ui/brand'
import { Icon } from '../ui/icon'
import { Tabs } from '../ui/tabs'
import { ProductWindow } from './product-window'
import { templateCatalog } from './template-catalog'

const templateMeta = {
  blank: { category: 'Product', icon: FileText },
  saas: { category: 'Product', icon: LayoutGrid },
  ml: { category: 'Product', icon: Boxes },
  mobile: { category: 'Mobile', icon: Smartphone },
  commerce: { category: 'Commerce', icon: ShoppingCart },
  portfolio: { category: 'Internal', icon: UserRound },
} as const

const templates = templateCatalog.map((item) => ({ ...item, ...templateMeta[item.id] }))

const templateTabs = ['All', 'Product', 'Mobile', 'Commerce', 'Internal'].map((label) => ({
  id: label,
  label,
}))

const roles = [
  {
    title: 'Product manager',
    description: 'Turn a rough brief into milestones the team can agree on.',
    start: 'Plan drafts',
    icon: BookOpenCheck,
  },
  {
    title: 'Engineering lead',
    description: 'Write down risks and estimates before the work is underway.',
    start: 'Risks section',
    icon: Braces,
  },
  {
    title: 'Designer',
    description: 'Keep flows and the work that follows them in one project.',
    start: 'Diagrams',
    icon: GitBranch,
  },
  {
    title: 'Engineer',
    description: 'See the tasks you own and the dates the team agreed on.',
    start: 'My tasks',
    icon: CircleCheck,
  },
]

const capabilities = [
  {
    title: 'Search projects and tasks',
    description: 'Jump to a project, task or command.',
    icon: Search,
  },
  {
    title: 'Inbox and mentions',
    description: 'See replies, assignments and mentions in one place.',
    icon: Bell,
  },
  {
    title: 'Diagram history',
    description: 'Save versions and restore a previous diagram.',
    icon: Clock3,
  },
  {
    title: 'Workspace roles',
    description: 'Choose owner, editor or viewer access.',
    icon: UsersRound,
  },
  {
    title: 'Comments',
    description: 'Keep project and task discussions with the work.',
    icon: MessageSquareText,
  },
  {
    title: 'Share links',
    description: 'Give people a read-only view of the plan.',
    icon: GitBranch,
  },
]

const LandingButton = ({ children }: { children: string }) => (
  <Link
    to="/sign-up"
    className="inline-flex min-h-11 items-center justify-center rounded-control border border-transparent bg-accent px-5 text-ui font-medium text-on-accent hover:opacity-90"
  >
    {children}
  </Link>
)

const SignInLink = ({ className = '' }: { className?: string }) => (
  <Link
    to="/sign-in"
    className={`inline-flex min-h-11 items-center justify-center rounded-control px-3 text-ui font-medium text-text hover:bg-bg-muted ${className}`}
  >
    Sign in
  </Link>
)

function LandingNav() {
  return (
    <header className="mx-auto w-full max-w-[1440px] px-4 pt-3 md:px-6 md:pt-4">
      <nav
        aria-label="Primary"
        className="flex min-h-12 items-center justify-between gap-2 rounded-panel border border-border bg-bg px-3 md:px-4"
      >
        <a href="#top" aria-label="PlanFrojex home" className="shrink-0 py-2">
          <Brand />
        </a>
        <div className="hidden items-center gap-7 md:flex">
          <a className="text-ui text-text-muted hover:text-text" href="#product">
            Product
          </a>
          <a className="text-ui text-text-muted hover:text-text" href="#templates">
            Templates
          </a>
          <a className="text-ui text-text-muted hover:text-text" href="#teams">
            Teams
          </a>
        </div>
        <div className="flex items-center gap-1">
          <SignInLink />
          <LandingButton>Get started</LandingButton>
        </div>
      </nav>
    </header>
  )
}

function MilestoneRuler() {
  const milestones = [
    { left: '10%', title: 'Plan agreed', date: 'Oct 11', done: true },
    { left: '34%', title: 'M1 · Sign-in', date: 'Oct 31' },
    { left: '58%', title: 'M2 · Billing', date: 'Nov 21' },
    { left: '82%', title: 'Launch', date: 'Dec 12' },
  ]
  return (
    <div
      role="img"
      aria-label="A project timeline from October to January"
      className="relative mx-auto mt-12 h-24 w-full max-w-[1120px] px-8 md:mt-14"
    >
      <div className="absolute left-8 right-8 top-10 h-px bg-border-strong" />
      <div className="absolute left-[10%] top-10 h-0.5 w-[19%] bg-text" />
      <div className="absolute left-[29%] top-10 h-0.5 w-[19%] bg-accent" />
      {['OCT', 'NOV', 'DEC', 'JAN'].map((month, index) => (
        <span
          key={month}
          className="absolute top-14 -translate-x-1/2 font-mono text-[10px] text-text-muted"
          style={{ left: `${10 + index * 26}%` }}
        >
          {month}
        </span>
      ))}
      {milestones.map((milestone) => (
        <div
          key={milestone.title}
          className="absolute top-0 -translate-x-1/2 text-center"
          style={{ left: milestone.left }}
        >
          <span className="block whitespace-nowrap text-caption font-medium text-text">
            {milestone.title}
          </span>
          <span className="block text-caption text-text-muted">{milestone.date}</span>
          <span
            aria-hidden="true"
            className={`absolute left-1/2 top-[37px] size-3 -translate-x-1/2 rotate-45 border border-text ${milestone.done ? 'bg-text' : 'bg-bg'}`}
          />
        </div>
      ))}
      <span aria-hidden="true" className="absolute left-[29%] top-8 h-7 w-0.5 bg-accent" />
      <span className="absolute left-[29%] top-[68px] -translate-x-1/2 rounded-control bg-accent px-2 py-1 font-mono text-[10px] text-on-accent">
        TODAY
      </span>
    </div>
  )
}

function Hero() {
  return (
    <section id="top" className="relative px-4 pb-16 pt-16 text-center md:pb-20 md:pt-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-96 bg-accent/5"
      />
      <div className="relative mx-auto max-w-[780px]">
        <h1 className="text-5xl font-semibold leading-[1.04] tracking-[-0.045em] md:text-[72px]">
          Plans your team
          <br className="hidden sm:block" /> actually follows.
        </h1>
        <p className="mx-auto mt-5 max-w-[560px] text-body leading-7 text-text-muted md:text-dialog">
          Start with a rough brief. Review the plan together, then keep the work and decisions
          connected.
        </p>
        <p className="mt-3 text-ui text-text-muted">
          Free for one person. Bring the team in when the plan is ready.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <LandingButton>Start planning free</LandingButton>
          <a
            href="#product"
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-bg px-5 text-ui font-medium text-text hover:bg-bg-muted"
          >
            See a real plan <Icon icon={ArrowUpRight} className="ml-1" />
          </a>
        </div>
        <ul className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-caption text-text-muted">
          <li>One person can start free</li>
          <li>Invite the team when ready</li>
        </ul>
      </div>
      <div className="relative z-10 px-1">
        <MilestoneRuler />
      </div>
    </section>
  )
}

function Templates() {
  const [category, setCategory] = useState('All')
  const visible = templates.filter(
    (template) => category === 'All' || template.category === category,
  )
  return (
    <section
      id="templates"
      aria-label="Templates"
      className="scroll-mt-8 px-5 py-20 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-title font-semibold md:text-[32px] md:leading-10">
            There’s a template for that.
          </h2>
          <p className="mt-3 text-body text-text-muted">
            Start from a structure that has worked before, or from a blank page.
          </p>
        </div>
        <div className="mt-8 flex justify-center">
          <div className="rounded-panel border border-border bg-bg p-1 [&_[role=tab]]:h-11">
            <Tabs tabs={templateTabs} value={category} onChange={setCategory} />
          </div>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((template) => (
            <article
              key={template.id}
              className="min-h-36 rounded-panel border border-border bg-bg p-5"
            >
              <span className="mb-3 inline-flex size-9 items-center justify-center rounded-control border border-border bg-bg-subtle text-text">
                <Icon icon={template.icon} />
              </span>
              <h3 className="font-medium text-text">{template.name}</h3>
              <p className="mt-1 text-ui text-text-muted">{template.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function DecisionSection() {
  return (
    <section className="bg-bg-subtle px-5 py-20 md:px-10 md:py-24">
      <div className="mx-auto max-w-[1100px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-title font-semibold md:text-[32px] md:leading-10">
            Draft the plan. Keep the decisions.
          </h2>
          <p className="mt-3 text-body text-text-muted">
            A draft starts from the brief your team wrote. Nothing changes until someone accepts it.
          </p>
        </div>
        <div className="mx-auto mt-10 max-w-[720px] rounded-panel border border-border bg-bg p-4 md:p-6">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <span className="inline-flex size-8 items-center justify-center rounded-control bg-bg-subtle text-warning">
              <Icon icon={FileText} />
            </span>
            <div>
              <p className="font-medium">Draft from the brief is ready</p>
              <p className="text-caption text-text-muted">
                Review each change before it becomes part of the plan.
              </p>
            </div>
          </div>
          <div className="space-y-3 py-4">
            <div className="rounded-control border border-border bg-bg-subtle p-3">
              <p className="text-caption font-medium text-text-muted">REQUIREMENTS</p>
              <p className="mt-2 text-ui">Customers can find and update their account details.</p>
              <p className="mt-2 text-ui text-success">
                + Keep account changes in one clear place.
              </p>
            </div>
            <div className="rounded-control border border-border p-3">
              <p className="text-caption font-medium text-success">ACCEPTED</p>
              <p className="mt-2 text-ui">Account owners can invite teammates to the workspace.</p>
            </div>
          </div>
          <div className="border-t border-border pt-3 text-caption text-text-muted">
            Each decision stays in the project history.
          </div>
        </div>
        <div className="mx-auto mt-5 grid max-w-[980px] gap-4 sm:grid-cols-2">
          <article className="rounded-panel border border-border bg-bg p-5">
            <div className="flex items-center gap-2 font-medium">
              <Icon icon={FileText} className="text-accent" />
              <h3>Draft a plan from the brief</h3>
            </div>
            <p className="mt-3 text-ui leading-5 text-text-muted">
              Requirements, user stories, milestones, risks and estimates in one reviewable draft.
            </p>
          </article>
          <article className="rounded-panel border border-border bg-bg p-5">
            <div className="flex items-center gap-2 font-medium">
              <Icon icon={GitBranch} className="text-accent" />
              <h3>Draft a diagram</h3>
            </div>
            <p className="mt-3 text-ui leading-5 text-text-muted">
              Describe a flow, then review the editable diagram before it joins the project.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}

function Roles() {
  return (
    <section id="teams" className="scroll-mt-8 px-5 py-20 md:px-10 md:py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-title font-semibold md:text-[32px] md:leading-10">
            Built for small product teams.
          </h2>
          <p className="mt-3 text-body text-text-muted">
            Everyone gets a useful view of the same plan.
          </p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {roles.map((role) => (
            <article key={role.title} className="rounded-panel border border-border bg-bg p-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-8 items-center justify-center rounded-control bg-bg-subtle text-text-muted">
                  <Icon icon={role.icon} />
                </span>
                <h3 className="font-medium">{role.title}</h3>
              </div>
              <p className="mt-4 min-h-[60px] text-ui leading-5 text-text-muted">
                {role.description}
              </p>
              <div className="mt-4 border-t border-border pt-3">
                <p className="font-mono text-[10px] text-text-faint">WHERE TO START</p>
                <span className="mt-1 inline-block text-ui font-medium text-accent">
                  {role.start}
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function ConnectedWork() {
  return (
    <section className="px-5 py-20 md:px-10 md:py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-title font-semibold md:text-[32px] md:leading-10">
            Don’t plan twice.
          </h2>
          <p className="mt-3 text-body text-text-muted">
            Plans, tasks, discussions and decisions stay connected.
          </p>
        </div>
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          <article className="rounded-panel border border-border bg-bg p-5">
            <h3 className="mb-4 font-medium">Tasks from the plan</h3>
            {[
              'Confirm sign-in requirements',
              'Review billing flow',
              'Prepare launch checklist',
            ].map((task) => (
              <div
                key={task}
                className="flex min-h-10 items-center gap-3 border-b border-border text-ui last:border-0"
              >
                <span
                  className="size-4 rounded-control border border-border-strong"
                  aria-hidden="true"
                />
                {task}
              </div>
            ))}
            <p className="mt-5 border-t border-border pt-4 text-body font-medium">
              Tasks keep owners and dates.
            </p>
          </article>
          <article className="rounded-panel border border-border bg-bg p-5">
            <h3 className="mb-4 font-medium">A history you can follow</h3>
            {[
              ['Maya', 'edited the requirements section'],
              ['Luis', 'commented on a task'],
              ['Priya', 'accepted a milestone'],
            ].map(([name, action]) => (
              <div
                key={`${name}-${action}`}
                className="flex min-h-10 items-center gap-2 border-b border-border text-ui last:border-0"
              >
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-muted text-caption font-medium">
                  {name?.charAt(0) ?? ''}
                </span>
                <span className="font-medium">{name}</span>
                <span className="truncate text-text-muted">{action}</span>
              </div>
            ))}
            <p className="mt-5 border-t border-border pt-4 text-body font-medium">
              Edits and decisions have a record.
            </p>
          </article>
          <article className="rounded-panel border border-border bg-bg p-5">
            <div className="flex h-20 items-center gap-3 rounded-control border border-border bg-bg-subtle px-4">
              <Icon icon={GitBranch} className="text-text-muted" />
              <span className="font-mono text-caption text-text">planfrojex.app/share/••••••</span>
            </div>
            <p className="mt-5 font-medium">One link for everyone else</p>
            <p className="mt-2 text-ui text-text-muted">
              Share a read-only plan with clients or another team. Revoke it when you’re done.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}

function Capabilities() {
  return (
    <section className="bg-bg-subtle px-5 py-20 md:px-10 md:py-24">
      <div className="mx-auto max-w-[1200px]">
        <h2 className="text-center text-title font-semibold md:text-[32px] md:leading-10">
          What else can PlanFrojex do?
        </h2>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((item) => (
            <article
              key={item.title}
              className="flex min-h-24 items-start gap-3 rounded-panel border border-border bg-bg p-4"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-bg-subtle text-text-muted">
                <Icon icon={item.icon} />
              </span>
              <div>
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 text-ui text-text-muted">{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section className="relative overflow-hidden px-5 py-20 text-center md:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-0 size-64 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl md:size-80"
      />
      <div className="relative mx-auto max-w-xl">
        <LogoMark size={64} className="mx-auto text-accent" />
        <h2 className="mt-6 text-title font-semibold md:text-[36px] md:leading-[44px]">
          Start with the brief.
        </h2>
        <p className="mt-3 text-body text-text-muted">
          Free for one person. Bring the team in when the plan is ready.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <LandingButton>Start planning free</LandingButton>
          <a
            href="#product"
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-bg px-5 text-ui font-medium hover:bg-bg-muted"
          >
            See a real plan
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border px-5 py-8 md:px-10">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Brand />
          <p className="mt-2 max-w-lg text-ui text-text-muted">
            Briefs, plans, and team work in one place.
          </p>
        </div>
        <SignInLink className="self-start sm:self-auto" />
      </div>
    </footer>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-bg text-text">
      <LandingNav />
      <main>
        <Hero />
        <section id="product" className="scroll-mt-8 px-5 pb-20 pt-12 md:px-10 md:pb-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-title font-semibold md:text-[32px] md:leading-10">
              It’s not about writing plans.
            </h2>
            <p className="mt-2 text-title font-semibold text-text-muted md:text-[32px] md:leading-10">
              It’s about the whole team agreeing on one.
            </p>
          </div>
          <div className="relative mx-auto mt-10 max-w-[1200px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/4 -z-0 hidden size-80 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl md:block"
            />
            <div className="mb-5 hidden gap-4 md:grid md:grid-cols-2 xl:hidden">
              <Callout
                title="Drafts, not autopilot"
                text="Nothing changes until someone accepts it."
              />
              <Callout
                title="Every line reviewable"
                text="Read each proposed change before it lands."
              />
              <Callout
                title="Owners and dates"
                text="Accepted milestones keep their people and dates."
              />
              <Callout
                title="One link to share"
                text="Clients can read the plan without joining."
              />
            </div>
            <div className="relative grid items-center gap-5 xl:grid-cols-[minmax(120px,1fr)_minmax(0,900px)_minmax(120px,1fr)]">
              <aside className="hidden space-y-36 text-right xl:block">
                <Callout
                  title="Drafts, not autopilot"
                  text="Nothing changes until someone accepts it."
                />
                <Callout
                  title="Every line reviewable"
                  text="Read each proposed change before it lands."
                />
              </aside>
              <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-bg shadow-float">
                <ProductWindow />
              </div>
              <aside className="hidden space-y-36 text-left xl:block">
                <Callout
                  title="Owners and dates"
                  text="Accepted milestones keep their people and dates."
                />
                <Callout
                  title="One link to share"
                  text="Clients can read the plan without joining."
                />
              </aside>
            </div>
          </div>
        </section>
        <Templates />
        <DecisionSection />
        <Roles />
        <ConnectedWork />
        <Capabilities />
        <Closing />
      </main>
      <Footer />
    </div>
  )
}

function Callout({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="text-ui font-semibold">{title}</h3>
      <p className="mt-1 text-ui leading-5 text-text-muted">{text}</p>
    </div>
  )
}
