const bar = 'h-2.5 rounded-[3px] bg-bg-muted'

export const SkeletonRow = () => (
  <div aria-hidden className="flex h-9 items-center gap-4 border-b border-border px-3">
    <div className={`${bar} w-4`} />
    <div className={`${bar} w-40`} />
    <div className={`${bar} w-16`} />
    <div className={`${bar} w-12`} />
  </div>
)
