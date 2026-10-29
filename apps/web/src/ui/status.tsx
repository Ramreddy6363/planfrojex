export type Status = 'draft' | 'planning' | 'in-progress' | 'completed' | 'archived'

const meta: Record<Status, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'text-text-faint' },
  planning: { label: 'Planning', color: 'text-text-muted' },
  'in-progress': { label: 'In progress', color: 'text-warning' },
  completed: { label: 'Completed', color: 'text-success' },
  archived: { label: 'Archived', color: 'text-text-faint' },
}

export const StatusGlyph = ({ status }: { status: Status }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    aria-hidden
    className={meta[status].color}
  >
    <circle cx="7" cy="7" r="6" strokeDasharray={status === 'draft' ? '2 2' : undefined} />
    {status === 'in-progress' && <path d="M7 3a4 4 0 0 1 0 8z" fill="currentColor" stroke="none" />}
    {status === 'completed' && <path d="M4.5 7.2 6.3 9l3.2-3.6" strokeLinecap="round" />}
    {status === 'archived' && <path d="M4.5 7h5" strokeLinecap="round" />}
  </svg>
)

export const StatusLabel = ({ status }: { status: Status }) => (
  <span className="inline-flex h-5.5 items-center gap-1.5 text-ui text-text">
    <StatusGlyph status={status} />
    {meta[status].label}
  </span>
)
