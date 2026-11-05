import { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { api, call, RequestError } from './api'
import { auth } from './auth-client'
import { chooseWorkspace } from './last-workspace'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

export const getMe = () =>
  queryClient.fetchQuery({ queryKey: ['me'], queryFn: () => call(api.me.$get()) })

export const getWorkspace = (slug: string) =>
  queryClient.fetchQuery({
    queryKey: ['workspace', slug],
    queryFn: () => call(api.workspaces[':ws'].$get({ param: { ws: slug } })),
  })

// Signed-out visitors go to sign-in. Other failures pass through; the API enforces access anyway.
export async function requireSignedIn() {
  try {
    const { user } = await getMe()
    if (user?.email) sessionStorage.setItem('email', user.email)
    if (!sessionStorage.getItem('displayName')) {
      const session = await auth.getSession().catch(() => null)
      if (session?.data?.user.name) sessionStorage.setItem('displayName', session.data.user.name)
    }
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) throw redirect({ to: '/sign-in' })
  }
}

export async function acceptInvite(token: string) {
  const { workspace } = await call(api.invites.accept.$post({ json: { token } }))
  sessionStorage.removeItem('invite')
  return `/${workspace.slug}`
}

// Where a signed-in user lands: a pending invite's workspace, the last used one, or onboarding.
export async function nextPath() {
  const token = sessionStorage.getItem('invite')
  if (token) {
    try {
      return await acceptInvite(token)
    } catch {
      return `/invite/${token}`
    }
  }
  const { workspaces } = await getMe()
  const slug = chooseWorkspace(workspaces, localStorage.getItem('lastWorkspace'))
  return slug ? `/${slug}` : '/onboarding'
}

export async function enterApp(): Promise<never> {
  let to = '/sign-in'
  try {
    to = await nextPath()
  } catch {}
  throw redirect({ to })
}

export type StoredWorkspace = { name: string; slug: string }
export function storedWorkspace(): StoredWorkspace | null {
  try {
    return JSON.parse(sessionStorage.getItem('onboardingWorkspace') ?? 'null')
  } catch {
    return null
  }
}

export async function createWorkspace(input: {
  name: string
  slug: (attempt: number) => string
  isPersonal: boolean
}) {
  // A personal space gets its URL from the name, so a taken URL retries with a suffix.
  for (let attempt = 0; ; attempt++) {
    try {
      const { workspace } = await call(
        api.workspaces.$post({
          json: { name: input.name, slug: input.slug(attempt), isPersonal: input.isPersonal },
        }),
      )
      sessionStorage.setItem('onboardingWorkspace', JSON.stringify(workspace))
      return workspace
    } catch (error) {
      const retry =
        input.isPersonal && error instanceof RequestError && error.status === 409 && attempt < 99
      if (!retry) throw error
    }
  }
}
