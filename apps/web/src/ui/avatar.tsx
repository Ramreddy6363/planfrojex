const tones = ['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3']

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export const Avatar = ({
  id,
  name,
  className = '',
}: {
  id: string
  name: string
  className?: string
}) => (
  <span
    role="img"
    aria-label={name}
    className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-avatar-text ${tones[hash(id) % 3]} ${className}`}
  >
    {initials(name)}
  </span>
)

export const AvatarStack = ({
  people,
  max = 3,
}: {
  people: { id: string; name: string }[]
  max?: number
}) => (
  <span className="inline-flex items-center">
    {people.slice(0, max).map((p, i) => (
      <Avatar key={p.id} {...p} className={`ring-2 ring-bg ${i ? '-ml-1' : ''}`} />
    ))}
    {people.length > max && (
      <span className="-ml-1 inline-flex size-6 items-center justify-center rounded-full bg-bg-muted text-[10px] font-semibold text-text-muted ring-2 ring-bg">
        +{people.length - max}
      </span>
    )}
  </span>
)
