export const LogoMark = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
  </svg>
)

export const Brand = () => (
  <span
    role="img"
    aria-label="planfrojex"
    className="inline-flex items-baseline text-[16px] font-semibold tracking-[-0.3px] text-text"
  >
    planfr
    <LogoMark size={9} className="self-baseline" />
    jex
  </span>
)
