const bar = 'h-2.5 rounded-[3px] bg-bg-muted'

export const SkeletonRow = () => (
  <div aria-hidden className="flex h-9 items-center gap-4 border-b border-border px-3">
    <div className={`${bar} w-4`} />
    <div className={`${bar} w-40`} />
    <div className={`${bar} w-16`} />
    <div className={`${bar} w-12`} />
  </div>
)

// The drawn loading state: a list of skeleton rows, announced once as "Loading".
export const SkeletonRows = ({ count = 7 }: { count?: number }) => (
  <div role="status" aria-label="Loading">
    {Array.from({ length: count }, (_, n) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: identical static rows never reorder
      <SkeletonRow key={n} />
    ))}
  </div>
)
