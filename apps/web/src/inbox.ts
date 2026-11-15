import { api, call } from './api'

export const inboxKey = (slug: string) => ['inbox', slug] as const
export const getInbox = (slug: string, cursor: string | null = null, limit = '50') =>
  call(api.inbox.$get({ query: { ws: slug, limit, ...(cursor ? { cursor } : {}) } }))
