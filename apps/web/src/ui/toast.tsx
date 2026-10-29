// Keep <ToastRegion> mounted; screen readers announce what is added to an existing live region.
export const ToastRegion = ({
  message,
  action,
  onAction,
  className = 'fixed bottom-4 left-4',
}: {
  message: string | null
  action?: string
  onAction?: () => void
  className?: string
}) => (
  <div role="status" aria-live="polite" className={className}>
    {message && (
      <div className="flex w-85 items-center justify-between gap-3 rounded-panel bg-text px-3.5 py-2.5 text-ui leading-[18px] text-bg shadow-float">
        <span>{message}</span>
        {action && (
          <button type="button" onClick={onAction} className="font-semibold">
            {action}
          </button>
        )}
      </div>
    )}
  </div>
)
