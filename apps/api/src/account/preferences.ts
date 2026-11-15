export const notificationTypes = [
  'mention',
  'assigned',
  'draft_ready',
  'drift',
  'weekly_summary',
] as const
export const notificationDefaults = [
  { type: 'mention', email: true, inApp: true },
  { type: 'assigned', email: true, inApp: true },
  { type: 'draft_ready', email: false, inApp: true },
  { type: 'drift', email: true, inApp: true },
  { type: 'weekly_summary', email: true, inApp: false },
] as const
