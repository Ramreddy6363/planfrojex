// Shared by the API's validation and the web app, so the two never drift apart.
export const reservedSlugs = new Set([
  'api',
  'auth',
  'sign-in',
  'sign-up',
  'verify',
  'onboarding',
  'invite',
  'assets', // the web build's /assets files
  // First segments of API routes: the single Worker answers these before the web app does.
  'me',
  'inbox',
  'projects',
  'workspaces',
  'diagrams',
  'drafts',
  'public',
  'integrations',
  'comments',
  'tasks',
  'invites',
  'risks',
  'milestones',
  'webhooks',
  'templates',
  'share',
  'review-requests',
  'decisions',
  'health',
])

// Names are shown in emails, so links and line breaks are not allowed.
export const nameHasLink = (name: string) => /:\/\/|www\.|[\r\n]/i.test(name)

export const validWorkspaceName = (name: string, maxLength = 100) =>
  name.length >= 1 && name.length <= maxLength && !nameHasLink(name)

export const validWorkspaceSlug = (slug: string) =>
  slug.length >= 3 &&
  slug.length <= 40 &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
  !reservedSlugs.has(slug)
