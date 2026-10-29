export const Progress = ({ value: raw, label }: { value: number; label: string }) => {
  const value = Math.min(100, Math.max(0, raw))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-1 w-30 overflow-hidden rounded-xs bg-bg-muted"
    >
      <div className="h-full bg-accent" style={{ width: `${value}%` }} />
    </div>
  )
}
