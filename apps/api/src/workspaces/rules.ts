// Shared by the API's validation and the web app, so the two never drift apart.
export const reservedSlugs = new Set([
  'api',
  'auth',
  'sign-in',
  'sign-up',
  'verify',
  'onboarding',
  'invite',
])

// Names are shown in emails, so links and line breaks are not allowed.
export const nameHasLink = (name: string) => /:\/\/|www\.|[\r\n]/i.test(name)
