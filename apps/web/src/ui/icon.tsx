import type { LucideIcon } from 'lucide-react'

// Lucide, 16px, 1.5 stroke (spec 5.4).
export const Icon = ({ icon: I, className }: { icon: LucideIcon; className?: string }) => (
  <I size={16} strokeWidth={1.5} aria-hidden className={className} />
)
