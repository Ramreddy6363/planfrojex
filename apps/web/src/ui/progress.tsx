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

export function StepMarks({ step, total = 2 }: { step: number; total?: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Onboarding steps"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step}
      className="flex gap-1"
    >
      {Array.from({ length: total }, (_, index) => index + 1).map((value) => (
        <span
          key={value}
          aria-hidden="true"
          className={`h-[3px] w-8 rounded-xs ${value <= step ? 'bg-text' : 'bg-border'}`}
        />
      ))}
    </div>
  )
}
